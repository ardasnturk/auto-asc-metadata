import { existsSync } from '@vitrin/core';
import type { Evidence, Platform, ProjectKind } from '@vitrin/schemas';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Cross-platform project detection: Flutter, React Native, Expo and native Android, next to native Xcode.
 * Everything here reads files only (nothing is executed, app.config.js is matched with regexes),
 * and every value keeps the file it came from so features stay App-Review-safe.
 */

export interface FrameworkLocale {
  /** Locale code as written by the framework, normalised to BCP 47 (`pt-BR`, `zh-Hans`). */
  code: string;
  path: string;
}

export interface FrameworkInfo {
  kind: ProjectKind;
  /** Why this kind was chosen (pubspec.yaml, package.json dependency…). */
  evidence: Evidence[];
  /** Directory that should contain the Xcode host project, relative to root (`.` for native). */
  iosDir?: string;
  androidDir?: string;
  macosDir?: string;
  /** Expo: a declared platform has no native folder yet. */
  needsPrebuild: boolean;
  displayName?: { value: string; path: string };
  bundleId?: { value: string; path: string };
  androidApplicationId?: { value: string; path: string };
  version?: { value: string; path: string };
  build?: { value: string; path: string };
  /** Expo `ios.supportsTablet`. */
  supportsTablet?: { value: boolean; path: string };
  locales: FrameworkLocale[];
  /** Platforms declared by framework files (folders, Expo `platforms`). Xcode targets are added by the analyzer. */
  platforms: Array<{ platform: Platform; evidence: Evidence }>;
}

const SKIP = new Set(['node_modules', '.git', 'build', '.build', 'Pods', 'DerivedData', '.dart_tool', '.gradle', '.vitrin', 'fastlane', '.expo']);

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

async function readJsonFile(file: string): Promise<Record<string, unknown> | undefined> {
  const text = await readText(file);
  if (text === undefined) return undefined;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);

async function hasEntry(dir: string, test: (name: string) => boolean): Promise<string | undefined> {
  try {
    return (await readdir(dir)).find(test);
  } catch {
    return undefined;
  }
}

/** Normalises framework locale spellings (`pt_BR`, `zh-rTW`, `b+sr+Latn`) to BCP 47 (`pt-BR`, `zh-TW`, `sr-Latn`). */
export function normalizeLocale(code: string): string | undefined {
  const parts = code.replace(/^b\+/, '').split(/[-_+]/).filter(Boolean);
  if (!parts.length || !/^[a-zA-Z]{2,3}$/.test(parts[0]!)) return undefined;
  const out = [parts[0]!.toLowerCase()];
  for (const p of parts.slice(1)) {
    const q = p.startsWith('r') && p.length === 3 && /^r[A-Z]{2}$/.test(p) ? p.slice(1) : p;
    if (/^[A-Za-z]{4}$/.test(q)) out.push(q[0]!.toUpperCase() + q.slice(1).toLowerCase());
    else if (/^[A-Za-z]{2}$|^\d{3}$/.test(q)) out.push(q.toUpperCase());
    else return undefined;
  }
  return out.join('-');
}

// ---------------------------------------------------------------- Android

export interface AndroidInfo {
  dir: string;
  module: string;
  applicationId?: { value: string; path: string };
  versionName?: { value: string; path: string };
  versionCode?: { value: string; path: string };
  label?: { value: string; path: string };
  locales: FrameworkLocale[];
  /** Tablet layouts (sw600dp/sw720dp/large resources). */
  tablet?: Evidence;
  manifest: string;
}

/** Android locale qualifiers: `values-tr`, `values-pt-rBR`, `values-b+zh+Hans`. Other qualifiers (night, v21, sw600dp) are skipped. */
export function androidValuesLocale(dirName: string): string | undefined {
  const m = /^values-((?:[a-z]{2,3})(?:-r[A-Z]{2})?|b\+[a-z]{2,3}(?:\+[A-Za-z]{4})?(?:\+[A-Z]{2})?)$/.exec(dirName);
  return m ? normalizeLocale(m[1]!) : undefined;
}

/** Literal `key = "value"` / `key "value"` in build.gradle or build.gradle.kts (Groovy and Kotlin DSL). */
export function gradleValue(text: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*${key}\\s*(?:=\\s*|\\(\\s*|\\s+)["']([^"'$]+)["']`, 'm');
  const m = re.exec(text);
  if (m) return m[1];
  if (key === 'versionCode') return new RegExp(`^\\s*${key}\\s*(?:=\\s*|\\s+)(\\d+)\\s*$`, 'm').exec(text)?.[1];
  return undefined;
}

/** Finds the Gradle application module (`com.android.application`) under `dir`. */
async function androidAppModule(root: string, dir: string): Promise<string | undefined> {
  const abs = join(root, dir);
  const settings = (await readText(join(abs, 'settings.gradle.kts'))) ?? (await readText(join(abs, 'settings.gradle')));
  if (settings === undefined) return undefined;
  const modules = [...settings.matchAll(/["']:([\w-]+(?::[\w-]+)*)["']/g)].map((m) => m[1]!.replace(/:/g, '/'));
  for (const m of [...new Set(['app', ...modules])]) {
    if (!existsSync(join(abs, m, 'src', 'main', 'AndroidManifest.xml'))) continue;
    const build = (await readText(join(abs, m, 'build.gradle.kts'))) ?? (await readText(join(abs, m, 'build.gradle'))) ?? '';
    if (m === 'app' || /com\.android\.application|android\.application/.test(build)) return m;
  }
  return undefined;
}

export async function readAndroidProject(root: string, dir: string): Promise<AndroidInfo | undefined> {
  const module = await androidAppModule(root, dir);
  if (!module) return undefined;
  const abs = join(root, dir, module);
  const rel = (p: string) => relative(root, p);
  const buildFile = existsSync(join(abs, 'build.gradle.kts')) ? join(abs, 'build.gradle.kts') : join(abs, 'build.gradle');
  const build = (await readText(buildFile)) ?? '';
  const manifestPath = join(abs, 'src', 'main', 'AndroidManifest.xml');
  const manifest = (await readText(manifestPath)) ?? '';
  const info: AndroidInfo = { dir, module, locales: [], manifest: rel(manifestPath) };

  const appId = gradleValue(build, 'applicationId') ?? gradleValue(build, 'namespace') ?? /\bpackage="([^"]+)"/.exec(manifest)?.[1];
  if (appId) info.applicationId = { value: appId, path: rel(buildFile) };
  const vn = gradleValue(build, 'versionName');
  if (vn) info.versionName = { value: vn, path: rel(buildFile) };
  const vc = gradleValue(build, 'versionCode');
  if (vc) info.versionCode = { value: vc, path: rel(buildFile) };

  const res = join(abs, 'src', 'main', 'res');
  const label = /<application\b[^>]*?android:label="([^"]+)"/s.exec(manifest)?.[1];
  if (label && !label.startsWith('@')) info.label = { value: label, path: rel(manifestPath) };
  else if (label?.startsWith('@string/')) {
    const key = label.slice('@string/'.length);
    const stringsPath = join(res, 'values', 'strings.xml');
    const strings = (await readText(stringsPath)) ?? '';
    const v = new RegExp(`<string\\s+name="${key}"[^>]*>([^<]+)</string>`).exec(strings)?.[1];
    if (v) info.label = { value: v.replace(/\\'/g, "'").trim(), path: rel(stringsPath) };
  }

  let resDirs: string[] = [];
  try {
    resDirs = await readdir(res);
  } catch {
    // no resources
  }
  for (const d of resDirs) {
    const code = androidValuesLocale(d);
    if (code && existsSync(join(res, d, 'strings.xml'))) info.locales.push({ code, path: rel(join(res, d, 'strings.xml')) });
    if (!info.tablet && /^(layout|values)-(sw(6\d\d|7\d\d|[89]\d\d)dp|large|xlarge)(-|$)/.test(d)) info.tablet = { path: rel(join(res, d)), note: 'tablet resource qualifier' };
  }
  // Per-app language list (Android 13+).
  const localesConfig = await readText(join(res, 'xml', 'locales_config.xml'));
  if (localesConfig) {
    for (const m of localesConfig.matchAll(/android:name="([^"]+)"/g)) {
      const code = normalizeLocale(m[1]!);
      if (code) info.locales.push({ code, path: rel(join(res, 'xml', 'locales_config.xml')) });
    }
  }
  return info;
}

// ---------------------------------------------------------------- JS / ARB locales

const LOCALE_DIRS = /^(locales?|i18n|l10n|translations?|langs?|messages)$/i;
const LOCALE_NAME = /^[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/;

/** Translation folders used by React Native / Expo apps: `locales/en.json`, `src/i18n/tr/translation.json`. */
export async function findJsLocales(root: string): Promise<FrameworkLocale[]> {
  const out: FrameworkLocale[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.') || (depth === 0 && ['ios', 'android', 'macos', 'windows', 'web'].includes(e.name))) continue;
      const full = join(dir, e.name);
      if (LOCALE_DIRS.test(e.name)) {
        for (const c of await readdir(full, { withFileTypes: true })) {
          const stem = c.isFile() ? c.name.replace(/\.(json|ts|js|ya?ml|po)$/, '') : c.name;
          if ((c.isFile() && stem === c.name) || !LOCALE_NAME.test(stem)) continue;
          const code = normalizeLocale(stem);
          if (code) out.push({ code, path: relative(root, join(full, c.name)) });
        }
      } else {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(root, 0);
  return out;
}

/** Flutter gen-l10n ARB files (`lib/l10n/app_en.arb`, or `arb-dir` from l10n.yaml); `@@locale` wins over the file name. */
export async function findArbLocales(root: string): Promise<FrameworkLocale[]> {
  const l10n = await readText(join(root, 'l10n.yaml'));
  let arbDir = 'lib/l10n';
  if (l10n) {
    try {
      arbDir = str(obj(parseYaml(l10n))['arb-dir']) ?? arbDir;
    } catch {
      // keep the default
    }
  }
  const out: FrameworkLocale[] = [];
  for (const dir of [...new Set([arbDir, 'lib/l10n', 'assets/l10n'])]) {
    let files: string[] = [];
    try {
      files = (await readdir(join(root, dir))).filter((f) => f.endsWith('.arb')).sort();
    } catch {
      continue;
    }
    for (const f of files) {
      const json = await readJsonFile(join(root, dir, f));
      const fromKey = str(json?.['@@locale']);
      const fromName = /(?:^|_)([a-z]{2,3}(?:_[A-Z][a-z]{3})?(?:_[A-Z]{2})?)\.arb$/.exec(f)?.[1];
      const code = normalizeLocale(fromKey ?? fromName ?? '');
      if (code) out.push({ code, path: join(dir, f) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Expo config

/** Values from app.json, or regex matches in app.config.{js,ts} (it is code; Vitrin never runs it). */
export async function readExpoConfig(root: string): Promise<{ path: string; expo: Record<string, unknown> } | undefined> {
  const json = await readJsonFile(join(root, 'app.json'));
  if (json && (json.expo || json.name)) {
    const expo = json.expo ? obj(json.expo) : json;
    // app.config.* may still override app.json; its literal values are layered on top.
    const dyn = await readExpoDynamicConfig(root);
    return { path: dyn && Object.keys(dyn.expo).length ? dyn.path : 'app.json', expo: mergeDeep(expo, dyn?.expo ?? {}) };
  }
  return readExpoDynamicConfig(root);
}

async function readExpoDynamicConfig(root: string): Promise<{ path: string; expo: Record<string, unknown> } | undefined> {
  for (const name of ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs']) {
    const text = await readText(join(root, name));
    if (text === undefined) continue;
    const lit = (key: string, scope?: string) => {
      const body = scope ? (new RegExp(`\\b${scope}\\s*:\\s*\\{([\\s\\S]*?)\\}`).exec(text)?.[1] ?? '') : text;
      return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`$]+)["'\`]`).exec(body)?.[1];
    };
    const expo: Record<string, unknown> = {};
    const ios: Record<string, unknown> = {};
    const android: Record<string, unknown> = {};
    const name_ = lit('name');
    if (name_) expo.name = name_;
    const version = lit('version');
    if (version) expo.version = version;
    const bid = lit('bundleIdentifier', 'ios');
    if (bid) ios.bundleIdentifier = bid;
    if (/\bsupportsTablet\s*:\s*true/.test(text)) ios.supportsTablet = true;
    const pkg = lit('package', 'android');
    if (pkg) android.package = pkg;
    const platforms = /\bplatforms\s*:\s*\[([^\]]*)\]/.exec(text)?.[1];
    if (platforms) expo.platforms = [...platforms.matchAll(/["'](\w+)["']/g)].map((m) => m[1]);
    if (Object.keys(ios).length) expo.ios = ios;
    if (Object.keys(android).length) expo.android = android;
    return { path: name, expo };
  }
  return undefined;
}

function mergeDeep(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergeDeep(obj(a[k]), obj(v)) : v;
  return out;
}

// ---------------------------------------------------------------- detection

function depsOf(pkg: Record<string, unknown>): Record<string, unknown> {
  return { ...obj(pkg.devDependencies), ...obj(pkg.peerDependencies), ...obj(pkg.dependencies) };
}

/** Flutter `version: 1.2.3+45` → name 1.2.3, build 45. */
export function splitFlutterVersion(v: string | undefined): { name?: string; build?: string } {
  if (!v) return {};
  const [name, build] = v.split('+');
  return { name: name || undefined, build: build || undefined };
}

async function detectAndroidDir(root: string, candidates: string[]): Promise<string | undefined> {
  for (const c of candidates) if (await androidAppModule(root, c)) return c;
  return undefined;
}

async function xcodeIn(root: string, dir: string): Promise<string | undefined> {
  return hasEntry(join(root, dir), (n) => n.endsWith('.xcodeproj') || n.endsWith('.xcworkspace'));
}

/** Detects the project kind at `root` and reads the framework-level metadata. */
export async function detectFramework(root: string): Promise<FrameworkInfo> {
  const info: FrameworkInfo = { kind: 'native', evidence: [], needsPrebuild: false, locales: [], platforms: [] };
  const addPlatform = (platform: Platform, evidence: Evidence) => {
    if (!info.platforms.some((p) => p.platform === platform)) info.platforms.push({ platform, evidence });
  };

  // ---------- Flutter ----------
  const pubspecText = await readText(join(root, 'pubspec.yaml'));
  let pubspec: Record<string, unknown> | undefined;
  if (pubspecText) {
    try {
      pubspec = obj(parseYaml(pubspecText));
    } catch {
      pubspec = undefined;
    }
  }
  if (pubspec && 'flutter' in obj(pubspec.dependencies)) {
    info.kind = 'flutter';
    info.evidence.push({ path: 'pubspec.yaml', note: 'dependencies.flutter' });
    const name = str(pubspec.name);
    if (name) info.displayName = { value: name, path: 'pubspec.yaml' };
    const v = splitFlutterVersion(str(pubspec.version));
    if (v.name) info.version = { value: v.name, path: 'pubspec.yaml' };
    if (v.build) info.build = { value: v.build, path: 'pubspec.yaml' };
    if (existsSync(join(root, 'ios', 'Runner.xcodeproj'))) {
      info.iosDir = 'ios';
      addPlatform('ios', { path: 'ios/Runner.xcodeproj', note: 'Flutter iOS host' });
    }
    if (existsSync(join(root, 'macos', 'Runner.xcodeproj'))) {
      info.macosDir = 'macos';
      addPlatform('macos', { path: 'macos/Runner.xcodeproj', note: 'Flutter macOS host' });
    }
    info.locales.push(...(await findArbLocales(root)));
  } else {
    // ---------- React Native / Expo ----------
    const pkg = await readJsonFile(join(root, 'package.json'));
    const deps = pkg ? depsOf(pkg) : {};
    if (pkg && ('expo' in deps || 'react-native' in deps)) {
      const isExpo = 'expo' in deps;
      info.kind = isExpo ? 'expo' : 'react-native';
      info.evidence.push({ path: 'package.json', note: isExpo ? 'depends on expo' : 'depends on react-native' });
      const appJson = await readJsonFile(join(root, 'app.json'));
      const expo = isExpo ? await readExpoConfig(root) : undefined;
      if (expo) {
        const e = expo.expo;
        const ios = obj(e.ios);
        const android = obj(e.android);
        if (str(e.name)) info.displayName = { value: str(e.name)!, path: expo.path };
        if (str(e.version)) info.version = { value: str(e.version)!, path: expo.path };
        if (str(ios.buildNumber)) info.build = { value: str(ios.buildNumber)!, path: expo.path };
        if (str(ios.bundleIdentifier)) info.bundleId = { value: str(ios.bundleIdentifier)!, path: expo.path };
        if (str(android.package)) info.androidApplicationId = { value: str(android.package)!, path: expo.path };
        if (ios.supportsTablet === true || ios.isTabletOnly === true) info.supportsTablet = { value: true, path: expo.path };
        // Expo builds for iOS and Android unless `platforms` says otherwise.
        const declared = Array.isArray(e.platforms) ? (e.platforms as unknown[]).map(String) : ['ios', 'android'];
        if (declared.includes('ios')) addPlatform('ios', { path: expo.path, note: Array.isArray(e.platforms) ? 'expo.platforms' : 'Expo default platforms (ios, android)' });
        if (declared.includes('android')) addPlatform('android', { path: expo.path, note: Array.isArray(e.platforms) ? 'expo.platforms' : 'Expo default platforms (ios, android)' });
        for (const [code, file] of Object.entries(obj(e.locales))) {
          const c = normalizeLocale(code);
          if (c) info.locales.push({ code: c, path: typeof file === 'string' ? file.replace(/^\.\//, '') : expo.path });
        }
      } else if (appJson) {
        const name = str(appJson.displayName) ?? str(appJson.name);
        if (name) info.displayName = { value: name, path: 'app.json' };
      }
      if (!info.displayName && str(pkg.name)) info.displayName = { value: str(pkg.name)!, path: 'package.json' };
      if (!info.version && str(pkg.version)) info.version = { value: str(pkg.version)!, path: 'package.json' };
      if (await xcodeIn(root, 'ios')) {
        info.iosDir = 'ios';
        addPlatform('ios', { path: 'ios', note: 'iOS host project' });
      }
      if ('react-native-macos' in deps && (await xcodeIn(root, 'macos'))) {
        info.macosDir = 'macos';
        addPlatform('macos', { path: 'macos', note: 'react-native-macos host project' });
      }
      info.locales.push(...(await findJsLocales(root)));
    }
  }

  // ---------- Android (framework android/ folder, or a native Android app) ----------
  const androidDir = await detectAndroidDir(root, info.kind === 'native' ? ['.', 'android'] : ['android']);
  if (androidDir) {
    info.androidDir = androidDir;
    addPlatform('android', { path: androidDir === '.' ? 'settings.gradle' : androidDir, note: 'Gradle application module' });
  }
  if (info.kind === 'expo') {
    const wantsIos = info.platforms.some((p) => p.platform === 'ios');
    const wantsAndroid = info.platforms.some((p) => p.platform === 'android');
    info.iosDir ??= wantsIos ? 'ios' : undefined;
    info.androidDir ??= wantsAndroid ? 'android' : undefined;
    info.needsPrebuild = (wantsIos && !(await xcodeIn(root, 'ios'))) || (wantsAndroid && !androidDir);
  }
  return info;
}
