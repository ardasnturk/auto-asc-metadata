import { ensureDir, exec, existsSync, log, TEMPLATES_DIR, writeText, type AppPaths } from '@vitrin/core';
import type { AppMetadata, LocaleMetadata, VitrinConfig } from '@vitrin/schemas';
import { copyFile, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** deliver's per-locale file names (fastlane/metadata/<locale>/<name>.txt). */
export const LOCALE_FILES: Record<string, (m: LocaleMetadata, c: VitrinConfig) => string | undefined> = {
  'name.txt': (m) => m.name,
  'subtitle.txt': (m) => m.subtitle,
  'description.txt': (m) => m.description,
  'keywords.txt': (m) => m.keywords,
  'promotional_text.txt': (m) => m.promotionalText,
  'release_notes.txt': (m) => m.whatsNew || undefined,
  'support_url.txt': (m, c) => m.supportUrl ?? c.urls.support,
  'marketing_url.txt': (m, c) => m.marketingUrl ?? c.urls.marketing,
  'privacy_url.txt': (m, c) => m.privacyUrl ?? c.urls.privacy,
};

/** Optional fields that must be cleared remotely when emptied locally (release notes stay absent: first versions reject them). */
const CLEARABLE = new Set(['subtitle.txt', 'promotional_text.txt', 'marketing_url.txt']);

/**
 * Writes the deliver metadata tree. Demo account credentials are NOT written to disk:
 * the Fastfile reads them from REVIEW_DEMO_USER / REVIEW_DEMO_PASSWORD at upload time.
 */
export async function exportFastlaneMetadata(paths: AppPaths, config: VitrinConfig, app: AppMetadata, locales: LocaleMetadata[]): Promise<string[]> {
  const root = paths.fastlaneMetadata;
  const written: string[] = [];
  const write = async (rel: string, value: string | undefined, clearable = false) => {
    const file = join(root, rel);
    if (value === undefined || value === '') {
      // A missing file means "leave the remote value alone" to deliver; an empty file clears it.
      if (clearable) await writeText(file, '');
      else if (existsSync(file)) await rm(file);
      return;
    }
    await writeText(file, value.trim() + '\n');
    written.push(file);
  };
  await ensureDir(root);
  for (const m of locales) {
    // Remove files of fields that became empty so deliver does not upload stale text.
    for (const [file, get] of Object.entries(LOCALE_FILES)) await write(join(m.locale, file), get(m, config), CLEARABLE.has(file));
  }
  await write('copyright.txt', app.copyright);
  await write('primary_category.txt', app.primaryCategory);
  await write('secondary_category.txt', app.secondaryCategory);
  await write('primary_first_sub_category.txt', app.primarySubcategories[0]);
  await write('primary_second_sub_category.txt', app.primarySubcategories[1]);
  await write('secondary_first_sub_category.txt', app.secondarySubcategories[0]);
  await write('secondary_second_sub_category.txt', app.secondarySubcategories[1]);
  const r = config.review;
  await write('review_information/first_name.txt', r.firstName);
  await write('review_information/last_name.txt', r.lastName);
  await write('review_information/phone_number.txt', r.phone);
  await write('review_information/email_address.txt', r.email);
  await write('review_information/notes.txt', app.reviewNotes);
  for (const legacy of ['demo_user.txt', 'demo_password.txt']) {
    const f = join(root, 'review_information', legacy);
    if (existsSync(f)) {
      await rm(f);
      log.warn(`${legacy} silindi: demo hesap bilgisi dosyada tutulmaz, .env (REVIEW_DEMO_*) kullanılır.`);
    }
  }
  return written;
}

/** Copies Gemfile + Fastfile templates into the app repo (never overwrites a user-edited Fastfile without --force). */
export async function installFastlaneTemplates(paths: AppPaths, force = false): Promise<string[]> {
  const out: string[] = [];
  await ensureDir(paths.fastlane);
  const pairs: Array<[string, string]> = [
    [join(TEMPLATES_DIR, 'Gemfile'), join(paths.root, 'Gemfile')],
    [join(TEMPLATES_DIR, 'Fastfile'), join(paths.fastlane, 'Fastfile')],
  ];
  for (const [src, dest] of pairs) {
    if (existsSync(dest) && !force) {
      const cur = await readFile(dest, 'utf8');
      if (dest.endsWith('Gemfile') && !/fastlane/.test(cur)) {
        log.warn('Mevcut Gemfile fastlane içermiyor; `gem "fastlane", ">= 2.241.1"` satırını ekle.');
      } else if (dest.endsWith('Fastfile') && !cur.includes('vitrin_upload')) {
        log.warn('Mevcut Fastfile’da vitrin lane’leri yok; şablon fastlane/Fastfile.vitrin olarak yazıldı, içeri aktar (import "Fastfile.vitrin").');
        await copyFile(src, `${dest}.vitrin`);
        out.push(`${dest}.vitrin`);
      }
      continue;
    }
    await copyFile(src, dest);
    out.push(dest);
  }
  return out;
}

export interface LaneEnv {
  bundleId: string;
  languages: string[];
  appVersion?: string;
  platform: string;
  skipScreenshots?: boolean;
  skipMetadata?: boolean;
}

/** Runs `bundle exec fastlane ios <lane>` in the app root, installing gems first if needed. */
export async function runLane(paths: AppPaths, lane: string, env: LaneEnv): Promise<void> {
  const gemfile = join(paths.root, 'Gemfile');
  if (!existsSync(gemfile)) throw new Error('Gemfile yok; `vitrin init` fastlane şablonlarını kurar.');
  const check = await exec('bundle', ['check'], { cwd: paths.root });
  if (check.code !== 0) {
    log.step('bundle install (fastlane >= 2.241.1)…');
    const res = await exec('bundle', ['install'], { cwd: paths.root, stream: true });
    if (res.code !== 0) throw new Error('bundle install başarısız.');
  }
  const res = await exec('bundle', ['exec', 'fastlane', 'ios', lane], {
    cwd: paths.root,
    stream: true,
    env: {
      VITRIN_BUNDLE_ID: env.bundleId,
      VITRIN_LANGUAGES: env.languages.join(','),
      VITRIN_APP_VERSION: env.appVersion ?? '',
      VITRIN_PLATFORM: env.platform,
      VITRIN_SKIP_SCREENSHOTS: env.skipScreenshots ? '1' : '0',
      VITRIN_SKIP_METADATA: env.skipMetadata ? '1' : '0',
      FASTLANE_SKIP_UPDATE_CHECK: '1',
      FASTLANE_HIDE_CHANGELOG: '1',
    },
  });
  if (res.code !== 0) {
    const text = res.stdout + res.stderr;
    if (/deprecat|appScreenshotSets|appPreviewSets|410 Gone/i.test(text)) {
      throw new Error('fastlane eski görsel uç noktalarında hata verdi (ASC API 4.5.1 deprecation). `vitrin upload --uploader=asset-library` ile tekrar dene.');
    }
    if (/Could not find (a )?version|no editable|cannot create.*version/i.test(text)) {
      throw new Error('Düzenlenebilir App Store sürümü yok. İlk sürümü App Store Connect’te bir kez elle aç, sonra “devam” de.');
    }
    throw new Error(`fastlane ${lane} başarısız (çıkış ${res.code}). Ayrıntı yukarıda.`);
  }
}

export async function listScreenshotFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
}
