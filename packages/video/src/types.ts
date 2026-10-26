/** Props passed from the CLI to the Remotion compositions (must stay JSON-serialisable). */
export interface MediaRef {
  /** Path relative to the bundle's public dir (.vitrin/raw), resolved with staticFile(). */
  path: string;
  kind: 'video' | 'image';
  /** Seconds into the source video where this beat starts. */
  from: number;
  /** height / width of the capture. */
  aspect: number;
}

export interface Look {
  background: string[];
  accent: string;
  text: string;
  textMuted: string;
  surface: string;
  badgeBackground: string;
  badgeText: string;
  headlineFont: string;
  bodyFont: string;
  headlineWeight: number;
  dir: 'ltr' | 'rtl';
  deviceFamily: PreviewFamily;
  /** Raw capture aspect (height / width). */
  aspect: number;
  /**
   * Device frame from @vitrin/render (the same HTML/CSS frames as the screenshots), drawn at a reference width:
   * `under` is the body and bezel, the media goes into `screen`, `over` holds glare, island and camera.
   */
  frame?: FrameShellProps;
  /** Style preset of the art direction (for reference; the colors above are already resolved). */
  preset?: string;
}

export type PreviewFamily = 'iphone' | 'ipad' | 'mac' | 'tv';

export interface FrameShellProps {
  under: string;
  over: string;
  width: number;
  height: number;
  screen: { x: number; y: number; w: number; h: number; r: number };
}

/** Landscape previews (Mac, Apple TV) are 1920×1080; phones and tablets are portrait. */
export function isLandscape(family: PreviewFamily): boolean {
  return family === 'mac' || family === 'tv';
}

/** Composition size in CSS px (rendered at scale 2): iPhone 443×960, iPad 600×800, Mac/TV 960×540. */
export function compositionSize(family: PreviewFamily): { width: number; height: number } {
  if (family === 'ipad') return { width: 600, height: 800 };
  if (isLandscape(family)) return { width: 960, height: 540 };
  return { width: 443, height: 960 };
}

export type PreviewStyle = 'classic' | 'showcase' | 'kinetic' | 'energetic';
/** `leak` = hard cut covered by a light-leak overlay (does not overlap scenes). */
export type TransitionKind = 'fade' | 'slide' | 'wipe' | 'flip' | 'push' | 'iris' | 'leak' | 'none';

export interface Chip {
  label: string;
  /** Inline Lucide SVG markup (resolved by the CLI). */
  iconSvg: string;
}

export type Scene =
  | { kind: 'hook'; frames: number; text: string; media: MediaRef }
  | { kind: 'device'; frames: number; caption: string; media: MediaRef }
  | { kind: 'zoom'; frames: number; caption: string; media: MediaRef; rect: { x: number; y: number; w: number; h: number } }
  | { kind: 'split'; frames: number; caption: string; media: MediaRef; media2: MediaRef }
  | { kind: 'text'; frames: number; text: string }
  | { kind: 'stat'; frames: number; caption: string; media: MediaRef; value: number; suffix: string; label: string; locale: string }
  | { kind: 'badges'; frames: number; caption: string; media: MediaRef; chips: Chip[] }
  | { kind: 'outro'; frames: number; title: string; subtitle: string };

export interface AppPreviewProps extends Record<string, unknown> {
  look: Look;
  style: PreviewStyle;
  /** Resolved transition per cut (length = scenes.length − 1). */
  transitions: TransitionKind[];
  transitionFrames: number;
  lightLeaks: boolean;
  scenes: Scene[];
  /** Path of the app icon inside public dir, if available. */
  icon?: string;
}

export interface LoopProps extends Record<string, unknown> {
  look: Look;
  copy: string;
  media: MediaRef[];
  durationSec: number;
  layout: 'header' | 'search' | 'event';
}

export const FPS_PREVIEW = 30;

/** Transitions overlap neighbouring scenes, so they shorten the timeline. */
export function previewDurationFrames(p: Pick<AppPreviewProps, 'scenes' | 'transitions' | 'transitionFrames'>): number {
  const scenes = p.scenes.reduce((a, s) => a + s.frames, 0);
  const overlaps = p.transitions.filter((t) => t !== 'none' && t !== 'leak').length * p.transitionFrames;
  return scenes - overlaps;
}

export function previewDurationSec(p: Pick<AppPreviewProps, 'scenes' | 'transitions' | 'transitionFrames'>): number {
  return previewDurationFrames(p) / FPS_PREVIEW;
}

/** Per-style defaults: which cut transitions to cycle through and how long a cut lasts. */
export const STYLE_DEFAULTS: Record<PreviewStyle, { transitions: TransitionKind[]; transitionFrames: number; lightLeaks: boolean; textCards: boolean }> = {
  classic: { transitions: ['fade'], transitionFrames: 12, lightLeaks: false, textCards: false },
  showcase: { transitions: ['push', 'leak', 'iris', 'leak'], transitionFrames: 16, lightLeaks: true, textCards: false },
  kinetic: { transitions: ['slide', 'push', 'wipe'], transitionFrames: 10, lightLeaks: false, textCards: true },
  energetic: { transitions: ['wipe', 'flip', 'slide'], transitionFrames: 12, lightLeaks: false, textCards: false },
};
