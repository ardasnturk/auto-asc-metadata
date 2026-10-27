import { Video } from '@remotion/media';
import { lightLeak } from '@remotion/effects/light-leak';
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, Sequence, Solid, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { flowTiming, type Chip, type FlowShot, type Look, type MediaRef, type PreviewStyle } from '../types.js';
import { fontStack } from './fonts.js';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outExpo = Easing.bezier(0.16, 1, 0.3, 1);

/**
 * Animated gradient backdrop. Energetic adds moving diagonal stripes. On every cut (`cuts`, frames) the backdrop
 * shifts a little, so the scenes read as one moving camera instead of separate slides.
 */
export const Backdrop: React.FC<{ look: Look; style: PreviewStyle; cuts?: number[] }> = ({ look, style, cuts = [] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps, width, height } = useVideoConfig();
  const [c0, c1 = c0, c2 = c1] = look.background;
  const moved = cuts.map((c) => interpolate(frame, [c - 0.1 * fps, c + 0.5 * fps], [0, 1], { ...clamp, easing: outExpo }));
  // x swings left and right, y keeps climbing: both stay inside the -20 % inset.
  const shiftX = moved.reduce((a, m, i) => a + (i % 2 ? -m : m), 0);
  const shiftY = moved.reduce((a, m) => a + m, 0) / Math.max(cuts.length, 1);
  return (
    <AbsoluteFill style={{ background: c0, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: '-20%',
          filter: 'blur(60px)',
          background: `radial-gradient(40% 32% at 25% 25%, ${c1} 0%, transparent 70%), radial-gradient(45% 35% at 80% 70%, ${c2} 0%, transparent 70%)`,
          rotate: interpolate(frame, [0, durationInFrames], ['0deg', style === 'energetic' ? '50deg' : '20deg']),
          scale: interpolate(frame, [0, durationInFrames / 2, durationInFrames], [1, 1.15, 1]),
          translate: `${shiftX * width * 0.07}px ${-shiftY * height * 0.12}px`,
        }}
      />
      {style === 'energetic' ? (
        <div
          style={{
            position: 'absolute',
            inset: '-50%',
            opacity: 0.12,
            background: `repeating-linear-gradient(-35deg, ${look.accent} 0 18px, transparent 18px 70px)`,
            translate: interpolate(frame, [0, durationInFrames], ['0px 0px', '-420px 0px']),
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * Real app footage: a trimmed recording, or a screenshot with a Ken Burns push. `still` keeps a screenshot
 * unscaled (flow steps: the touch points must stay on the UI they point at).
 */
export const MediaView: React.FC<{ media: MediaRef; still?: boolean }> = ({ media, still }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (media.kind === 'video') {
    return <Video src={staticFile(media.path)} trimBefore={Math.round(media.from * fps)} muted objectFit="cover" style={{ width: '100%', height: '100%' }} />;
  }
  return (
    <Img
      src={staticFile(media.path)}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition: 'top',
        transformOrigin: '50% 30%',
        scale: still ? undefined : interpolate(frame, [0, 3 * fps], [1, 1.05], { ...clamp, easing: Easing.inOut(Easing.quad) }),
      }}
    />
  );
};

/** A touch on the screen: the dot lands, presses at `at` (frame) and leaves a ripple. Position in px of the screen. */
export const TouchIndicator: React.FC<{ x: number; y: number; at: number; size: number }> = ({ x, y, at, size }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const land = at - 0.3 * fps;
  if (frame < land || frame > at + 0.6 * fps) return null;
  return (
    <div style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `${Math.max(1.5, size * 0.06)}px solid rgba(255,255,255,.9)`,
          boxShadow: '0 0 0 1px rgba(0,0,0,.18)',
          scale: interpolate(frame, [at, at + 0.5 * fps], [1, 2.4], { ...clamp, easing: outExpo, output: 'perceptual-scale' }),
          opacity: interpolate(frame, [at, at + 0.5 * fps], [0.85, 0], clamp),
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: 'rgba(255,255,255,.62)',
          border: '1px solid rgba(0,0,0,.2)',
          boxShadow: `0 ${size * 0.08}px ${size * 0.3}px rgba(0,0,0,.35)`,
          scale: interpolate(frame, [land, land + 0.15 * fps, at - 0.05 * fps, at + 0.05 * fps, at + 0.2 * fps], [1.4, 1, 1, 0.8, 0.95], { ...clamp, output: 'perceptual-scale' }),
          opacity: interpolate(frame, [land, land + 0.12 * fps, at + 0.1 * fps, at + 0.3 * fps], [0, 1, 1, 0], clamp),
        }}
      />
    </div>
  );
};

/**
 * The screens of a `flow` beat inside the device (`w`×`h` px): each step holds, a finger taps, and the next screen
 * arrives the way the app shows it — pushed in, raised as a sheet, faded (state change), scrolled up — or as a quick
 * montage cut.
 * `statusBar` is the fraction of the capture the status bar takes; it stays put while the content scrolls.
 */
export const FlowScreens: React.FC<{ steps: FlowShot[]; frames: number; w: number; h: number; dir: 'ltr' | 'rtl'; statusBar: number }> = ({ steps, frames, w, h, dir, statusBar }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { arrive, change, taps } = flowTiming(steps, frames, fps);
  const sign = dir === 'rtl' ? -1 : 1;
  const progress = (i: number) => (i === 0 || change[i] === 0 ? (frame >= arrive[i]! ? 1 : 0) : interpolate(frame, [arrive[i]!, arrive[i]! + change[i]!], [0, 1], { ...clamp, easing: Easing.bezier(0.25, 1, 0.5, 1) }));
  return (
    <>
      {steps.map((s, i) => {
        const start = arrive[i]!;
        const next = steps[i + 1];
        const end = next ? arrive[i + 1]! + change[i + 1]! : frames;
        if (frame < start || frame >= Math.max(end, start + 1)) return null;
        const enter = progress(i);
        const exit = next ? progress(i + 1) : 0;
        const kind = i === 0 ? 'cut' : s.change;
        const moveX = (kind === 'push' ? (1 - enter) * 100 * sign : 0) + (next?.change === 'push' ? -30 * exit * sign : 0);
        // A scroll moves the content under the status bar, so both screens travel the height minus the bar.
        const scroll = 100 - statusBar * 100;
        const moveY = (kind === 'scroll' ? (1 - enter) * scroll : kind === 'sheet' ? (1 - enter) * 100 : 0) + (next?.change === 'scroll' ? -scroll * exit : 0);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              translate: `${moveX}% ${moveY}%`,
              // While it scrolls in, the arriving screen's own status bar is hidden (the held strip shows it).
              clipPath: kind === 'scroll' && statusBar > 0 && enter < 1 ? `inset(${statusBar * 100}% 0 0 0)` : undefined,
              opacity: kind === 'fade' ? enter : 1,
              // A montage cut lands with a small punch; under a rising sheet the screen sinks back a little.
              scale: kind === 'cut' && i > 0 ? interpolate(frame, [start, start + 0.3 * fps], [1.08, 1], { ...clamp, easing: outExpo, output: 'perceptual-scale' }) : next?.change === 'sheet' ? 1 - 0.06 * exit : undefined,
              boxShadow: enter < 1 && kind === 'push' ? `${-sign * w * 0.04}px 0 ${w * 0.08}px rgba(0,0,0,.3)` : enter < 1 && kind === 'sheet' ? `0 ${-w * 0.03}px ${w * 0.08}px rgba(0,0,0,.3)` : undefined,
            }}
          >
            <Sequence from={start} durationInFrames={Math.max(end - start, 1)} layout="none">
              <MediaView media={s.media} still />
              {/* The leaving screen dims under a pushed screen or a sheet, as in iOS. */}
              {(next?.change === 'push' || next?.change === 'sheet') && exit > 0 ? <AbsoluteFill style={{ background: '#000', opacity: 0.22 * exit }} /> : null}
            </Sequence>
          </div>
        );
      })}
      {steps.map((s, i) =>
        s.change === 'scroll' && i > 0 && statusBar > 0 && progress(i) > 0 && progress(i) < 1 ? (
          // The status bar does not scroll: hold the arriving screen's top strip in place.
          <div key={`bar${i}`} style={{ position: 'absolute', left: 0, top: 0, width: w, height: h * statusBar, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }}>
              <Sequence from={arrive[i]!} layout="none">
                <MediaView media={s.media} still />
              </Sequence>
            </div>
          </div>
        ) : null,
      )}
      {steps.map((s, i) => {
        const at = taps[i];
        return s.tap && at !== undefined ? <TouchIndicator key={`tap${i}`} x={s.tap.x * w} y={s.tap.y * h} at={at} size={w * 0.13} /> : null;
      })}
    </>
  );
};

/** Screen rectangle of the device frame at outer width `width` (falls back to the legacy proportions). */
export function screenRect(look: Look, width: number, aspect: number): { x: number; y: number; w: number; h: number; r: number; height: number } {
  const f = look.frame;
  if (f) {
    const k = width / f.width;
    // Fixed-shape displays (Mac, TV, Vision Pro window) keep their own screen; phones follow the media aspect.
    const fixed = look.deviceFamily === 'mac' || look.deviceFamily === 'tv' || look.deviceFamily === 'vision';
    const sh = fixed ? f.screen.h * k : f.screen.w * k * aspect;
    return { x: f.screen.x * k, y: f.screen.y * k, w: f.screen.w * k, h: sh, r: f.screen.r * k, height: (f.height - f.screen.h) * k + sh };
  }
  const ipad = look.deviceFamily === 'ipad';
  const bezel = Math.round(width * (ipad ? 0.022 : 0.032));
  const sw = width - bezel * 2;
  const sh = Math.round(sw * aspect);
  return { x: bezel, y: bezel, w: sw, h: sh, r: Math.round(sw * (ipad ? 0.035 : 0.137)), height: sh + bezel * 2 };
}

/**
 * Device around the media: the same HTML/CSS frame as the screenshots (from @vitrin/render, scaled from its
 * reference width), with the recording dropped into the screen between the bezel and the glare/island layer.
 * `screen` replaces the single recording (a flow of screens); `media` still sets the screen's aspect.
 */
export const Device: React.FC<{ look: Look; media: MediaRef; width: number; screen?: React.ReactNode; children?: React.ReactNode }> = ({ look, media, width, screen, children }) => {
  const f = look.frame;
  const s = screenRect(look, width, media.aspect);
  const shadow = `drop-shadow(0 ${width * 0.06}px ${width * 0.09}px rgba(0,0,0,.4)) drop-shadow(0 ${width * 0.01}px ${width * 0.02}px rgba(0,0,0,.2))`;
  if (!f) {
    return (
      <div style={{ position: 'relative', width, height: s.height, borderRadius: s.r + s.x, background: '#0E0F12', filter: shadow }}>
        <div style={{ position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h, borderRadius: s.r, overflow: 'hidden', background: '#000' }}>
          {screen ?? <MediaView media={media} />}
          {children}
        </div>
      </div>
    );
  }
  const k = width / f.width;
  const stretch = s.height / k / f.height;
  const layer = (html: string) => (
    <div
      style={{ position: 'absolute', left: 0, top: 0, width: f.width, height: f.height, transform: `scale(${k}, ${k * stretch})`, transformOrigin: '0 0', pointerEvents: 'none' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
  return (
    <div style={{ position: 'relative', width, height: s.height, filter: shadow }}>
      {layer(f.under)}
      <div style={{ position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h, borderRadius: s.r, overflow: 'hidden', background: '#000' }}>
        {screen ?? <MediaView media={media} />}
        {children}
      </div>
      {layer(f.over)}
    </div>
  );
};

export function deviceHeight(width: number, look: Look, aspect: number): number {
  return screenRect(look, width, aspect).height;
}

/**
 * How a device arrives, per style, and how the camera keeps moving after it landed (a push-in and a slow drift
 * until the scene ends), so no beat holds a frozen frame. Wraps the device; frame 0 = scene start.
 */
export const DeviceEntrance: React.FC<{ style: PreviewStyle; children: React.ReactNode; durationInFrames: number; tilt?: number }> = ({ style, children, durationInFrames, tilt = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Keyframes after the entrance need a later end frame than the entrance itself.
  const end = Math.max(durationInFrames, fps);
  if (style === 'showcase') {
    // 3D swing-in, then the camera keeps orbiting slightly and pushes in.
    return (
      <div
        style={{
          transform: `perspective(1600px) rotateY(${interpolate(frame, [0, 0.9 * fps, end], [28, 0, -5], { ...clamp, easing: [outExpo, Easing.inOut(Easing.sin)] })}deg) rotateX(${interpolate(frame, [0, 0.9 * fps, end], [8, 0, 2], { ...clamp, easing: [outExpo, Easing.inOut(Easing.sin)] })}deg)`,
          scale: interpolate(frame, [0, 0.9 * fps, end], [0.82, 1, 1.07], { ...clamp, easing: [outExpo, Easing.linear], output: 'perceptual-scale' }),
          opacity: interpolate(frame, [0, 0.35 * fps], [0, 1], clamp),
        }}
      >
        {children}
      </div>
    );
  }
  if (style === 'kinetic') {
    // Punch-in: arrives slightly too big, snaps into place, then pushes in and rises.
    return (
      <div
        style={{
          scale: interpolate(frame, [0, 0.35 * fps, end], [1.18, 1, 1.07], { ...clamp, easing: [Easing.spring({ damping: 14 }), Easing.linear], output: 'perceptual-scale' }),
          translate: interpolate(frame, [0.35 * fps, end], ['0px 0px', '0px -14px'], clamp),
          opacity: interpolate(frame, [0, 0.15 * fps], [0, 1], clamp),
        }}
      >
        {children}
      </div>
    );
  }
  if (style === 'energetic') {
    // Springs in tilted, then keeps swaying and bobbing.
    return (
      <div
        style={{
          rotate: `${interpolate(frame, [0, 0.6 * fps], [tilt - 18, tilt], { ...clamp, easing: Easing.spring({ damping: 9 }) }) + Math.sin((frame / fps) * 2.6) * 2.5}deg`,
          translate: `0px ${interpolate(frame, [0, 0.6 * fps], [600, 0], { ...clamp, easing: Easing.spring({ damping: 12 }) }) + Math.sin((frame / fps) * 3.4) * 8}px`,
          scale: interpolate(frame, [0.6 * fps, end], [1, 1.06], { ...clamp, output: 'perceptual-scale' }),
        }}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      style={{
        translate: interpolate(frame, [0, 0.8 * fps, end], ['0px 80px', '0px 0px', '0px -10px'], { ...clamp, easing: [outExpo, Easing.linear] }),
        scale: interpolate(frame, [0.8 * fps, end], [1, 1.04], { ...clamp, output: 'perceptual-scale' }),
        opacity: interpolate(frame, [0, 0.5 * fps], [0, 1], clamp),
      }}
    >
      {children}
    </div>
  );
};

type Word = { text: string; accent: boolean };

/** Splits `*accent*` markup into words (accent spans may contain several words). */
export function parseWords(text: string): Word[] {
  const out: Word[] = [];
  text.split(/(\*[^*]+\*)/).forEach((part) => {
    const accent = part.startsWith('*') && part.endsWith('*') && part.length > 2;
    const clean = accent ? part.slice(1, -1) : part;
    for (const w of clean.split(/\s+/).filter(Boolean)) out.push({ text: w, accent });
  });
  return out;
}

/**
 * Word-by-word caption. Accent words get the accent colour and an underline that sweeps in.
 * `big` is the kinetic card variant (larger, words pop from scale 1.6 with blur).
 */
export const KineticText: React.FC<{ look: Look; text: string; size: number; delay?: number; align?: 'center' | 'start'; big?: boolean; color?: string; accentColor?: string; underlineColor?: string }> = ({ look, text, size, delay = 0, align = 'center', big, color, accentColor, underlineColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = parseWords(text);
  const step = big ? 0.12 * fps : 0.07 * fps;
  return (
    <div
      dir={look.dir}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        columnGap: size * 0.26,
        rowGap: size * 0.06,
        fontFamily: fontStack(look.headlineFont),
        fontWeight: look.headlineWeight,
        fontSize: size,
        lineHeight: 1.05,
        letterSpacing: '-0.025em',
        color: color ?? look.text,
        textAlign: align === 'center' ? 'center' : 'start',
      }}
    >
      {words.map((w, i) => {
        const start = delay + i * step;
        return (
          <span
            key={i}
            style={{
              position: 'relative',
              display: 'inline-block',
              color: w.accent ? (accentColor ?? look.accent) : undefined,
              opacity: interpolate(frame, [start, start + 0.18 * fps], [0, 1], clamp),
              translate: big ? undefined : interpolate(frame, [start, start + 0.45 * fps], ['0px 40px', '0px 0px'], { ...clamp, easing: outExpo }),
              scale: big ? interpolate(frame, [start, start + 0.4 * fps], [1.6, 1], { ...clamp, easing: outExpo, output: 'perceptual-scale' }) : undefined,
              filter: big ? `blur(${interpolate(frame, [start, start + 0.3 * fps], [12, 0], clamp)}px)` : undefined,
            }}
          >
            {w.text}
            {w.accent ? (
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: -size * 0.06,
                  height: size * 0.09,
                  borderRadius: size,
                  background: underlineColor ?? look.accent,
                  transformOrigin: look.dir === 'rtl' ? 'right' : 'left',
                  scale: `${interpolate(frame, [start + 0.25 * fps, start + 0.6 * fps], [0, 1], { ...clamp, easing: outExpo })} 1`,
                }}
              />
            ) : null}
          </span>
        );
      })}
    </div>
  );
};

/** Number that counts up, formatted for the locale. */
export const Counter: React.FC<{ look: Look; value: number; suffix: string; locale: string; size: number }> = ({ look, value, suffix, locale, size }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = interpolate(frame, [0.2 * fps, 1.4 * fps], [0, value], { ...clamp, easing: Easing.out(Easing.cubic) });
  const digits = Number.isInteger(value) ? 0 : 1;
  return (
    <div
      style={{
        fontFamily: fontStack(look.headlineFont),
        fontWeight: 850,
        fontSize: size,
        lineHeight: 0.95,
        letterSpacing: '-0.04em',
        color: look.accent,
        fontVariantNumeric: 'tabular-nums',
        scale: interpolate(frame, [1.3 * fps, 1.45 * fps, 1.65 * fps], [1, 1.08, 1], { ...clamp, output: 'perceptual-scale' }),
      }}
    >
      {v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}
      {suffix ? <span style={{ fontSize: size * 0.45, marginInlineStart: size * 0.08 }}>{suffix}</span> : null}
    </div>
  );
};

/** Feature chip that pops in on a spring and keeps floating. */
export const ChipView: React.FC<{ look: Look; chip: Chip; size: number; delay: number; phase: number; sticker?: boolean }> = ({ look, chip, size, delay, phase, sticker }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bg = sticker ? look.accent : look.badgeBackground;
  const fg = sticker ? '#FFFFFF' : look.badgeText;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.45,
        padding: `${size * 0.55}px ${size * 0.9}px`,
        borderRadius: sticker ? size * 0.6 : 999,
        background: bg,
        color: fg,
        fontFamily: fontStack(look.bodyFont),
        fontWeight: 700,
        fontSize: size,
        whiteSpace: 'nowrap',
        boxShadow: `0 ${size * 0.5}px ${size * 1.6}px rgba(0,0,0,.3)`,
        scale: interpolate(frame, [delay, delay + 0.45 * fps], [0, 1], { ...clamp, easing: Easing.spring({ damping: 11 }), output: 'perceptual-scale' }),
        translate: `0px ${Math.sin((frame / fps) * 1.6 + phase) * size * 0.25}px`,
        rotate: sticker ? '-5deg' : '0deg',
      }}
    >
      <span style={{ display: 'inline-flex', width: size * 1.2, height: size * 1.2 }} dangerouslySetInnerHTML={{ __html: chip.iconSvg.replace(/stroke="[^"]*"/, `stroke="${fg}"`).replace(/width="\d+"/, `width="${Math.round(size * 1.2)}"`).replace(/height="\d+"/, `height="${Math.round(size * 1.2)}"`) }} />
      {chip.label}
    </div>
  );
};

/** Light leak over a cut point (WebGL effect from @remotion/effects). */
export const LightLeakOverlay: React.FC<{ seed: number; hueShift: number }> = ({ seed, hueShift }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  return (
    <Solid
      width={width}
      height={height}
      // Screen blend at 70 % keeps the UI readable at the peak of the leak.
      style={{ mixBlendMode: 'screen', opacity: 0.7 }}
      effects={[lightLeak({ seed, hueShift, progress: interpolate(frame, [0, durationInFrames - 1], [0, 1], clamp) })]}
    />
  );
};
