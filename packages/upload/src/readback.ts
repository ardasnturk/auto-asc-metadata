import type { AppPaths } from '@vitrin/core';
import type { LocaleMetadata, Platform, VitrinConfig } from '@vitrin/schemas';
import type { AscClient } from './asc-client.js';
import { buildPlan } from './plan.js';
import { playReadBackDiffs, type PlayInputs } from './play.js';
import type { PlayClient } from './play-client.js';

/**
 * After an upload: read every store back and list each text field that still differs from the local files —
 * App Store Connect for every Apple platform version (plus the shared app info), and the Google Play listings.
 */
export async function readBack(opts: {
  paths: AppPaths;
  config: VitrinConfig;
  bundleId: string;
  metadata: LocaleMetadata[];
  client?: AscClient;
  platforms?: Platform[];
  play?: { client: PlayClient; packageName: string; inputs: PlayInputs };
}): Promise<string[]> {
  const out: string[] = [];
  // Only what this run uploaded is compared (config.selection): unselected text was left as it is in the store.
  const sel = opts.config.selection;
  if (sel?.assets?.length && !sel.assets.includes('metadata')) return out;
  const platforms = (opts.platforms ?? []).filter((p) => !sel?.platforms?.length || sel.platforms.includes(p));
  if (opts.client && (!opts.platforms || platforms.some((p) => p !== 'android'))) {
    const { play: _play, ...apple } = opts;
    const plan = await buildPlan({ ...apple, platforms: opts.platforms ? platforms : undefined, include: { creatives: false, cpp: false, events: false } });
    const diffs = plan.items.filter((i) => i.area === 'metadata' && i.change !== 'unchanged');
    out.push(...plan.blockers, ...diffs.map((d) => `${d.platform ? `${d.platform} ` : ''}${d.locale} ${d.field}: ASC “${d.remote ?? '(empty)'}”, local “${d.local}”`));
  }
  if (opts.play && (!opts.platforms || platforms.includes('android'))) {
    const remote = await opts.play.client.readState(opts.play.packageName, opts.play.inputs.app.track);
    out.push(...playReadBackDiffs(opts.play.inputs, remote));
  }
  return out;
}
