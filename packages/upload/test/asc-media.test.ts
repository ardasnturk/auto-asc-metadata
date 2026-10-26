import { appPaths, DELIVER_PREVIEW_DEVICE, loadTargets, mask, type ExecResult } from '@vitrin/core';
import { type RenderTarget } from '@vitrin/schemas';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ascEnv,
  ascMediaJobs,
  ascMetadataPushInvocation,
  ascScreenshotsUploadInvocation,
  ascValidateInvocation,
  ascVideoPreviewsUploadInvocation,
  AscClient,
  assetCommitBody,
  assetCreateBody,
  AssetLibraryClient,
  ClassicMediaClient,
  diffRefData,
  exportAscMetadata,
  isPreviewFrameTimeCode,
  loadAscDisplayTypes,
  orderingRequestBody,
  parseRefData,
  perTypeRoute,
  placementCreateBody,
  previewCommitBody,
  previewCreateBody,
  previewOrderBody,
  previewSetCreateBody,
  resolvePlacementGroup,
  runAscForPlatforms,
  runDeliverForPlatforms,
  screenshotCommitBody,
  screenshotCreateBody,
  screenshotOrderBody,
  screenshotSetCreateBody,
  uploadPerDisplayType,
  type CommandRunner,
  type RenderedAsset,
  type UploadPlan,
} from '../src/index.js';

// ---- the App Store Connect API 4.5.1 OpenAPI spec (subset, unchanged) and a strict validator ----------------

type Schema = Record<string, unknown>;
const SPEC = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'asc-openapi-4.5.1-subset.json'), 'utf8')) as {
  info: { version: string };
  paths: string[];
  components: { schemas: Record<string, Schema> };
};
const schema = (name: string) => SPEC.components.schemas[name]!;
const enumOf = (name: string) => schema(name).enum as string[];

/**
 * Checks `value` against an OpenAPI schema: types, enums, `required` (also inside anyOf variants) and — stricter
 * than the spec — no properties the schema does not declare, so a guessed attribute name fails.
 */
function check(s: Schema, value: unknown, path = '$', strict = true): string[] {
  if (s.$ref) return check(schema(String(s.$ref).split('/').pop()!), value, path, strict);
  if (value === null) return s.nullable ? [] : [`${path}: null not allowed`];
  const errors: string[] = [];
  if (Array.isArray(s.allOf)) for (const sub of s.allOf as Schema[]) errors.push(...check(sub, value, path, strict));
  if (Array.isArray(s.enum) && !(s.enum as unknown[]).includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  const type = s.type as string | undefined;
  if (type === 'string' && typeof value !== 'string') errors.push(`${path}: expected string`);
  if (type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: expected integer`);
  if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
  if (type === 'array') {
    if (!Array.isArray(value)) errors.push(`${path}: expected array`);
    else if (s.items) value.forEach((v, i) => errors.push(...check(s.items as Schema, v, `${path}[${i}]`)));
  }
  if (type === 'object' || s.properties || s.required) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [...errors, `${path}: expected object`];
    const o = value as Record<string, unknown>;
    for (const r of (s.required as string[] | undefined) ?? []) if (!(r in o)) errors.push(`${path}.${r}: required`);
    const props = s.properties as Record<string, Schema> | undefined;
    if (props) {
      for (const [k, v] of Object.entries(o)) {
        if (!props[k]) {
          if (strict) errors.push(`${path}.${k}: not in the spec`);
        } else errors.push(...check(props[k]!, v, `${path}.${k}`, strict));
      }
    }
  }
  if (Array.isArray(s.anyOf)) {
    // anyOf variants only add `required` lists; the declared properties come from the base schema.
    const results = (s.anyOf as Schema[]).map((v) => check(v, value, path, false));
    if (!results.some((r) => r.length === 0)) errors.push(`${path}: matches no anyOf variant (${results.map((r) => r.join(', ')).join(' | ')})`);
  }
  return errors;
}

// ---- fixtures ---------------------------------------------------------------------------------------------------

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const creds = { keyId: 'KEY1234567', issuerId: '69a6de7e-0000-0000-0000-000000000000', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
const fast = { intervalMs: 0, sleep: async () => {} };

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

/** An AscClient whose fetch is a router; every request is recorded with its parsed body. */
function mockAsc(route: (c: Call) => unknown): { client: AscClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? 'GET', path: decodeURIComponent(String(url).replace('https://api.appstoreconnect.apple.com', '')), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const res = route(c);
    if (res === undefined) return new Response(null, { status: 204 });
    if (res instanceof Response) return res;
    return new Response(JSON.stringify(res), { status: 200 });
  }) as typeof fetch;
  return { client: new AscClient(creds, fetchImpl), calls };
}

function uploads(): { fetchImpl: typeof fetch; puts: Array<{ url: string; headers: Record<string, string>; size: number }> } {
  const puts: Array<{ url: string; headers: Record<string, string>; size: number }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    puts.push({ url: String(url), headers: init?.headers as Record<string, string>, size: (init?.body as Uint8Array).byteLength });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, puts };
}

const op = (url: string, length: number) => [{ method: 'PUT', url, offset: 0, length, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] }];

function tmpFile(dir: string, name: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  const f = join(dir, name);
  writeFileSync(f, content);
  return f;
}

const targetsById = new Map(loadTargets().map((t) => [t.id, t]));
const T = (id: string): RenderTarget => targetsById.get(id)!;
const asset = (file: string, id: string, order: string, locale = 'tr'): RenderedAsset => ({ file, locale, target: T(id), kind: T(id).kind, order });

function planWith(over: Partial<UploadPlan>, scope: Partial<NonNullable<UploadPlan['scope']>['apple'][number]>): UploadPlan {
  return {
    generatedAt: 'now',
    bundleId: 'com.x',
    appId: '1',
    uploader: 'deliver',
    remoteKnown: true,
    platforms: [{ platform: 'ios', ascPlatform: 'IOS', version: { id: 'v1', versionString: '1.2.0', state: 'PREPARE_FOR_SUBMISSION' } }],
    scope: {
      assets: ['metadata', 'screenshots', 'previews'],
      apple: [{ platform: 'ios', covers: ['ios', 'watchos'], selectedPlatforms: ['ios', 'watchos'], metadata: false, screenshots: 'skip', previews: 'skip', screenshotTargets: [], previewTargets: [], untouched: [], ...scope }],
    },
    items: [],
    blockers: [],
    ...over,
  };
}

// ---- mapping ----------------------------------------------------------------------------------------------------

describe('data/asc-display-types.json', () => {
  const file = loadAscDisplayTypes();

  it('uses only values of the 4.5.1 enums', () => {
    expect(SPEC.info.version).toBe('4.5.1');
    for (const [id, d] of Object.entries(file.targets)) {
      if (d.screenshotDisplayType) expect(enumOf('ScreenshotDisplayType'), id).toContain(d.screenshotDisplayType);
      if (d.previewType) expect(enumOf('PreviewType'), id).toContain(d.previewType);
      if (d.assetLibrary) {
        expect(enumOf('AppAssetLibraryPlacementType'), id).toContain(d.assetLibrary.placementType);
        expect(enumOf('AppAssetLibraryDisplayClass'), id).toContain(d.assetLibrary.displayClass);
        expect(enumOf('AppAssetLibraryPlacementPlatform'), id).toContain(d.assetLibrary.platform);
        expect(enumOf('AppAssetLibraryAssetCategory'), id).toContain(d.assetLibrary.category);
      }
    }
  });

  it('covers every App Store target and none of the guessed names', () => {
    const apple = loadTargets().filter((t) => t.store === 'app-store');
    for (const t of apple) expect(file.targets[t.id], t.id).toBeDefined();
    for (const t of apple) expect(t.assetLibraryDisplayClass, t.id).toBeUndefined();
    const all = JSON.stringify(file.targets);
    for (const guess of ['"SCREENSHOT"', 'PRODUCT_PAGE_HEADER"', '"SEARCH_RESULT"', '"IPHONE_61"', 'IPHONE_69', 'APP_IPHONE_DUO', '"APPLE_TV_DISPLAY"']) expect(all).not.toContain(guess);
  });

  it('maps 6.9" iPhone to APP_IPHONE_67 and sends iPhone Duo to the Asset Library', () => {
    expect(enumOf('ScreenshotDisplayType')).not.toContain('APP_IPHONE_69');
    expect(file.targets['iphone-6.9']).toMatchObject({ screenshotDisplayType: 'APP_IPHONE_67', assetLibrary: { displayClass: 'IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY' } });
    expect(file.targets['iphone-6.3']?.screenshotDisplayType).toBe('APP_IPHONE_61');
    expect(file.targets['duo-outer']).toMatchObject({ screenshotDisplayType: null, assetLibrary: { placementType: 'APP_SCREENSHOT', displayClass: 'IPHONE_DUO', platform: 'IPHONE_APP_STORE' } });
    expect(file.targets['mac-16x10']).toMatchObject({ screenshotDisplayType: 'APP_DESKTOP', assetLibrary: { displayClass: 'DEFAULT', platform: 'MAC_APP_STORE' } });
    expect(file.targets['header']?.assetLibrary).toMatchObject({ placementType: 'PRODUCT_PAGE_HEADER_ASSET', category: 'CREATIVE_ASSETS' });
    expect(file.targets['search']?.assetLibrary?.placementType).toBe('APP_STORE_SEARCH_RESULTS_ASSET');
    expect(perTypeRoute(T('watch-ultra'), 'deliver')).toBe('classic');
    expect(perTypeRoute(T('duo-inner'), 'deliver')).toBe('asset-library');
    expect(perTypeRoute(T('watch-ultra'), 'asset-library')).toBe('asset-library');
  });

  it('names every preview file with its classic PreviewType, including Vision Pro', () => {
    const previews = loadTargets().filter((t) => t.kind === 'preview' && t.store === 'app-store');
    expect(previews.map((t) => t.id)).toContain('preview-vision');
    expect(T('preview-vision')).toMatchObject({ width: 3840, height: 2160, platform: 'visionos', family: 'vision', defaultEnabled: false });
    for (const t of previews) expect(DELIVER_PREVIEW_DEVICE[t.id], t.id).toBe(file.targets[t.id]?.previewType);
  });
});

// ---- request bodies vs. the spec -----------------------------------------------------------------------------------

describe('request bodies match the 4.5.1 spec', () => {
  const owner = { type: 'appStoreVersionLocalizations' as const, id: 'loc1' };
  it('classic screenshot and preview sets', () => {
    expect(check(schema('AppScreenshotSetCreateRequest'), screenshotSetCreateBody('loc1', 'APP_WATCH_ULTRA'))).toEqual([]);
    expect(check(schema('AppScreenshotCreateRequest'), screenshotCreateBody('set1', '01.png', 1234))).toEqual([]);
    expect(check(schema('AppScreenshotUpdateRequest'), screenshotCommitBody('s1', 'abc'))).toEqual([]);
    expect(check(schema('AppScreenshotSetAppScreenshotsLinkagesRequest'), screenshotOrderBody(['s1', 's2']))).toEqual([]);
    expect(check(schema('AppPreviewSetCreateRequest'), previewSetCreateBody('loc1', 'APPLE_VISION_PRO'))).toEqual([]);
    expect(check(schema('AppPreviewCreateRequest'), previewCreateBody('ps1', '01.mp4', 99, { mimeType: 'video/mp4', previewFrameTimeCode: '00:00:05:00' }))).toEqual([]);
    expect(check(schema('AppPreviewUpdateRequest'), previewCommitBody('p1', 'abc', '00:00:05.000'))).toEqual([]);
    expect(check(schema('AppPreviewSetAppPreviewsLinkagesRequest'), previewOrderBody(['p1']))).toEqual([]);
    // There is no 6.9" classic type.
    expect(check(schema('AppScreenshotSetCreateRequest'), { data: { ...screenshotSetCreateBody('loc1', 'APP_IPHONE_67').data, attributes: { screenshotDisplayType: 'APP_IPHONE_69' } } })).not.toEqual([]);
  });

  it('App Asset Library assets, placements and ordering', () => {
    expect(check(schema('AppAssetLibraryImageCreateRequest'), assetCreateBody('image', 'lib1', { fileName: 'a.png', fileSize: 10, category: 'APP_SCREENSHOTS_AND_PREVIEWS' }))).toEqual([]);
    expect(check(schema('AppAssetLibraryVideoCreateRequest'), assetCreateBody('video', 'lib1', { fileName: 'a.mp4', fileSize: 10, category: 'CREATIVE_ASSETS', previewFrameTimeCode: '00:00:01:00' }))).toEqual([]);
    expect(check(schema('AppAssetLibraryImageUpdateRequest'), assetCommitBody('image', 'i1'))).toEqual([]);
    expect(check(schema('AppAssetLibraryVideoUpdateRequest'), assetCommitBody('video', 'v1'))).toEqual([]);
    expect(check(schema('AppAssetLibraryPlacementCreateRequest'), placementCreateBody(owner, { kind: 'image', id: 'i1' }, 'APP_SCREENSHOT', 'IPHONE_DUO_PROFILE'))).toEqual([]);
    expect(check(schema('AppAssetLibraryPlacementCreateRequest'), placementCreateBody({ type: 'appEventLocalizations', id: 'e1' }, { kind: 'video', id: 'v1' }, 'EVENT_CARD_ASSET', 'DEFAULT_PROFILE'))).toEqual([]);
    expect(check(schema('AppAssetLibraryPlacementOrderingRequestCreateRequest'), orderingRequestBody(owner, 'IPHONE_DUO_PROFILE', ['p1', 'p2']))).toEqual([]);
    expect(() => orderingRequestBody({ type: 'appEventLocalizations', id: 'e1' }, 'DEFAULT_PROFILE', ['p1'])).toThrow(/In-App Event/);
  });

  it('rejects the bodies Vitrin used to guess', () => {
    const oldImage = { data: { type: 'appAssetLibraryImages', attributes: { fileName: 'a.png', fileSize: 1 }, relationships: { appAssetLibrary: { data: { type: 'appAssetLibraries', id: 'l' } } } } };
    expect(check(schema('AppAssetLibraryImageCreateRequest'), oldImage).join('\n')).toMatch(/category: required[\s\S]*appAssetLibrary: not in the spec/);
    const oldPlacement = { data: { type: 'appAssetLibraryPlacements', attributes: { placementType: 'SCREENSHOT', displayClass: 'IPHONE_69' }, relationships: { asset: { data: { type: 'appAssetLibraryImages', id: 'i' } } } } };
    expect(check(schema('AppAssetLibraryPlacementCreateRequest'), oldPlacement).join('\n')).toMatch(/SCREENSHOT" not in enum[\s\S]*displayClass: not in the spec/);
    expect(check(schema('AppAssetLibraryImageUpdateRequest'), { data: { type: 'appAssetLibraryImages', id: 'i', attributes: { uploaded: true, sourceFileChecksum: 'x' } } })).toEqual(['$.data.attributes.sourceFileChecksum: not in the spec']);
  });

  it('every endpoint Vitrin calls is in the spec', () => {
    for (const p of [
      'GET /v1/appStoreVersionLocalizations/{id}/appScreenshotSets',
      'POST /v1/appScreenshotSets',
      'GET /v1/appScreenshotSets/{id}/appScreenshots',
      'DELETE /v1/appScreenshots/{id}',
      'POST /v1/appScreenshots',
      'PATCH /v1/appScreenshots/{id}',
      'GET /v1/appScreenshots/{id}',
      'PATCH /v1/appScreenshotSets/{id}/relationships/appScreenshots',
      'GET /v1/appStoreVersionLocalizations/{id}/appPreviewSets',
      'POST /v1/appPreviewSets',
      'POST /v1/appPreviews',
      'PATCH /v1/appPreviewSets/{id}/relationships/appPreviews',
      'GET /v1/apps/{id}/assetLibrary',
      'GET /v1/appAssetLibraryRefData',
      'POST /v1/appAssetLibraryImages',
      'PATCH /v1/appAssetLibraryImages/{id}',
      'GET /v1/appAssetLibraryImages/{id}',
      'POST /v1/appAssetLibraryPlacements',
      'DELETE /v1/appAssetLibraryPlacements/{id}',
      'GET /v1/appStoreVersionLocalizations/{id}/placements',
      'POST /v1/appAssetLibraryPlacementOrderingRequests',
    ])
      expect(SPEC.paths, p).toContain(p);
  });

  it('knows the poster frame formats', () => {
    expect(isPreviewFrameTimeCode('00:00:05:12')).toBe(true);
    expect(isPreviewFrameTimeCode('00:00:05.250')).toBe(true);
    expect(isPreviewFrameTimeCode('5s')).toBe(false);
  });
});

// ---- classic per-display-type replacement -----------------------------------------------------------------------------

describe('classic screenshot and preview sets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vitrin-sets-'));
  const a = tmpFile(dir, '01_home_watch-ultra.png', 'AAAA');
  const b = tmpFile(dir, '02_list_watch-ultra.png', 'BBBBBB');

  it('replaces exactly one set: find, delete its items, reserve, upload, commit with MD5, poll, order', async () => {
    const up = uploads();
    let n = 0;
    const { client, calls } = mockAsc((c) => {
      if (c.method === 'GET' && c.path.startsWith('/v1/appStoreVersionLocalizations/loc1/appScreenshotSets')) return { data: [{ type: 'appScreenshotSets', id: 'set-w', attributes: { screenshotDisplayType: 'APP_WATCH_ULTRA' } }] };
      if (c.method === 'GET' && c.path.startsWith('/v1/appScreenshotSets/set-w/appScreenshots')) return { data: [{ type: 'appScreenshots', id: 'old1', attributes: {} }, { type: 'appScreenshots', id: 'old2', attributes: {} }] };
      if (c.method === 'POST' && c.path === '/v1/appScreenshots') {
        n++;
        const size = (c.body as { data: { attributes: { fileSize: number } } }).data.attributes.fileSize;
        return { data: { type: 'appScreenshots', id: `new${n}`, attributes: { uploadOperations: op(`https://upload.example/${n}`, size) } } };
      }
      if (c.method === 'GET' && c.path.startsWith('/v1/appScreenshots/new')) return { data: { type: 'appScreenshots', id: 'x', attributes: { assetDeliveryState: { state: 'COMPLETE' } } } };
      if (c.method === 'PATCH') return { data: { type: 'appScreenshots', id: 'x', attributes: {} } };
      return undefined;
    });
    const res = await new ClassicMediaClient(client, { uploadFetch: up.fetchImpl, poll: fast }).replaceScreenshotSet('loc1', 'APP_WATCH_ULTRA', [a, b]);
    expect(res).toEqual({ setId: 'set-w', createdSet: false, deleted: 2, uploaded: ['new1', 'new2'] });
    expect(calls[0]!.path).toContain('filter[screenshotDisplayType]=APP_WATCH_ULTRA');
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/v1/appScreenshots/old1', '/v1/appScreenshots/old2']);
    expect(calls.some((c) => c.method === 'DELETE' && c.path.includes('Sets'))).toBe(false);
    const commits = calls.filter((c) => c.method === 'PATCH' && c.path.startsWith('/v1/appScreenshots/'));
    expect(commits.map((c) => c.body)).toEqual([screenshotCommitBody('new1', createHash('md5').update('AAAA').digest('hex')), screenshotCommitBody('new2', createHash('md5').update('BBBBBB').digest('hex'))]);
    for (const c of calls.filter((x) => x.body)) {
      const name = c.path === '/v1/appScreenshots' ? 'AppScreenshotCreateRequest' : c.path.includes('/relationships/') ? 'AppScreenshotSetAppScreenshotsLinkagesRequest' : 'AppScreenshotUpdateRequest';
      expect(check(schema(name), c.body), c.path).toEqual([]);
    }
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/v1/appScreenshotSets/set-w/relationships/appScreenshots', body: screenshotOrderBody(['new1', 'new2']) });
    expect(up.puts).toEqual([
      { url: 'https://upload.example/1', headers: { 'Content-Type': 'image/png' }, size: 4 },
      { url: 'https://upload.example/2', headers: { 'Content-Type': 'image/png' }, size: 6 },
    ]);
  });

  it('creates a missing preview set, sends the poster frame and waits on videoDeliveryState', async () => {
    const mp4 = tmpFile(dir, '01_APPLE_VISION_PRO.mp4', 'VIDEO');
    const up = uploads();
    let polls = 0;
    const { client, calls } = mockAsc((c) => {
      if (c.method === 'GET' && c.path.includes('/appPreviewSets')) return { data: [] };
      if (c.method === 'POST' && c.path === '/v1/appPreviewSets') return { data: { type: 'appPreviewSets', id: 'ps1', attributes: { previewType: 'APPLE_VISION_PRO' } } };
      if (c.method === 'POST' && c.path === '/v1/appPreviews') return { data: { type: 'appPreviews', id: 'pv1', attributes: { uploadOperations: op('https://upload.example/v', 5) } } };
      if (c.method === 'GET' && c.path === '/v1/appPreviews/pv1') return { data: { type: 'appPreviews', id: 'pv1', attributes: { videoDeliveryState: { state: ++polls < 3 ? 'PROCESSING' : 'COMPLETE' } } } };
      return { data: { type: 'appPreviews', id: 'pv1', attributes: {} } };
    });
    const res = await new ClassicMediaClient(client, { uploadFetch: up.fetchImpl, poll: fast }).replacePreviewSet('loc1', 'APPLE_VISION_PRO', [mp4], { previewFrameTimeCode: '00:00:02:00' });
    expect(res).toMatchObject({ setId: 'ps1', createdSet: true, deleted: 0, uploaded: ['pv1'] });
    expect(polls).toBe(3);
    const create = calls.find((c) => c.path === '/v1/appPreviewSets')!;
    expect(check(schema('AppPreviewSetCreateRequest'), create.body)).toEqual([]);
    const reserve = calls.find((c) => c.path === '/v1/appPreviews')!;
    expect(reserve.body).toMatchObject({ data: { attributes: { fileName: '01_APPLE_VISION_PRO.mp4', fileSize: 5, mimeType: 'video/mp4', previewFrameTimeCode: '00:00:02:00' } } });
    expect(check(schema('AppPreviewCreateRequest'), reserve.body)).toEqual([]);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('refuses when the filtered list holds another display type, and checks limits before deleting', async () => {
    const { client, calls } = mockAsc((c) => (c.method === 'GET' ? { data: [{ type: 'appScreenshotSets', id: 's', attributes: { screenshotDisplayType: 'APP_IPHONE_67' } }] } : undefined));
    const media = new ClassicMediaClient(client, { poll: fast });
    await expect(media.replaceScreenshotSet('loc1', 'APP_WATCH_ULTRA', [a])).rejects.toThrow(/refusing to touch any set/);
    await expect(media.replaceScreenshotSet('loc1', 'APP_WATCH_ULTRA', Array(11).fill(a))).rejects.toThrow(/at most 10/);
    await expect(media.replaceScreenshotSet('loc1', 'APP_WATCH_ULTRA', [join(dir, 'missing.png')])).rejects.toThrow(/ENOENT/);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('reports a failed screenshot instead of waiting forever', async () => {
    const { client } = mockAsc((c) => {
      if (c.method === 'GET' && c.path.includes('appScreenshotSets')) return { data: [] };
      if (c.path === '/v1/appScreenshotSets') return { data: { type: 'appScreenshotSets', id: 's1', attributes: {} } };
      if (c.method === 'POST') return { data: { type: 'appScreenshots', id: 'n1', attributes: { uploadOperations: op('https://u/1', 4) } } };
      if (c.method === 'GET') return { data: { type: 'appScreenshots', id: 'n1', attributes: { assetDeliveryState: { state: 'FAILED', errors: [{ code: 'IMAGE_INCORRECT_DIMENSIONS', description: 'wrong size' }] } } } };
      return { data: {} };
    });
    await expect(new ClassicMediaClient(client, { uploadFetch: uploads().fetchImpl, poll: fast }).replaceScreenshotSet('loc1', 'APP_WATCH_ULTRA', [a])).rejects.toThrow(/wrong size/);
  });
});

// ---- App Asset Library ------------------------------------------------------------------------------------------------

/** GET /v1/appAssetLibraryRefData shaped like AppAssetLibraryRefDataResponse. */
const REF = {
  data: [
    {
      type: 'appAssetLibraryRefData',
      id: 'r1',
      attributes: {
        placementProfileGroups: [
          { placementProfileGroupId: 'IPHONE_DUO_PROFILE', platform: 'IPHONE_APP_STORE', displayClassId: 'IPHONE_DUO' },
          { placementProfileGroupId: 'IPHONE_LARGE_PROFILE', platform: 'IPHONE_APP_STORE', displayClassId: 'IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY' },
          { placementProfileGroupId: 'WATCH_ULTRA_PROFILE', platform: 'WATCH_APP_STORE', displayClassId: 'WATCH_ULTRA' },
        ],
        placementTypes: [{ placementTypeId: 'APP_SCREENSHOT', acceptsAssetCategories: ['APP_SCREENSHOTS_AND_PREVIEWS'], specMappings: [{ placementGroupId: 'IPHONE_DUO_PROFILE', specs: ['s1'] }, { placementGroupId: 'IPHONE_LARGE_PROFILE', specs: ['s2'] }, { placementGroupId: 'WATCH_ULTRA_PROFILE', specs: ['s3'] }] }],
        displayClasses: [
          { displayClassId: 'IPHONE_DUO', deviceFamily: 'IPHONE', screenDimensions: ['1398x2034', '2007x2853'] },
          { displayClassId: 'IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY', deviceFamily: 'IPHONE', screenDimensions: ['1320x2868', '1290x2796'] },
          { displayClassId: 'WATCH_ULTRA', deviceFamily: 'APPLE_WATCH', screenDimensions: ['422x514'] },
        ],
      },
    },
  ],
};

describe('App Asset Library (spec-shaped)', () => {
  const duo = loadAscDisplayTypes().targets['duo-outer']!.assetLibrary!;
  const header = loadAscDisplayTypes().targets['header']!.assetLibrary!;

  it('resolves the placementGroup from refData placementProfileGroups', () => {
    const ref = parseRefData(REF);
    expect(resolvePlacementGroup(ref, duo)).toBe('IPHONE_DUO_PROFILE');
    expect(resolvePlacementGroup(ref, header)).toBe('DEFAULT_PROFILE');
    expect(() => resolvePlacementGroup(ref, { placementType: 'APP_SCREENSHOT', displayClass: 'IPAD_13_DISPLAY', platform: 'IPAD_APP_STORE' })).toThrow(/no placement group/);
    const narrowed = parseRefData({ data: { attributes: { ...REF.data[0]!.attributes, placementTypes: [{ placementTypeId: 'APP_SCREENSHOT', specMappings: [{ placementGroupId: 'OTHER' }] }] } } });
    expect(() => resolvePlacementGroup(narrowed, duo)).toThrow(/does not allow/);
  });

  it('replaces one placement set: filtered list, delete, reserve with category, upload, commit, place, order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-al-'));
    const files = [tmpFile(dir, '01_a_duo-outer.png', 'ONE'), tmpFile(dir, '01_a_duo-inner.png', 'TWO')];
    const up = uploads();
    let n = 0;
    const { client, calls } = mockAsc((c) => {
      if (c.path === '/v1/appAssetLibraryRefData') return REF;
      if (c.path === '/v1/apps/1/assetLibrary') return { data: { type: 'appAssetLibraries', id: 'lib1' } };
      if (c.method === 'GET' && c.path.startsWith('/v1/appStoreVersionLocalizations/loc1/placements')) return { data: [{ type: 'appAssetLibraryPlacements', id: 'old', attributes: { placementType: 'APP_SCREENSHOT', placementGroup: 'IPHONE_DUO_PROFILE', mediaType: 'IMAGE' } }] };
      if (c.method === 'POST' && c.path === '/v1/appAssetLibraryImages') return { data: { type: 'appAssetLibraryImages', id: `img${++n}`, attributes: { state: 'AWAITING_UPLOAD', uploadOperations: op(`https://u/${n}`, 3) } } };
      if (c.method === 'GET' && c.path.startsWith('/v1/appAssetLibraryImages/')) return { data: { type: 'appAssetLibraryImages', id: 'x', attributes: { state: 'COMPLETE' } } };
      if (c.method === 'POST' && c.path === '/v1/appAssetLibraryPlacements') return { data: { type: 'appAssetLibraryPlacements', id: `pl${n}`, attributes: {} } };
      if (c.method === 'POST' && c.path === '/v1/appAssetLibraryPlacementOrderingRequests') return { data: { type: 'appAssetLibraryPlacementOrderingRequests', id: 'o1' } };
      if (c.method === 'PATCH') return { data: { type: 'appAssetLibraryImages', id: 'x', attributes: { state: 'UPLOAD_COMPLETE' } } };
      return undefined;
    });
    const lib = new AssetLibraryClient(client, { uploadFetch: up.fetchImpl, poll: fast });
    const res = await lib.replaceSet(await lib.libraryId('1'), { type: 'appStoreVersionLocalizations', id: 'loc1' }, duo, files.map((file) => ({ file, kind: 'image' as const })));
    expect(res).toEqual({ group: 'IPHONE_DUO_PROFILE', removed: 1, placements: ['pl1', 'pl2'] });
    const list = calls.find((c) => c.path.includes('/placements?'))!;
    expect(list.path).toContain('filter[placementType]=APP_SCREENSHOT&filter[placementGroup]=IPHONE_DUO_PROFILE');
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/v1/appAssetLibraryPlacements/old']);
    const bodies: Record<string, string> = {
      'POST /v1/appAssetLibraryImages': 'AppAssetLibraryImageCreateRequest',
      'POST /v1/appAssetLibraryPlacements': 'AppAssetLibraryPlacementCreateRequest',
      'POST /v1/appAssetLibraryPlacementOrderingRequests': 'AppAssetLibraryPlacementOrderingRequestCreateRequest',
    };
    for (const c of calls.filter((x) => x.body)) {
      const name = bodies[`${c.method} ${c.path}`] ?? (c.method === 'PATCH' ? 'AppAssetLibraryImageUpdateRequest' : '');
      expect(name, c.path).not.toBe('');
      expect(check(schema(name), c.body), `${c.method} ${c.path}`).toEqual([]);
    }
    expect(calls.find((c) => c.path === '/v1/appAssetLibraryImages')!.body).toMatchObject({ data: { attributes: { category: 'APP_SCREENSHOTS_AND_PREVIEWS' }, relationships: { assetLibrary: { data: { type: 'appAssetLibraries', id: 'lib1' } } } } });
    expect(calls.find((c) => c.path === '/v1/appAssetLibraryPlacements')!.body).toEqual(placementCreateBody({ type: 'appStoreVersionLocalizations', id: 'loc1' }, { kind: 'image', id: 'img1' }, 'APP_SCREENSHOT', 'IPHONE_DUO_PROFILE'));
    expect(calls.at(-1)!.body).toEqual(orderingRequestBody({ type: 'appStoreVersionLocalizations', id: 'loc1' }, 'IPHONE_DUO_PROFILE', ['pl1', 'pl2']));
    expect(up.puts.map((p) => p.size)).toEqual([3, 3]);
  });

  it('refuses to delete when the filtered list carries another type or group', async () => {
    const { client, calls } = mockAsc((c) => (c.method === 'GET' ? { data: [{ type: 'appAssetLibraryPlacements', id: 'p', attributes: { placementType: 'APP_SCREENSHOT', placementGroup: 'IPHONE_LARGE_PROFILE' } }, { type: 'appAssetLibraryPlacements', id: 'q', attributes: {} }] } : undefined));
    await expect(new AssetLibraryClient(client).clearPlacements({ type: 'appStoreVersionLocalizations', id: 'loc1' }, 'APP_SCREENSHOT', 'IPHONE_DUO_PROFILE')).rejects.toThrow(/Refusing/);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('compares refData with the mapping and the target sizes', () => {
    const targets = loadTargets();
    const diffs = diffRefData(REF, targets);
    // The fixture has no iPad, Mac, TV, Vision or 6.3" groups: each is reported; Duo, 6.9" and Watch Ultra are fine.
    expect(diffs.some((d) => d.startsWith('ipad-13:'))).toBe(true);
    expect(diffs.some((d) => d.startsWith('duo-outer:') || d.startsWith('iphone-6.9:') || d.startsWith('watch-ultra:'))).toBe(false);
    const wrongSize = { data: [{ attributes: { ...REF.data[0]!.attributes, displayClasses: [{ displayClassId: 'WATCH_ULTRA', screenDimensions: ['410x502'] }, { displayClassId: 'IPHONE_FOLD_DISPLAY' }] } }] };
    const d2 = diffRefData(wrongSize, targets);
    expect(d2).toContain('watch-ultra: 422×514 is not among refData\'s WATCH_ULTRA sizes (410x502).');
    expect(d2).toContain('refData has a display class the 4.5.1 spec does not list: IPHONE_FOLD_DISPLAY');
    expect(diffRefData({ data: [] }, targets)[0]).toMatch(/shape differs/);
  });
});

// ---- routing of a partial run ---------------------------------------------------------------------------------------------

describe('uploadPerDisplayType', () => {
  it('uses the classic API for Watch Ultra and the Asset Library for iPhone Duo; nothing else is touched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-route-'));
    const assets = [
      asset(tmpFile(dir, '01_a_watch-ultra.png', 'W1'), 'watch-ultra', '01'),
      asset(tmpFile(dir, '02_b_watch-ultra.png', 'W2'), 'watch-ultra', '02'),
      asset(tmpFile(dir, '01_a_duo-outer.png', 'D1'), 'duo-outer', '01'),
      asset(tmpFile(dir, '01_a_iphone-6.9.png', 'I1'), 'iphone-6.9', '01'),
    ];
    const plan = planWith({}, { screenshots: 'per-display-type', screenshotTargets: ['duo-outer', 'watch-ultra'] });
    let id = 0;
    const { client, calls } = mockAsc((c) => {
      if (c.path.startsWith('/v1/appStoreVersions/v1/appStoreVersionLocalizations')) return { data: [{ type: 'appStoreVersionLocalizations', id: 'loc1', attributes: { locale: 'tr' } }] };
      if (c.path === '/v1/appAssetLibraryRefData') return REF;
      if (c.path === '/v1/apps/1/assetLibrary') return { data: { type: 'appAssetLibraries', id: 'lib1' } };
      if (c.method === 'GET' && c.path.includes('/appScreenshotSets?')) return { data: [] };
      if (c.method === 'GET' && c.path.includes('/placements?')) return { data: [] };
      if (c.method === 'POST' && c.path === '/v1/appScreenshotSets') return { data: { type: 'appScreenshotSets', id: 'set1', attributes: { screenshotDisplayType: 'APP_WATCH_ULTRA' } } };
      if (c.method === 'POST') return { data: { type: c.path.split('/').pop(), id: `r${++id}`, attributes: { uploadOperations: op('https://u', 2) } } };
      if (c.method === 'GET' && c.path.startsWith('/v1/appScreenshots/')) return { data: { attributes: { assetDeliveryState: { state: 'COMPLETE' } } } };
      if (c.method === 'GET' && c.path.startsWith('/v1/appAssetLibraryImages/')) return { data: { attributes: { state: 'COMPLETE' } } };
      return { data: { type: 'x', id: 'x', attributes: {} } };
    });
    const n = await uploadPerDisplayType(client, plan, assets, ['tr'], { uploadFetch: uploads().fetchImpl, poll: fast });
    expect(n).toBe(3);
    const created = calls.find((c) => c.path === '/v1/appScreenshotSets')!;
    expect(created.body).toEqual(screenshotSetCreateBody('loc1', 'APP_WATCH_ULTRA'));
    expect(calls.filter((c) => c.path === '/v1/appScreenshots')).toHaveLength(2);
    expect(calls.find((c) => c.path === '/v1/appAssetLibraryPlacements')!.body).toMatchObject({ data: { attributes: { placementType: 'APP_SCREENSHOT', placementGroup: 'IPHONE_DUO_PROFILE' } } });
    // iphone-6.9 was not in the run; no DELETE anywhere because both sets were empty.
    expect(calls.some((c) => JSON.stringify(c.body ?? '').includes('iphone-6.9'))).toBe(false);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    // With the asc uploader the classic sets are left to the asc CLI; only Duo goes through here.
    calls.length = 0;
    expect(await uploadPerDisplayType(client, { ...plan, uploader: 'asc' }, assets, ['tr'], { classic: 'skip', uploadFetch: uploads().fetchImpl, poll: fast })).toBe(1);
    expect(calls.some((c) => c.path.includes('appScreenshot'))).toBe(false);
  });
});

// ---- asc CLI uploader -------------------------------------------------------------------------------------------------------

function recorder(code = 0): { runner: CommandRunner; calls: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> } {
  const calls: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const runner = (async (cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
    calls.push({ cmd, args, env: opts?.env });
    return { code, stdout: '', stderr: '' } satisfies ExecResult;
  }) as CommandRunner;
  return { runner, calls };
}

describe('asc uploader', () => {
  it('maps Vitrin keys to asc’s documented environment credential and masks them', () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-ascenv-'));
    tmpFile(join(root, 'secrets'), 'AuthKey.p8', 'x');
    const byPath = ascEnv({ ASC_KEY_ID: 'KEYID00001', ASC_ISSUER_ID: 'issuer-uuid-0001', ASC_KEY_PATH: './secrets/AuthKey.p8' }, root);
    expect(byPath.problems).toEqual([]);
    expect(byPath.env).toEqual({ ASC_KEY_ID: 'KEYID00001', ASC_ISSUER_ID: 'issuer-uuid-0001', ASC_KEY_TYPE: 'team', ASC_PRIVATE_KEY_PATH: join(root, 'secrets', 'AuthKey.p8'), ASC_PRIVATE_KEY_B64: '', ASC_PRIVATE_KEY: '', ASC_PROFILE: '' });
    const b64 = Buffer.from('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----').toString('base64');
    const byContent = ascEnv({ ASC_KEY_ID: 'KEYID00002', ASC_ISSUER_ID: 'issuer-uuid-0002', ASC_KEY_CONTENT_BASE64: b64, ASC_KEY_PATH: './nope.p8' }, root);
    expect(byContent.env).toMatchObject({ ASC_PRIVATE_KEY_B64: b64, ASC_PRIVATE_KEY_PATH: '' });
    expect(mask(`key ${b64} id KEYID00002`)).not.toContain(b64);
    expect(mask('KEYID00002')).not.toContain('KEYID00002');
    expect(ascEnv({}, root).problems).toHaveLength(3);
    expect(ascEnv({ ASC_KEY_ID: 'a', ASC_ISSUER_ID: 'b', ASC_KEY_PATH: 'missing.p8' }, root).problems[0]).toMatch(/not found/);
  });

  it('builds asc commands without secrets in the arguments', () => {
    const env = { ASC_KEY_ID: 'K' };
    expect(ascMetadataPushInvocation({ appId: '1', version: '1.2.0', platform: 'IOS', dir: '/m', dryRun: true }, env).args).toEqual(['metadata', 'push', '--app', '1', '--version', '1.2.0', '--platform', 'IOS', '--dir', '/m', '--dry-run']);
    expect(ascMetadataPushInvocation({ appId: '1', version: '1.2.0', platform: 'MAC_OS', dir: '/m', dryRun: false, confirm: true }, env).args.slice(-1)).toEqual(['--confirm']);
    expect(ascMetadataPushInvocation({ appId: '1', version: '1.2.0', platform: 'IOS', dir: '/m', dryRun: false }, env).args).not.toContain('--confirm');
    expect(ascScreenshotsUploadInvocation({ localizationId: 'loc1', path: '/s', deviceType: 'APP_IPHONE_67' }, env)).toEqual({ command: 'asc', args: ['screenshots', 'upload', '--version-localization', 'loc1', '--path', '/s', '--device-type', 'APP_IPHONE_67', '--replace', '--confirm'], env });
    expect(ascVideoPreviewsUploadInvocation({ localizationId: 'loc1', path: '/p', deviceType: 'IPHONE_67', dryRun: true }, env).args).toEqual(['video-previews', 'upload', '--version-localization', 'loc1', '--path', '/p', '--device-type', 'IPHONE_67', '--replace', '--dry-run']);
    expect(ascValidateInvocation({ appId: '1', platform: 'IOS' }, env).args).toEqual(['validate', '--app', '1', '--platform', 'IOS']);
  });

  it('writes asc’s canonical metadata layout from the fastlane export', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-ascmd-'));
    const fl = join(root, 'metadata', 'store', 'metadata');
    tmpFile(join(fl, 'tr'), 'name.txt', 'Ritim\n');
    tmpFile(join(fl, 'tr'), 'subtitle.txt', '');
    tmpFile(join(fl, 'tr'), 'description.txt', 'Açıklama\n');
    tmpFile(join(fl, 'tr'), 'keywords.txt', 'a,b');
    tmpFile(join(fl, 'tr'), 'marketing_url.txt', '');
    tmpFile(join(fl, 'tr'), 'release_notes.txt', 'Yeni');
    tmpFile(fl, 'copyright.txt', '2026 X');
    const out = join(root, 'asc');
    const exp = await exportAscMetadata(fl, out, { locales: ['tr', 'de-DE'], version: '1.2.0', includeAppInfo: true, dropReleaseNotes: true });
    expect(JSON.parse(readFileSync(join(out, 'app-info', 'tr.json'), 'utf8'))).toEqual({ name: 'Ritim', subtitle: null });
    expect(JSON.parse(readFileSync(join(out, 'version', '1.2.0', 'tr.json'), 'utf8'))).toEqual({ description: 'Açıklama', keywords: 'a,b' });
    expect(exp.clears).toBe(1);
    expect(exp.warnings.join('\n')).toMatch(/marketingUrl: asc cannot clear[\s\S]*does not upload copyright.txt/);
    const versionOnly = await exportAscMetadata(fl, out, { locales: ['tr'], version: '1.2.0', includeAppInfo: false });
    expect(existsSync(join(out, 'app-info'))).toBe(false);
    expect(versionOnly.files).toEqual([join(out, 'version', '1.2.0', 'tr.json')]);
  });

  it('runs one asc job per locale and classic display type; Duo stays with the Asset Library', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-ascrun-'));
    const paths = appPaths(root);
    tmpFile(join(paths.fastlaneMetadata, 'tr'), 'description.txt', 'Yeni');
    tmpFile(join(root, 'secrets'), 'k.p8', 'x');
    const src = join(root, 'src');
    const assets = [
      asset(tmpFile(src, '02_b_iphone-6.9.png', 'b'), 'iphone-6.9', '02'),
      asset(tmpFile(src, '01_a_iphone-6.9.png', 'a'), 'iphone-6.9', '01'),
      asset(tmpFile(src, '01_a_duo-outer.png', 'd'), 'duo-outer', '01'),
      asset(tmpFile(src, '01_IPHONE_67.mp4', 'v'), 'preview-iphone', '01'),
    ];
    const plan = planWith({ uploader: 'asc' }, { metadata: true, screenshots: 'per-display-type', previews: 'per-display-type', screenshotTargets: ['duo-outer', 'iphone-6.9'], previewTargets: ['preview-iphone'] });
    const jobs = ascMediaJobs(plan, assets, ['tr']);
    expect(jobs.map((j) => `${j.kind}:${j.deviceType}:${j.files.length}`)).toEqual(['screenshot:APP_IPHONE_67:2', 'preview:IPHONE_67:1']);

    const { client } = mockAsc((c) => (c.path.includes('appStoreVersionLocalizations') ? { data: [{ type: 'appStoreVersionLocalizations', id: 'loc1', attributes: { locale: 'tr' } }] } : undefined));
    const rec = recorder();
    const env = { ASC_KEY_ID: 'KEYID00003', ASC_ISSUER_ID: 'issuer-3', ASC_KEY_PATH: 'secrets/k.p8' };
    const res = await runAscForPlatforms(paths, plan, assets, client, { languages: ['tr'], env }, rec.runner);
    expect(res).toEqual({ metadataRuns: 1, mediaJobs: 2 });
    expect(rec.calls.map((c) => c.args.slice(0, 2).join(' '))).toEqual(['metadata push', 'screenshots upload', 'video-previews upload']);
    expect(rec.calls[0]!.args).toEqual(['metadata', 'push', '--app', '1', '--version', '1.2.0', '--platform', 'IOS', '--dir', join(paths.vitrin, 'asc', 'ios', 'metadata')]);
    const shots = rec.calls[1]!;
    expect(shots.args).toEqual(['screenshots', 'upload', '--version-localization', 'loc1', '--path', join(paths.vitrin, 'asc', 'ios', 'media', 'tr', 'APP_IPHONE_67'), '--device-type', 'APP_IPHONE_67', '--replace', '--confirm']);
    expect(readdirSync(shots.args[5]!)).toEqual(['01_01_a_iphone-6.9.png', '02_02_b_iphone-6.9.png']);
    for (const c of rec.calls) {
      expect(c.env).toMatchObject({ ASC_KEY_ID: 'KEYID00003', ASC_PRIVATE_KEY_PATH: join(root, 'secrets', 'k.p8') });
      expect(c.args.join(' ')).not.toMatch(/KEYID00003|issuer-3|k\.p8/);
    }
    // deliver never runs with the asc uploader.
    expect(await runDeliverForPlatforms(paths, plan, assets, { bundleId: 'com.x', languages: ['tr'] }, rec.runner)).toEqual([]);
    // A failing asc run is an error, not a silent skip.
    await expect(runAscForPlatforms(paths, plan, assets, client, { languages: ['tr'], env }, recorder(3).runner)).rejects.toThrow(/asc metadata push failed \(asc exit 3\)/);
  });
});
