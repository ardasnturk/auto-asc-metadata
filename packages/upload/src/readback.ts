import type { LocaleMetadata, VitrinConfig } from '@vitrin/schemas';
import type { AscClient } from './asc-client.js';
import { buildPlan } from './plan.js';
import type { AppPaths } from '@vitrin/core';

/** After an upload: read ASC back and list every text field that still differs from the local files. */
export async function readBack(opts: { paths: AppPaths; config: VitrinConfig; bundleId: string; metadata: LocaleMetadata[]; client: AscClient }): Promise<string[]> {
  const plan = await buildPlan({ ...opts, include: { creatives: false, cpp: false, events: false } });
  const diffs = plan.items.filter((i) => i.area === 'metadata' && i.change !== 'unchanged');
  return [...plan.blockers, ...diffs.map((d) => `${d.locale} ${d.field}: ASC “${d.remote ?? '(empty)'}”, local “${d.local}”`)];
}
