/**
 * Every environment variable Vitrin understands, with a Turkish explanation of where to get it.
 * `.env.example` is generated from this list, and doctor uses it to explain missing keys.
 */
export interface EnvKey {
  name: string;
  group: 'asc' | 'app' | 'apple-ads' | 'apptweak' | 'fastlane' | 'review';
  required: 'upload' | 'optional';
  /** Placeholder written to .env.example. */
  example: string;
  where: string;
  secret: boolean;
}

export const ENV_KEYS: EnvKey[] = [
  {
    name: 'ASC_KEY_ID',
    group: 'asc',
    required: 'upload',
    example: '',
    where: 'App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys. Rol en az “App Manager” olmalı; listedeki “Key ID” sütunu.',
    secret: true,
  },
  {
    name: 'ASC_ISSUER_ID',
    group: 'asc',
    required: 'upload',
    example: '',
    where: 'Aynı sayfanın üstündeki “Issuer ID” (UUID).',
    secret: true,
  },
  {
    name: 'ASC_KEY_PATH',
    group: 'asc',
    required: 'upload',
    example: './secrets/AuthKey_XXXXXXXXXX.p8',
    where: 'Anahtarı oluştururken bir kez indirilebilen AuthKey_<KEYID>.p8 dosyasının yolu. Repo dışında ya da .gitignore’daki secrets/ klasöründe tut. Alternatif: ASC_KEY_CONTENT_BASE64.',
    secret: false,
  },
  {
    name: 'ASC_KEY_CONTENT_BASE64',
    group: 'asc',
    required: 'optional',
    example: '',
    where: 'CI için: `base64 -i AuthKey_XXXX.p8` çıktısı. ASC_KEY_PATH doluysa gerekmez.',
    secret: true,
  },
  {
    name: 'APP_BUNDLE_ID',
    group: 'app',
    required: 'optional',
    example: '',
    where: 'Boş bırakılırsa Xcode projesinden (PRODUCT_BUNDLE_IDENTIFIER) okunur.',
    secret: false,
  },
  {
    name: 'APPLE_ADS_CLIENT_ID',
    group: 'apple-ads',
    required: 'optional',
    example: '',
    where: 'Apple Ads > Account Settings > API. Anahtar kelime popülerliği için; yoksa popülerlik “tahmin” olarak işaretlenir.',
    secret: true,
  },
  { name: 'APPLE_ADS_TEAM_ID', group: 'apple-ads', required: 'optional', example: '', where: 'Apple Ads API ayarlarındaki Team ID.', secret: true },
  { name: 'APPLE_ADS_KEY_ID', group: 'apple-ads', required: 'optional', example: '', where: 'Apple Ads API ayarlarındaki Key ID.', secret: true },
  {
    name: 'APPLE_ADS_PRIVATE_KEY_PATH',
    group: 'apple-ads',
    required: 'optional',
    example: '',
    where: 'Apple Ads API için oluşturduğun EC özel anahtarın (.pem) yolu.',
    secret: false,
  },
  { name: 'APPLE_ADS_ORG_ID', group: 'apple-ads', required: 'optional', example: '', where: 'Apple Ads hesabındaki Organization ID (orgId).', secret: true },
  {
    name: 'APPTWEAK_API_KEY',
    group: 'apptweak',
    required: 'optional',
    example: '',
    where: 'AppTweak > Account > API. Opsiyonel popülerlik kaynağı.',
    secret: true,
  },
  {
    name: 'FASTLANE_USER',
    group: 'fastlane',
    required: 'optional',
    example: '',
    where: 'Yalnız uygulama kaydını `fastlane produce` ile açmak için Apple ID e-postası. Normal akışta gerekmez.',
    secret: true,
  },
  {
    name: 'FASTLANE_PASSWORD',
    group: 'fastlane',
    required: 'optional',
    example: '',
    where: 'Yalnız `produce` için. Uygulamaya özel parola değil, Apple ID parolası (2FA ister).',
    secret: true,
  },
  {
    name: 'REVIEW_DEMO_USER',
    group: 'review',
    required: 'optional',
    example: '',
    where: 'App Review için demo hesap kullanıcı adı (giriş gerektiren uygulamalarda).',
    secret: true,
  },
  {
    name: 'REVIEW_DEMO_PASSWORD',
    group: 'review',
    required: 'optional',
    example: '',
    where: 'App Review demo hesabının parolası. Süresi dolmamalı.',
    secret: true,
  },
];

const GROUP_TITLES: Record<EnvKey['group'], string> = {
  asc: 'App Store Connect API (yükleme için zorunlu)',
  app: 'Uygulama',
  'apple-ads': 'Opsiyonel: Apple Ads (anahtar kelime popülerliği)',
  apptweak: 'Opsiyonel: AppTweak',
  fastlane: 'Opsiyonel: yalnız uygulama kaydı oluşturmak (fastlane produce) için',
  review: 'Opsiyonel: App Review demo hesabı',
};

/** Renders .env.example, keeping any keys the user added that Vitrin does not know about. */
export function renderEnvExample(extraLines: string[] = []): string {
  const lines: string[] = [
    '# Vitrin ortam değişkenleri. Bu dosyayı .env olarak kopyalayıp doldur.',
    '# .env ve *.p8 dosyaları asla commit edilmez; değerleri sohbete yapıştırma.',
    '',
  ];
  let group: EnvKey['group'] | undefined;
  for (const k of ENV_KEYS) {
    if (k.group !== group) {
      if (group) lines.push('');
      lines.push(`# --- ${GROUP_TITLES[k.group]} ---`);
      group = k.group;
    }
    lines.push(`# ${k.where}`);
    lines.push(`${k.name}=${k.example}`);
  }
  if (extraLines.length) lines.push('', '# --- Proje özel ---', ...extraLines);
  return lines.join('\n') + '\n';
}
