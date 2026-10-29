import { language } from './i18n';

/**
 * Short titles for validation issues in the Studio's language. The validator writes its sentences in English; until
 * it speaks other languages, a Turkish user reads the title here and the validator's sentence as the detail.
 */

const TR: Record<string, string> = {
  'url.placeholder': 'Yer tutucu bağlantı',
  'url.missing': 'Bağlantı eksik',
  'url.invalid': 'Geçersiz bağlantı',
  'url.http': 'Güvensiz bağlantı (http)',
  'text.too-long': 'Çok uzun',
  'text.too-short': 'Çok kısa',
  'text.required': 'Zorunlu alan boş',
  'text.placeholder': 'Yer tutucu metin',
  'text.price': 'Fiyat ifadesi',
  'text.superlative': 'Kanıtsız üstünlük iddiası',
  'text.competitor-brand': 'Rakip markası',
  'text.apple-award': 'Apple ödülü ifadesi',
  'text.kids-reserved': 'Çocuklara yönelik ifade',
  'text.html': 'HTML etiketi',
  'text.whitespace': 'Fazla boşluk',
  'keywords.top-unused': 'Kullanılmayan güçlü anahtar kelimeler',
  'keywords.underused': 'Anahtar kelime alanının bir kısmı boş',
  'keywords.spaces': 'Virgülden sonra boşluk',
  'keywords.duplicate': 'Tekrarlanan kelime',
  'keywords.repeats-name': 'Ad ya da alt başlıktaki kelimeyi tekrarlıyor',
  'keywords.plural': 'Çoğul kelime',
  'keywords.too-short': 'Çok kısa kelime',
  'keywords.apple-trademark': 'Apple markası',
  'keywords.developer-name': 'Geliştirici adı',
  'keywords.noise': 'Gereksiz kelime',
  'keywords.drops-ranked-term': 'Sıralamada olunan kelime çıkarılmış',
  'keywords.plan-mismatch': 'Seçilen kelimeler alanlarda yok',
  'keywords.plan-unscored': 'Puanlanmamış adaylar',
  'keywords.plan-unselected': 'Anahtar kelime seçimi yok',
  'keywords.cross-locale-duplicate': 'Aynı mağazadaki başka dille tekrar',
  'keywords.cross-locale-repeats-name': 'Başka dilin adını tekrarlıyor',
  'keywords.live-diff': 'Yayındaki listeden farklı',
  'aso.subtitle-empty': 'Alt başlık boş',
  'aso.subtitle-short': 'Alt başlık kısa',
  'aso.subtitle-repeats-name': 'Alt başlık adı tekrarlıyor',
  'aso.name-brand-only': 'Ad yalnızca marka',
  'description.hook': 'Açıklamanın ilk satırları zayıf',
  'description.stuffing': 'Anahtar kelime doldurma',
  'whatsnew.generic': 'Genel “Yenilikler” metni',
  'review.notes-short': 'İnceleme notları kısa',
  'copyright.format': 'Telif biçimi',
  'copyright.symbol': 'Telif sembolü',
  'category.same': 'Kategoriler aynı',
  'claim.none': 'İddia yok',
  'claim.not-in-copy': 'İddia metinde geçmiyor',
  'claim.unknown-feature': 'Bilinmeyen özellik',
  'evidence.missing-file': 'Kanıt dosyası yok',
  'metadata.stray-locale': 'Seçili olmayan dilin klasörü',
  'metadata.missing-locale': 'Dil eksik',
  'metadata.app-missing': 'app.json eksik',
  'metadata.locale-mismatch': 'Dil alanı uyuşmuyor',
  'config.primary-locale': 'Ana dil mağaza dilleri arasında değil',
  'image.none': 'Ekran görüntüsü yok',
  'image.stray-locale': 'Seçili olmayan dilin ekran görüntüleri',
  'image.missing-locale': 'Bir dilin ekran görüntüleri yok',
  'video.no-recording': 'Gerçek ekran kaydı yok',
  'video.stray-locale': 'Seçili olmayan dilin videoları',
};

/** By the part before the first dot, for codes without a title of their own. */
const TR_FAMILY: Record<string, string> = {
  url: 'Bağlantı',
  text: 'Metin',
  keywords: 'Anahtar kelimeler',
  aso: 'ASO',
  description: 'Açıklama',
  shot: 'Ekran görüntüsü',
  video: 'Video',
  image: 'Görsel',
  badge: 'Rozet',
  claim: 'İddia',
  event: 'Etkinlik',
  play: 'Google Play',
  metadata: 'Mağaza metinleri',
  cpp: 'Özel ürün sayfası',
  experiment: 'Ürün sayfası testi',
  quote: 'Alıntı',
  icon: 'Simge',
  copyright: 'Telif',
  category: 'Kategori',
  review: 'İnceleme notları',
  whatsnew: 'Yenilikler',
  config: 'Ayar',
  evidence: 'Kanıt',
};

/** The title for an issue code in the Studio's language; undefined in English (the validator's sentence says it all). */
export function issueTitle(code: string): string | undefined {
  if (language() !== 'tr') return undefined;
  return TR[code] ?? TR_FAMILY[code.split('.')[0]!];
}
