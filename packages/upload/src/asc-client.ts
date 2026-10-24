import { addSecret, mask } from '@vitrin/core';
import { importPKCS8, SignJWT } from 'jose';
import { existsSync, readFileSync } from 'node:fs';

const BASE = 'https://api.appstoreconnect.apple.com';
/** Apple allows at most 20 minutes; we stay a bit below. */
const TOKEN_LIFETIME_SEC = 19 * 60;

export interface AscCredentials {
  keyId: string;
  issuerId: string;
  privateKey: string;
}

export class AscCredentialError extends Error {}

/** Reads ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH (or ASC_KEY_CONTENT_BASE64). Throws with a readable message. */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): AscCredentials {
  const keyId = env.ASC_KEY_ID?.trim();
  const issuerId = env.ASC_ISSUER_ID?.trim();
  let privateKey: string | undefined;
  if (env.ASC_KEY_CONTENT_BASE64?.trim()) {
    privateKey = Buffer.from(env.ASC_KEY_CONTENT_BASE64.trim(), 'base64').toString('utf8');
  } else if (env.ASC_KEY_PATH?.trim()) {
    if (!existsSync(env.ASC_KEY_PATH.trim())) throw new AscCredentialError(`.p8 file not found: ${env.ASC_KEY_PATH}`);
    privateKey = readFileSync(env.ASC_KEY_PATH.trim(), 'utf8');
  }
  if (!keyId || !issuerId || !privateKey) throw new AscCredentialError('ASC API key is missing (ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH).');
  if (!isPem(privateKey)) throw new AscCredentialError('.p8 content is not in PEM format (expected -----BEGIN PRIVATE KEY-----).');
  addSecret(keyId);
  addSecret(issuerId);
  return { keyId, issuerId, privateKey };
}

export function isPem(text: string): boolean {
  return /-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(text.trim());
}

export async function createToken(creds: AscCredentials, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await importPKCS8(creds.privateKey, 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: creds.keyId, typ: 'JWT' })
    .setIssuer(creds.issuerId)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_LIFETIME_SEC)
    .setAudience('appstoreconnect-v1')
    .sign(key);
  addSecret(token);
  return token;
}

export class AscApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly errors: Array<{ code?: string; title?: string; detail?: string }>,
  ) {
    super(mask(`ASC API ${status} ${path}: ${errors.map((e) => e.detail ?? e.title ?? e.code).join('; ')}`));
  }
}

export interface JsonApiResource<A = Record<string, unknown>> {
  type: string;
  id: string;
  attributes: A;
  relationships?: Record<string, { data?: { type: string; id: string } | Array<{ type: string; id: string }> }>;
}

export interface JsonApiDocument<A = Record<string, unknown>> {
  data: JsonApiResource<A> | Array<JsonApiResource<A>>;
  included?: JsonApiResource[];
  links?: { next?: string };
}

export class AscClient {
  private token?: { value: string; exp: number };

  constructor(
    private readonly creds: AscCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async auth(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (!this.token || this.token.exp - now < 60) {
      this.token = { value: await createToken(this.creds, now), exp: now + TOKEN_LIFETIME_SEC };
    }
    return this.token.value;
  }

  async request<T = JsonApiDocument>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const url = path.startsWith('http') ? path : BASE + path;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.auth()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get('retry-after') ?? 2 ** attempt * 2);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.request<T>(method, path, body, attempt + 1);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new AscApiError(res.status, path, (json.errors as AscApiError['errors']) ?? [{ detail: text.slice(0, 300) }]);
    }
    return json as T;
  }

  get<T = JsonApiDocument>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** Follows `links.next` and concatenates `data`. */
  async getAll<A = Record<string, unknown>>(path: string, max = 20): Promise<Array<JsonApiResource<A>>> {
    const out: Array<JsonApiResource<A>> = [];
    let next: string | undefined = path;
    for (let i = 0; next && i < max; i++) {
      const doc: JsonApiDocument<A> = await this.get<JsonApiDocument<A>>(next);
      out.push(...(Array.isArray(doc.data) ? doc.data : [doc.data]));
      next = doc.links?.next;
    }
    return out;
  }

  async findApp(bundleId: string): Promise<JsonApiResource<{ name: string; bundleId: string; sku: string; primaryLocale: string }> | null> {
    const doc = await this.get<JsonApiDocument<{ name: string; bundleId: string; sku: string; primaryLocale: string }>>(
      `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
    );
    const list = Array.isArray(doc.data) ? doc.data : [doc.data];
    return list.find((a) => a.attributes.bundleId === bundleId) ?? null;
  }

  async appStoreVersions(appId: string, platform = 'IOS') {
    return this.getAll<{ versionString: string; appStoreState?: string; appVersionState?: string; platform: string }>(
      `/v1/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=50`,
    );
  }

  async versionLocalizations(versionId: string) {
    return this.getAll<Record<string, string | null>>(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=50`);
  }

  async appInfos(appId: string) {
    return this.getAll<{ appStoreState?: string; state?: string }>(`/v1/apps/${appId}/appInfos`);
  }

  async appInfoLocalizations(appInfoId: string) {
    return this.getAll<Record<string, string | null>>(`/v1/appInfos/${appInfoId}/appInfoLocalizations?limit=50`);
  }

  /** GET /v1/appAssetLibraryRefData — placements, display classes, dimensions and limits (API 4.5.1). */
  async assetLibraryRefData(): Promise<unknown> {
    return this.get('/v1/appAssetLibraryRefData');
  }
}

/** Version states in which metadata can still be edited. */
export const EDITABLE_VERSION_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
]);

export function isEditableVersion(v: { attributes: { appStoreState?: string; appVersionState?: string } }): boolean {
  const s = v.attributes.appVersionState ?? v.attributes.appStoreState ?? '';
  return EDITABLE_VERSION_STATES.has(s);
}
