import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TargetsFile, type RenderTarget } from '@vitrin/schemas';

/** Root of the Vitrin installation (monorepo root), where data/ and fastlane/ templates live. */
export const VITRIN_HOME = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DATA_DIR = join(VITRIN_HOME, 'data');
export const TEMPLATES_DIR = join(VITRIN_HOME, 'fastlane');

/** Paths inside the app repository that Vitrin reads and writes. */
export function appPaths(root: string) {
  const v = join(root, '.vitrin');
  return {
    root,
    vitrin: v,
    state: join(v, 'state.json'),
    cache: join(v, 'cache'),
    profile: join(v, 'app_profile.json'),
    competitors: join(v, 'competitors.json'),
    keywords: join(v, 'keywords'),
    keywordFile: (locale: string) => join(v, 'keywords', `${locale}.json`),
    metadataDir: join(v, 'metadata'),
    metadataFile: (locale: string) => join(v, 'metadata', `${locale}.json`),
    appMetadata: join(v, 'metadata', 'app.json'),
    cpp: join(v, 'cpp-suggestions.json'),
    artDirection: join(v, 'art-direction.json'),
    shots: join(v, 'shots.json'),
    videoPlan: join(v, 'video-plan.json'),
    raw: join(v, 'raw'),
    rawShot: (locale: string, family: string, id: string) => join(v, 'raw', locale, family, `${id}.png`),
    rawVideo: (locale: string, family: string, id: string) => join(v, 'raw', locale, family, `${id}.mp4`),
    creative: join(v, 'creative'),
    renderManifest: join(v, 'render-manifest.json'),
    validation: join(v, 'validation.json'),
    report: join(v, 'report.html'),
    approval: join(v, 'approval.json'),
    reviewFeedback: join(v, 'review-feedback.json'),
    reviewSnapshot: join(v, 'review-snapshot.json'),
    briefs: join(v, 'briefs'),
    uploadPlan: join(v, 'upload-plan.json'),
    config: join(root, 'vitrin.config.yaml'),
    env: join(root, '.env'),
    envExample: join(root, '.env.example'),
    fastlane: join(root, 'fastlane'),
    fastlaneMetadata: join(root, 'fastlane', 'metadata'),
    screenshots: join(root, 'fastlane', 'screenshots'),
    appPreviews: join(root, 'fastlane', 'app-previews'),
    /** Google Play listing exported for fastlane supply. */
    androidMetadata: join(root, 'fastlane', 'metadata', 'android'),
  };
}
export type AppPaths = ReturnType<typeof appPaths>;

let targetsCache: RenderTarget[] | undefined;
export function loadTargets(): RenderTarget[] {
  if (!targetsCache) {
    targetsCache = TargetsFile.parse(JSON.parse(readFileSync(join(DATA_DIR, 'targets.json'), 'utf8'))).targets;
  }
  return targetsCache;
}

export function getTarget(id: string): RenderTarget {
  const t = loadTargets().find((x) => x.id === id);
  if (!t) throw new Error(`Unknown target: ${id}`);
  return t;
}

export interface AscLocaleInfo {
  code: string;
  name: string;
  nameTr: string;
  xcode: string[];
  dir: 'ltr' | 'rtl';
  script: string;
}

let localesCache: AscLocaleInfo[] | undefined;
export function loadLocales(): AscLocaleInfo[] {
  localesCache ??= JSON.parse(readFileSync(join(DATA_DIR, 'asc-locales.json'), 'utf8')).locales as AscLocaleInfo[];
  return localesCache;
}

export function localeInfo(code: string): AscLocaleInfo | undefined {
  return loadLocales().find((l) => l.code === code);
}

/** Map an Xcode region (`tr`, `en`, `pt-BR`, `zh-Hans`, `Base`) to an ASC locale code. */
export function xcodeToAsc(region: string): string | null {
  const locales = loadLocales();
  const exact = locales.find((l) => l.code.toLowerCase() === region.toLowerCase());
  if (exact) return exact.code;
  const alias = locales.find((l) => l.xcode.some((x) => x.toLowerCase() === region.toLowerCase()));
  return alias?.code ?? null;
}

export interface StorefrontInfo {
  code: string;
  country: string;
  default: string;
  additional: string[];
}

let storefrontCache: StorefrontInfo[] | undefined;
export function loadStorefronts(): StorefrontInfo[] {
  storefrontCache ??= JSON.parse(readFileSync(join(DATA_DIR, 'storefront-languages.json'), 'utf8')).storefronts as StorefrontInfo[];
  return storefrontCache;
}

export function storefrontInfo(code: string): StorefrontInfo | undefined {
  return loadStorefronts().find((s) => s.code === code.toLowerCase());
}

/** Best storefront for a locale (the country whose default language it is), e.g. `tr` → `tr`, `de-DE` → `de`. */
export function storefrontForLocale(locale: string): string {
  const region = locale.split('-')[1]?.toLowerCase();
  if (region && region.length === 2 && storefrontInfo(region)) return region;
  const special: Record<string, string> = {
    tr: 'tr', ja: 'jp', ko: 'kr', 'zh-Hans': 'cn', 'zh-Hant': 'tw', he: 'il', el: 'gr', da: 'dk', sv: 'se',
    cs: 'cz', uk: 'ua', vi: 'vn', hi: 'in', ar: 'sa', 'ar-SA': 'sa', no: 'no', ca: 'es', ms: 'my', id: 'id',
    it: 'it', fi: 'fi', hu: 'hu', pl: 'pl', ro: 'ro', ru: 'ru', sk: 'sk', th: 'th', hr: 'hr',
  };
  if (special[locale]) return special[locale]!;
  const asDefault = loadStorefronts().find((s) => s.default === locale);
  return asDefault?.code ?? 'us';
}

export interface ForbiddenTerms {
  price: Record<string, string[]>;
  superlatives: Record<string, string[]>;
  appleTrademarks: string[];
  keywordNoise: string[];
  cta: Record<string, string[]>;
  otherPlatforms: string[];
  /** Apple-designated recognitions (Editor's Choice, App of the Day, …): never in metadata or assets. */
  appleAwards: string[];
  /** Wording reserved for the Kids Category, per language. */
  kidsReserved: Record<string, string[]>;
  /** Generic release-note phrases, per language. */
  genericWhatsNew: Record<string, string[]>;
}

export function loadForbiddenTerms(): ForbiddenTerms {
  return JSON.parse(readFileSync(join(DATA_DIR, 'forbidden-terms.json'), 'utf8')) as ForbiddenTerms;
}

/** Walks up from `start` to find the app root (directory with vitrin.config.yaml, or a .xcodeproj, or .git). */
export function findAppRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'vitrin.config.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}
