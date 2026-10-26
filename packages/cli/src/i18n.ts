import { existsSync, log, readJsonIfExists } from '@vitrin/core';
import { join } from 'node:path';
import { z } from 'zod';
import type { Ctx } from './context.js';

/**
 * Words of the review gallery (`vitrin review`) in the language the user talks to Vitrin in (`ui.language`).
 * English and Turkish are built in. For any other language Claude writes `metadata/i18n/<language>.json` (same keys,
 * translated values; `vitrin review --print-labels` prints the English set to start from). Missing keys fall back
 * to English. Placeholders like {n} are filled in at render time. Store copy is never translated here.
 */
export const UI_EN = {
  review: 'review',
  generated: 'generated',
  approved: 'Approved {date}',
  changesRequested: 'Changes requested ({n})',
  approvalOutdated: 'Approval outdated: {n} files changed',
  notApproved: 'Not approved yet',
  validationPassed: 'Validation passed',
  validationFailed: 'Validation failed',
  validateNotRun: 'validate has not run',
  errors: '{n} errors',
  warnings: '{n} warnings',
  screenshots: '{n} screenshots',
  previews: '{n} App Previews',
  creatives: '{n} creatives',
  artDirection: 'Art direction: {name}',
  whatWillBeUploaded: 'What will be uploaded',
  uploadIntro: 'Every file below is part of the approval. Upload starts only after the user approves this exact content (overall hash below); any change afterwards requires a new review.',
  colStore: 'Store',
  colPlatform: 'Platform',
  colLocale: 'Locale',
  colType: 'Type',
  colItems: 'Items',
  colSize: 'Size',
  colDestination: 'Destination',
  nothingToUpload: 'Nothing to upload yet.',
  overallHash: 'Overall hash:',
  noAssets: 'No assets found: run {commands}.',
  competitorComparison: 'Competitor comparison',
  notUploaded: 'not uploaded',
  ourFirstScreenshots: 'Our first 3 screenshots ({locale})',
  researchNotRun: 'research has not run',
  otherIssues: 'Other validation issues',
  noOtherIssues: 'None — every issue is shown next to its item.',
  approveHint: 'To approve, tell Claude “approve” after looking through everything (it runs {command}), or open this page with {serve} to approve or reject items with buttons.',
  sendRejections: 'Send rejections',
  approveAll: 'Approve everything',
  close: 'Close (Esc)',
  searchResult: 'Search result',
  productPage: 'Product page',
  get: 'GET',
  more: '… more',
  whatsNew: 'What’s New',
  metadata: 'Metadata',
  kindScreenshot: 'Screenshots',
  kindPreview: 'App Previews',
  kindCreative: 'Creatives (header / search)',
  kindEvent: 'In-App Event images',
  inUploadOrder: 'in upload order',
  cppSuggestions: 'Custom Product Page suggestions',
  allLocales: 'All locales',
  files: '{n} files',
  file: '1 file',
  reject: 'Reject…',
  undoReject: 'Undo reject',
  rejectPlaceholder: 'What should change?',
  emptyClears: '(empty — clears the remote value)',
  noTextFiles: 'No text files.',
  expectedSize: 'expected {size}',
  error: 'ERROR',
  warning: 'WARNING',
  info: 'info',
  videoStyles: 'Video styles',
  sendNRejections: 'Send {n} rejection(s)',
  markedForChanges: '{n} item(s) marked for changes. Add a comment to each, then send them to Claude.',
  lookThrough: 'Look through every item. Approve everything to allow the upload of exactly this content, or reject items with a comment.',
  confirmApprove: 'Approve all {n} items for upload?',
  approvedClose: 'Approved ({hash}…). You can close this tab; Claude continues with the upload.',
  notApprovedError: 'Not approved: {error}',
  commentEach: 'Add a comment to every rejected item.',
  sentRejections: 'Sent {n} rejection(s) to Claude. You can close this tab.',
  notSent: 'Not sent: {error}',
  samplesTitle: 'Choose a design',
  samplesIntro: 'Each column shows how your App Store listing looks with that design: the search result first, then the product page. Pick A, B, C or D.',
  samplesOption: 'If you choose {letter}',
};
export type UiKey = keyof typeof UI_EN;
export type UiText = Record<UiKey, string>;

const UI_TR: UiText = {
  review: 'inceleme',
  generated: 'oluşturuldu',
  approved: 'Onaylandı {date}',
  changesRequested: 'Değişiklik istendi ({n})',
  approvalOutdated: 'Onay geçersiz: {n} dosya değişti',
  notApproved: 'Henüz onaylanmadı',
  validationPassed: 'Doğrulama geçti',
  validationFailed: 'Doğrulama başarısız',
  validateNotRun: 'validate henüz çalışmadı',
  errors: '{n} hata',
  warnings: '{n} uyarı',
  screenshots: '{n} ekran görüntüsü',
  previews: '{n} App Preview',
  creatives: '{n} kreatif',
  artDirection: 'Sanat yönetimi: {name}',
  whatWillBeUploaded: 'Yüklenecekler',
  uploadIntro: 'Aşağıdaki her dosya onayın parçasıdır. Yükleme ancak kullanıcı tam olarak bu içeriği onayladıktan sonra başlar (aşağıdaki genel hash); sonradan yapılan her değişiklik yeni bir inceleme gerektirir.',
  colStore: 'Mağaza',
  colPlatform: 'Platform',
  colLocale: 'Dil',
  colType: 'Tür',
  colItems: 'Öğe',
  colSize: 'Boyut',
  colDestination: 'Hedef',
  nothingToUpload: 'Henüz yüklenecek bir şey yok.',
  overallHash: 'Genel hash:',
  noAssets: 'İçerik bulunamadı: {commands} çalıştırın.',
  competitorComparison: 'Rakip karşılaştırması',
  notUploaded: 'yüklenmez',
  ourFirstScreenshots: 'İlk 3 ekran görüntümüz ({locale})',
  researchNotRun: 'araştırma henüz çalışmadı',
  otherIssues: 'Diğer doğrulama sorunları',
  noOtherIssues: 'Yok — her sorun kendi öğesinin yanında gösteriliyor.',
  approveHint: 'Onaylamak için her şeye baktıktan sonra Claude’a “onaylıyorum” deyin ({command} çalıştırır) ya da öğeleri butonlarla onaylamak veya reddetmek için bu sayfayı {serve} ile açın.',
  sendRejections: 'Retleri gönder',
  approveAll: 'Hepsini onayla',
  close: 'Kapat (Esc)',
  searchResult: 'Arama sonucu',
  productPage: 'Ürün sayfası',
  get: 'AL',
  more: '… daha fazla',
  whatsNew: 'Yenilikler',
  metadata: 'Metadata',
  kindScreenshot: 'Ekran görüntüleri',
  kindPreview: 'App Preview videoları',
  kindCreative: 'Kreatifler (başlık / arama)',
  kindEvent: 'Uygulama İçi Etkinlik görselleri',
  inUploadOrder: 'yükleme sırasıyla',
  cppSuggestions: 'Özel Ürün Sayfası önerileri',
  allLocales: 'Tüm diller',
  files: '{n} dosya',
  file: '1 dosya',
  reject: 'Reddet…',
  undoReject: 'Reddi geri al',
  rejectPlaceholder: 'Ne değişmeli?',
  emptyClears: '(boş — mağazadaki değeri siler)',
  noTextFiles: 'Metin dosyası yok.',
  expectedSize: 'beklenen {size}',
  error: 'HATA',
  warning: 'UYARI',
  info: 'bilgi',
  videoStyles: 'Video stilleri',
  sendNRejections: '{n} reddi gönder',
  markedForChanges: '{n} öğe değişiklik için işaretlendi. Her birine yorum ekleyip Claude’a gönderin.',
  lookThrough: 'Her öğeye göz atın. Tam olarak bu içeriğin yüklenmesine izin vermek için hepsini onaylayın ya da öğeleri yorumla reddedin.',
  confirmApprove: '{n} öğenin tamamı yükleme için onaylansın mı?',
  approvedClose: 'Onaylandı ({hash}…). Bu sekmeyi kapatabilirsiniz; Claude yüklemeye devam ediyor.',
  notApprovedError: 'Onaylanmadı: {error}',
  commentEach: 'Reddedilen her öğeye bir yorum ekleyin.',
  sentRejections: '{n} ret Claude’a gönderildi. Bu sekmeyi kapatabilirsiniz.',
  notSent: 'Gönderilmedi: {error}',
  samplesTitle: 'Bir tasarım seçin',
  samplesIntro: 'Her sütun, o tasarımı seçerseniz App Store sayfanızın nasıl görüneceğini gösterir: önce arama sonucu, sonra ürün sayfası. A, B, C veya D’yi seçin.',
  samplesOption: '{letter} seçeneğini seçerseniz',
};

const BUILT_IN: Record<string, UiText> = { en: UI_EN, tr: UI_TR };

const Overrides = z.record(z.string(), z.string());

/** Base language subtag: `pt-BR` → `pt`. */
export function baseLanguage(tag: string | undefined): string {
  return (tag ?? 'en').split('-')[0]!.toLowerCase();
}

export function i18nFile(ctx: Pick<Ctx, 'paths'>, language: string): string {
  return join(ctx.paths.vitrin, 'i18n', `${language}.json`);
}

/**
 * The gallery words for `ui.language`: `metadata/i18n/<tag>.json` (or its base language) over the built-in set,
 * over English. Reports when a language has neither, so Claude can write the file.
 */
export async function loadUiText(ctx: Pick<Ctx, 'paths' | 'config'>): Promise<{ text: UiText; language: string; missing: boolean }> {
  const tag = ctx.config.ui?.language ?? 'en';
  const base = baseLanguage(tag);
  let text: UiText = { ...UI_EN, ...(BUILT_IN[base] ?? {}) };
  let found = base in BUILT_IN;
  for (const name of [...new Set([base, tag])]) {
    const file = i18nFile(ctx, name);
    if (!existsSync(file)) continue;
    const extra = await readJsonIfExists(file, Overrides).catch((err: Error) => {
      log.warn(`${file}: ${err.message} (ignored)`);
      return undefined;
    });
    if (!extra) continue;
    found = true;
    for (const [k, v] of Object.entries(extra)) if (k in UI_EN && v.trim()) text = { ...text, [k]: v };
  }
  return { text, language: tag, missing: !found };
}

/** `{name}` placeholders → values. */
export function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
