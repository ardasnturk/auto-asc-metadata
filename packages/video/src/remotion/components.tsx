import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { Look, MediaRef } from '../types.js';
import { fontStack } from './fonts.js';
import { Device as KitDevice } from './kit.js';

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

/** Frame for real app footage in the loops: the shared device frame, absolutely positioned by `style`. */
export const Device: React.FC<{ look: Look; media: MediaRef; width: number; style?: React.CSSProperties; zoom?: boolean }> = ({ look, media, width, style }) => (
  <div style={{ position: 'absolute', ...style }}>
    <KitDevice look={look} media={media} width={width} />
  </div>
);

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
