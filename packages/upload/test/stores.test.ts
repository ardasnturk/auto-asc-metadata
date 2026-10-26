import { appPaths, mask, TEMPLATES_DIR, type ExecResult } from '@vitrin/core';
import { RenderTarget, VitrinConfig, type LocaleMetadata, type RenderManifest } from '@vitrin/schemas';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applePlatformsOf,
  AscClient,
  AssetLibraryClient,
  buildDeliverFolders,
  buildPlan,
  buildPlayPlan,
  checkPlayImages,
  collectRenderedAssets,
  deliverAcceptsPreview,
  deliverLaneInvocation,
  deliverPlatformFor,
  exportPlayMetadata,
  formatPlan,
  installFastlaneTemplates,
  parseImageHeader,
  parseServiceAccount,
  PlayClient,
  playImageSets,
  playKeyFromEnv,
  playLocaleFor,
  playReadBackDiffs,
  readBack,
  readImageInfo,
  resolveScope,
  routeAssets,
  runDeliverForPlatforms,
  runLane,
  runPlayUpload,
  runSupplyLane,
  supplyLaneInvocation,
  templateVersion,
  type CommandRunner,
  type ImageInfo,
  type PlayContext,
  type PlayInputs,
  type RenderedAsset,
  type UploadPlan,
} from '../src/index.js';

// ---- fixtures ------------------------------------------------------------------------------------

function target(id: string, over: Partial<RenderTarget>): RenderTarget {
  return RenderTarget.parse({
    id,
    kind: 'screenshot',
    label: id,
    family: 'iphone',
    width: 100,
    height: 200,
    logical: { width: 100, height: 200, scale: 1 },
    requirement: 'optional',
    defaultEnabled: true,
    formats: ['png'],
    ...over,
  });
}

const TARGETS: RenderTarget[] = [
  target('iphone-6.9', { family: 'iphone', width: 1320, height: 2868, assetLibraryDisplayClass: 'IPHONE_69' }),
  target('ipad-13', { family: 'ipad', width: 2064, height: 2752 }),
  target('watch-ultra', { family: 'watch', platform: 'watchos', width: 422, height: 514, assetLibraryDisplayClass: 'APP_WATCH_ULTRA' }),
  target('mac-16x10', { family: 'mac', platform: 'macos', width: 2880, height: 1800 }),
  target('appletv-4k', { family: 'tv', platform: 'tvos', width: 3840, height: 2160 }),
  target('vision', { family: 'vision', platform: 'visionos', width: 3840, height: 2160 }),
  target('preview-iphone', { kind: 'preview', family: 'iphone', width: 886, height: 1920, formats: ['mp4'] }),
  target('preview-mac', { kind: 'preview', family: 'mac', platform: 'macos', width: 1920, height: 1080, formats: ['mp4'], assetLibraryDisplayClass: 'DESKTOP' }),
  target('header', { kind: 'creative', family: 'any', width: 3840, height: 1646 }),
  target('play-phone', { family: 'android-phone', store: 'google-play', platform: 'android', width: 1080, height: 1920 }),
  target('play-tablet-10', { family: 'android-tablet', store: 'google-play', platform: 'android', width: 1600, height: 2560 }),
  target('play-feature-graphic', { kind: 'creative', family: 'any', store: 'google-play', platform: 'android', width: 1024, height: 500 }),
  target('play-icon', { kind: 'creative', family: 'any', store: 'google-play', platform: 'android', width: 512, height: 512 }),
];

async function png(file: string, w: number, h: number, alpha = false): Promise<string> {
  mkdirSync(join(file, '..'), { recursive: true });
  await sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 1, g: 2, b: 3, alpha: 0.5 } : { r: 1, g: 2, b: 3 } } })
    .png()
    .toFile(file);
  return file;
}

function touch(file: string, content = 'x'): string {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
  return file;
}

interface Fixture {
  root: string;
  paths: ReturnType<typeof appPaths>;
  manifest: RenderManifest;
  assets: RenderedAsset[];
}

/** One locale (tr) with screenshots for every Apple platform, two Android phone shots, feature graphic and icon. */
async function fixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'vitrin-stores-'));
  const paths = appPaths(root);
  const s = (n: string, t: string) => join(paths.screenshots, 'tr', `${n}_home_${t}.png`);
  const images: RenderManifest['images'] = [];
  const add = async (file: string, t: string, shot: string, w: number, h: number) => {
    await png(file, w, h);
    images.push({ file, target: t, locale: 'tr', shot, width: w, height: h, overflow: [], safeAreaViolations: [] });
  };
  await add(s('01', 'iphone-6.9'), 'iphone-6.9', '01', 1320, 2868);
  await add(s('01', 'watch-ultra'), 'watch-ultra', '01', 422, 514);
  await add(s('01', 'mac-16x10'), 'mac-16x10', '01', 2880, 1800);
  await add(s('01', 'appletv-4k'), 'appletv-4k', '01', 3840, 2160);
  await add(s('01', 'vision'), 'vision', '01', 3840, 2160);
  await add(s('02', 'play-phone'), 'play-phone', '02', 1080, 1920);
  await add(s('01', 'play-phone'), 'play-phone', '01', 1080, 1920);
  await add(join(paths.creative, 'tr', 'play-feature-graphic_feature.png'), 'play-feature-graphic', 'feature', 1024, 500);
  await add(join(paths.creative, 'tr', 'play-icon_icon.png'), 'play-icon', 'icon', 512, 512);
  await add(join(paths.creative, 'tr', 'header_header.png'), 'header', 'header', 3840, 1646);
  const videos: RenderManifest['videos'] = [
    { file: touch(join(paths.appPreviews, 'tr', '01_IPHONE_67.mp4')), target: 'preview-iphone', locale: 'tr', id: '01' },
    { file: touch(join(paths.appPreviews, 'tr', '01_DESKTOP.mp4')), target: 'preview-mac', locale: 'tr', id: '01' },
  ];
  const manifest: RenderManifest = { generatedAt: 'now', artDirection: 'a', images, videos };
  // Text metadata as exportFastlaneMetadata writes it, plus a supply folder deliver must never see.
  touch(join(paths.fastlaneMetadata, 'tr', 'name.txt'), 'Ritim\n');
  touch(join(paths.fastlaneMetadata, 'tr', 'release_notes.txt'), 'Yeni\n');
  touch(join(paths.fastlaneMetadata, 'copyright.txt'), '2026 X\n');
  touch(join(paths.fastlaneMetadata, 'android', 'tr-TR', 'title.txt'), 'Ritim\n');
  const { assets } = await collectRenderedAssets(paths, TARGETS, manifest);
  return { root, paths, manifest, assets };
}

function recorder(code = 0, output = ''): { runner: CommandRunner; calls: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> } {
  const calls: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const runner = (async (cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
    calls.push({ cmd, args, env: opts?.env });
    const isLane = args[0] === 'exec';
    return { code: isLane ? code : 0, stdout: isLane ? output : '', stderr: '' } satisfies ExecResult;
  }) as CommandRunner;
  return { runner, calls };
}

const listing = (over: Partial<PlayInputs['listings'][number]> = {}): PlayInputs['listings'][number] => ({
  locale: 'tr',
  title: 'Ritim: Alışkanlık Takibi',
  shortDescription: 'Alışkanlıklarını tek dokunuşla işaretle, serilerini koru.',
  fullDescription: 'Ritim ile alışkanlıklarını her gün işaretle.',
  changelog: 'Yeni grafikler.',
  claims: [],
  ...over,
});

// ---- Apple platforms -----------------------------------------------------------------------------

describe('Apple platforms', () => {
  it('maps platforms to deliver runs; watchOS belongs to the iOS version', () => {
    expect(deliverPlatformFor('watchos')).toBe('ios');
    expect(deliverPlatformFor('macos')).toBe('osx');
    expect(deliverPlatformFor('tvos')).toBe('appletvos');
    expect(deliverPlatformFor('visionos')).toBe('xros');
    expect(deliverPlatformFor('android')).toBeNull();
    expect(applePlatformsOf(['android', 'visionos', 'watchos', 'ios', 'macos'])).toEqual(['ios', 'osx', 'xros']);
    expect(applePlatformsOf(['android'])).toEqual([]);
  });

  it('knows which previews deliver 2.241.1 can upload', () => {
    expect(deliverAcceptsPreview('ios', '/x/01_IPHONE_67.mp4')).toBe(true);
    expect(deliverAcceptsPreview('ios', '/x/01_IPAD_PRO_3GEN_129.mp4')).toBe(true);
    expect(deliverAcceptsPreview('osx', '/x/01_DESKTOP.mp4')).toBe(false);
  });

  it('routes rendered files by store and platform from the manifest', async () => {
    const f = await fixture();
    const r = routeAssets(f.assets);
    expect(r.apple.ios.map((a) => a.target.id).sort()).toEqual(['iphone-6.9', 'preview-iphone', 'watch-ultra']);
    expect(r.apple.osx.map((a) => a.target.id).sort()).toEqual(['mac-16x10', 'preview-mac']);
    expect(r.apple.appletvos.map((a) => a.target.id)).toEqual(['appletv-4k']);
    expect(r.apple.xros.map((a) => a.target.id)).toEqual(['vision']);
    expect(r.appleCreatives.map((a) => a.target.id)).toEqual(['header']);
    expect(r.play.map((a) => a.target.id).sort()).toEqual(['play-feature-graphic', 'play-icon', 'play-phone', 'play-phone']);
  });

  it('falls back to the folders when there is no manifest and reports unknown targets', async () => {
    const f = await fixture();
    touch(join(f.paths.screenshots, 'tr', '03_x_unknown-target.png'));
    const { assets, unknown } = await collectRenderedAssets(f.paths, TARGETS);
    expect(assets.filter((a) => a.kind === 'screenshot')).toHaveLength(7);
    expect(assets.find((a) => a.target.id === 'play-icon')?.order).toBe('icon');
    expect(unknown.some((u) => u.endsWith('03_x_unknown-target.png'))).toBe(true);
  });

  it('builds per-platform deliver folders with only that platform’s files', async () => {
    const f = await fixture();
    const ios = await buildDeliverFolders(f.paths, 'ios', f.assets, { locales: ['tr'], dropReleaseNotes: true });
    expect(readdirSync(join(ios.screenshotsPath, 'tr')).sort()).toEqual(['01_home_iphone-6.9.png', '01_home_watch-ultra.png']);
    expect(readdirSync(join(ios.previewsPath, 'tr'))).toEqual(['01_IPHONE_67.mp4']);
    // supply's folder is not a language deliver knows; release notes dropped for a first release.
    expect(existsSync(join(ios.metadataPath, 'android'))).toBe(false);
    expect(existsSync(join(ios.metadataPath, 'tr', 'release_notes.txt'))).toBe(false);
    expect(readFileSync(join(ios.metadataPath, 'tr', 'name.txt'), 'utf8')).toBe('Ritim\n');
    expect(existsSync(join(ios.metadataPath, 'copyright.txt'))).toBe(true);

    const mac = await buildDeliverFolders(f.paths, 'osx', f.assets, { locales: ['tr'] });
    expect(readdirSync(join(mac.screenshotsPath, 'tr'))).toEqual(['01_home_mac-16x10.png']);
    expect(mac.previews).toBe(0);
    expect(mac.assetLibraryPreviews.map((a) => a.target.id)).toEqual(['preview-mac']);
    expect(existsSync(join(mac.metadataPath, 'tr', 'release_notes.txt'))).toBe(true);

    // 3840×2160 is Apple TV unless the path contains "vision".
    const vision = await buildDeliverFolders(f.paths, 'xros', f.assets, { locales: ['tr'] });
    expect(readdirSync(join(vision.screenshotsPath, 'tr'))).toEqual(['01_home_vision.png']);
    const tv = await buildDeliverFolders(f.paths, 'appletvos', f.assets, { locales: ['tr'] });
    expect(readdirSync(join(tv.screenshotsPath, 'tr'))).toEqual(['01_home_appletv-4k.png']);
  });

  it('adds “vision” to a Vision Pro file name that lacks it', async () => {
    const f = await fixture();
    const t = target('apv', { family: 'vision', platform: 'visionos', width: 3840, height: 2160 });
    const file = await png(join(f.paths.screenshots, 'tr', '01_home_apv.png'), 4, 4);
    const out = await buildDeliverFolders(f.paths, 'xros', [{ file, locale: 'tr', target: t, kind: 'screenshot', order: '01' }], { locales: ['tr'] });
    expect(readdirSync(join(out.screenshotsPath, 'tr'))).toEqual(['01_home_apv_vision.png']);
  });
});

// ---- lane builders -------------------------------------------------------------------------------

describe('fastlane lanes', () => {
  it('passes the platform as a lane option and the per-platform folders as env', () => {
    const inv = deliverLaneInvocation('vitrin_upload', { bundleId: 'com.x', languages: ['tr', 'en-US'], platform: 'osx', appVersion: '1.2.0', metadataPath: '/m', screenshotsPath: '/s', previewsPath: '/p' });
    expect(inv.command).toBe('bundle');
    expect(inv.args).toEqual(['exec', 'fastlane', 'ios', 'vitrin_upload', 'platform:osx']);
    expect(inv.env).toMatchObject({ VITRIN_PLATFORM: 'osx', VITRIN_LANGUAGES: 'tr,en-US', VITRIN_APP_VERSION: '1.2.0', VITRIN_METADATA_PATH: '/m', VITRIN_SCREENSHOTS_PATH: '/s', VITRIN_PREVIEWS_PATH: '/p', VITRIN_SKIP_SCREENSHOTS: '0' });
  });

  it('builds the supply invocation without putting the key content anywhere', () => {
    const inv = supplyLaneInvocation({ packageName: 'com.x.app', metadataPath: '/r/fastlane/metadata/android', track: 'production', versionCode: 42, validateOnly: true, jsonKeyPath: '/r/secrets/k.json' });
    expect(inv.args).toEqual(['exec', 'fastlane', 'android', 'vitrin_play_upload', 'validate_only:true']);
    expect(inv.env).toMatchObject({ VITRIN_PLAY_PACKAGE_NAME: 'com.x.app', VITRIN_PLAY_TRACK: 'production', VITRIN_PLAY_VERSION_CODE: '42', VITRIN_PLAY_VALIDATE_ONLY: '1', VITRIN_PLAY_JSON_KEY_PATH: '/r/secrets/k.json' });
    expect(Object.keys(inv.env).some((k) => /BASE64|JSON_KEY_DATA/.test(k))).toBe(false);
    const real = supplyLaneInvocation({ packageName: 'com.x.app', metadataPath: '/m', track: 'beta', validateOnly: false });
    expect(real.args).not.toContain('validate_only:true');
    expect(real.env.VITRIN_PLAY_VERSION_CODE).toBe('');
  });

  it('runs lanes through the injected runner and maps supply errors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-lane-'));
    touch(join(root, 'Gemfile'));
    const paths = appPaths(root);
    const ok = recorder();
    await runLane(paths, 'vitrin_upload', { bundleId: 'com.x', languages: ['tr'], platform: 'appletvos' }, ok.runner);
    expect(ok.calls.map((c) => c.args.join(' '))).toEqual(['check', 'exec fastlane ios vitrin_upload platform:appletvos']);

    const noRelease = recorder(1, 'Could not find release for version code \'7\' to update changelog');
    await expect(runSupplyLane(paths, { packageName: 'com.x', metadataPath: '/m', track: 'production', versionCode: 7, validateOnly: false }, noRelease.runner)).rejects.toThrow(/existing release on the “production” track/);
    const multi = recorder(1, 'More than one release found in this track.');
    await expect(runSupplyLane(paths, { packageName: 'com.x', metadataPath: '/m', track: 'production', validateOnly: false }, multi.runner)).rejects.toThrow(/versionCode/);
    await expect(runLane(appPaths(mkdtempSync(join(tmpdir(), 'v-'))), 'x', { bundleId: 'b', languages: [], platform: 'ios' }, ok.runner)).rejects.toThrow(/No Gemfile/);
  });

  it('runs one deliver per Apple platform with an editable version', async () => {
    const f = await fixture();
    touch(join(f.root, 'Gemfile'));
    const plan: UploadPlan = {
      generatedAt: 'now',
      bundleId: 'com.x',
      uploader: 'deliver',
      remoteKnown: true,
      platforms: [
        { platform: 'ios', ascPlatform: 'IOS', version: { id: 'v1', versionString: '1.2.0', state: 'PREPARE_FOR_SUBMISSION' } },
        { platform: 'osx', ascPlatform: 'MAC_OS', version: { id: 'v2', versionString: '1.0.0', state: 'PREPARE_FOR_SUBMISSION' }, firstRelease: true },
        { platform: 'xros', ascPlatform: 'VISION_OS' },
      ],
      items: [],
      blockers: [],
    };
    const rec = recorder();
    const done = await runDeliverForPlatforms(f.paths, plan, f.assets, { bundleId: 'com.x', languages: ['tr'] }, rec.runner);
    expect(done.map((d) => d.platform)).toEqual(['ios', 'osx']);
    const lanes = rec.calls.filter((c) => c.args[0] === 'exec');
    expect(lanes.map((c) => c.args.at(-1))).toEqual(['platform:ios', 'platform:osx']);
    expect(lanes[1]!.env).toMatchObject({ VITRIN_APP_VERSION: '1.0.0', VITRIN_SCREENSHOTS_PATH: join(f.paths.vitrin, 'deliver', 'osx', 'screenshots') });
    expect(existsSync(join(f.paths.vitrin, 'deliver', 'osx', 'metadata', 'tr', 'release_notes.txt'))).toBe(false);
  });

  it('ships a Fastfile with platform-aware deliver lanes and a metadata-only supply lane', () => {
    const ff = readFileSync(join(TEMPLATES_DIR, 'Fastfile'), 'utf8');
    expect(templateVersion(ff)).toBe(2);
    expect(ff).toMatch(/lane :vitrin_upload do \|options\|/);
    expect(ff).toContain('%w(ios osx appletvos xros)');
    expect(ff).toContain('lane :vitrin_play_upload');
    expect(ff).toContain('skip_upload_aab: true');
    expect(ff).toContain('skip_upload_apk: true');
    expect(ff).toContain('validate_only: validate_only');
    // Never a release: no rollout, promotion or release status.
    expect(ff).not.toMatch(/\b(rollout|track_promote_to|release_status|aab|apk):/);
    expect(templateVersion('# Generated by Vitrin.\n')).toBe(1);
  });

  it('refreshes an older generated Fastfile and keeps a backup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-tpl-'));
    const paths = appPaths(root);
    touch(join(root, 'Gemfile'), 'gem "fastlane"');
    touch(join(paths.fastlane, 'Fastfile'), '# Generated by Vitrin. old\nlane :vitrin_upload do\nend\n');
    const out = await installFastlaneTemplates(paths);
    expect(out).toContain(join(paths.fastlane, 'Fastfile'));
    expect(readFileSync(join(paths.fastlane, 'Fastfile.bak'), 'utf8')).toContain('old');
    expect(templateVersion(readFileSync(join(paths.fastlane, 'Fastfile'), 'utf8'))).toBe(2);
    // A user Fastfile that already has the current lanes is left alone.
    touch(join(paths.fastlane, 'Fastfile'), 'lane :vitrin_upload do\nend\n');
    expect(await installFastlaneTemplates(paths)).toEqual([]);
  });
});

// ---- Google Play ---------------------------------------------------------------------------------

describe('Google Play locales and export', () => {
  it('maps ASC locales to Play languages', () => {
    expect(playLocaleFor('tr')).toBe('tr-TR');
    expect(playLocaleFor('en-US')).toBe('en-US');
    expect(playLocaleFor('he')).toBe('iw-IL');
    expect(playLocaleFor('zh-Hans')).toBe('zh-CN');
    expect(playLocaleFor('es-MX')).toBe('es-419');
    expect(playLocaleFor('ur-PK')).toBeNull();
    expect(playLocaleFor('es-MX', 'es-US')).toBe('es-US');
  });

  it('writes the supply layout with ordered images', async () => {
    const f = await fixture();
    const inputs: PlayInputs = { listings: [listing({ video: 'https://www.youtube.com/watch?v=abcdefgh' }), listing({ locale: 'ur-PK' })], app: { track: 'production', versionCode: 42 } };
    // A stale screenshot from an earlier run must disappear.
    touch(join(f.paths.fastlaneMetadata, 'android', 'tr-TR', 'images', 'phoneScreenshots', '09.png'));
    const out = await exportPlayMetadata(f.paths, inputs, f.assets);
    const dir = join(f.paths.fastlaneMetadata, 'android', 'tr-TR');
    expect(out.skipped).toEqual(['ur-PK']);
    expect(readFileSync(join(dir, 'title.txt'), 'utf8')).toBe('Ritim: Alışkanlık Takibi\n');
    expect(readFileSync(join(dir, 'short_description.txt'), 'utf8')).toContain('serilerini koru');
    expect(readFileSync(join(dir, 'full_description.txt'), 'utf8')).toContain('Ritim ile');
    expect(readFileSync(join(dir, 'video.txt'), 'utf8')).toBe('https://www.youtube.com/watch?v=abcdefgh\n');
    expect(readFileSync(join(dir, 'changelogs', '42.txt'), 'utf8')).toBe('Yeni grafikler.\n');
    expect(readdirSync(join(dir, 'images', 'phoneScreenshots'))).toEqual(['01.png', '02.png']);
    // 01 is the shot with id 01 even though the manifest listed 02 first.
    const first = await readImageInfo(join(dir, 'images', 'phoneScreenshots', '01.png'));
    expect(first).toMatchObject({ width: 1080, height: 1920 });
    expect(readdirSync(join(dir, 'images')).sort()).toEqual(['featureGraphic.png', 'icon.png', 'phoneScreenshots']);

    // Without a video in the listing the remote value is left alone (no file); "" clears it.
    await exportPlayMetadata(f.paths, { ...inputs, listings: [listing()] }, f.assets);
    expect(existsSync(join(dir, 'video.txt'))).toBe(false);
    await exportPlayMetadata(f.paths, { ...inputs, listings: [listing({ video: '' })] }, f.assets);
    expect(readFileSync(join(dir, 'video.txt'), 'utf8')).toBe('');
  });
});

describe('Google Play image rules', () => {
  const info = (over: Partial<ImageInfo>): ImageInfo => ({ format: 'png', width: 1080, height: 1920, hasAlpha: false, bitDepth: 8, bytes: 1000, ...over });

  it('reads PNG and JPEG headers, including tRNS transparency', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-img-'));
    expect(await readImageInfo(await png(join(dir, 'rgb.png'), 40, 20))).toMatchObject({ format: 'png', width: 40, height: 20, hasAlpha: false, bitDepth: 8 });
    expect(await readImageInfo(await png(join(dir, 'rgba.png'), 40, 20, true))).toMatchObject({ hasAlpha: true });
    const pal = join(dir, 'pal.png');
    await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png({ palette: true }).toFile(pal);
    expect((await readImageInfo(pal)).hasAlpha).toBe(true);
    const jpg = join(dir, 'a.jpg');
    await sharp({ create: { width: 33, height: 17, channels: 3, background: { r: 9, g: 9, b: 9 } } }).jpeg().toFile(jpg);
    expect(await readImageInfo(jpg)).toMatchObject({ format: 'jpeg', width: 33, height: 17, hasAlpha: false });
    expect(parseImageHeader(Buffer.from('not an image')).format).toBe('unknown');
  });

  it('checks alpha, size, aspect, counts, feature graphic and icon', () => {
    const sets = [
      { playLocale: 'tr-TR', slot: 'phoneScreenshots' as const, files: ['a', 'b', 'c', 'd'] },
      { playLocale: 'tr-TR', slot: 'featureGraphic' as const, files: ['fg'] },
      { playLocale: 'tr-TR', slot: 'icon' as const, files: ['ic'] },
      { playLocale: 'en-US', slot: 'phoneScreenshots' as const, files: ['one'] },
    ];
    const map = new Map<string, ImageInfo>([
      ['a', info({})],
      ['b', info({ hasAlpha: true })],
      ['c', info({ width: 300, height: 600 })],
      ['d', info({ width: 1000, height: 2100 })],
      ['fg', info({ width: 1024, height: 512 })],
      ['ic', info({ width: 512, height: 512, hasAlpha: true, bytes: 2_000_000 })],
      ['one', info({ format: 'jpeg' })],
    ]);
    const codes = checkPlayImages(sets, map).map((i) => `${i.code}:${i.file ?? ''}`);
    expect(codes).toContain('play.image.alpha:b');
    expect(codes).toContain('play.image.size:c');
    expect(codes).toContain('play.image.aspect:d');
    expect(codes).toContain('play.image.feature-graphic:fg');
    expect(codes).toContain('play.image.icon:ic'); // > 1024 KB; alpha is fine for the icon
    expect(codes.filter((c) => c.startsWith('play.image.alpha'))).toEqual(['play.image.alpha:b']);
    expect(codes).toContain('play.image.count:'); // en-US has one phone screenshot
    expect(codes.some((c) => c.endsWith(':a'))).toBe(false);
    const nine = { playLocale: 'tr-TR', slot: 'tenInchScreenshots' as const, files: Array.from({ length: 9 }, (_, i) => `t${i}`) };
    expect(checkPlayImages([nine], new Map()).map((i) => i.code)).toEqual(['play.image.count']);
  });

  it('groups rendered Play assets by language and slot', async () => {
    const f = await fixture();
    const sets = playImageSets(f.assets, [listing()]);
    expect(sets.map((s) => `${s.playLocale}/${s.slot}/${s.files.length}`)).toEqual(['tr-TR/featureGraphic/1', 'tr-TR/icon/1', 'tr-TR/phoneScreenshots/2']);
  });
});

// ---- Play credentials and API --------------------------------------------------------------------

const { privateKey: rsa } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsaPem = rsa.export({ type: 'pkcs8', format: 'pem' }).toString();
const serviceAccount = { type: 'service_account', project_id: 'p', private_key_id: 'kid123456', private_key: rsaPem, client_email: 'vitrin@p.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token' };

describe('Google Play credentials', () => {
  it('parses a service account and rejects other JSON', () => {
    expect(parseServiceAccount(JSON.stringify(serviceAccount)).account?.client_email).toBe('vitrin@p.iam.gserviceaccount.com');
    expect(parseServiceAccount('{').problems).toEqual(['not valid JSON']);
    expect(parseServiceAccount(JSON.stringify({ installed: { client_id: 'x' } })).problems.join(' ')).toMatch(/service_account/);
  });

  it('reads the key from a relative path or base64 and masks its secrets', () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-key-'));
    touch(join(root, 'secrets', 'play.json'), JSON.stringify(serviceAccount));
    const fromPath = playKeyFromEnv({ GOOGLE_PLAY_JSON_KEY_PATH: './secrets/play.json' }, root);
    expect(fromPath).toMatchObject({ from: 'GOOGLE_PLAY_JSON_KEY_PATH', path: join(root, 'secrets', 'play.json'), problems: [] });
    expect(mask(`id kid123456 key ${rsaPem}`)).not.toContain('kid123456');
    const b64 = Buffer.from(JSON.stringify(serviceAccount)).toString('base64');
    const fromB64 = playKeyFromEnv({ GOOGLE_PLAY_JSON_KEY_BASE64: b64, GOOGLE_PLAY_JSON_KEY_PATH: './missing.json' }, root);
    expect(fromB64?.from).toBe('GOOGLE_PLAY_JSON_KEY_BASE64');
    expect(mask(`value ${b64}`)).not.toContain(b64);
    expect(playKeyFromEnv({ GOOGLE_PLAY_JSON_KEY_PATH: 'nope.json' }, root)?.problems[0]).toContain('file not found');
    expect(playKeyFromEnv({}, root)).toBeUndefined();
  });
});

function playFetch(state: { listings: unknown[]; releases?: unknown[] }, log: string[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const u = String(url);
    log.push(`${init?.method ?? 'GET'} ${u.replace('https://androidpublisher.googleapis.com/androidpublisher/v3/applications/', '')}`);
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      const assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
      const claims = decodeJwt(assertion);
      expect(decodeProtectedHeader(assertion)).toMatchObject({ alg: 'RS256', kid: 'kid123456' });
      expect(claims).toMatchObject({ iss: serviceAccount.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: serviceAccount.token_uri });
      return new Response(JSON.stringify({ access_token: 'ya29.token-value', expires_in: 3600 }), { status: 200 });
    }
    if (init?.method === 'POST' && u.endsWith('/edits')) return new Response(JSON.stringify({ id: 'e1' }), { status: 200 });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (u.endsWith('/listings')) return new Response(JSON.stringify({ listings: state.listings }), { status: 200 });
    if (u.includes('/tracks/')) return state.releases ? new Response(JSON.stringify({ track: 'production', releases: state.releases }), { status: 200 }) : new Response(JSON.stringify({ error: { message: 'Track not found' } }), { status: 404 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

describe('Google Play API client and plan', () => {
  const account = parseServiceAccount(JSON.stringify(serviceAccount)).account!;

  it('reads listings and the track in a throw-away edit', async () => {
    const calls: string[] = [];
    const client = new PlayClient(account, playFetch({ listings: [{ language: 'tr-TR', title: 'Eski' }], releases: [{ versionCodes: ['42'], status: 'completed' }] }, calls));
    const state = await client.readState('com.x.app', 'production');
    expect(state.listings[0]!.title).toBe('Eski');
    expect(state.releases).toHaveLength(1);
    expect(calls).toEqual(['POST https://oauth2.googleapis.com/token', 'POST com.x.app/edits', 'GET com.x.app/edits/e1/listings', 'GET com.x.app/edits/e1/tracks/production', 'DELETE com.x.app/edits/e1']);
    expect(mask('Bearer ya29.token-value')).not.toContain('token-value');
    const none = await new PlayClient(account, playFetch({ listings: [] }, [])).readState('com.x.app', 'beta');
    expect(none.releases).toBeUndefined();
  });

  it('diffs the listing and checks supply’s track preconditions', () => {
    const inputs: PlayInputs = { listings: [listing()], app: { track: 'production', versionCode: 42 } };
    const remote = { listings: [{ language: 'tr-TR', title: 'Ritim: Alışkanlık Takibi', shortDescription: 'Eski kısa', fullDescription: 'Ritim ile alışkanlıklarını her gün işaretle.' }], releases: [{ versionCodes: ['42'], releaseNotes: [{ language: 'tr-TR', text: 'Eski notlar' }] }] };
    const plan = buildPlayPlan({ packageName: 'com.x.app', inputs, sets: [], imageIssues: [], remote });
    const by = Object.fromEntries(plan.items.map((i) => [i.field, i.change]));
    expect(by).toMatchObject({ title: 'unchanged', shortDescription: 'update', fullDescription: 'unchanged', 'changelog 42': 'update' });
    expect(plan.blockers).toEqual([]);
    expect(buildPlayPlan({ packageName: 'p', inputs, sets: [], imageIssues: [], remote: { listings: [], releases: [] } }).blockers[0]).toMatch(/play.track/);
    expect(buildPlayPlan({ packageName: 'p', inputs, sets: [], imageIssues: [], remote: { listings: [] } }).blockers[0]).toMatch(/does not exist/);
    expect(buildPlayPlan({ packageName: 'p', inputs, sets: [], imageIssues: [], remote: { listings: [], releases: [{ versionCodes: ['41'] }] } }).blockers[0]).toMatch(/play.version-code/);
    const noCode = { ...inputs, app: { track: 'production' } };
    expect(buildPlayPlan({ packageName: 'p', inputs: noCode, sets: [], imageIssues: [], remote: { listings: [], releases: [{}, {}] } }).blockers[0]).toMatch(/2 releases/);
    const unknown = buildPlayPlan({ inputs, sets: [], imageIssues: [{ code: 'play.image.alpha', message: 'x', severity: 'error' }] });
    expect(unknown.items.every((i) => i.change === 'unknown')).toBe(true);
    expect(unknown.blockers.join('\n')).toMatch(/play.package[\s\S]*play.image.alpha/);
    expect(playReadBackDiffs(inputs, remote)).toEqual([expect.stringContaining('tr-TR shortDescription')].concat([expect.stringContaining('changelog 42')]));
  });

  it('runs supply only with a valid key and exports first', async () => {
    const f = await fixture();
    touch(join(f.root, 'Gemfile'));
    const keyFile = touch(join(f.root, 'secrets', 'play.json'), JSON.stringify(serviceAccount));
    const inputs: PlayInputs = { listings: [listing()], app: { track: 'production' } };
    const play: PlayContext = { packageName: 'com.x.app', inputs, key: playKeyFromEnv({ GOOGLE_PLAY_JSON_KEY_PATH: keyFile }, f.root), plan: { inputs, sets: [], imageIssues: [] } };
    const rec = recorder();
    await runPlayUpload(f.paths, play, f.assets, { validateOnly: true }, rec.runner);
    const lane = rec.calls.find((c) => c.args[0] === 'exec')!;
    expect(lane.args).toContain('validate_only:true');
    expect(lane.env).toMatchObject({ VITRIN_PLAY_JSON_KEY_PATH: keyFile, VITRIN_PLAY_METADATA_PATH: join(f.paths.fastlaneMetadata, 'android') });
    expect(existsSync(join(f.paths.fastlaneMetadata, 'android', 'tr-TR', 'title.txt'))).toBe(true);
    const bad: PlayContext = { ...play, key: { from: 'GOOGLE_PLAY_JSON_KEY_PATH', problems: ['not valid JSON'] } };
    await expect(runPlayUpload(f.paths, bad, f.assets, { validateOnly: false }, rec.runner)).rejects.toThrow(/not valid JSON/);
  });
});

// ---- multi-platform upload plan --------------------------------------------------------------------

describe('multi-platform plan', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const creds = { keyId: 'KEY1234567', issuerId: '69a6de7e-0000-0000-0000-000000000000', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const version = (id: string, v: string, state = 'PREPARE_FOR_SUBMISSION') => ({ data: [{ type: 'appStoreVersions', id, attributes: { versionString: v, appVersionState: state } }] });
  function ascFetch(): typeof fetch {
    const routes: Record<string, unknown> = {
      '/v1/apps?filter': { data: [{ type: 'apps', id: '1', attributes: { bundleId: 'com.x', name: 'X' } }] },
      '/v1/apps/1/appStoreVersions?filter[platform]=IOS': { data: [...version('v1', '1.2.0').data, { type: 'appStoreVersions', id: 'v0', attributes: { versionString: '1.1.0', appVersionState: 'READY_FOR_DISTRIBUTION' } }] },
      '/v1/apps/1/appStoreVersions?filter[platform]=MAC_OS': version('m1', '1.0.0'),
      '/v1/apps/1/appStoreVersions?filter[platform]=VISION_OS': { data: [] },
      '/v1/appStoreVersions/v1/appStoreVersionLocalizations': { data: [{ type: 'l', id: 'l1', attributes: { locale: 'tr', description: 'Yeni', keywords: 'a,b', whatsNew: 'Notlar' } }] },
      '/v1/appStoreVersions/m1/appStoreVersionLocalizations': { data: [{ type: 'l', id: 'l2', attributes: { locale: 'tr', description: 'Eski', keywords: 'a,b' } }] },
      '/v1/apps/1/appInfos': { data: [{ type: 'appInfos', id: 'i1', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }] },
      '/v1/appInfos/i1/appInfoLocalizations': { data: [{ type: 'appInfoLocalizations', id: 'il1', attributes: { locale: 'tr', name: 'Ritim' } }] },
    };
    return (async (url: string) => {
      const path = decodeURIComponent(String(url).replace('https://api.appstoreconnect.apple.com', ''));
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      return key ? new Response(JSON.stringify(routes[key]), { status: 200 }) : new Response(JSON.stringify({ errors: [{ detail: path }] }), { status: 404 });
    }) as typeof fetch;
  }

  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
  });
  const config = VitrinConfig.parse({ app: { locales: ['tr'] }, urls: {} });
  const meta = { locale: 'tr', name: 'Ritim', subtitle: '', promotionalText: '', description: 'Yeni', keywords: 'a,b', whatsNew: 'Notlar', claims: [] } as LocaleMetadata;

  it('plans every Apple platform version, shared app info once, and Google Play', async () => {
    const client = new AscClient(creds, ascFetch());
    const calls: string[] = [];
    const playRemote = await new PlayClient(parseServiceAccount(JSON.stringify(serviceAccount)).account!, playFetch({ listings: [], releases: [{ versionCodes: ['42'] }] }, calls)).readState('com.x.app', 'production');
    const inputs: PlayInputs = { listings: [listing()], app: { track: 'production', versionCode: 42 } };
    const plan = await buildPlan({
      paths: f.paths,
      config,
      bundleId: 'com.x',
      metadata: [meta],
      client,
      include: { creatives: false, cpp: false, events: false },
      platforms: ['ios', 'watchos', 'macos', 'visionos', 'android'],
      assets: f.assets,
      play: { packageName: 'com.x.app', inputs, sets: playImageSets(f.assets, inputs.listings), imageIssues: [], remote: playRemote },
    });
    expect(plan.platforms.map((p) => `${p.platform}:${p.version?.versionString ?? '-'}:${p.firstRelease}`)).toEqual(['ios:1.2.0:false', 'osx:1.0.0:true', 'xros:-:true']);
    expect(plan.version?.versionString).toBe('1.2.0');
    expect(plan.blockers).toEqual([expect.stringContaining('visionOS (VISION_OS)')]);
    const md = plan.items.filter((i) => i.area === 'metadata' && i.store !== 'google-play');
    expect(md.filter((i) => i.field === 'name')).toHaveLength(1);
    expect(md.find((i) => i.platform === 'ios' && i.field === 'description')?.change).toBe('unchanged');
    expect(md.find((i) => i.platform === 'osx' && i.field === 'description')?.change).toBe('update');
    // First Mac release: no What's New.
    expect(md.some((i) => i.platform === 'osx' && i.field === 'whatsNew')).toBe(false);
    const shots = plan.items.filter((i) => i.area === 'screenshots' && i.store !== 'google-play').map((i) => `${i.platform}/${i.field}`);
    expect(shots.sort()).toEqual(['ios/iphone-6.9', 'ios/watch-ultra', 'osx/mac-16x10', 'xros/vision']);
    const previews = plan.items.filter((i) => i.area === 'previews');
    expect(previews.map((i) => `${i.platform}/${i.via}`).sort()).toEqual(['ios/deliver', 'osx/asset-library']);
    const play = plan.items.filter((i) => i.store === 'google-play');
    expect(play.every((i) => i.via === 'supply')).toBe(true);
    expect(play.find((i) => i.field === 'title')?.change).toBe('create');
    expect(play.find((i) => i.field === 'phoneScreenshots')?.local).toBe('2 images');
    const text = formatPlan(plan);
    expect(text).toContain('Version (macOS): 1.0.0 — PREPARE_FOR_SUBMISSION (first release)');
    expect(text).toContain('[metadata · macOS]');
    expect(text).toContain('[Google Play · metadata]');
    expect(text).toContain('“Eski” → “Yeni”');
  });

  it('skips ASC entirely for an Android-only app', async () => {
    const inputs: PlayInputs = { listings: [listing()], app: { track: 'production' } };
    const plan = await buildPlan({ paths: f.paths, config, bundleId: 'com.x', metadata: [meta], client: new AscClient(creds, (async () => { throw new Error('no ASC call expected'); }) as typeof fetch), include: { creatives: false, cpp: false, events: false }, platforms: ['android'], assets: f.assets, play: { packageName: 'com.x.app', inputs, sets: [], imageIssues: [] } });
    expect(plan.platforms).toEqual([]);
    expect(plan.items.every((i) => i.store === 'google-play')).toBe(true);
  });

  it('reads back every platform and Google Play', async () => {
    const client = new AscClient(creds, ascFetch());
    const play = new PlayClient(parseServiceAccount(JSON.stringify(serviceAccount)).account!, playFetch({ listings: [{ language: 'tr-TR', title: 'Ritim: Alışkanlık Takibi', shortDescription: 'x', fullDescription: 'Ritim ile alışkanlıklarını her gün işaretle.' }], releases: [{ versionCodes: ['1'] }] }, []));
    const diffs = await readBack({ paths: f.paths, config, bundleId: 'com.x', metadata: [meta], client, platforms: ['ios', 'macos', 'android'], play: { client: play, packageName: 'com.x.app', inputs: { listings: [listing({ changelog: '' })], app: { track: 'production' } } } });
    expect(diffs).toEqual([expect.stringMatching(/^osx tr description: ASC “Eski”/), expect.stringMatching(/^Google Play tr-TR shortDescription/)]);
  });
  // ---- partial uploads (config.selection) ----

  const enabled = TARGETS.filter((t) => ['iphone-6.9', 'watch-ultra', 'mac-16x10', 'vision', 'preview-iphone', 'preview-mac'].includes(t.id));
  const shipping = ['ios', 'watchos', 'macos', 'visionos', 'android'] as const;
  const scopeWith = (selection: VitrinConfig['selection'], uploader: 'deliver' | 'asset-library' = 'deliver') =>
    resolveScope({ shipping: [...shipping], selection, assets: f.assets, enabledTargets: enabled, locales: ['tr'], uploader });

  it('uses deliver overwrite only for complete sets of selected platforms', () => {
    const all = scopeWith({});
    const ios = all.apple.find((s) => s.platform === 'ios')!;
    expect(ios).toMatchObject({ metadata: true, screenshots: 'replace-all', previews: 'replace-all', screenshotTargets: ['iphone-6.9', 'watch-ultra'] });
    expect(all.play).toMatchObject({ selected: true, metadata: true, screenshots: true, creatives: true });

    // "I already uploaded iPhone screenshots; now only watchOS screenshots."
    const watch = scopeWith({ platforms: ['watchos'], assets: ['screenshots'] });
    const w = watch.apple.find((s) => s.platform === 'ios')!;
    expect(w).toMatchObject({ metadata: false, screenshots: 'per-display-type', previews: 'skip', screenshotTargets: ['watch-ultra'] });
    expect(w.untouched.join('\n')).toMatch(/ios not selected[\s\S]*text metadata not selected[\s\S]*only watch-ultra replaced; iphone-6.9/);
    expect(watch.apple.find((s) => s.platform === 'osx')!.untouched[0]).toMatch(/macos not selected/);
    expect(watch.play).toMatchObject({ selected: false });

    // A locale missing one enabled target is not a complete set either.
    const noIphone = resolveScope({ shipping: ['ios', 'watchos'], selection: {}, assets: f.assets.filter((a) => a.target.id !== 'iphone-6.9'), enabledTargets: enabled, locales: ['tr'], uploader: 'deliver' });
    expect(noIphone.apple[0]!.screenshots).toBe('per-display-type');
    // The Asset Library uploader never uses deliver's overwrite.
    expect(scopeWith({}, 'asset-library').apple[0]!.screenshots).toBe('per-display-type');
    // "Only update the App Preview."
    const prev = scopeWith({ platforms: ['ios'], assets: ['previews'] }).apple[0]!;
    expect(prev).toMatchObject({ metadata: false, screenshots: 'skip', previews: 'replace-all', previewTargets: ['preview-iphone'] });
  });

  it('plans a watch-only run without touching text, iPhone or other platforms', async () => {
    const asked: string[] = [];
    const inner = ascFetch();
    const client = new AscClient(creds, (async (url: string, init?: RequestInit) => {
      asked.push(decodeURIComponent(String(url)));
      return inner(url, init);
    }) as typeof fetch);
    const cfg = VitrinConfig.parse({ app: { locales: ['tr'] }, urls: {}, selection: { platforms: ['watchos'], assets: ['screenshots'] } });
    const inputs: PlayInputs = { listings: [listing()], app: { track: 'production' } };
    const plan = await buildPlan({ paths: f.paths, config: cfg, bundleId: 'com.x', metadata: [meta], client, include: { creatives: true, cpp: false, events: false }, platforms: [...shipping], assets: f.assets, enabledTargets: enabled, play: { packageName: 'com.x.app', inputs, sets: [], imageIssues: [] } });
    // Only the iOS version is read; the untouched Mac and Vision versions cannot block this run.
    expect(asked.some((u) => u.includes('MAC_OS') || u.includes('VISION_OS'))).toBe(false);
    expect(plan.blockers).toEqual([]);
    expect(plan.items.filter((i) => i.area === 'metadata')).toEqual([]);
    const shots = plan.items.filter((i) => i.area === 'screenshots');
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ platform: 'ios', field: 'watch-ultra', via: 'asset-library' });
    expect(shots[0]!.note).toMatch(/replaces only the APP_WATCH_ULTRA screenshot set; other display types stay untouched/);
    expect(plan.items.find((i) => i.area === 'creatives')?.note).toMatch(/creatives not selected/);
    const text = formatPlan(plan);
    expect(text).toContain('[untouched · iOS]');
    expect(text).toContain('[untouched · macOS]');
    expect(text).toContain('[untouched · Google Play]');
    expect(text).toMatch(/iphone-6.9 and every other display type stay untouched/);
    expect(text).not.toContain('replaces EVERY');

    // No deliver run at all: no text and no complete set.
    const rec = recorder();
    touch(join(f.root, 'Gemfile'));
    expect(await runDeliverForPlatforms(f.paths, { ...plan, remoteKnown: false }, f.assets, { bundleId: 'com.x', languages: ['tr'] }, rec.runner)).toEqual([]);
    expect(rec.calls.filter((c) => c.args[0] === 'exec')).toEqual([]);
  });

  it('says plainly when a full run replaces every set of a locale', async () => {
    const plan = await buildPlan({ paths: f.paths, config, bundleId: 'com.x', metadata: [meta], include: { creatives: false, cpp: false, events: false }, platforms: ['ios', 'watchos'], assets: f.assets, enabledTargets: enabled });
    const shot = plan.items.find((i) => i.area === 'screenshots' && i.field === 'iphone-6.9')!;
    expect(shot).toMatchObject({ via: 'deliver' });
    expect(shot.note).toMatch(/replaces EVERY screenshot set of tr on iOS/);
  });

  it('runs deliver for text only when only metadata is selected', async () => {
    const cfg = VitrinConfig.parse({ app: { locales: ['tr'] }, urls: {}, selection: { assets: ['metadata'] } });
    const plan = await buildPlan({ paths: f.paths, config: cfg, bundleId: 'com.x', metadata: [meta], include: { creatives: false, cpp: false, events: false }, platforms: ['ios', 'macos'], assets: f.assets, enabledTargets: enabled });
    touch(join(f.root, 'Gemfile'));
    const rec = recorder();
    await runDeliverForPlatforms(f.paths, plan, f.assets, { bundleId: 'com.x', languages: ['tr'] }, rec.runner);
    const lanes = rec.calls.filter((c) => c.args[0] === 'exec');
    expect(lanes.map((c) => c.args.at(-1))).toEqual(['platform:ios', 'platform:osx']);
    for (const l of lanes) expect(l.env).toMatchObject({ VITRIN_SKIP_METADATA: '0', VITRIN_SKIP_SCREENSHOTS: '1' });
    expect(readdirSync(join(f.paths.vitrin, 'deliver', 'ios', 'screenshots'))).toEqual([]);
    expect(readdirSync(join(f.paths.vitrin, 'deliver', 'ios', 'app-previews'))).toEqual([]);
  });

  it('replaces only placements of the selected display class, and refuses when it cannot tell', async () => {
    const deleted: string[] = [];
    const placements = (attrs: Array<Record<string, string>>) =>
      ({
        getAll: async () => attrs.map((a, i) => ({ type: 'appAssetLibraryPlacements', id: `p${i}`, attributes: a })),
        request: async (_m: string, path: string) => {
          deleted.push(path);
          return undefined;
        },
      }) as unknown as AscClient;
    const owner = { type: 'appStoreVersionLocalizations', id: 'l1' };
    const lib = new AssetLibraryClient(placements([{ placementType: 'SCREENSHOT', displayClass: 'IPHONE_69' }, { placementType: 'SCREENSHOT', displayClass: 'APP_WATCH_ULTRA' }, { placementType: 'APP_PREVIEW', displayClass: 'APP_WATCH_ULTRA' }]));
    expect(await lib.clearPlacements(owner, 'SCREENSHOT', 'APP_WATCH_ULTRA', { strict: true })).toBe(1);
    expect(deleted).toEqual(['/v1/appAssetLibraryPlacements/p1']);
    const unclear = new AssetLibraryClient(placements([{ placementType: 'SCREENSHOT' }]));
    await expect(unclear.clearPlacements(owner, 'SCREENSHOT', 'APP_WATCH_ULTRA', { strict: true })).rejects.toThrow(/Refusing/);
  });

  it('uploads only the selected Google Play kinds and leaves the rest', async () => {
    touch(join(f.root, 'Gemfile'));
    const keyFile = touch(join(f.root, 'secrets', 'play.json'), JSON.stringify(serviceAccount));
    const inputs: PlayInputs = { listings: [listing()], app: { track: 'production', versionCode: 42 } };
    const play: PlayContext = { packageName: 'com.x.app', inputs, key: playKeyFromEnv({ GOOGLE_PLAY_JSON_KEY_PATH: keyFile }, f.root), plan: { inputs, sets: [], imageIssues: [] } };
    const sel = scopeWith({ platforms: ['android'], assets: ['screenshots'] }).play!;
    const rec = recorder();
    await runPlayUpload(f.paths, play, f.assets, { validateOnly: false, scope: sel }, rec.runner);
    const lane = rec.calls.find((c) => c.args[0] === 'exec')!;
    expect(lane.env).toMatchObject({ VITRIN_PLAY_SKIP_METADATA: '1', VITRIN_PLAY_SKIP_CHANGELOGS: '1', VITRIN_PLAY_SKIP_SCREENSHOTS: '0', VITRIN_PLAY_SKIP_IMAGES: '1' });
    const images = join(f.paths.fastlaneMetadata, 'android', 'tr-TR', 'images');
    expect(readdirSync(images)).toEqual(['phoneScreenshots']);

    const sets = playImageSets(f.assets, inputs.listings);
    const pp = buildPlayPlan({ packageName: 'com.x.app', inputs, sets, imageIssues: [{ code: 'play.image.feature-graphic', message: 'bad', severity: 'error', playLocale: 'tr-TR', slot: 'featureGraphic' }], scope: sel });
    expect(pp.items.filter((i) => i.area === 'metadata')).toEqual([]);
    expect(pp.items.filter((i) => i.area === 'screenshots').map((i) => i.note)).toEqual(['replaces only the tr-TR phoneScreenshots set; other image types stay untouched']);
    expect(pp.items.some((i) => i.area === 'creatives')).toBe(false);
    // An issue in an image type this run does not upload does not block it.
    expect(pp.blockers).toEqual([]);
    expect(pp.items.filter((i) => i.change === 'skip').map((i) => i.note).join('\n')).toMatch(/text and release notes not selected[\s\S]*feature graphic and icon not selected/);

    // Not selected at all: no supply run.
    const none = recorder();
    await runPlayUpload(f.paths, play, f.assets, { validateOnly: false, scope: scopeWith({ platforms: ['ios'] }).play }, none.runner);
    expect(none.calls).toEqual([]);
  });

  it('blocks a changelog upload that would drop release notes of other languages', () => {
    const inputs: PlayInputs = { listings: [listing()], app: { track: 'production', versionCode: 42 } };
    const remote = { listings: [], releases: [{ versionCodes: ['42'], releaseNotes: [{ language: 'tr-TR', text: 'Eski' }, { language: 'de-DE', text: 'Alt' }] }] };
    expect(buildPlayPlan({ packageName: 'p', inputs, sets: [], imageIssues: [], remote }).blockers).toEqual([expect.stringMatching(/play.changelog.would-clear.*de-DE/)]);
    // Without metadata in the run the release notes are not touched, so nothing can be lost.
    expect(buildPlayPlan({ packageName: 'p', inputs, sets: [], imageIssues: [], remote, scope: { metadata: false, screenshots: true, creatives: true, untouched: [] } }).blockers).toEqual([]);
  });
});
