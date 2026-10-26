import { renderEnvExample } from '@vitrin/core';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { googlePlayChecks, missingUploadKeys } from '../src/commands/doctor.js';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const account = { type: 'service_account', project_id: 'p', private_key_id: 'k1', private_key: pem, client_email: 'ci@p.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token' };
const asc = { ASC_KEY_ID: 'a', ASC_ISSUER_ID: 'b', ASC_KEY_CONTENT_BASE64: 'c' };

function keyFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vitrin-doc-'));
  mkdirSync(join(dir, 'secrets'));
  writeFileSync(join(dir, 'secrets', 'play.json'), content);
  return dir;
}

describe('upload keys per platform', () => {
  it('requires the Play key only when Android ships, and the ASC key only for Apple platforms', () => {
    expect(missingUploadKeys(asc, ['ios'])).toEqual([]);
    expect(missingUploadKeys(asc, ['ios', 'android']).map((k) => k.name)).toEqual(['GOOGLE_PLAY_JSON_KEY_PATH']);
    expect(missingUploadKeys({ ...asc, GOOGLE_PLAY_JSON_KEY_BASE64: 'x' }, ['ios', 'android'])).toEqual([]);
    expect(missingUploadKeys({ GOOGLE_PLAY_JSON_KEY_PATH: './k.json' }, ['android'])).toEqual([]);
    expect(missingUploadKeys({}, ['android']).map((k) => k.name)).toEqual(['GOOGLE_PLAY_JSON_KEY_PATH']);
  });

  it('lists the Play variables in .env.example', () => {
    const text = renderEnvExample();
    expect(text).toContain('GOOGLE_PLAY_JSON_KEY_PATH=./secrets/play-service-account.json');
    expect(text).toContain('GOOGLE_PLAY_JSON_KEY_BASE64=');
    expect(text).toContain('GOOGLE_PLAY_PACKAGE_NAME=');
    expect(text).toContain('Google Play Developer API');
  });
});

describe('Google Play key check', () => {
  it('accepts a service account JSON without a network call', async () => {
    const root = keyFile(JSON.stringify(account));
    const checks = await googlePlayChecks({ env: { GOOGLE_PLAY_JSON_KEY_PATH: 'secrets/play.json' }, root, packageName: 'com.x.app', fetchImpl: (() => { throw new Error('no network expected'); }) as unknown as typeof fetch });
    expect(checks.map((c) => `${c.id}:${c.status}`)).toEqual(['play-key:ok', 'play-package:ok', 'play-api:skip']);
  });

  it('fails on a missing file, bad JSON, other credential types and a missing package', async () => {
    const fail = async (content: string | null, env: NodeJS.ProcessEnv = { GOOGLE_PLAY_JSON_KEY_PATH: 'secrets/play.json' }, packageName?: string) => {
      const root = content === null ? mkdtempSync(join(tmpdir(), 'v-')) : keyFile(content);
      return googlePlayChecks({ env, root, packageName });
    };
    expect((await fail(null))[0]).toMatchObject({ status: 'fail', detail: expect.stringContaining('file not found') });
    expect((await fail('{oops'))[0]).toMatchObject({ status: 'fail', detail: expect.stringContaining('not valid JSON') });
    expect((await fail(JSON.stringify({ type: 'authorized_user', client_id: 'x' })))[0]!.detail).toContain('service_account');
    expect((await fail(JSON.stringify(account))).find((c) => c.id === 'play-package')?.status).toBe('fail');
    expect((await fail(null, {}))[0]).toMatchObject({ id: 'play-key', status: 'fail', detail: 'missing' });
  });

  it('runs a read-only live check behind the flag', async () => {
    const root = keyFile(JSON.stringify(account));
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok-123456', expires_in: 3600 }));
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'e9' }));
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (String(url).endsWith('/listings')) return new Response(JSON.stringify({ listings: [{ language: 'en-US' }] }));
      return new Response(JSON.stringify({ error: { message: 'The caller does not have permission' } }), { status: 403 });
    }) as typeof fetch;
    const checks = await googlePlayChecks({ env: { GOOGLE_PLAY_JSON_KEY_PATH: 'secrets/play.json' }, root, packageName: 'com.x.app', live: true, fetchImpl });
    const api = checks.find((c) => c.id === 'play-api')!;
    expect(api.status).toBe('fail');
    expect(api.fix).toMatch(/Users and permissions/);
    // The edit was opened and deleted again; nothing was committed.
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(true);
    expect(calls.some((c) => c.includes(':commit'))).toBe(false);
  });
});
