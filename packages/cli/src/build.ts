import { exec, existsSync, log, type ExecOptions, type ExecResult } from '@vitrin/core';
import type { AppProfile, Platform, ProjectKind } from '@vitrin/schemas';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

/**
 * Builds the app for capture, per project kind and platform:
 *
 * | kind          | iOS / watchOS / tvOS / visionOS / macOS                     | Android                          |
 * | ------------- | ----------------------------------------------------------- | -------------------------------- |
 * | native        | xcodebuild (simulator SDK; macOS native or Mac Catalyst)    | ./gradlew assembleDebug          |
 * | flutter       | flutter build ios --simulator --debug / flutter build macos | flutter build apk --debug        |
 * | react-native  | pod install → xcodebuild -workspace                         | ./gradlew assembleRelease/Debug  |
 * | expo          | npx expo prebuild (when ios/ is missing) → as React Native  | prebuild (android/) → as RN      |
 *
 * React Native and Expo default to Release variants: Debug variants load JavaScript from a Metro server and
 * show dev overlays, so screenshots would depend on a running bundler. `capture.reactNative.metro: true` switches
 * to Debug (assembleDebug) for apps whose demo mode only exists in dev builds.
 *
 * Command construction is pure (`prepareSteps`, `compileSteps`, `artifactDir`) so it can be unit-tested on Linux.
 */

export type Runner = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

export interface BuildStep {
  label: string;
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface BuildInput {
  root: string;
  kind: ProjectKind;
  platform: Platform;
  /** Xcode host folder relative to root (`.` native, `ios` for frameworks). */
  iosDir?: string;
  macosDir?: string;
  androidDir?: string;
  xcodeproj?: string;
  workspace?: string;
  scheme?: string;
  /** Xcode configuration for native apps (capture.configuration). */
  configuration: string;
  derivedData: string;
  macCatalyst?: boolean;
  /** React Native / Expo: Debug variants with a Metro server instead of Release with an embedded bundle. */
  metro?: boolean;
  podInstall?: boolean;
  /** Expo: allowed to run `npx expo prebuild`. */
  prebuild?: boolean;
  /** Native Android Gradle task (default assembleDebug). */
  gradleTask?: string;
}

const LONG = 30 * 60_000;

/** xcodebuild destination and the Build/Products folder suffix per platform. */
export function xcodeDestination(platform: Platform, macCatalyst = false): { destination: string; products: (configuration: string) => string } {
  switch (platform) {
    case 'ios':
      return { destination: 'generic/platform=iOS Simulator', products: (c) => `${c}-iphonesimulator` };
    case 'watchos':
      return { destination: 'generic/platform=watchOS Simulator', products: (c) => `${c}-watchsimulator` };
    case 'tvos':
      return { destination: 'generic/platform=tvOS Simulator', products: (c) => `${c}-appletvsimulator` };
    case 'visionos':
      return { destination: 'generic/platform=visionOS Simulator', products: (c) => `${c}-xrsimulator` };
    case 'macos':
      return macCatalyst
        ? { destination: 'platform=macOS,variant=Mac Catalyst', products: (c) => `${c}-maccatalyst` }
        : { destination: 'platform=macOS', products: (c) => c };
    default:
      throw new Error(`xcodebuild does not build for ${platform}.`);
  }
}

/** Configuration actually used: Release for React Native/Expo unless Metro mode is on. */
export function effectiveConfiguration(input: Pick<BuildInput, 'kind' | 'configuration' | 'metro'>): string {
  if (input.kind === 'react-native' || input.kind === 'expo') return input.metro ? 'Debug' : 'Release';
  return input.configuration;
}

function gradleTaskOf(input: BuildInput): string {
  if (input.kind === 'react-native' || input.kind === 'expo') return input.metro ? 'assembleDebug' : 'assembleRelease';
  return input.gradleTask ?? 'assembleDebug';
}

/** Gradle variant folder from a task name: assembleDebug → debug, assembleFreeRelease → freeRelease. */
export function gradleVariant(task: string): string {
  const v = task.replace(/^:?(?:[\w-]+:)?assemble/, '');
  return v ? v[0]!.toLowerCase() + v.slice(1) : 'debug';
}

/**
 * Steps that create or refresh the native project before compiling: Expo prebuild and CocoaPods.
 * `exists` is injectable for tests.
 */
export function prepareSteps(input: BuildInput, exists: (p: string) => boolean = existsSync): BuildStep[] {
  const steps: BuildStep[] = [];
  const { root } = input;
  const iosDir = join(root, input.iosDir ?? 'ios');
  const androidDir = join(root, input.androidDir ?? 'android');
  if (input.kind === 'expo') {
    const missing = input.platform === 'android' ? !exists(androidDir) : input.platform === 'ios' ? !exists(iosDir) : false;
    if (missing) {
      if (input.prebuild === false) throw new Error(`Expo: ${input.platform === 'android' ? 'android/' : 'ios/'} is missing and capture.reactNative.prebuild is false. Run \`npx expo prebuild\` yourself.`);
      steps.push({
        label: `npx expo prebuild (${input.platform})`,
        cmd: 'npx',
        args: ['expo', 'prebuild', '--platform', input.platform, '--no-install'],
        cwd: root,
        timeoutMs: LONG,
        env: { CI: '1', EXPO_NO_GIT_STATUS: '1' },
      });
    }
  }
  if ((input.kind === 'react-native' || input.kind === 'expo') && (input.platform === 'ios' || input.platform === 'macos') && input.podInstall !== false) {
    const dir = input.platform === 'macos' ? join(root, input.macosDir ?? 'macos') : iosDir;
    // React Native templates pin CocoaPods with a Gemfile at the root (or in ios/).
    const bundler = exists(join(root, 'Gemfile')) || exists(join(dir, 'Gemfile'));
    steps.push({
      label: 'pod install',
      cmd: bundler ? 'bundle' : 'pod',
      args: bundler ? ['exec', 'pod', 'install'] : ['install'],
      cwd: dir,
      timeoutMs: LONG,
    });
  }
  return steps;
}

/** The compile step for a platform. Needs the workspace/project resolved after `prepareSteps` ran. */
export function compileSteps(input: BuildInput, exists: (p: string) => boolean = existsSync): BuildStep[] {
  const { root, kind, platform } = input;
  if (platform === 'android') {
    if (kind === 'flutter') return [{ label: 'flutter build apk --debug', cmd: 'flutter', args: ['build', 'apk', '--debug'], cwd: root, timeoutMs: LONG }];
    const dir = join(root, input.androidDir ?? 'android');
    const task = gradleTaskOf(input);
    // Framework templates always ship the wrapper (Expo's appears with prebuild).
    const gradlew = kind !== 'native' || exists(join(dir, 'gradlew'));
    return [{ label: `gradle ${task}`, cmd: gradlew ? './gradlew' : 'gradle', args: [task, '--console=plain'], cwd: dir, timeoutMs: LONG }];
  }
  if (kind === 'flutter') {
    if (platform === 'ios') return [{ label: 'flutter build ios --simulator --debug', cmd: 'flutter', args: ['build', 'ios', '--simulator', '--debug'], cwd: root, timeoutMs: LONG }];
    if (platform === 'macos') return [{ label: 'flutter build macos --debug', cmd: 'flutter', args: ['build', 'macos', '--debug'], cwd: root, timeoutMs: LONG }];
    throw new Error(`Flutter does not build for ${platform}; provide the app via capture.prebuilt.${platform} or use capture.mode: manual.`);
  }
  if ((kind === 'react-native' || kind === 'expo') && !['ios', 'macos'].includes(platform)) {
    throw new Error(`${kind} capture supports iOS, macOS (react-native-macos) and Android; provide capture.prebuilt.${platform} or use capture.mode: manual.`);
  }
  const configuration = effectiveConfiguration(input);
  const { destination } = xcodeDestination(platform, input.macCatalyst);
  if (!input.workspace && !input.xcodeproj) throw new Error(`No Xcode project for ${platform} (${input.iosDir ?? 'ios'}).`);
  if (!input.scheme) throw new Error('No Xcode scheme: set app.scheme in vitrin.config.yaml.');
  // Simulators run unsigned builds; a Mac app must be at least ad-hoc signed to launch on Apple silicon.
  const signing = platform === 'macos' ? ['CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_STYLE=Manual', 'DEVELOPMENT_TEAM=', 'PROVISIONING_PROFILE_SPECIFIER='] : ['CODE_SIGNING_ALLOWED=NO'];
  return [
    {
      label: `xcodebuild ${input.scheme} (${configuration}, ${destination})`,
      cmd: 'xcodebuild',
      args: [
        ...(input.workspace ? ['-workspace', join(root, input.workspace)] : ['-project', join(root, input.xcodeproj!)]),
        '-scheme', input.scheme,
        '-configuration', configuration,
        '-destination', destination,
        '-derivedDataPath', input.derivedData,
        'build',
        ...signing,
        'COMPILER_INDEX_STORE_ENABLE=NO',
      ],
      cwd: root,
      timeoutMs: LONG,
      // Never let the React Native build phase open a Terminal with Metro; in Metro mode the user runs it.
      env: kind === 'react-native' || kind === 'expo' ? { RCT_NO_LAUNCH_PACKAGER: '1' } : undefined,
    },
  ];
}

/** Where the build leaves its artifact and what it is called. */
export function artifactDir(input: BuildInput): { dir: string; ext: '.app' | '.apk'; preferred?: string } {
  const { root, kind, platform } = input;
  if (platform === 'android') {
    if (kind === 'flutter') return { dir: join(root, 'build', 'app', 'outputs', 'flutter-apk'), ext: '.apk', preferred: 'app-debug.apk' };
    const variant = gradleVariant(gradleTaskOf(input));
    return { dir: join(root, input.androidDir ?? 'android', 'app', 'build', 'outputs', 'apk', variant), ext: '.apk', preferred: `app-${variant}.apk` };
  }
  if (kind === 'flutter') {
    if (platform === 'macos') return { dir: join(root, 'build', 'macos', 'Build', 'Products', 'Debug'), ext: '.app' };
    return { dir: join(root, 'build', 'ios', 'iphonesimulator'), ext: '.app', preferred: 'Runner.app' };
  }
  const { products } = xcodeDestination(platform, input.macCatalyst);
  return { dir: join(input.derivedData, 'Build', 'Products', products(effectiveConfiguration(input))), ext: '.app', preferred: input.scheme ? `${input.scheme}.app` : undefined };
}

/** First `.xcworkspace` in a folder (created by `pod install` / `expo prebuild`), as a root-relative path. */
export async function findWorkspace(root: string, dir: string): Promise<{ workspace?: string; scheme?: string }> {
  try {
    const ws = (await readdir(join(root, dir))).find((f) => f.endsWith('.xcworkspace'));
    return ws ? { workspace: join(dir, ws), scheme: basename(ws, '.xcworkspace') } : {};
  } catch {
    return {};
  }
}

async function runStep(step: BuildStep, runner: Runner): Promise<void> {
  log.step(`${step.label}…`);
  const res = await runner(step.cmd, step.args, { cwd: step.cwd, timeoutMs: step.timeoutMs, env: step.env });
  if (res.code !== 0) {
    const out = res.stdout + res.stderr;
    const errors = out.split('\n').filter((l) => /error:|FAILURE|What went wrong|\[!\]/.test(l)).slice(0, 15).join('\n');
    throw new Error(`${step.label} failed:\n${errors || out.slice(-3000)}`);
  }
}

/** Runs the build for one platform and returns the .app or .apk path. */
export async function buildApp(input: BuildInput, runner: Runner = exec): Promise<string> {
  for (const step of prepareSteps(input)) await runStep(step, runner);
  let resolved = input;
  // React Native / Expo: the workspace exists only after pod install / prebuild.
  if ((input.kind === 'react-native' || input.kind === 'expo') && input.platform !== 'android') {
    const found = await findWorkspace(input.root, input.platform === 'macos' ? (input.macosDir ?? 'macos') : (input.iosDir ?? 'ios'));
    resolved = { ...input, workspace: found.workspace ?? input.workspace, scheme: input.scheme ?? found.scheme };
  }
  for (const step of compileSteps(resolved)) await runStep(step, runner);
  const { dir, ext, preferred } = artifactDir(resolved);
  const found = existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith(ext)) : [];
  const name = (preferred && found.includes(preferred) ? preferred : undefined) ?? found[0];
  if (!name) throw new Error(`Built ${ext} not found (${dir}).`);
  return join(dir, name);
}

/** Bundle id / application id and Xcode scheme for a platform, from the profile. */
export function appIdentity(profile: AppProfile, platform: Platform, overrides: { bundleId?: string; scheme?: string; androidApplicationId?: string } = {}): { appId?: string; scheme?: string; macCatalyst: boolean } {
  if (platform === 'android') return { appId: overrides.androidApplicationId ?? profile.project.androidApplicationId ?? profile.app.bundleId, macCatalyst: false };
  if (platform === 'ios') return { appId: overrides.bundleId ?? profile.app.bundleId, scheme: overrides.scheme ?? profile.project.scheme, macCatalyst: false };
  const shipping = profile.project.targets.filter((t) => (t.kind === 'app' || t.kind === 'watch') && t.platforms.includes(platform));
  // Prefer the main (scheme) target when it is multiplatform, otherwise the dedicated platform target.
  const t = shipping.find((x) => x.name === profile.project.scheme) ?? shipping.find((x) => x.productType !== 'com.apple.product-type.watchkit2-extension') ?? shipping[0];
  return {
    appId: t?.bundleId ?? overrides.bundleId ?? profile.app.bundleId,
    scheme: t?.name ?? overrides.scheme ?? profile.project.scheme,
    macCatalyst: Boolean(t?.macCatalyst),
  };
}
