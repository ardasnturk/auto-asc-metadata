/** Props passed from the CLI to the Remotion compositions (must stay JSON-serialisable). */
export interface MediaRef {
  /** Path relative to the bundle's public dir (metadata/raw), resolved with staticFile(). */
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

export type PreviewFamily = 'iphone' | 'ipad' | 'mac' | 'tv' | 'vision';

export interface FrameShellProps {
  under: string;
  over: string;
  width: number;
  height: number;
  screen: { x: number; y: number; w: number; h: number; r: number };
}

/** Landscape previews (Mac, Apple TV 1920×1080; Vision Pro 3840×2160); phones and tablets are portrait. */
export function isLandscape(family: PreviewFamily): boolean {
  return family === 'mac' || family === 'tv' || family === 'vision';
}

/** Render scale from the composition size to the delivery size: Vision Pro previews are 4K, everything else 2×. */
export function renderScale(family: PreviewFamily): number {
  return family === 'vision' ? 4 : 2;
}

/** Composition size in CSS px (rendered at `renderScale`): iPhone 443×960, iPad 600×800, Mac/TV/Vision 960×540. */
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

/** How a flow screen arrives: navigation push, modal sheet, state change, the same screen further down, or a montage cut. */
export type FlowChange = 'push' | 'sheet' | 'fade' | 'scroll' | 'cut';

export interface FlowShot {
  media: MediaRef;
  /** Touch point (fractions of the capture), shown just before the next screen arrives. */
  tap?: { x: number; y: number };
  change: FlowChange;
}

export type Scene =
  | { kind: 'hook'; frames: number; text: string; media: MediaRef }
  | { kind: 'device'; frames: number; caption: string; media: MediaRef }
  | { kind: 'zoom'; frames: number; caption: string; media: MediaRef; rect: { x: number; y: number; w: number; h: number } }
  | { kind: 'split'; frames: number; caption: string; media: MediaRef; media2: MediaRef }
  | { kind: 'text'; frames: number; text: string }
  | { kind: 'stat'; frames: number; caption: string; media: MediaRef; value: number; suffix: string; label: string; locale: string }
  | { kind: 'badges'; frames: number; caption: string; media: MediaRef; chips: Chip[] }
  | { kind: 'flow'; frames: number; caption: string; steps: FlowShot[] }
  /** Closing line over the outcome screen (no icon card). */
  | { kind: 'outro'; frames: number; title: string; subtitle: string; media: MediaRef };

export interface AppPreviewProps extends Record<string, unknown> {
  look: Look;
  style: PreviewStyle;
  /** Resolved transition per cut (length = scenes.length − 1). */
  transitions: TransitionKind[];
  transitionFrames: number;
  lightLeaks: boolean;
  scenes: Scene[];
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

/** Frames where one scene hands over to the next (the middle of an overlapping transition, or the hard cut). */
export function cutFrames(p: Pick<AppPreviewProps, 'scenes' | 'transitions' | 'transitionFrames'>): number[] {
  const cuts: number[] = [];
  let at = 0;
  p.scenes.slice(0, -1).forEach((s, i) => {
    const cut = p.transitions[i];
    const overlap = cut && cut !== 'none' && cut !== 'leak' ? p.transitionFrames : 0;
    at += s.frames - overlap;
    cuts.push(at + overlap / 2);
  });
  return cuts;
}

/** Seconds each kind of screen change takes inside a flow (a montage cut is instant). */
const CHANGE_SEC = { push: 0.4, sheet: 0.45, scroll: 0.45, fade: 0.25, cut: 0 } as const;

/**
 * Frame timing of a flow: when each step's screen starts to arrive (`arrive`), how long that takes (`change`) and
 * when the finger presses for each tap. Step 0 is there from the start; the others share the rest evenly.
 */
export function flowTiming(steps: Pick<FlowShot, 'tap' | 'change'>[], frames: number, fps: number): { arrive: number[]; change: number[]; taps: Array<number | undefined> } {
  const n = steps.length;
  const lead = Math.min(0.35 * fps, frames * 0.1);
  const slot = (frames - lead) / n;
  const arrive = steps.map((_, i) => (i === 0 ? 0 : Math.round(lead + i * slot)));
  const change = steps.map((s, i) => (i === 0 ? 0 : Math.round(Math.min(CHANGE_SEC[s.change] * fps, slot * 0.45))));
  // The press lands just before the next screen starts to move; a tap on the last step lands mid-step.
  const taps = steps.map((s, i) => (s.tap ? (i < n - 1 ? arrive[i + 1]! - 0.08 * fps : arrive[i]! + (frames - arrive[i]!) * 0.5) : undefined));
  return { arrive, change, taps };
}

/** Most full-screen text cards a preview may have (explicit `text` beats plus kinetic cards): app footage must dominate. */
export const MAX_TEXT_CARDS = 2;

/**
 * Per-style defaults: which cut transitions to cycle through and how long a cut lasts. Cuts are short because
 * beats are short (≈ 2 s); `textCards` = kinetic typography cards before up to MAX_TEXT_CARDS beats.
 */
export const STYLE_DEFAULTS: Record<PreviewStyle, { transitions: TransitionKind[]; transitionFrames: number; lightLeaks: boolean; textCards: boolean }> = {
  classic: { transitions: ['fade'], transitionFrames: 10, lightLeaks: false, textCards: false },
  showcase: { transitions: ['push', 'leak', 'iris', 'leak'], transitionFrames: 12, lightLeaks: true, textCards: false },
  kinetic: { transitions: ['slide', 'push', 'wipe'], transitionFrames: 8, lightLeaks: false, textCards: true },
  energetic: { transitions: ['wipe', 'flip', 'slide'], transitionFrames: 9, lightLeaks: false, textCards: false },
};
