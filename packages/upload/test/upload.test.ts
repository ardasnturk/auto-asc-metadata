import { appPaths } from '@vitrin/core';
import { VitrinConfig, type AppMetadata, type LocaleMetadata } from '@vitrin/schemas';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import { AscClient, buildPlan, createToken, diffRefData, exportFastlaneMetadata, formatPlan, isEditableVersion, isPem } from '../src/index.js';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const creds = { keyId: 'KEY1234567', issuerId: '69a6de7e-0000-0000-0000-000000000000', privateKey: pem };

describe('JWT', () => {
  it('creates an ES256 token valid for at most 20 minutes', async () => {
    const now = 1_800_000_000;
    const token = await createToken(creds, now);
    const header = decodeProtectedHeader(token);
    const payload = decodeJwt(token);
    expect(header).toMatchObject({ alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
    expect(payload.aud).toBe('appstoreconnect-v1');
    expect(payload.iss).toBe(creds.issuerId);
    expect(payload.exp! - now).toBeLessThanOrEqual(1200);
    expect(isPem(pem)).toBe(true);
    expect(isPem('not a key')).toBe(false);
  });
});

describe('fastlane export', () => {
  it('writes deliver files and never writes demo credentials', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-fl-'));
    const paths = appPaths(root);
    const config = VitrinConfig.parse({ app: { locales: ['tr'] }, urls: { support: 'https://a.app/s', privacy: 'https://a.app/p' }, review: { firstName: 'Arda', email: 'a@a.app' } });
    const app: AppMetadata = { copyright: '2026 JASTech', primaryCategory: 'HEALTH_AND_FITNESS', primarySubcategories: [], secondarySubcategories: [], reviewNotes: 'Demo modu' };
    const m = { locale: 'tr', name: 'Ritim', subtitle: 'Alt', promotionalText: '', description: 'Açıklama', keywords: 'a,b', whatsNew: '', claims: [] } as LocaleMetadata;
    await exportFastlaneMetadata(paths, config, app, [m]);
    const md = paths.fastlaneMetadata;
    expect(readFileSync(join(md, 'tr', 'name.txt'), 'utf8')).toBe('Ritim\n');
    expect(readFileSync(join(md, 'tr', 'support_url.txt'), 'utf8')).toBe('https://a.app/s\n');
    // Cleared optional field → empty file so deliver clears the remote value; release notes stay absent.
    expect(readFileSync(join(md, 'tr', 'promotional_text.txt'), 'utf8')).toBe('');
    expect(existsSync(join(md, 'tr', 'release_notes.txt'))).toBe(false);
    expect(readFileSync(join(md, 'copyright.txt'), 'utf8')).toBe('2026 JASTech\n');
    expect(readFileSync(join(md, 'review_information', 'first_name.txt'), 'utf8')).toBe('Arda\n');
    expect(existsSync(join(md, 'review_information', 'demo_password.txt'))).toBe(false);
  });
});

describe('upload plan', () => {
  function fakeFetch(routes: Record<string, unknown>): typeof fetch {
    return (async (url: string) => {
      const path = String(url).replace('https://api.appstoreconnect.apple.com', '');
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      if (!key) return new Response(JSON.stringify({ errors: [{ detail: `no route ${path}` }] }), { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status: 200 });
    }) as typeof fetch;
  }

  it('diffs local metadata against ASC', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-plan-'));
    const client = new AscClient(
      creds,
      fakeFetch({
        '/v1/apps?filter': { data: [{ type: 'apps', id: '1', attributes: { bundleId: 'com.x', name: 'X' } }] },
        '/v1/apps/1/appStoreVersions': { data: [{ type: 'appStoreVersions', id: 'v1', attributes: { versionString: '1.2.0', appVersionState: 'PREPARE_FOR_SUBMISSION' } }] },
        '/v1/appStoreVersions/v1/appStoreVersionLocalizations': { data: [{ type: 'appStoreVersionLocalizations', id: 'l1', attributes: { locale: 'tr', description: 'Eski', keywords: 'a,b' } }] },
        '/v1/apps/1/appInfos': { data: [{ type: 'appInfos', id: 'i1', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }] },
        '/v1/appInfos/i1/appInfoLocalizations': { data: [{ type: 'appInfoLocalizations', id: 'il1', attributes: { locale: 'tr', name: 'Ritim', subtitle: null } }] },
      }),
    );
    const config = VitrinConfig.parse({ app: { locales: ['tr'] }, urls: {} });
    const m = { locale: 'tr', name: 'Ritim', subtitle: 'Yeni alt', promotionalText: '', description: 'Yeni', keywords: 'a,b', whatsNew: '', claims: [] } as LocaleMetadata;
    const plan = await buildPlan({ paths: appPaths(root), config, bundleId: 'com.x', metadata: [m], client, include: { creatives: false, cpp: false, events: false } });
    const byField = Object.fromEntries(plan.items.map((i) => [i.field, i.change]));
    expect(plan.version?.versionString).toBe('1.2.0');
    expect(byField).toMatchObject({ name: 'unchanged', subtitle: 'update', description: 'update', keywords: 'unchanged' });
    expect(formatPlan(plan)).toContain('“Eski” → “Yeni”');
  });

  it('reports a blocker when the app record does not exist', async () => {
    const client = new AscClient(creds, fakeFetch({ '/v1/apps?filter': { data: [] } }));
    const plan = await buildPlan({ paths: appPaths(mkdtempSync(join(tmpdir(), 'v-'))), config: VitrinConfig.parse({ app: {}, urls: {} }), bundleId: 'com.none', metadata: [], client, include: { creatives: false, cpp: false, events: false } });
    expect(plan.blockers[0]).toContain('elle oluştur');
  });
});

describe('helpers', () => {
  it('knows editable version states', () => {
    expect(isEditableVersion({ attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION' } })).toBe(true);
    expect(isEditableVersion({ attributes: { appStoreState: 'READY_FOR_SALE' } })).toBe(false);
  });

  it('diffs refData against known targets', () => {
    const known = [{ width: 1206, height: 2622, assetLibraryDisplayClass: 'IPHONE_61' }, { width: 1398, height: 2034, assetLibraryDisplayClass: 'IPHONE_DUO' }];
    const ref = { data: [{ attributes: { displayClass: 'IPHONE_DUO', width: 1398, height: 2034 } }, { attributes: { displayClass: 'IPHONE_FOLD', width: 1, height: 2 } }] };
    const d = diffRefData(ref, known);
    expect(d).toHaveLength(1);
    expect(d[0]).toContain('IPHONE_FOLD');
  });
});
