/**
 * Every environment variable Vitrin understands, with an explanation of where to get it.
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
    where: 'App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys. The role must be at least “App Manager”; use the “Key ID” column in the list.',
    secret: true,
  },
  {
    name: 'ASC_ISSUER_ID',
    group: 'asc',
    required: 'upload',
    example: '',
    where: 'The “Issuer ID” (UUID) at the top of the same page.',
    secret: true,
  },
  {
    name: 'ASC_KEY_PATH',
    group: 'asc',
    required: 'upload',
    example: './secrets/AuthKey_XXXXXXXXXX.p8',
    where: 'Path to the AuthKey_<KEYID>.p8 file, which can be downloaded only once when the key is created. Keep it outside the repo or in the git-ignored secrets/ folder. Alternative: ASC_KEY_CONTENT_BASE64.',
    secret: false,
  },
  {
    name: 'ASC_KEY_CONTENT_BASE64',
    group: 'asc',
    required: 'optional',
    example: '',
    where: 'For CI: the output of `base64 -i AuthKey_XXXX.p8`. Not needed when ASC_KEY_PATH is set.',
    secret: true,
  },
  {
    name: 'APP_BUNDLE_ID',
    group: 'app',
    required: 'optional',
    example: '',
    where: 'If left empty, it is read from the Xcode project (PRODUCT_BUNDLE_IDENTIFIER).',
    secret: false,
  },
  {
    name: 'APPLE_ADS_CLIENT_ID',
    group: 'apple-ads',
    required: 'optional',
    example: '',
    where: 'Apple Ads > Account Settings > API. Used for keyword popularity; without it, popularity is marked as “estimated”.',
    secret: true,
  },
  { name: 'APPLE_ADS_TEAM_ID', group: 'apple-ads', required: 'optional', example: '', where: 'The Team ID from the Apple Ads API settings.', secret: true },
  { name: 'APPLE_ADS_KEY_ID', group: 'apple-ads', required: 'optional', example: '', where: 'The Key ID from the Apple Ads API settings.', secret: true },
  {
    name: 'APPLE_ADS_PRIVATE_KEY_PATH',
    group: 'apple-ads',
    required: 'optional',
    example: '',
    where: 'Path to the EC private key (.pem) you created for the Apple Ads API.',
    secret: false,
  },
  { name: 'APPLE_ADS_ORG_ID', group: 'apple-ads', required: 'optional', example: '', where: 'The Organization ID (orgId) of your Apple Ads account.', secret: true },
  {
    name: 'APPTWEAK_API_KEY',
    group: 'apptweak',
    required: 'optional',
    example: '',
    where: 'AppTweak > Account > API. Optional popularity source.',
    secret: true,
  },
  {
    name: 'FASTLANE_USER',
    group: 'fastlane',
    required: 'optional',
    example: '',
    where: 'Apple ID email, only for creating the app record with `fastlane produce`. Not needed in the normal flow.',
    secret: true,
  },
  {
    name: 'FASTLANE_PASSWORD',
    group: 'fastlane',
    required: 'optional',
    example: '',
    where: 'Only for `produce`. Your Apple ID password, not an app-specific password (requires 2FA).',
    secret: true,
  },
  {
    name: 'REVIEW_DEMO_USER',
    group: 'review',
    required: 'optional',
    example: '',
    where: 'Demo account username for App Review (for apps that require sign-in).',
    secret: true,
  },
  {
    name: 'REVIEW_DEMO_PASSWORD',
    group: 'review',
    required: 'optional',
    example: '',
    where: 'Password of the App Review demo account. It must not expire.',
    secret: true,
  },
];

const GROUP_TITLES: Record<EnvKey['group'], string> = {
  asc: 'App Store Connect API (required for upload)',
  app: 'App',
  'apple-ads': 'Optional: Apple Ads (keyword popularity)',
  apptweak: 'Optional: AppTweak',
  fastlane: 'Optional: only for creating the app record (fastlane produce)',
  review: 'Optional: App Review demo account',
};

/** Renders .env.example, keeping any keys the user added that Vitrin does not know about. */
export function renderEnvExample(extraLines: string[] = []): string {
  const lines: string[] = [
    '# Vitrin environment variables. Copy this file to .env and fill it in.',
    '# Never commit .env or *.p8 files; do not paste these values into a chat.',
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
  if (extraLines.length) lines.push('', '# --- Project-specific ---', ...extraLines);
  return lines.join('\n') + '\n';
}
