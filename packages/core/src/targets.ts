import type { AppProfile, RenderTarget, VitrinConfig } from '@vitrin/schemas';
import { loadTargets } from './workspace.js';

/**
 * Targets to produce for this app: defaults from data/targets.json, iPad only when the app supports it,
 * then config `targets.enable` / `targets.disable`.
 */
export function enabledTargets(config: VitrinConfig, profile?: Pick<AppProfile, 'app'>): RenderTarget[] {
  return loadTargets().filter((t) => {
    if (config.targets.disable.includes(t.id)) return false;
    if (config.targets.enable.includes(t.id)) return true;
    if (!t.defaultEnabled) return false;
    if (t.family === 'ipad' && profile && !profile.app.supportsIPad) return false;
    if (t.id === 'preview-iphone' || t.id === 'preview-ipad') return config.video.enabled;
    return true;
  });
}

/** deliver infers the App Preview device from the file name; 886×1920 covers every modern iPhone class. */
export const DELIVER_PREVIEW_DEVICE: Record<string, string> = {
  'preview-iphone': 'IPHONE_67',
  'preview-ipad': 'IPAD_PRO_3GEN_129',
};
