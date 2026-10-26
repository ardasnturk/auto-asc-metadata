import { DATA_DIR } from '@vitrin/core';
import { AscDisplayTypesFile, type AscTargetDisplayTypes, type RenderTarget } from '@vitrin/schemas';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * data/asc-display-types.json: per Vitrin target, the classic App Store Connect display type
 * (ScreenshotDisplayType / PreviewType) and the App Asset Library placement (placementType, displayClass, platform,
 * category). Every value is a member of the matching enum of the ASC API 4.5.1 OpenAPI spec.
 */
let cache: AscDisplayTypesFile | undefined;

export function loadAscDisplayTypes(): AscDisplayTypesFile {
  cache ??= AscDisplayTypesFile.parse(JSON.parse(readFileSync(join(DATA_DIR, 'asc-display-types.json'), 'utf8')));
  return cache;
}

export function displayTypesFor(targetId: string, file: AscDisplayTypesFile = loadAscDisplayTypes()): AscTargetDisplayTypes | undefined {
  return file.targets[targetId];
}

/** The classic API type for this target's kind, or undefined when appScreenshotSets/appPreviewSets has none (iPhone Duo). */
export function classicTypeFor(target: Pick<RenderTarget, 'id' | 'kind'>, file?: AscDisplayTypesFile): string | undefined {
  const d = displayTypesFor(target.id, file);
  if (target.kind === 'screenshot') return d?.screenshotDisplayType ?? undefined;
  if (target.kind === 'preview') return d?.previewType ?? undefined;
  return undefined;
}

/** How one partial (per-display-type) set reaches App Store Connect. */
export type PerTypeRoute = 'classic' | 'asset-library' | 'none';

/**
 * Partial sets go through the classic appScreenshotSets/appPreviewSets API whenever it has a type for the target
 * (it replaces exactly one display type of one localization); the App Asset Library is used only for what the
 * classic API cannot do (iPhone Duo), or for everything with `uploader: asset-library`.
 */
export function perTypeRoute(target: Pick<RenderTarget, 'id' | 'kind'>, uploader: 'deliver' | 'asset-library' | 'asc', file?: AscDisplayTypesFile): PerTypeRoute {
  const d = displayTypesFor(target.id, file);
  if (uploader !== 'asset-library' && classicTypeFor(target, file)) return 'classic';
  if (d?.assetLibrary) return 'asset-library';
  return 'none';
}
