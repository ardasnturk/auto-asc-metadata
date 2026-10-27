import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TargetsFile, type RenderTarget } from '@vitrin/schemas';

/**
 * Finds the root of the Vitrin installation by walking up from `start` to the first directory that holds
 * `data/targets.json` and a `package.json`: the monorepo root when running from packages/core/dist, the
 * package root when running from the published bundle (`<pkg>/dist/bin.js`). Returns undefined if none.
 */
export function findVitrinHome(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'data', 'targets.json')) && existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** Root of the Vitrin installation (monorepo root or installed package root), where data/ and fastlane/ templates live. */
export const VITRIN_HOME = findVitrinHome(MODULE_DIR) ?? resolve(MODULE_DIR, '..', '..', '..');
export const DATA_DIR = join(VITRIN_HOME, 'data');
export const TEMPLATES_DIR = join(VITRIN_HOME, 'fastlane');

/** The Vitrin release version: `version` of the package.json at VITRIN_HOME (the root package.json in the monorepo). */
export function vitrinVersion(home: string = VITRIN_HOME): string {
  try {
    const v = (JSON.parse(readFileSync(join(home, 'package.json'), 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' ? v : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Folder in the app repository that holds everything Vitrin generates (sources, research, renders, store set). */
export const WORKSPACE_DIR = 'metadata';
/** Marker file that says the metadata/ folder belongs to Vitrin (a user folder with that name is never touched). */
export const WORKSPACE_MARKER = '.vitrin-workspace';

/** Paths inside the app repository that Vitrin reads and writes. */
export function appPaths(root: string) {
  const v = join(root, WORKSPACE_DIR);
  const research = join(v, 'research');
  return {
    root,
    /** The workspace: `<project>/metadata/`. Every generated file lives under it. */
    vitrin: v,
    marker: join(v, WORKSPACE_MARKER),
    state: join(v, 'state.json'),
    /** Render cache (HTML pages, thumbnails, Remotion, DerivedData); safe to delete at any time. */
    cache: join(v, '.cache'),
    profile: join(v, 'app_profile.json'),
    /** Everything the research stage downloads or derives: deleted together only when the user asks. */
    research,
    researchCache: join(research, 'cache'),
    competitors: join(research, 'competitors.json'),
    keywords: join(research, 'keywords'),
    keywordFile: (locale: string) => join(research, 'keywords', `${locale}.json`),
    /** The listing as it is live today (asc or App Store lookup), read during research. */
    liveListing: join(research, 'live-listing.json'),
    /** The app's icon among competitors' icons at search-result size (icon audit). */
    iconSheet: join(research, 'icons.png'),
    /** The app's own search ranks, one snapshot per day; outside research/ so they survive its deletion. */
    rankings: join(v, 'rankings'),
    /** The store copy Claude writes (JSON, validated by `vitrin write`). */
    metadataDir: join(v, 'listing'),
    metadataFile: (locale: string) => join(v, 'listing', `${locale}.json`),
    appMetadata: join(v, 'listing', 'app.json'),
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
    /** Only the Fastfile lives here, and only when fastlane is the chosen uploader (or for Google Play supply). */
    fastlane: join(root, 'fastlane'),
    /** The generated store set, in the layout deliver and supply read (whatever the uploader): metadata text, screenshots and App Previews. */
    store: join(v, 'store'),
    fastlaneMetadata: join(v, 'store', 'metadata'),
    screenshots: join(v, 'store', 'screenshots'),
    appPreviews: join(v, 'store', 'app-previews'),
    /** Each Custom Product Page's own screenshot set: cpp/<page id>/<locale>/NN_slug_<target>.png. */
    cppScreenshots: join(v, 'store', 'cpp'),
    /** Google Play listing in the supply layout. */
    androidMetadata: join(v, 'store', 'metadata', 'android'),
    /** HTML recreations of the app's screens (capture.mode: html), written by Claude from the source code. */
    screens: join(v, 'screens'),
    /** Bespoke screenshot layouts Claude writes for this app (`shots[].template`). */
    designs: join(v, 'designs'),
    /** Device mockups (empty templates and the app's screens placed in them). */
    mockups: join(v, 'mockups'),
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
