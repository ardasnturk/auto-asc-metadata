import { enabledTargets, existsSync, readJson, readJsonIfExists, type AppPaths } from '@vitrin/core';
import {
  AppMetadata,
  AppProfile,
  Competitors,
  LocaleMetadata,
  RenderManifest,
  ShotList,
  VideoPlan,
  type Issue,
  type ValidationReport,
  type VitrinConfig,
} from '@vitrin/schemas';
import { validateClaims } from './claims.js';
import { IssueList } from './issues.js';
import { strayLocaleDirs, validateScreenshots, validateVideos } from './media.js';
import { validateText } from './text.js';

export * from './issues.js';
export * from './text.js';
export * from './claims.js';
export * from './media.js';

export interface ValidateScope {
  text?: boolean;
  images?: boolean;
  videos?: boolean;
  claims?: boolean;
}

/** Loads every artefact that exists and validates it. Schema errors become issues instead of exceptions. */
export async function validateAll(paths: AppPaths, config: VitrinConfig, scope: ValidateScope = { text: true, images: true, videos: true, claims: true }): Promise<ValidationReport> {
  const issues = new IssueList();
  const load = async <T>(file: string, schema: Parameters<typeof readJson<T>>[1]): Promise<T | undefined> => {
    try {
      return await readJsonIfExists(file, schema);
    } catch (err) {
      issues.error('schema', (err as Error).message, { file });
      return undefined;
    }
  };

  const profile = await load(paths.profile, AppProfile);
  if (!profile) issues.error('profile.missing', 'app_profile.json yok; önce `vitrin analyze`.');
  const competitors = await load(paths.competitors, Competitors);
  const appMetadata = await load(paths.appMetadata, AppMetadata);
  const shots = await load(paths.shots, ShotList);
  const videoPlan = await load(paths.videoPlan, VideoPlan);
  const manifest = await load(paths.renderManifest, RenderManifest);
  const targets = enabledTargets(config, profile);

  let measurements: ValidationReport['measurements'] = {};
  if (scope.text !== false) {
    const locales = new Map<string, LocaleMetadata>();
    for (const locale of config.app.locales) {
      const m = await load(paths.metadataFile(locale), LocaleMetadata);
      if (m) {
        if (m.locale !== locale) issues.error('metadata.locale-mismatch', `${locale}.json içindeki locale alanı “${m.locale}”.`, { locale });
        locales.set(locale, m);
      }
    }
    for (const extra of await strayLocaleDirs(paths.fastlaneMetadata, config.app.locales)) {
      if (!['default'].includes(extra)) issues.error('metadata.stray-locale', `fastlane/metadata/${extra} config’te olmayan bir dil; deliver bunu da yükler.`);
    }
    const text = validateText({ config, profile, competitors, appMetadata, locales });
    issues.push(...text.issues.items);
    measurements = text.measurements;
  }

  if (scope.claims !== false && profile) {
    issues.push(...validateClaims({ config, profile, shots, videoPlan, competitors, enabledTargets: targets.map((t) => t.id) }).items);
  }

  if (scope.images !== false) {
    if (existsSync(paths.screenshots)) {
      issues.push(...(await validateScreenshots({ screenshotsDir: paths.screenshots, locales: config.app.locales, targets: targets.filter((t) => t.kind === 'screenshot'), manifest })).items);
    } else {
      issues.warn('image.none', 'fastlane/screenshots henüz yok (vitrin design).');
    }
  }

  if (scope.videos !== false) {
    issues.push(
      ...(
        await validateVideos({
          previewsDir: paths.appPreviews,
          creativeDir: paths.creative,
          locales: config.app.locales,
          targets,
          expectPreview: targets.some((t) => t.kind === 'preview'),
        })
      ).items,
    );
    const recordingIds = new Set(config.capture.recordings.map((r) => r.id));
    if (videoPlan && videoPlan.previews.some((p) => p.beats.every((b) => !recordingIds.has(b.source)))) {
      issues.warn('video.no-recording', 'App Preview yalnız ekran görüntülerinden oluşuyor; gerçek ekran kaydı (capture.recordings) önerilir.');
    }
  }

  return buildReport(issues.items, measurements);
}

export function buildReport(items: Issue[], measurements: ValidationReport['measurements'] = {}): ValidationReport {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of items) counts[i.severity === 'warning' ? 'warning' : i.severity]++;
  return { generatedAt: new Date().toISOString(), ok: counts.error === 0, counts, issues: items, measurements };
}
