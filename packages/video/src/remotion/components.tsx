import React from 'react';
import { AbsoluteFill, Img, interpolate, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Look, MediaRef } from '../types.js';
import { fontStack } from './fonts.js';

export const Backdrop: React.FC<{ look: Look; drift?: number }> = ({ look, drift = 0 }) => {
  const [c0, c1 = c0, c2 = c1] = look.background;
  const x = 20 + 10 * Math.sin(drift * Math.PI * 2);
  const y = 15 + 8 * Math.cos(drift * Math.PI * 2);
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(70% 50% at ${x}% ${y}%, ${c1} 0%, transparent 70%), radial-gradient(60% 45% at ${100 - x}% ${100 - y}%, ${c2} 0%, transparent 70%), ${c0}`,
      }}
    />
  );
};

/** Frame for real app footage. `media.kind === 'image'` gets a slow zoom so stills never look frozen. */
export const Device: React.FC<{ look: Look; media: MediaRef; width: number; style?: React.CSSProperties; zoom?: boolean }> = ({ look, media, width, style, zoom = true }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ipad = look.deviceFamily === 'ipad';
  const bezel = Math.round(width * (ipad ? 0.022 : 0.032));
  const sw = width - bezel * 2;
  const sh = Math.round(sw * look.aspect);
  const r = Math.round(sw * (ipad ? 0.035 : 0.137));
  const scale = media.kind === 'image' && zoom ? interpolate(frame, [0, fps * 6], [1, 1.06], { extrapolateRight: 'clamp' }) : 1;
  const src = staticFile(media.path);
  return (
    <div style={{ position: 'absolute', width, height: sh + bezel * 2, borderRadius: r + bezel, background: '#0E0F12', boxShadow: `0 ${width * 0.06}px ${width * 0.14}px rgba(0,0,0,.35)`, ...style }}>
      <div style={{ position: 'absolute', left: bezel, top: bezel, width: sw, height: sh, borderRadius: r, overflow: 'hidden', background: '#000' }}>
        {media.kind === 'video' ? (
          <OffthreadVideo src={src} startFrom={Math.round(media.from * fps)} muted style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
        ) : (
          <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', transform: `scale(${scale})`, transformOrigin: '50% 30%' }} />
        )}
      </div>
      {!ipad && (
        <div style={{ position: 'absolute', left: '50%', top: bezel + sw * 0.027, transform: 'translateX(-50%)', width: sw * 0.31, height: sw * 0.092, borderRadius: 999, background: '#000' }} />
      )}
    </div>
  );
};

export const Title: React.FC<{ look: Look; text: string; size: number; color?: string; weight?: number; style?: React.CSSProperties; body?: boolean }> = ({ look, text, size, color, weight, style, body }) => (
  <div
    dir={look.dir}
    style={{
      fontFamily: fontStack(body ? look.bodyFont : look.headlineFont),
      fontSize: size,
      fontWeight: weight ?? (body ? 500 : look.headlineWeight),
      color: color ?? (body ? look.textMuted : look.text),
      lineHeight: body ? 1.25 : 1.06,
      letterSpacing: body ? 0 : '-0.02em',
      textAlign: 'center',
      textWrap: 'balance',
      ...style,
    }}
  >
    {text}
  </div>
);
