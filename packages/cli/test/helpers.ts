import { AppProfile, VitrinConfig } from '@vitrin/schemas';

export function profileWith(app: Partial<AppProfile['app']>, project: Partial<AppProfile['project']> = {}): AppProfile {
  return AppProfile.parse({
    generatedAt: 'x',
    project: { root: '.', targets: [], ...project },
    app: { displayName: 'X', ...app },
    features: [],
    brand: {},
    docs: {},
  });
}

export function configWith(extra: Record<string, unknown> = {}): VitrinConfig {
  return VitrinConfig.parse({ app: {}, urls: {}, ...extra });
}
