import { Video } from '@remotion/media';
import { lightLeak } from '@remotion/effects/light-leak';
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, Solid, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Chip, Look, MediaRef, PreviewStyle } from '../types.js';
import { fontStack } from './fonts.js';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outExpo = Easing.bezier(0.16, 1, 0.3, 1);

/** Animated gradient backdrop. Energetic adds moving diagonal stripes. */
export const Backdrop: React.FC<{ look: Look; style: PreviewStyle }> = ({ look, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const [c0, c1 = c0, c2 = c1] = look.background;
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

/** Real app footage: a trimmed recording, or a screenshot with a slow Ken Burns push. */
export const MediaView: React.FC<{ media: MediaRef }> = ({ media }) => {
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
        scale: interpolate(frame, [0, 6 * fps], [1, 1.06], { ...clamp, easing: Easing.inOut(Easing.quad) }),
      }}
    />
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
 */
export const Device: React.FC<{ look: Look; media: MediaRef; width: number; children?: React.ReactNode }> = ({ look, media, width, children }) => {
  const f = look.frame;
  const s = screenRect(look, width, media.aspect);
  const shadow = `drop-shadow(0 ${width * 0.06}px ${width * 0.09}px rgba(0,0,0,.4)) drop-shadow(0 ${width * 0.01}px ${width * 0.02}px rgba(0,0,0,.2))`;
  if (!f) {
    return (
      <div style={{ position: 'relative', width, height: s.height, borderRadius: s.r + s.x, background: '#0E0F12', filter: shadow }}>
        <div style={{ position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h, borderRadius: s.r, overflow: 'hidden', background: '#000' }}>
          <MediaView media={media} />
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
        <MediaView media={media} />
        {children}
      </div>
      {layer(f.over)}
    </div>
  );
};

export function deviceHeight(width: number, look: Look, aspect: number): number {
  return screenRect(look, width, aspect).height;
}

/** How a device arrives, per style. Wraps the device; frame 0 = scene start. */
export const DeviceEntrance: React.FC<{ style: PreviewStyle; children: React.ReactNode; durationInFrames: number; tilt?: number }> = ({ style, children, durationInFrames, tilt = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (style === 'showcase') {
    // 3D swing-in + slow camera push for the rest of the scene.
    return (
      <div
        style={{
          transform: `perspective(1600px) rotateY(${interpolate(frame, [0, 0.9 * fps], [28, 0], { ...clamp, easing: outExpo })}deg) rotateX(${interpolate(frame, [0, 0.9 * fps], [8, 0], { ...clamp, easing: outExpo })}deg)`,
          scale: interpolate(frame, [0, 0.9 * fps, durationInFrames], [0.82, 1, 1.05], { ...clamp, easing: [outExpo, Easing.linear], output: 'perceptual-scale' }),
          opacity: interpolate(frame, [0, 0.35 * fps], [0, 1], clamp),
        }}
      >
        {children}
      </div>
    );
  }
  if (style === 'kinetic') {
    // Punch-in: arrives slightly too big and snaps into place.
    return (
      <div
        style={{
          scale: interpolate(frame, [0, 0.35 * fps], [1.18, 1], { ...clamp, easing: Easing.spring({ damping: 14 }), output: 'perceptual-scale' }),
          opacity: interpolate(frame, [0, 0.15 * fps], [0, 1], clamp),
        }}
      >
        {children}
      </div>
    );
  }
  if (style === 'energetic') {
    return (
      <div
        style={{
          rotate: `${interpolate(frame, [0, 0.6 * fps], [tilt - 18, tilt], { ...clamp, easing: Easing.spring({ damping: 9 }) }) + Math.sin((frame / fps) * 2.2) * 1.5}deg`,
          translate: interpolate(frame, [0, 0.6 * fps], ['0px 600px', '0px 0px'], { ...clamp, easing: Easing.spring({ damping: 12 }) }),
        }}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      style={{
        translate: interpolate(frame, [0, 0.8 * fps], ['0px 80px', '0px 0px'], { ...clamp, easing: outExpo }),
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
