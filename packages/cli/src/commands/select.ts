import { ASSET_OF_KIND, enabledTargets, loadConfig, log, selectedPlatforms, writeText } from '@vitrin/core';
import { AssetKindEnum, PlatformEnum, VitrinConfig, type AppProfile, type AssetKind, type Evidence, type Platform } from '@vitrin/schemas';
import { readFile } from 'node:fs/promises';
import pc from 'picocolors';
import { isMap, parseDocument } from 'yaml';
import { EXIT, loadProfile, type Ctx } from '../context.js';

/**
 * `vitrin platforms` lists what the analyzer detected so the skill can offer a multiple-choice list;
 * `vitrin select` stores the user's choice in `selection` in vitrin.config.yaml. Every later stage
 * (design, video, capture, validate, upload) only produces what is selected.
 */

export const PLATFORM_LABEL: Record<Platform, string> = {
  ios: 'iPhone & iPad (App Store)',
  macos: 'Mac (App Store)',
  watchos: 'Apple Watch (App Store)',
  tvos: 'Apple TV (App Store)',
  visionos: 'Apple Vision Pro (App Store)',
  android: 'Android (Google Play)',
};

export const ASSET_LABEL: Record<AssetKind, string> = {
  metadata: 'Store metadata (name, subtitle, keywords, description)',
  screenshots: 'Screenshots',
  previews: 'App Preview videos',
  creatives: 'Creatives (product page header, search result, Play feature graphic and icon)',
  events: 'In-App Event cards',
};

export interface PlatformChoice {
  platform: Platform;
  label: string;
  detected: boolean;
  selected: boolean;
  evidence: Evidence[];
  /** Targets this platform would produce if selected with every asset kind (honours targets.enable/disable). */
  targets: Record<Exclude<AssetKind, 'metadata'>, string[]>;
}

export interface PlatformsReport {
  app: string;
  kind: AppProfile['project']['kind'];
  platforms: PlatformChoice[];
  assets: Array<{ asset: AssetKind; label: string; selected: boolean }>;
  selection: VitrinConfig['selection'];
}

/** Pure: the data behind `vitrin platforms --json`. */
export function platformsReport(config: VitrinConfig, profile: AppProfile): PlatformsReport {
  const current = selectedPlatforms(config, profile).platforms;
  const choices = PlatformEnum.options.map((platform): PlatformChoice => {
    const targets: PlatformChoice['targets'] = { screenshots: [], previews: [], creatives: [], events: [] };
    // Listed as if every asset kind were chosen, so opt-in previews and events show up too.
    const probe = { ...config, selection: { platforms: [platform], assets: AssetKindEnum.options } };
    for (const t of enabledTargets(probe, profile, { quiet: true })) targets[ASSET_OF_KIND[t.kind] as keyof PlatformChoice['targets']].push(t.id);
    const detected = profile.app.platforms.includes(platform);
    return {
      platform,
      label: PLATFORM_LABEL[platform],
      detected,
      selected: current.includes(platform),
      evidence: profile.app.platformEvidence?.[platform] ?? [],
      targets,
    };
  });
  const assets = config.selection?.assets;
  return {
    app: profile.app.displayName,
    kind: profile.project.kind,
    // Detected platforms first, so the multi-select shows them on top.
    platforms: [...choices.filter((c) => c.detected), ...choices.filter((c) => !c.detected)],
    assets: AssetKindEnum.options.map((asset) => ({ asset, label: ASSET_LABEL[asset], selected: !assets || assets.includes(asset) })),
    selection: config.selection ?? {},
  };
}

export async function platformsCommand(ctx: Ctx, opts: { json?: boolean } = {}): Promise<number> {
  const profile = await loadProfile(ctx);
  const report = platformsReport(ctx.config, profile);
  if (opts.json ?? ctx.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return EXIT.OK;
  }
  log.step(`${report.app} (${report.kind}) — platforms`);
  for (const p of report.platforms) {
    const mark = p.selected ? pc.green('●') : pc.dim('○');
    const counts = Object.entries(p.targets)
      .filter(([, ids]) => ids.length)
      .map(([k, ids]) => `${ids.length} ${k}`)
      .join(', ');
    log.info(`${mark} ${p.platform.padEnd(9)} ${p.label}${p.detected ? '' : pc.yellow(' (not detected)')}${counts ? pc.dim(` — ${counts}`) : ''}`);
    for (const e of p.evidence.slice(0, 2)) log.dim(`      ${e.path}${e.note ? ` (${e.note})` : ''}`);
  }
  log.info(`Assets: ${report.assets.map((a) => (a.selected ? a.asset : pc.dim(a.asset))).join(', ')}`);
  log.dim('Change with: vitrin select --platforms ios,watchos --assets screenshots,previews');
  return EXIT.OK;
}

/** Parses a comma-separated CLI value; `all` (or an empty value) clears the selection. */
export function parseChoice<T extends string>(raw: string | string[] | undefined, valid: readonly T[], what: string): T[] | null | undefined {
  if (raw === undefined) return undefined;
  const items = (Array.isArray(raw) ? raw : raw.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  if (!items.length || (items.length === 1 && items[0] === 'all')) return null;
  const bad = items.filter((i) => !(valid as readonly string[]).includes(i));
  if (bad.length) throw new Error(`Unknown ${what}: ${bad.join(', ')}. Valid: ${valid.join(', ')} (or "all").`);
  return [...new Set(items)] as T[];
}

/**
 * Writes `selection` into the YAML text, keeping comments and every other key.
 * `null` removes the key (= produce everything detected), `undefined` leaves it unchanged.
 */
export function applySelection(yamlText: string, change: { platforms?: Platform[] | null; assets?: AssetKind[] | null }): string {
  const doc = parseDocument(yamlText);
  for (const key of ['platforms', 'assets'] as const) {
    const v = change[key];
    if (v === undefined) continue;
    if (v === null) doc.deleteIn(['selection', key]);
    else doc.setIn(['selection', key], doc.createNode(v, { flow: true }));
  }
  const sel = doc.getIn(['selection']);
  if (isMap(sel) && sel.items.length === 0) doc.delete('selection');
  return doc.toString({ lineWidth: 120 });
}

export async function selectCommand(ctx: Ctx, opts: { platforms?: string | string[]; assets?: string | string[] }): Promise<number> {
  const platforms = parseChoice(opts.platforms, PlatformEnum.options, 'platform');
  const assets = parseChoice(opts.assets, AssetKindEnum.options, 'asset');
  if (platforms === undefined && assets === undefined) throw new Error('Nothing to select: pass --platforms and/or --assets (comma-separated, or "all").');
  const text = applySelection(await readFile(ctx.paths.config, 'utf8'), { platforms, assets });
  await writeText(ctx.paths.config, text);
  // Re-read through the schema so an invalid file is caught now, not in the next stage.
  const config = loadConfig(ctx.paths.config);
  ctx.config = config;
  const s = config.selection ?? {};
  log.ok(`selection: platforms ${s.platforms?.join(', ') ?? 'all detected'} · assets ${s.assets?.join(', ') ?? 'all'}`);
  const profile = await loadProfile(ctx).catch(() => undefined);
  const targets = enabledTargets(config, profile);
  log.dim(`  ${targets.length} targets: ${targets.map((t) => t.id).join(', ') || 'none'}`);
  if (profile && s.platforms) {
    const { undetected } = selectedPlatforms(config, profile);
    if (undetected.length) log.warn(`Not detected in the project: ${undetected.join(', ')}. Capture needs capture.prebuilt.<platform> or capture.mode: manual for them.`);
  }
  return EXIT.OK;
}
