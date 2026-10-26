import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeProject,
  androidValuesLocale,
  detectDuo,
  detectFramework,
  gradleValue,
  normalizeLocale,
  readPbxproj,
  splitFlutterVersion,
  targetPlatforms,
  xcodeVersionOf,
} from '../src/index.js';

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const RITIM = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'examples', 'Ritim');
const analyze = (name: string) => analyzeProject({ root: join(FIXTURES, name) });
const ids = (p: { features: Array<{ id: string }> }) => p.features.map((f) => f.id);

describe('Xcode platform detection', () => {
  it('maps SDKROOT, SUPPORTED_PLATFORMS and device families to platforms', () => {
    expect(targetPlatforms({ SDKROOT: 'iphoneos', TARGETED_DEVICE_FAMILY: '1,2' }).platforms).toEqual(['ios']);
    expect(targetPlatforms({ SDKROOT: 'macosx' }).platforms).toEqual(['macos']);
    expect(targetPlatforms({ SDKROOT: 'watchos', TARGETED_DEVICE_FAMILY: '4' }).platforms).toEqual(['watchos']);
    expect(targetPlatforms({ SDKROOT: 'appletvos' }).platforms).toEqual(['tvos']);
    expect(targetPlatforms({ SDKROOT: 'xros' }).platforms).toEqual(['visionos']);
    expect(targetPlatforms({ SDKROOT: 'auto', SUPPORTED_PLATFORMS: 'iphoneos iphonesimulator macosx xros xrsimulator' }).platforms).toEqual(['ios', 'macos', 'visionos']);
    expect(targetPlatforms({}).platforms).toEqual(['ios']); // Xcode's default SDK
  });

  it('counts Mac Catalyst as macOS but not "Designed for iPad"', () => {
    const catalyst = targetPlatforms({ SDKROOT: 'iphoneos', TARGETED_DEVICE_FAMILY: '1,2,6', SUPPORTS_MACCATALYST: 'YES' });
    expect(catalyst).toEqual({ platforms: ['ios', 'macos'], macCatalyst: true });
    const designedForIPad = targetPlatforms({ SDKROOT: 'iphoneos', TARGETED_DEVICE_FAMILY: '1,2', SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: 'YES', SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD: 'YES' });
    expect(designedForIPad).toEqual({ platforms: ['ios'], macCatalyst: false });
    expect(targetPlatforms({ SDKROOT: 'iphoneos', TARGETED_DEVICE_FAMILY: '1,2,7' }).platforms).toEqual(['ios', 'visionos']);
  });

  it('ignores the watch container stub and counts legacy WatchKit apps', () => {
    expect(targetPlatforms({ SDKROOT: 'iphoneos' }, 'com.apple.product-type.application.watchapp2-container').platforms).toEqual([]);
    expect(targetPlatforms({ SDKROOT: 'watchos' }, 'com.apple.product-type.application.watchapp2').platforms).toEqual(['watchos']);
  });

  it('reads the Xcode version from LastUpgradeCheck', () => {
    expect(xcodeVersionOf('2710')).toBe(27.1);
    expect(xcodeVersionOf('1430')).toBe(14.3);
    expect(xcodeVersionOf('2600')).toBe(26);
    expect(xcodeVersionOf(undefined)).toBeUndefined();
    const pbx = readPbxproj('{ objects = { P = { isa = PBXProject; attributes = { LastUpgradeCheck = 2710; BuildIndependentTargetsInParallel = 1; }; targets = (); }; }; rootObject = P; }');
    expect(pbx.attributes.LastUpgradeCheck).toBe('2710');
  });

  it('iPhone Duo heuristic: Xcode 27.1+ or an iOS 27.1 deployment target, iPhone only', () => {
    const base = { supportsIPhone: true, pbxprojPath: 'A.xcodeproj/project.pbxproj' };
    expect(detectDuo({ ...base, attributes: { LastUpgradeCheck: '2710' } }).supported).toBe(true);
    expect(detectDuo({ ...base, attributes: { LastSwiftUpdateCheck: '2800' } }).supported).toBe(true);
    expect(detectDuo({ ...base, attributes: { LastUpgradeCheck: '2700' } }).supported).toBe(false);
    expect(detectDuo({ ...base, attributes: {}, deploymentTarget: '27.1' }).supported).toBe(true);
    expect(detectDuo({ ...base, attributes: { LastUpgradeCheck: '2710' }, supportsIPhone: false }).supported).toBe(false);
    expect(detectDuo({ ...base, attributes: { LastUpgradeCheck: '2710' } }).evidence).toMatchObject({ path: base.pbxprojPath, note: expect.stringContaining('LastUpgradeCheck=2710') });
  });
});

describe('framework file readers', () => {
  it('normalises locale spellings', () => {
    expect(normalizeLocale('pt_BR')).toBe('pt-BR');
    expect(normalizeLocale('zh_Hans')).toBe('zh-Hans');
    expect(normalizeLocale('b+sr+Latn')).toBe('sr-Latn');
    expect(normalizeLocale('zh-rTW')).toBe('zh-TW');
    expect(normalizeLocale('night')).toBeUndefined();
  });

  it('reads Android locale qualifiers and skips other qualifiers', () => {
    expect(androidValuesLocale('values-tr')).toBe('tr');
    expect(androidValuesLocale('values-pt-rBR')).toBe('pt-BR');
    expect(androidValuesLocale('values-b+zh+Hans')).toBe('zh-Hans');
    for (const d of ['values', 'values-night', 'values-v21', 'values-sw600dp', 'values-land', 'values-tr-night']) expect(androidValuesLocale(d), d).toBeUndefined();
  });

  it('reads literal Gradle values in Groovy and Kotlin DSL', () => {
    expect(gradleValue('  applicationId "com.a.b"\n', 'applicationId')).toBe('com.a.b');
    expect(gradleValue('  applicationId = "com.a.b"\n', 'applicationId')).toBe('com.a.b');
    expect(gradleValue('  versionName = flutter.versionName\n', 'versionName')).toBeUndefined();
    expect(gradleValue('  versionCode 7\n', 'versionCode')).toBe('7');
    expect(gradleValue('  versionCode = 51\n', 'versionCode')).toBe('51');
  });

  it('splits Flutter versions', () => {
    expect(splitFlutterVersion('2.3.1+45')).toEqual({ name: '2.3.1', build: '45' });
    expect(splitFlutterVersion('1.0.0')).toEqual({ name: '1.0.0', build: undefined });
  });

  it('detects each project kind', async () => {
    expect((await detectFramework(join(FIXTURES, 'flutter'))).kind).toBe('flutter');
    expect((await detectFramework(join(FIXTURES, 'react-native'))).kind).toBe('react-native');
    expect((await detectFramework(join(FIXTURES, 'expo'))).kind).toBe('expo');
    const android = await detectFramework(join(FIXTURES, 'android'));
    expect(android).toMatchObject({ kind: 'native', androidDir: '.' });
    expect((await detectFramework(join(FIXTURES, 'mac'))).kind).toBe('native');
  });
});

describe('analyzeProject per project kind', () => {
  it('Flutter: Runner host, pubspec version, ARB locales, macOS and Android', async () => {
    const p = await analyze('flutter');
    expect(p.project).toMatchObject({ kind: 'flutter', iosDir: 'ios', androidDir: 'android', macosDir: 'macos', xcodeproj: 'ios/Runner.xcodeproj', scheme: 'Runner', androidApplicationId: 'com.example.habitflow' });
    expect(p.app).toMatchObject({ displayName: 'Habit Flow', bundleId: 'com.example.habitflow', version: '2.3.1', build: '45', supportsIPhone: true, supportsIPad: true, supportsDuo: false });
    expect(p.app.platforms).toEqual(['ios', 'macos', 'android']);
    expect(p.app.locales.map((l) => l.xcode)).toEqual(['en', 'pt-BR', 'tr']);
    expect(p.app.platformEvidence.android![0]!.path).toBe('android/app/src/main/AndroidManifest.xml');
    expect(ids(p)).toEqual(expect.arrayContaining(['ipad', 'mac-app', 'android-app', 'charts', 'localization']));
    expect(p.signals['vitrin.demo-mode']).toBeDefined();
  });

  it('React Native: workspace, Gradle applicationId, strings.xml locales, tablet resources, Pods ignored', async () => {
    const p = await analyze('react-native');
    expect(p.project).toMatchObject({ kind: 'react-native', xcodeproj: 'ios/Pocket.xcodeproj', workspace: 'ios/Pocket.xcworkspace', scheme: 'Pocket', androidApplicationId: 'com.pocketbudget' });
    expect(p.project.targets.map((t) => t.name)).toEqual(['Pocket']);
    expect(p.app).toMatchObject({ displayName: 'Pocket Budget', version: '1.4.0', build: '7', supportsIPad: false, supportsAndroidTablet: true });
    expect(p.app.platforms).toEqual(['ios', 'android']);
    expect(p.app.locales.map((l) => l.xcode)).toEqual(['de', 'en']);
    expect(p.signals['vitrin.demo-mode']?.[0]?.path).toBe('App.tsx');
  });

  it('Expo without native folders: app.json identity, prebuild needed', async () => {
    const p = await analyze('expo');
    expect(p.project).toMatchObject({ kind: 'expo', needsPrebuild: true, iosDir: 'ios', androidDir: 'android', androidApplicationId: 'com.trailnotes.android' });
    expect(p.project.xcodeproj).toBeUndefined();
    expect(p.app).toMatchObject({ displayName: 'Trail Notes', bundleId: 'com.trailnotes.app', version: '3.0.0', build: '12', supportsIPhone: true, supportsIPad: true });
    expect(p.app.platforms).toEqual(['ios', 'android']);
    expect(p.app.locales.map((l) => l.xcode)).toEqual(['en', 'tr']);
    expect(p.todo.some((t) => t.includes('expo prebuild'))).toBe(true);
    expect(p.features.find((f) => f.id === 'ipad')!.evidence[0]!.path).toBe('app.json');
  });

  it('native Android only: no iOS, Kotlin DSL, locale qualifiers', async () => {
    const p = await analyze('android');
    expect(p.project).toMatchObject({ kind: 'native', androidDir: '.', androidApplicationId: 'com.example.quicknotes' });
    expect(p.app).toMatchObject({ displayName: 'Quick Notes', bundleId: undefined, version: '5.1', build: '51', supportsIPhone: false, supportsIPad: false });
    expect(p.app.platforms).toEqual(['android']);
    expect(p.app.locales.map((l) => l.xcode)).toEqual(['es', 'pt-BR', 'zh-Hans']);
    expect(p.signals['vitrin.demo-mode']?.[0]?.path).toBe('app/src/main/java/com/example/notes/MainActivity.kt');
  });

  it('macOS-only app is not an iPhone app', async () => {
    const p = await analyze('mac');
    expect(p.app.platforms).toEqual(['macos']);
    expect(p.app.supportsIPhone).toBe(false);
    expect(p.project.targets[0]!.devices).toContain('mac');
    expect(ids(p)).toContain('mac-app');
  });

  it('watchOS: single-target watch app next to the iOS app', async () => {
    const p = await analyze('watch');
    expect(p.app.platforms).toEqual(['ios', 'watchos']);
    expect(p.project.scheme).toBe('Pulse');
    expect(p.project.targets.find((t) => t.name === 'Pulse Watch App')).toMatchObject({ kind: 'watch', platforms: ['watchos'], bundleId: 'com.example.pulse.watchkitapp' });
    expect(ids(p)).toContain('apple-watch');
  });

  it('tvOS and visionOS', async () => {
    const tv = await analyze('tv');
    expect(tv.app.platforms).toEqual(['tvos']);
    expect(tv.app.supportsIPhone).toBe(false);
    expect(ids(tv)).toContain('apple-tv');
    const vision = await analyze('vision');
    expect(vision.app.platforms).toEqual(['ios', 'visionos']); // "Designed for iPad" on Mac does not add macOS
    expect(ids(vision)).toContain('vision-pro');
  });

  it('iPhone Duo from Xcode 27.1, with evidence', async () => {
    const p = await analyze('duo');
    expect(p.app.supportsDuo).toBe(true);
    expect(p.features.find((f) => f.id === 'iphone-duo')).toMatchObject({ kind: 'platform', confidence: 'medium' });
  });

  it('native Swift example keeps its previous profile', async () => {
    const p = await analyzeProject({ root: RITIM });
    expect(p.project).toMatchObject({ kind: 'native', iosDir: '.', xcodeproj: 'Ritim.xcodeproj', scheme: 'Ritim' });
    expect(p.app).toMatchObject({ displayName: 'Ritim', bundleId: 'com.jastech.ritim', version: '1.2.0', supportsIPhone: true, supportsIPad: true, platforms: ['ios'] });
    expect(p.app.locales.map((l) => l.asc)).toEqual(['en-US', 'tr']);
    expect(p.signals['vitrin.demo-mode']).toBeDefined();
  });

  it('fails clearly when there is no app at all', async () => {
    await expect(analyzeProject({ root: join(FIXTURES, 'flutter', 'lib') })).rejects.toThrow(/No Xcode project or Android app/);
  });
});
