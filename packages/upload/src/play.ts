import { DATA_DIR, ensureDir, existsSync, readJson, readJsonIfExists, writeText, type AppPaths } from '@vitrin/core';
import { PLAY_IMAGE_RULES, PlayAppMetadata, PlayListing } from '@vitrin/schemas';
import { readFileSync } from 'node:fs';
import { copyFile, readdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { readImageInfo, type ImageInfo } from './image-info.js';
import type { PlayRemoteState } from './play-client.js';
import type { RenderedAsset } from './platforms.js';

/** data/play-locales.json */
export interface PlayLocaleTable {
  map: Record<string, string | null>;
  play: string[];
}

let tableCache: PlayLocaleTable | undefined;
export function loadPlayLocales(): PlayLocaleTable {
  tableCache ??= JSON.parse(readFileSync(join(DATA_DIR, 'play-locales.json'), 'utf8')) as PlayLocaleTable;
  return tableCache;
}

/** ASC locale → Play language (`tr` → `tr-TR`, `en-US` → `en-US`, `he` → `iw-IL`); null when Play has none. */
export function playLocaleFor(ascLocale: string, override?: string, table: PlayLocaleTable = loadPlayLocales()): string | null {
  if (override) return override;
  return table.map[ascLocale] ?? null;
}

/** `metadata/listing/play/` */
export function playMetadataDir(paths: AppPaths): string {
  return join(paths.metadataDir, 'play');
}

/** supply's metadata root: `metadata/store/metadata/android/`. */
export function playExportDir(paths: AppPaths): string {
  return join(paths.fastlaneMetadata, 'android');
}

export interface PlayInputs {
  listings: PlayListing[];
  app: PlayAppMetadata;
}

/** Loads `metadata/listing/play/<locale>.json` for the configured locales plus `app.json`. */
export async function loadPlayInputs(paths: AppPaths, locales: string[]): Promise<PlayInputs> {
  const dir = playMetadataDir(paths);
  const listings: PlayListing[] = [];
  for (const locale of locales) {
    const l = await readJsonIfExists(join(dir, `${locale}.json`), PlayListing);
    if (l) listings.push(l);
  }
  const appFile = join(dir, 'app.json');
  const app = existsSync(appFile) ? await readJson(appFile, PlayAppMetadata) : PlayAppMetadata.parse({});
  return { listings, app };
}

export type PlayImageSlot = 'phoneScreenshots' | 'sevenInchScreenshots' | 'tenInchScreenshots' | 'featureGraphic' | 'icon';
export const PLAY_SCREENSHOT_SLOTS: PlayImageSlot[] = ['phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots'];

/** Target ids agreed with the render work; anything else is placed by family and size. */
const SLOT_BY_TARGET: Record<string, PlayImageSlot> = {
  'play-phone': 'phoneScreenshots',
  'play-tablet-7': 'sevenInchScreenshots',
  'play-tablet-10': 'tenInchScreenshots',
  'play-feature-graphic': 'featureGraphic',
  'play-icon': 'icon',
};

export function playSlotOf(a: Pick<RenderedAsset, 'target' | 'kind'>): PlayImageSlot | null {
  const t = a.target;
  if (t.store !== 'google-play') return null;
  const byId = SLOT_BY_TARGET[t.id];
  if (byId) return byId;
  if (a.kind === 'screenshot' && t.family === 'android-phone') return 'phoneScreenshots';
  if (a.kind === 'screenshot' && t.family === 'android-tablet') return /7/.test(t.id) ? 'sevenInchScreenshots' : 'tenInchScreenshots';
  if (t.width === PLAY_IMAGE_RULES.featureGraphic.width && t.height === PLAY_IMAGE_RULES.featureGraphic.height) return 'featureGraphic';
  if (t.width === PLAY_IMAGE_RULES.icon.width && t.height === PLAY_IMAGE_RULES.icon.height) return 'icon';
  return null;
}

export interface PlayImageSet {
  playLocale: string;
  slot: PlayImageSlot;
  /** In upload order. */
  files: string[];
}

/** Groups rendered Play assets by Play language and image type, ordered by shot id. Images are png/jpeg only. */
export function playImageSets(assets: RenderedAsset[], listings: PlayListing[], table: PlayLocaleTable = loadPlayLocales()): PlayImageSet[] {
  const langOf = new Map(listings.map((l) => [l.locale, playLocaleFor(l.locale, l.playLocale, table)]));
  const sets = new Map<string, PlayImageSet>();
  for (const a of [...assets].sort((x, y) => x.order.localeCompare(y.order) || x.file.localeCompare(y.file))) {
    if (!/\.(png|jpe?g)$/i.test(a.file)) continue;
    const slot = playSlotOf(a);
    const pl = langOf.has(a.locale) ? langOf.get(a.locale) : playLocaleFor(a.locale, undefined, table);
    if (!slot || !pl) continue;
    const key = `${pl}/${slot}`;
    const set = sets.get(key) ?? { playLocale: pl, slot, files: [] };
    // featureGraphic and icon are single images: the last one wins in supply, keep the first.
    if (PLAY_SCREENSHOT_SLOTS.includes(slot) || set.files.length === 0) set.files.push(a.file);
    sets.set(key, set);
  }
  return [...sets.values()].sort((a, b) => a.playLocale.localeCompare(b.playLocale) || a.slot.localeCompare(b.slot));
}

export interface PlayImageIssue {
  code: string;
  message: string;
  file?: string;
  severity: 'error' | 'warning';
  /** The set the issue belongs to (so a run that does not upload that set can ignore it). */
  playLocale?: string;
  slot?: PlayImageSlot;
}

/** Image types a run uploads: screenshots ↔ `screenshots`, feature graphic and icon ↔ `creatives`. */
export function playSlotSelected(slot: PlayImageSlot, scope?: { screenshots: boolean; creatives: boolean }): boolean {
  if (!scope) return true;
  return PLAY_SCREENSHOT_SLOTS.includes(slot) ? scope.screenshots : scope.creatives;
}

/**
 * Pure Play graphic checks (no I/O): format, alpha, side length, aspect ratio, counts, exact feature graphic and
 * icon sizes, file sizes. `info` maps each file to its header.
 */
export function checkPlayImages(sets: PlayImageSet[], info: Map<string, ImageInfo>): PlayImageIssue[] {
  const r = PLAY_IMAGE_RULES;
  const out: PlayImageIssue[] = [];
  let cur: PlayImageSet | undefined;
  const err = (code: string, message: string, file?: string) => out.push({ code, message, file, severity: 'error', playLocale: cur?.playLocale, slot: cur?.slot });
  const warn = (code: string, message: string, file?: string) => out.push({ code, message, file, severity: 'warning', playLocale: cur?.playLocale, slot: cur?.slot });
  for (const s of sets) {
    cur = s;
    const where = `${s.playLocale} ${s.slot}`;
    if (PLAY_SCREENSHOT_SLOTS.includes(s.slot)) {
      if (s.files.length > r.maxScreenshots) err('play.image.count', `${where}: ${s.files.length} screenshots; Google Play accepts at most ${r.maxScreenshots} per type.`);
      if (s.files.length < r.minScreenshots) {
        if (s.slot === 'phoneScreenshots') err('play.image.count', `${where}: ${s.files.length} screenshot; Google Play needs at least ${r.minScreenshots} phone screenshots.`);
        else warn('play.image.count', `${where}: only ${s.files.length} screenshot; tablet listings need at least ${r.minScreenshots} to be shown as tablet-ready.`);
      }
    }
    for (const file of s.files) {
      const i = info.get(file);
      if (!i) continue;
      const name = `${where} ${file.split('/').pop()}`;
      if (i.format === 'unknown') {
        err('play.image.format', `${name}: not a PNG or JPEG file.`, file);
        continue;
      }
      if (s.slot === 'icon') {
        if (i.format !== 'png') err('play.image.icon', `${name}: the app icon must be a PNG.`, file);
        if (i.width !== r.icon.width || i.height !== r.icon.height) err('play.image.icon', `${name}: ${i.width}×${i.height} px; the app icon must be exactly 512×512.`, file);
        if (i.bytes > r.icon.maxBytes) err('play.image.icon', `${name}: ${Math.round(i.bytes / 1024)} KB; the app icon is limited to 1024 KB.`, file);
        continue;
      }
      if (i.hasAlpha) err('play.image.alpha', `${name}: has an alpha channel; Google Play needs JPEG or 24-bit PNG without transparency.`, file);
      if (i.format === 'png' && i.bitDepth > 8) warn('play.image.depth', `${name}: ${i.bitDepth}-bit channels; export 8 bits per channel (24-bit PNG).`, file);
      if (s.slot === 'featureGraphic') {
        if (i.width !== r.featureGraphic.width || i.height !== r.featureGraphic.height) err('play.image.feature-graphic', `${name}: ${i.width}×${i.height} px; the feature graphic must be exactly 1024×500.`, file);
        if (i.bytes > r.maxUploadBytes) err('play.image.bytes', `${name}: larger than 15 MB.`, file);
        continue;
      }
      const short = Math.min(i.width, i.height);
      const long = Math.max(i.width, i.height);
      if (short < r.minSide || long > r.maxSide) err('play.image.size', `${name}: ${i.width}×${i.height} px; each side must be ${r.minSide}–${r.maxSide} px.`, file);
      if (long > short * r.maxAspect) err('play.image.aspect', `${name}: ${i.width}×${i.height} px; the long side may be at most twice the short side.`, file);
      if (i.bytes > r.maxScreenshotBytes) err('play.image.bytes', `${name}: ${(i.bytes / 1024 / 1024).toFixed(1)} MB; screenshots are limited to 8 MB.`, file);
    }
  }
  return out;
}

export async function readPlayImageInfo(sets: PlayImageSet[]): Promise<Map<string, ImageInfo>> {
  const info = new Map<string, ImageInfo>();
  for (const f of sets.flatMap((s) => s.files)) if (!info.has(f) && existsSync(f)) info.set(f, await readImageInfo(f));
  return info;
}

/** supply file names per listing field. */
export const PLAY_LISTING_FILES: Record<string, (l: PlayListing) => string | undefined> = {
  'title.txt': (l) => l.title,
  'short_description.txt': (l) => l.shortDescription,
  'full_description.txt': (l) => l.fullDescription,
  'video.txt': (l) => l.video,
};

/**
 * Writes the supply tree:
 * `metadata/store/metadata/android/<play-locale>/{title,short_description,full_description,video}.txt`,
 * `changelogs/<versionCode>.txt`, `images/{phone,sevenInch,tenInch}Screenshots/NN.png`, `images/featureGraphic.png`,
 * `images/icon.png`. Image folders of the exported languages are rebuilt so supply never uploads stale files.
 * `video` undefined = leave the remote value (no file); `video: ""` = clear it (empty file).
 */
export async function exportPlayMetadata(
  paths: AppPaths,
  inputs: PlayInputs,
  assets: RenderedAsset[],
  table: PlayLocaleTable = loadPlayLocales(),
  /** Image types of this run (selection); unselected types get no files, so supply leaves them alone. */
  scope?: { screenshots: boolean; creatives: boolean },
): Promise<{ root: string; written: string[]; skipped: string[]; sets: PlayImageSet[] }> {
  const root = playExportDir(paths);
  const written: string[] = [];
  const skipped: string[] = [];
  await ensureDir(root);
  const exported = new Set<string>();
  for (const l of inputs.listings) {
    const pl = playLocaleFor(l.locale, l.playLocale, table);
    if (!pl) {
      skipped.push(l.locale);
      continue;
    }
    exported.add(pl);
    const dir = join(root, pl);
    for (const [file, get] of Object.entries(PLAY_LISTING_FILES)) {
      const value = get(l);
      const target = join(dir, file);
      if (value === undefined) {
        if (existsSync(target)) await rm(target);
        continue;
      }
      await writeText(target, value.trim() === '' ? '' : value.trim() + '\n');
      written.push(target);
    }
    if (inputs.app.versionCode) {
      const target = join(dir, 'changelogs', `${inputs.app.versionCode}.txt`);
      if (l.changelog.trim()) {
        await writeText(target, l.changelog.trim() + '\n');
        written.push(target);
      } else if (existsSync(target)) await rm(target);
    }
    // Rebuild images for this language.
    const images = join(dir, 'images');
    for (const slot of PLAY_SCREENSHOT_SLOTS) await rm(join(images, slot), { recursive: true, force: true });
    if (existsSync(images)) {
      for (const f of await readdir(images)) if (/^(featureGraphic|icon)\.(png|jpe?g)$/i.test(f)) await rm(join(images, f));
    }
  }
  const sets = playImageSets(assets, inputs.listings, table).filter((s) => exported.has(s.playLocale) && playSlotSelected(s.slot, scope));
  for (const s of sets) {
    const images = join(root, s.playLocale, 'images');
    if (PLAY_SCREENSHOT_SLOTS.includes(s.slot)) {
      await ensureDir(join(images, s.slot));
      let n = 0;
      for (const f of s.files) {
        const target = join(images, s.slot, `${String(++n).padStart(2, '0')}${extname(f).toLowerCase()}`);
        await copyFile(f, target);
        written.push(target);
      }
    } else {
      await ensureDir(images);
      const target = join(images, `${s.slot}${extname(s.files[0]!).toLowerCase()}`);
      await copyFile(s.files[0]!, target);
      written.push(target);
    }
  }
  return { root, written, skipped, sets };
}

/** Play language folders under metadata/store/metadata/android that no listing produces (supply would upload them too). */
export async function strayPlayLocaleDirs(paths: AppPaths, inputs: PlayInputs, table: PlayLocaleTable = loadPlayLocales()): Promise<string[]> {
  const root = playExportDir(paths);
  if (!existsSync(root)) return [];
  const expected = new Set(inputs.listings.map((l) => playLocaleFor(l.locale, l.playLocale, table)).filter(Boolean));
  return (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !expected.has(e.name)).map((e) => e.name);
}

// ---- plan ---------------------------------------------------------------------------------------

export interface PlayPlanItem {
  area: 'metadata' | 'screenshots' | 'creatives' | 'app';
  locale: string;
  field: string;
  change: 'create' | 'update' | 'unchanged' | 'unknown' | 'skip';
  local?: string;
  remote?: string;
  note?: string;
}

export interface PlayPlanResult {
  items: PlayPlanItem[];
  blockers: string[];
  warnings: string[];
}

function norm(v: unknown): string {
  return String(v ?? '').trim().replace(/\r\n/g, '\n');
}

function short(v: string): string {
  const one = v.replace(/\s+/g, ' ');
  return one.length > 60 ? `${one.slice(0, 57)}…` : one;
}

const REMOTE_FIELD: Record<string, 'title' | 'shortDescription' | 'fullDescription' | 'video'> = { title: 'title', shortDescription: 'shortDescription', fullDescription: 'fullDescription', video: 'video' };

/**
 * The Google Play part of the upload plan. With `remote` (PlayClient.readState) the text is diffed and the
 * track/release preconditions of supply are checked; without it every change is `unknown`.
 */
export function buildPlayPlan(opts: {
  packageName?: string;
  inputs: PlayInputs;
  sets: PlayImageSet[];
  imageIssues: PlayImageIssue[];
  remote?: PlayRemoteState;
  stray?: string[];
  table?: PlayLocaleTable;
  /** What this run uploads (config.selection); undefined = everything. */
  scope?: { metadata: boolean; screenshots: boolean; creatives: boolean; untouched: string[] };
}): PlayPlanResult {
  const { inputs, remote, scope } = opts;
  const table = opts.table ?? loadPlayLocales();
  const res: PlayPlanResult = { items: [], blockers: [], warnings: [] };
  const metadata = scope?.metadata ?? true;
  const sets = opts.sets.filter((s) => playSlotSelected(s.slot, scope));
  if (!opts.packageName) res.blockers.push('[play.package] No Android application id: set profile.project.androidApplicationId (vitrin analyze) or GOOGLE_PLAY_PACKAGE_NAME.');
  if (!inputs.listings.length) res.blockers.push('[play.listing.none] No Google Play listing in metadata/listing/play/<locale>.json.');
  for (const s of opts.stray ?? []) res.blockers.push(`[play.stray-locale] metadata/store/metadata/android/${s} is not produced by any listing; supply would upload it too. Remove the folder.`);
  for (const i of opts.imageIssues) {
    if (i.slot && !playSlotSelected(i.slot, scope)) continue;
    (i.severity === 'error' ? res.blockers : res.warnings).push(`[${i.code}] ${i.message}`);
  }

  // supply sets the release notes of the version code for every language at once: languages without a local
  // changelog end up empty, and languages Vitrin does not export are dropped.
  const vcode = inputs.app.versionCode;
  if (metadata && vcode) {
    const withNotes = new Set(inputs.listings.filter((l) => l.changelog.trim()).map((l) => playLocaleFor(l.locale, l.playLocale, table)).filter(Boolean));
    const rel = remote?.releases?.find((x) => (x.versionCodes ?? []).includes(String(vcode)));
    const lost = (rel?.releaseNotes ?? []).filter((n) => n.text.trim() && !withNotes.has(n.language)).map((n) => n.language);
    if (lost.length) res.blockers.push(`[play.changelog.would-clear] supply replaces all release notes of version code ${vcode}; ${lost.join(', ')} would lose theirs. Add a changelog for them or remove versionCode to leave the release notes untouched.`);
    else if (!remote) res.warnings.push(`[play.changelog.replace] supply replaces the release notes of version code ${vcode} for every language; languages without a changelog here lose theirs.`);
  }

  if (remote) {
    const releases = remote.releases;
    const vc = inputs.app.versionCode;
    if (!releases) res.blockers.push(`[play.track] The “${inputs.app.track}” track does not exist; supply needs an existing release on it even for listing-only updates.`);
    else if (!releases.length) res.blockers.push(`[play.track] The “${inputs.app.track}” track has no release; upload a build once in Play Console (Vitrin never creates releases).`);
    else if (vc && !releases.some((r) => (r.versionCodes ?? []).includes(String(vc)))) res.blockers.push(`[play.version-code] No release with version code ${vc} on the “${inputs.app.track}” track.`);
    else if (!vc && releases.length > 1) res.blockers.push(`[play.version-code] The “${inputs.app.track}” track has ${releases.length} releases; set versionCode in metadata/listing/play/app.json.`);
  }

  for (const l of metadata ? inputs.listings : []) {
    const pl = playLocaleFor(l.locale, l.playLocale, table);
    if (!pl) {
      res.items.push({ area: 'metadata', locale: l.locale, field: 'listing', change: 'skip', note: 'no Google Play language for this locale' });
      continue;
    }
    const r = remote?.listings.find((x) => x.language === pl);
    for (const field of ['title', 'shortDescription', 'fullDescription', 'video'] as const) {
      const value = norm(l[field]);
      if (field === 'video' && l.video === undefined) continue;
      if (!remote) {
        res.items.push({ area: 'metadata', locale: pl, field, change: 'unknown', local: short(value) });
        continue;
      }
      const rv = norm(r?.[REMOTE_FIELD[field]!]);
      res.items.push({ area: 'metadata', locale: pl, field, change: !r ? 'create' : rv === value ? 'unchanged' : 'update', local: value ? short(value) : '(empty — will be cleared)', remote: rv ? short(rv) : undefined });
    }
    if (l.changelog.trim()) {
      if (!inputs.app.versionCode) res.items.push({ area: 'metadata', locale: pl, field: 'changelog', change: 'skip', note: 'no versionCode in metadata/listing/play/app.json' });
      else {
        const rel = remote?.releases?.find((x) => (x.versionCodes ?? []).includes(String(inputs.app.versionCode)));
        const rv = norm(rel?.releaseNotes?.find((n) => n.language === pl)?.text);
        const value = norm(l.changelog);
        res.items.push({
          area: 'metadata',
          locale: pl,
          field: `changelog ${inputs.app.versionCode}`,
          change: !remote ? 'unknown' : rv === value ? 'unchanged' : rv ? 'update' : 'create',
          local: short(value),
          remote: rv ? short(rv) : undefined,
          note: 'release notes only; the release itself is not touched',
        });
      }
    }
  }
  for (const s of sets) {
    const isShot = PLAY_SCREENSHOT_SLOTS.includes(s.slot);
    res.items.push({
      area: isShot ? 'screenshots' : 'creatives',
      locale: s.playLocale,
      field: s.slot,
      change: 'update',
      local: isShot ? `${s.files.length} images` : s.files[0]!.split('/').pop(),
      note: isShot ? `replaces only the ${s.playLocale} ${s.slot} set; other image types stay untouched` : `replaces only the ${s.playLocale} ${s.slot}`,
    });
  }
  for (const u of scope?.untouched ?? []) res.items.push({ area: 'app', locale: '', field: '', change: 'skip', note: u });
  return res;
}

/** After supply: every listing field that still differs on Google Play. */
export function playReadBackDiffs(inputs: PlayInputs, remote: PlayRemoteState, table: PlayLocaleTable = loadPlayLocales()): string[] {
  const plan = buildPlayPlan({ packageName: 'read-back', inputs, sets: [], imageIssues: [], remote, table });
  return plan.items.filter((i) => i.area === 'metadata' && i.change !== 'unchanged' && i.change !== 'skip').map((d) => `Google Play ${d.locale} ${d.field}: Play “${d.remote ?? '(empty)'}”, local “${d.local}”`);
}
