import type { ExecOptions, ExecResult } from '@vitrin/core';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  AndroidDevice,
  amStartArgs,
  androidLocaleTag,
  androidTools,
  appLocaleArgs,
  avdCreateArgs,
  avdNameFor,
  demoModeCommands,
  emulatorArgs,
  ensureAvd,
  launchArgsToExtras,
  parseAvdList,
  parseResolvedActivity,
  parseWmSize,
  pickSystemImage,
} from '../src/android.js';
import { appIdentity, artifactDir, buildApp, compileSteps, effectiveConfiguration, gradleVariant, prepareSteps, xcodeDestination, type BuildInput, type Runner } from '../src/build.js';
import { captureKinds, familiesToCapture, requiredTools } from '../src/commands/pipeline.js';
import { applySelection, parseChoice, platformsReport } from '../src/commands/select.js';
import type { Ctx } from '../src/context.js';
import { ensureSimulator, macLaunchArgs, pickMainWindow, pickRuntime, runtimeMatches, screencaptureArgs, screenRecordArgs, statusBarArgs, type SimList } from '../src/simulator.js';
import { configWith, profileWith } from './helpers.js';

/** Records every command and answers from a table (first matching prefix wins). */
function mockRunner(answers: Array<[string, Partial<ExecResult>]> = []) {
  const calls: Array<{ cmd: string; args: string[]; opts?: ExecOptions }> = [];
  const runner: Runner = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const line = [cmd, ...args].join(' ');
    const hit = answers.find(([prefix]) => line.startsWith(prefix) || line.includes(prefix));
    return { code: 0, stdout: '', stderr: '', ...(hit?.[1] ?? {}) };
  };
  return { runner, calls, lines: () => calls.map((c) => [c.cmd, ...c.args].join(' ')) };
}

const base: BuildInput = { root: '/app', kind: 'native', platform: 'ios', iosDir: '.', xcodeproj: 'App.xcodeproj', scheme: 'App', configuration: 'Debug', derivedData: '/app/.vitrin/cache/DerivedData' };
const never = () => false;
const always = () => true;

describe('build commands per kind and platform', () => {
  it('native iOS: xcodebuild for the simulator without signing', () => {
    expect(prepareSteps(base, never)).toEqual([]);
    const [step] = compileSteps(base);
    expect(step!.cmd).toBe('xcodebuild');
    expect(step!.args).toEqual(['-project', '/app/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', base.derivedData, 'build', 'CODE_SIGNING_ALLOWED=NO', 'COMPILER_INDEX_STORE_ENABLE=NO']);
    expect(artifactDir(base)).toEqual({ dir: '/app/.vitrin/cache/DerivedData/Build/Products/Debug-iphonesimulator', ext: '.app', preferred: 'App.app' });
  });

  it('simulator SDKs and macOS variants', () => {
    expect(xcodeDestination('watchos').destination).toBe('generic/platform=watchOS Simulator');
    expect(xcodeDestination('tvos').products('Debug')).toBe('Debug-appletvsimulator');
    expect(xcodeDestination('visionos').products('Debug')).toBe('Debug-xrsimulator');
    expect(xcodeDestination('macos')).toMatchObject({ destination: 'platform=macOS' });
    expect(xcodeDestination('macos', true).destination).toBe('platform=macOS,variant=Mac Catalyst');
    expect(xcodeDestination('macos', true).products('Debug')).toBe('Debug-maccatalyst');
    const mac = compileSteps({ ...base, platform: 'macos' })[0]!;
    expect(mac.args).toContain('CODE_SIGN_IDENTITY=-'); // ad-hoc: unsigned Mac apps do not launch on Apple silicon
    expect(mac.args).not.toContain('CODE_SIGNING_ALLOWED=NO');
    expect(compileSteps({ ...base, platform: 'watchos', scheme: 'App Watch App' })[0]!.args).toContain('App Watch App');
  });

  it('Flutter: flutter build for iOS simulator, macOS and APK', () => {
    const f = { ...base, kind: 'flutter' as const, iosDir: 'ios', xcodeproj: 'ios/Runner.xcodeproj', scheme: 'Runner' };
    expect(compileSteps(f)[0]).toMatchObject({ cmd: 'flutter', args: ['build', 'ios', '--simulator', '--debug'], cwd: '/app' });
    expect(artifactDir(f)).toMatchObject({ dir: '/app/build/ios/iphonesimulator', preferred: 'Runner.app' });
    expect(compileSteps({ ...f, platform: 'macos' })[0]!.args).toEqual(['build', 'macos', '--debug']);
    expect(compileSteps({ ...f, platform: 'android' })[0]!.args).toEqual(['build', 'apk', '--debug']);
    expect(artifactDir({ ...f, platform: 'android' })).toMatchObject({ dir: '/app/build/app/outputs/flutter-apk', ext: '.apk', preferred: 'app-debug.apk' });
    expect(() => compileSteps({ ...f, platform: 'watchos' })).toThrow(/Flutter does not build for watchos/);
  });

  it('React Native: pod install, then xcodebuild on the workspace (Release); gradlew assembleRelease', () => {
    const rn = { ...base, kind: 'react-native' as const, iosDir: 'ios', androidDir: 'android', workspace: 'ios/Pocket.xcworkspace', scheme: 'Pocket' };
    expect(prepareSteps(rn, (p) => p === '/app/Gemfile')).toEqual([expect.objectContaining({ cmd: 'bundle', args: ['exec', 'pod', 'install'], cwd: '/app/ios' })]);
    expect(prepareSteps(rn, never)[0]).toMatchObject({ cmd: 'pod', args: ['install'] });
    expect(prepareSteps({ ...rn, podInstall: false }, never)).toEqual([]);
    const xb = compileSteps(rn)[0]!;
    expect(xb.args.slice(0, 6)).toEqual(['-workspace', '/app/ios/Pocket.xcworkspace', '-scheme', 'Pocket', '-configuration', 'Release']);
    expect(xb.env).toEqual({ RCT_NO_LAUNCH_PACKAGER: '1' });
    const gradle = compileSteps({ ...rn, platform: 'android' })[0]!;
    expect(gradle).toMatchObject({ cmd: './gradlew', args: ['assembleRelease', '--console=plain'], cwd: '/app/android' });
    expect(artifactDir({ ...rn, platform: 'android' })).toMatchObject({ dir: '/app/android/app/build/outputs/apk/release', preferred: 'app-release.apk' });
    // Metro mode: Debug variants.
    expect(effectiveConfiguration({ ...rn, metro: true })).toBe('Debug');
    expect(compileSteps({ ...rn, platform: 'android', metro: true })[0]!.args[0]).toBe('assembleDebug');
  });

  it('Expo: prebuild only when the native folder is missing', () => {
    const expo = { ...base, kind: 'expo' as const, iosDir: 'ios', androidDir: 'android', xcodeproj: undefined, scheme: undefined };
    const ios = prepareSteps(expo, never);
    expect(ios.map((s) => s.label)).toEqual(['npx expo prebuild (ios)', 'pod install']);
    expect(ios[0]).toMatchObject({ cmd: 'npx', args: ['expo', 'prebuild', '--platform', 'ios', '--no-install'], cwd: '/app', env: { CI: '1', EXPO_NO_GIT_STATUS: '1' } });
    expect(prepareSteps(expo, always).map((s) => s.label)).toEqual(['pod install']);
    expect(prepareSteps({ ...expo, platform: 'android' }, never).map((s) => s.args.join(' '))).toEqual(['expo prebuild --platform android --no-install']);
    expect(() => prepareSteps({ ...expo, prebuild: false }, never)).toThrow(/prebuild is false/);
  });

  it('native Android: gradlew assembleDebug (or a configured task)', () => {
    const a = { ...base, platform: 'android' as const, androidDir: '.' };
    expect(compileSteps(a, always)[0]).toMatchObject({ cmd: './gradlew', args: ['assembleDebug', '--console=plain'], cwd: '/app' });
    expect(compileSteps(a, never)[0]!.cmd).toBe('gradle');
    expect(gradleVariant('assembleFreeRelease')).toBe('freeRelease');
    expect(gradleVariant(':app:assembleDebug')).toBe('debug');
    expect(artifactDir({ ...a, gradleTask: 'assembleStagingDebug' }).dir).toBe('/app/app/build/outputs/apk/stagingDebug');
  });

  it('buildApp runs prepare + compile, resolves the Expo workspace after prebuild and returns the artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-build-'));
    const derived = join(root, 'dd');
    const { runner, lines } = mockRunner();
    // Simulate what prebuild + pod install + xcodebuild leave behind.
    mkdirSync(join(root, 'ios', 'TrailNotes.xcworkspace'), { recursive: true });
    mkdirSync(join(derived, 'Build', 'Products', 'Release-iphonesimulator', 'TrailNotes.app'), { recursive: true });
    const app = await buildApp({ root, kind: 'expo', platform: 'ios', iosDir: 'ios', configuration: 'Debug', derivedData: derived }, runner);
    expect(app).toBe(join(derived, 'Build', 'Products', 'Release-iphonesimulator', 'TrailNotes.app'));
    expect(lines()[0]).toBe('pod install'); // ios/ exists, so no prebuild
    expect(lines()[1]).toContain(`-workspace ${join(root, 'ios', 'TrailNotes.xcworkspace')} -scheme TrailNotes -configuration Release`);
  });

  it('buildApp surfaces build errors', async () => {
    const { runner } = mockRunner([['xcodebuild', { code: 65, stdout: 'x\n/app/A.swift:1: error: cannot find type\n' }]]);
    await expect(buildApp(base, runner)).rejects.toThrow(/cannot find type/);
  });

  it('picks the bundle id and scheme per platform', () => {
    const p = profileWith(
      { bundleId: 'com.a.app', platforms: ['ios', 'watchos', 'macos'] },
      {
        scheme: 'App',
        androidApplicationId: 'com.a.android',
        targets: [
          { name: 'App', kind: 'app', bundleId: 'com.a.app', devices: ['iphone', 'mac'], platforms: ['ios', 'macos'], macCatalyst: true },
          { name: 'App Watch App', kind: 'watch', bundleId: 'com.a.app.watchkitapp', devices: ['watch'], platforms: ['watchos'], macCatalyst: false },
        ],
      },
    );
    expect(appIdentity(p, 'ios')).toMatchObject({ appId: 'com.a.app', scheme: 'App' });
    expect(appIdentity(p, 'watchos')).toMatchObject({ appId: 'com.a.app.watchkitapp', scheme: 'App Watch App' });
    expect(appIdentity(p, 'macos')).toMatchObject({ appId: 'com.a.app', scheme: 'App', macCatalyst: true });
    expect(appIdentity(p, 'android').appId).toBe('com.a.android');
    expect(appIdentity(p, 'android', { androidApplicationId: 'x.y' }).appId).toBe('x.y');
  });
});

describe('simulators per platform', () => {
  const list: SimList = {
    devices: {},
    devicetypes: [
      { name: 'Apple Watch Ultra 3 (49mm)', identifier: 'watch-ultra-3' },
      { name: 'Apple Vision Pro', identifier: 'vision-pro' },
      { name: 'iPhone 17 Pro', identifier: 'iphone-17-pro' },
    ],
    runtimes: [
      { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-1', name: 'iOS 27.1', version: '27.1', isAvailable: true, platform: 'iOS' },
      { identifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-12-0', name: 'watchOS 12.0', version: '12.0', isAvailable: true, platform: 'watchOS' },
      { identifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-11-0', name: 'watchOS 11.0', version: '11.0', isAvailable: true },
      { identifier: 'com.apple.CoreSimulator.SimRuntime.xrOS-3-0', name: 'visionOS 3.0', version: '3.0', isAvailable: true, platform: 'xrOS' },
      { identifier: 'com.apple.CoreSimulator.SimRuntime.tvOS-27-0', name: 'tvOS 27.0', version: '27.0', isAvailable: false },
    ],
  };

  it('filters runtimes by platform (not /iOS/ for everything)', () => {
    expect(runtimeMatches(list.runtimes[0]!, 'ios')).toBe(true);
    expect(runtimeMatches(list.runtimes[1]!, 'ios')).toBe(false);
    expect(runtimeMatches(list.runtimes[3]!, 'ios')).toBe(false);
    expect(runtimeMatches(list.runtimes[3]!, 'visionos')).toBe(true);
    expect(runtimeMatches(list.runtimes[2]!, 'watchos')).toBe(true); // no platform field: name/identifier
    expect(pickRuntime(list, 'Apple Watch Ultra 3 (49mm)', 'watchos').runtime.name).toBe('watchOS 12.0');
    expect(pickRuntime(list, 'Apple Vision Pro', 'visionos').runtime.name).toBe('visionOS 3.0');
    expect(() => pickRuntime(list, 'Apple Vision Pro', 'tvos')).toThrow(/No suitable tvOS runtime/);
    expect(() => pickRuntime(list, 'Apple TV 4K (3rd generation)', 'tvos')).toThrow(/device type not found/);
  });

  it('creates a dedicated simulator on the right runtime', async () => {
    const { runner, lines } = mockRunner([
      ['xcrun simctl list -j', { stdout: JSON.stringify(list) }],
      ['xcrun simctl create', { stdout: 'UDID-1\n' }],
    ]);
    const sim = await ensureSimulator('Apple Watch Ultra 3 (49mm)', 'watchos', runner);
    expect(sim).toEqual({ udid: 'UDID-1', name: 'Vitrin · Apple Watch Ultra 3 (49mm)', runtime: 'watchOS 12.0' });
    expect(lines()[1]).toBe('xcrun simctl create Vitrin · Apple Watch Ultra 3 (49mm) watch-ultra-3 com.apple.CoreSimulator.SimRuntime.watchOS-12-0');
  });

  it('status bar overrides per platform', () => {
    expect(statusBarArgs('U', 'ios')).toEqual(expect.arrayContaining(['--time', '9:41', '--batteryLevel', '100', '--cellularBars', '4']));
    expect(statusBarArgs('U', 'watchos')).toEqual(['simctl', 'status_bar', 'U', 'override', '--time', '9:41']);
    expect(statusBarArgs('U', 'tvos')).toBeUndefined();
    expect(statusBarArgs('U', 'visionos')).toBeUndefined();
  });
});

describe('Mac capture', () => {
  it('builds launch arguments, window capture and recording commands', () => {
    expect(macLaunchArgs(['-VitrinDemo', '-VitrinScreen', 'home'], 'tr', 'tr', 'dark')).toEqual(['-VitrinDemo', '-VitrinScreen', 'home', '-AppleLanguages', '(tr)', '-AppleLocale', 'tr_TR', '-AppleInterfaceStyle', 'Dark']);
    expect(macLaunchArgs([], 'en-US', 'us', 'light')).toEqual(['-AppleLanguages', '(en-US)', '-AppleLocale', 'en_US']);
    expect(screencaptureArgs(4711, '/o.png')).toEqual(['-l', '4711', '-o', '-x', '-t', 'png', '/o.png']);
    expect(screenRecordArgs({ x: 40, y: 60.4, w: 1440, h: 900 }, 12, '/o.mov')).toEqual(['-v', '-V', '12', '-x', '-R40,60,1440,900', '/o.mov']);
    expect(pickMainWindow([{ id: 1, x: 0, y: 0, w: 300, h: 200, title: 'panel' }, { id: 2, x: 0, y: 0, w: 1440, h: 900, title: 'main' }, { id: 0, x: 0, y: 0, w: 4000, h: 4000, title: '' }])?.id).toBe(2);
  });
});

describe('Android capture', () => {
  it('converts launch arguments to intent extras', () => {
    expect(launchArgsToExtras(['-VitrinDemo', '-VitrinScreen', 'home'])).toEqual(['--ez', 'vitrinDemo', 'true', '--es', 'vitrinScreen', 'home']);
    expect(launchArgsToExtras(['-VitrinDemo', '-Pro', 'YES', '-Count', '3', '-Flag'])).toEqual(['--ez', 'vitrinDemo', 'true', '--ez', 'pro', 'true', '--ei', 'count', '3', '--ez', 'flag', 'true']);
    expect(amStartArgs('com.a/.Main', ['--ez', 'vitrinDemo', 'true'])).toEqual(['am', 'start', '-W', '-S', '-n', 'com.a/.Main', '--ez', 'vitrinDemo', 'true']);
    expect(amStartArgs('com.a/.Main', [], 'app://stats')).toEqual(['am', 'start', '-W', '-S', '-n', 'com.a/.Main', '-a', 'android.intent.action.VIEW', '-d', 'app://stats']);
  });

  it('System UI demo mode: 09:41, full battery and signal, no notifications', () => {
    const cmds = demoModeCommands().map((c) => c.join(' '));
    expect(cmds[0]).toBe('settings put global sysui_demo_allowed 1');
    expect(cmds).toEqual(
      expect.arrayContaining([
        'am broadcast -a com.android.systemui.demo -e command enter',
        'am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941',
        'am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false',
        'am broadcast -a com.android.systemui.demo -e command notifications -e visible false',
      ]),
    );
  });

  it('per-app language tags', () => {
    expect(androidLocaleTag('tr', 'tr')).toBe('tr-TR');
    expect(androidLocaleTag('en-US', 'us')).toBe('en-US');
    expect(androidLocaleTag('de-DE', 'de')).toBe('de-DE');
    expect(androidLocaleTag('zh-Hans', 'cn')).toBe('zh-Hans-CN');
    expect(androidLocaleTag('no', 'no')).toBe('nb-NO');
    expect(appLocaleArgs('com.a', 'tr-TR')).toEqual(['cmd', 'locale', 'set-app-locales', 'com.a', '--user', 'current', '--locales', 'tr-TR']);
  });

  it('AVD and emulator commands', () => {
    expect(avdNameFor('Nexus 7 2013')).toBe('Vitrin_Nexus_7_2013');
    expect(avdCreateArgs('Vitrin_pixel_9', 'system-images;android-36;google_apis;arm64-v8a', 'pixel_9')).toEqual(['create', 'avd', '-n', 'Vitrin_pixel_9', '-k', 'system-images;android-36;google_apis;arm64-v8a', '-d', 'pixel_9', '--force']);
    expect(emulatorArgs('A', 5680, true)).toEqual(['-avd', 'A', '-port', '5680', '-no-snapshot-save', '-no-boot-anim', '-no-audio', '-no-window']);
    expect(parseAvdList('INFO    | Storing crashdata\nPixel_9\nVitrin_pixel_9\n')).toEqual(['Pixel_9', 'Vitrin_pixel_9']);
    expect(pickSystemImage(['android-34/google_apis/arm64-v8a', 'android-36/google_apis_playstore/arm64-v8a', 'android-36/google_apis/arm64-v8a', 'android-36/google_apis/x86_64'], 'arm64')).toBe('system-images;android-36;google_apis;arm64-v8a');
    expect(pickSystemImage(['android-35/default/x86_64'], 'x64')).toBe('system-images;android-35;default;x86_64');
    expect(pickSystemImage([], 'arm64')).toBeUndefined();
    expect(parseResolvedActivity('priority=0 preferredOrder=0\ncom.a/.MainActivity\n', 'com.a')).toBe('com.a/.MainActivity');
    expect(parseWmSize('Physical size: 2560x1600\n')).toEqual({ width: 2560, height: 1600 });
    expect(parseWmSize('Physical size: 1080x2400\nOverride size: 1080x1920\n')).toEqual({ width: 1080, height: 1920 });
  });

  it('finds SDK tools under ANDROID_HOME', () => {
    const t = androidTools({ ANDROID_HOME: '/sdk' }, (p) => p !== '/sdk/cmdline-tools/latest/bin/avdmanager');
    expect(t).toEqual({ sdkRoot: '/sdk', adb: '/sdk/platform-tools/adb', emulator: '/sdk/emulator/emulator', avdmanager: '/sdk/tools/bin/avdmanager' });
    expect(androidTools({}).adb).toBe('adb');
  });

  it('ensureAvd uses a configured AVD, reuses Vitrin_<profile>, or creates it', async () => {
    const tools = { adb: 'adb', emulator: 'emulator', avdmanager: 'avdmanager' };
    const listed = mockRunner([['emulator -list-avds', { stdout: 'My_Pixel\nVitrin_pixel_9\n' }]]);
    expect(await ensureAvd(tools, { configured: 'My_Pixel', deviceProfile: 'pixel_9' }, listed.runner)).toBe('My_Pixel');
    await expect(ensureAvd(tools, { configured: 'Nope', deviceProfile: 'pixel_9' }, listed.runner)).rejects.toThrow(/AVD “Nope” not found/);
    expect(await ensureAvd(tools, { deviceProfile: 'pixel_9' }, listed.runner)).toBe('Vitrin_pixel_9');
    // No SDK root → no system image to create from.
    await expect(ensureAvd(tools, { deviceProfile: 'pixel_tablet' }, listed.runner)).rejects.toThrow(/No Android system image/);
    const sdk = mkdtempSync(join(tmpdir(), 'vitrin-sdk-'));
    const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
    mkdirSync(join(sdk, 'system-images', 'android-36', 'google_apis', abi), { recursive: true });
    const create = mockRunner([['emulator -list-avds', { stdout: '' }]]);
    expect(await ensureAvd({ ...tools, sdkRoot: sdk }, { deviceProfile: 'pixel_tablet' }, create.runner)).toBe('Vitrin_pixel_tablet');
    expect(create.lines()[1]).toBe(`avdmanager create avd -n Vitrin_pixel_tablet -k system-images;android-36;google_apis;${abi} -d pixel_tablet --force`);
  });

  it('AndroidDevice drives adb through the runner', async () => {
    const m = mockRunner([
      ['getprop sys.boot_completed', { stdout: '1\n' }],
      ['wm size', { stdout: 'Physical size: 2560x1600\n' }],
      ['resolve-activity', { stdout: 'com.a/.MainActivity\n' }],
    ]);
    const d = new AndroidDevice({ adb: 'adb', emulator: 'emulator', avdmanager: 'avdmanager' }, 'emulator-5682', m.runner);
    await d.waitForBoot(5, 1);
    await d.install('/x/app-release.apk');
    await d.prepare('dark', true);
    await d.setAppLocale('com.a', 'tr-TR');
    const component = await d.resolveActivity('com.a');
    await d.launch(component, launchArgsToExtras(['-VitrinDemo', '-VitrinScreen', 'stats']));
    const lines = m.lines();
    expect(lines).toContain('adb -s emulator-5682 install -r -t -g /x/app-release.apk');
    expect(lines).toContain('adb -s emulator-5682 shell settings put global sysui_demo_allowed 1');
    expect(lines).toContain('adb -s emulator-5682 shell cmd uimode night yes');
    expect(lines).toContain('adb -s emulator-5682 shell settings put system user_rotation 1'); // landscape tablet → portrait
    expect(lines).toContain('adb -s emulator-5682 shell cmd locale set-app-locales com.a --user current --locales tr-TR');
    expect(lines.at(-1)).toBe('adb -s emulator-5682 shell am start -W -S -n com.a/.MainActivity --ez vitrinDemo true --es vitrinScreen stats');
    expect(await d.resolveActivity('com.a', '.Splash')).toBe('com.a/.Splash');
  });
});

describe('capture planning', () => {
  const ctxWith = (extra: Record<string, unknown> = {}) => ({ config: configWith(extra) }) as unknown as Ctx;
  const everything = profileWith({ platforms: ['ios', 'macos', 'watchos', 'tvos', 'visionos', 'android'], supportsIPhone: true, supportsIPad: true, supportsDuo: true, supportsAndroidTablet: true });

  it('captures one family per enabled platform/device', () => {
    const fams = familiesToCapture(ctxWith(), everything);
    expect(fams.map((f) => `${f.family}:${f.platform}:${f.device}`)).toEqual([
      'iphone:ios:iPhone 17 Pro',
      'ipad:ios:iPad Pro 13-inch (M5)',
      'mac:macos:Mac',
      'watch:watchos:Apple Watch Ultra 3 (49mm)',
      'tv:tvos:Apple TV 4K (3rd generation)',
      'vision:visionos:Apple Vision Pro',
      'android-phone:android:pixel_9',
      'android-tablet:android:Nexus 7 2013', // first enabled tablet target's device profile
    ]);
  });

  it('uses configured simulators and AVDs; Duo stays opt-in', () => {
    const fams = familiesToCapture(ctxWith({ capture: { simulators: { watch: 'Apple Watch Series 11 (46mm)', duo: 'iPhone Duo' }, android: { avds: { 'android-phone': 'Pixel_9_API_36' } } } }), everything);
    expect(fams.find((f) => f.family === 'watch')!.device).toBe('Apple Watch Series 11 (46mm)');
    expect(fams.find((f) => f.family === 'duo')).toBeDefined();
    expect(fams.find((f) => f.family === 'android-phone')).toMatchObject({ device: 'Pixel_9_API_36', avd: true });
  });

  it('only captures the selected platforms', () => {
    const fams = familiesToCapture(ctxWith({ selection: { platforms: ['watchos'] } }), everything);
    expect(fams.map((f) => f.family)).toEqual(['watch']);
  });

  it('previews only → recordings only, for families with an App Preview class', () => {
    expect(captureKinds(configWith({ selection: { assets: ['previews'] } }))).toEqual({ screens: false, recordings: true });
    expect(captureKinds(configWith({ selection: { assets: ['screenshots'] } }))).toEqual({ screens: true, recordings: false });
    expect(captureKinds(configWith({ selection: { assets: ['metadata'] } }))).toEqual({ screens: false, recordings: false });
    expect(captureKinds(configWith())).toEqual({ screens: true, recordings: true });
    const fams = familiesToCapture(ctxWith({ selection: { platforms: ['ios', 'watchos', 'macos'], assets: ['previews'] } }), everything);
    expect(fams.map((f) => f.family)).toEqual(['iphone', 'ipad', 'mac']); // no watch preview class
    expect(familiesToCapture(ctxWith({ selection: { assets: ['metadata'] } }), everything)).toEqual([]);
  });

  it('tools per platform', () => {
    expect(requiredTools(['ios', 'android'])).toEqual(['xcrun', 'adb', 'emulator']);
    expect(requiredTools(['macos'])).toEqual(['xcrun', 'screencapture']);
  });
});

describe('vitrin platforms / select', () => {
  const profile = profileWith({
    platforms: ['ios', 'watchos'],
    supportsIPhone: true,
    platformEvidence: { ios: [{ path: 'A.xcodeproj/project.pbxproj', note: 'A: SDKROOT=iphoneos' }], watchos: [{ path: 'A.xcodeproj/project.pbxproj' }] },
  });

  it('reports detected platforms first, with evidence and target counts', () => {
    const r = platformsReport(configWith({ selection: { platforms: ['watchos'] } }), profile);
    expect(r.platforms.map((p) => p.platform)).toEqual(['ios', 'watchos', 'macos', 'tvos', 'visionos', 'android']);
    const ios = r.platforms[0]!;
    expect(ios).toMatchObject({ detected: true, selected: false, label: 'iPhone & iPad (App Store)' });
    expect(ios.evidence[0]!.note).toBe('A: SDKROOT=iphoneos');
    expect(ios.targets.screenshots).toEqual(['iphone-6.3', 'iphone-6.9']);
    expect(ios.targets.previews).toEqual(['preview-iphone']);
    expect(r.platforms[1]).toMatchObject({ platform: 'watchos', selected: true, targets: { screenshots: ['watch-ultra'] } });
    expect(r.platforms.find((p) => p.platform === 'android')).toMatchObject({ detected: false, selected: false });
    expect(r.assets.every((a) => a.selected)).toBe(true);
  });

  it('validates choices', () => {
    expect(parseChoice('ios, watchos,ios', ['ios', 'watchos'] as const, 'platform')).toEqual(['ios', 'watchos']);
    expect(parseChoice('all', ['ios'] as const, 'platform')).toBeNull();
    expect(parseChoice(undefined, ['ios'] as const, 'platform')).toBeUndefined();
    expect(() => parseChoice('ios,windows', ['ios', 'android'] as const, 'platform')).toThrow(/Unknown platform: windows/);
  });

  it('writes selection into vitrin.config.yaml, keeping comments and other keys', () => {
    const before = '# Vitrin configuration\napp:\n  bundleId: com.a # the app\nurls: {}\n';
    const after = applySelection(before, { platforms: ['ios', 'watchos'], assets: ['screenshots', 'previews'] });
    expect(after).toContain('# Vitrin configuration');
    expect(after).toContain('bundleId: com.a # the app');
    expect(parseYaml(after).selection).toEqual({ platforms: ['ios', 'watchos'], assets: ['screenshots', 'previews'] });
    const assetsOnly = applySelection(after, { assets: ['metadata'] });
    expect(parseYaml(assetsOnly).selection).toEqual({ platforms: ['ios', 'watchos'], assets: ['metadata'] });
    const cleared = applySelection(applySelection(after, { platforms: null }), { assets: null });
    expect(parseYaml(cleared).selection).toBeUndefined();
    expect(configWith(parseYaml(after)).selection.platforms).toEqual(['ios', 'watchos']);
  });

  it('select command writes the file', async () => {
    const { selectCommand } = await import('../src/commands/select.js');
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-select-'));
    const file = join(dir, 'vitrin.config.yaml');
    writeFileSync(file, '# keep me\napp:\n  bundleId: com.a\nurls: {}\n');
    const ctx = { root: dir, paths: { config: file, profile: join(dir, '.vitrin', 'app_profile.json') }, config: configWith() } as unknown as Ctx;
    await selectCommand(ctx, { platforms: 'ios,android', assets: 'screenshots' });
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('# keep me');
    expect(parseYaml(text).selection).toEqual({ platforms: ['ios', 'android'], assets: ['screenshots'] });
    expect(ctx.config.selection.platforms).toEqual(['ios', 'android']);
    await expect(selectCommand(ctx, {})).rejects.toThrow(/Nothing to select/);
  });
});
