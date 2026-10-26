import { addSecret, mask } from '@vitrin/core';
import { importPKCS8, SignJWT } from 'jose';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** The fields of a Google service account key file Vitrin relies on. */
export interface ServiceAccount {
  type: 'service_account';
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
  token_uri: string;
}

export class PlayCredentialError extends Error {}

/** Parses and checks a service account JSON key (no network). Returns readable problems instead of throwing. */
export function parseServiceAccount(text: string): { account?: ServiceAccount; problems: string[] } {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { problems: ['not valid JSON'] };
  }
  const problems: string[] = [];
  if (data.type !== 'service_account') problems.push(`"type" is ${JSON.stringify(data.type ?? null)}, expected "service_account" (an OAuth client or user credential will not work)`);
  if (typeof data.client_email !== 'string' || !/@.+\.iam\.gserviceaccount\.com$/.test(data.client_email)) problems.push('"client_email" is missing or not a service account address (…@….iam.gserviceaccount.com)');
  if (typeof data.private_key !== 'string' || !/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(data.private_key)) problems.push('"private_key" is missing or not a PEM private key');
  if (problems.length) return { problems };
  return {
    account: {
      type: 'service_account',
      client_email: data.client_email as string,
      private_key: data.private_key as string,
      private_key_id: typeof data.private_key_id === 'string' ? data.private_key_id : undefined,
      project_id: typeof data.project_id === 'string' ? data.project_id : undefined,
      token_uri: typeof data.token_uri === 'string' ? data.token_uri : 'https://oauth2.googleapis.com/token',
    },
    problems,
  };
}

export interface PlayKeySource {
  /** Absolute path when GOOGLE_PLAY_JSON_KEY_PATH is used. */
  path?: string;
  /** Where the key came from, for messages. */
  from: 'GOOGLE_PLAY_JSON_KEY_PATH' | 'GOOGLE_PLAY_JSON_KEY_BASE64';
  account?: ServiceAccount;
  problems: string[];
}

/** True when either Play key variable is set (they are alternatives). */
export function hasPlayKey(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.GOOGLE_PLAY_JSON_KEY_PATH?.trim() || env.GOOGLE_PLAY_JSON_KEY_BASE64?.trim());
}

/**
 * Reads GOOGLE_PLAY_JSON_KEY_BASE64 (CI) or GOOGLE_PLAY_JSON_KEY_PATH (relative to the app root), registers every
 * secret part for log masking, and validates the JSON. Returns undefined when neither variable is set.
 */
export function playKeyFromEnv(env: NodeJS.ProcessEnv, root: string): PlayKeySource | undefined {
  const b64 = env.GOOGLE_PLAY_JSON_KEY_BASE64?.trim();
  const p = env.GOOGLE_PLAY_JSON_KEY_PATH?.trim();
  let text: string;
  let source: PlayKeySource;
  if (b64) {
    addSecret(b64);
    text = Buffer.from(b64, 'base64').toString('utf8');
    source = { from: 'GOOGLE_PLAY_JSON_KEY_BASE64', problems: [] };
  } else if (p) {
    const full = isAbsolute(p) ? p : resolve(root, p);
    source = { from: 'GOOGLE_PLAY_JSON_KEY_PATH', path: full, problems: [] };
    if (!existsSync(full)) return { ...source, problems: [`file not found: ${p}`] };
    text = readFileSync(full, 'utf8');
  } else return undefined;
  const parsed = parseServiceAccount(text);
  if (parsed.account) {
    addSecret(parsed.account.private_key);
    addSecret(parsed.account.private_key_id);
  }
  return { ...source, account: parsed.account, problems: parsed.problems };
}

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

export class PlayApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    detail: string,
  ) {
    super(mask(`Google Play API ${status} ${path}: ${detail}`));
  }
}

export interface PlayRemoteListing {
  language: string;
  title?: string;
  shortDescription?: string;
  fullDescription?: string;
  video?: string;
}

export interface PlayRemoteRelease {
  name?: string;
  versionCodes?: string[];
  status?: string;
  releaseNotes?: Array<{ language: string; text: string }>;
}

export interface PlayRemoteState {
  listings: PlayRemoteListing[];
  /** Releases on the requested track; undefined when the track does not exist. */
  releases?: PlayRemoteRelease[];
}

/**
 * Minimal read-only Android Publisher v3 client: service-account JWT → OAuth token, then an edit that is
 * always deleted again. Vitrin uploads through supply; this client only reads (plan diff, read-back, doctor).
 */
export class PlayClient {
  private token?: { value: string; exp: number };

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async auth(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.exp - now > 60) return this.token.value;
    const key = await importPKCS8(this.account.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(this.account.private_key_id ? { kid: this.account.private_key_id } : {}) })
      .setIssuer(this.account.client_email)
      .setAudience(this.account.token_uri)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const res = await this.fetchImpl(this.account.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !json.access_token) throw new PlayApiError(res.status, 'oauth2/token', json.error_description ?? json.error ?? 'no access token');
    addSecret(json.access_token);
    this.token = { value: json.access_token, exp: now + (json.expires_in ?? 3600) };
    return json.access_token;
  }

  async request<T>(method: string, path: string): Promise<T> {
    const res = await this.fetchImpl(`${API}/${path}`, { method, headers: { Authorization: `Bearer ${await this.auth()}` } });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) throw new PlayApiError(res.status, path, String((json.error as { message?: string } | undefined)?.message ?? text.slice(0, 300)));
    return json as T;
  }

  /** Opens an edit, runs `fn`, and always deletes the edit (nothing is committed). */
  async withEdit<T>(packageName: string, fn: (editId: string) => Promise<T>): Promise<T> {
    const pkg = encodeURIComponent(packageName);
    const edit = await this.request<{ id: string }>('POST', `${pkg}/edits`);
    try {
      return await fn(edit.id);
    } finally {
      await this.request('DELETE', `${pkg}/edits/${edit.id}`).catch(() => undefined);
    }
  }

  /** Listings of every language and the releases of `track` (read-only). */
  async readState(packageName: string, track: string): Promise<PlayRemoteState> {
    const pkg = encodeURIComponent(packageName);
    return this.withEdit(packageName, async (id) => {
      const listings = (await this.request<{ listings?: PlayRemoteListing[] }>('GET', `${pkg}/edits/${id}/listings`)).listings ?? [];
      let releases: PlayRemoteRelease[] | undefined;
      try {
        releases = (await this.request<{ releases?: PlayRemoteRelease[] }>('GET', `${pkg}/edits/${id}/tracks/${encodeURIComponent(track)}`)).releases ?? [];
      } catch (err) {
        if (!(err instanceof PlayApiError && err.status === 404)) throw err;
      }
      return { listings, releases };
    });
  }
}
