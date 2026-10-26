import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { isLandscape, type AppPreviewProps, type Look, type MediaRef, type PreviewStyle, type Scene } from '../types.js';
import { fontStack } from './fonts.js';
import { ChipView, Counter, Device, DeviceEntrance, deviceHeight, KineticText, screenRect } from './kit.js';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outExpo = Easing.bezier(0.16, 1, 0.3, 1);

type SceneProps<K extends Scene['kind']> = { scene: Extract<Scene, { kind: K }>; look: Look; style: PreviewStyle };

/** Caption block at the top of a scene. Energetic puts it on an accent banner. */
const Caption: React.FC<{ look: Look; style: PreviewStyle; text: string; big?: boolean }> = ({ look, style, text, big }) => {
  const { width, height } = useVideoConfig();
  const wide = isLandscape(look.deviceFamily);
  // Landscape (Mac, TV): the caption is a column on the left, the device fills the right.
  const size = Math.round(wide ? height * (big ? 0.12 : 0.1) : width * (big ? 0.105 : 0.085));
  const box: React.CSSProperties = wide ? { top: 0, bottom: 0, left: width * 0.06, width: width * 0.36, alignItems: 'center' } : { top: height * 0.065, left: width * 0.07, right: width * 0.07 };
  return (
    <div style={{ position: 'absolute', ...box, display: 'flex', justifyContent: wide ? 'flex-start' : 'center' }}>
      {style === 'energetic' ? (
        <Banner look={look}>
          {/* On the accent banner the accent colour would vanish: accent words switch to the dark badge colour. */}
          <KineticText look={look} text={text} size={size} color="#FFFFFF" accentColor={look.badgeText} underlineColor="#FFFFFF" align={wide ? 'start' : 'center'} />
        </Banner>
      ) : (
        <KineticText look={look} text={text} size={size} align={wide ? 'start' : 'center'} />
      )}
    </div>
  );
};

const Banner: React.FC<{ look: Look; children: React.ReactNode }> = ({ look, children }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  return (
    <div
      style={{
        background: look.accent,
        padding: `${width * 0.025}px ${width * 0.045}px`,
        borderRadius: width * 0.04,
        rotate: '-3deg',
        transformOrigin: 'left center',
        scale: `${interpolate(frame, [0, 0.3 * fps], [0, 1], { ...clamp, easing: outExpo })} 1`,
      }}
    >
      {children}
    </div>
  );
};

/** Device sized to the area under the caption; it may bleed off the bottom a little. */
function useDeviceBox(media: MediaRef, look: Look, widthRatio = 0.8) {
  const { width, height } = useVideoConfig();
  if (isLandscape(look.deviceFamily)) {
    const areaW = width * 0.52;
    const probe = deviceHeight(1000, look, media.aspect) / 1000;
    const w = Math.min(areaW, (height * 0.8) / probe);
    const h = deviceHeight(w, look, media.aspect);
    return { top: (height - h) / 2, w, left: width * 0.44 + (areaW - w) / 2, h };
  }
  const top = height * 0.25;
  const w = Math.min(width * widthRatio, (height - top + height * 0.06) / media.aspect);
  return { top, w, left: (width - w) / 2, h: deviceHeight(w, look, media.aspect) };
}

const DeviceAt: React.FC<{ look: Look; style: PreviewStyle; media: MediaRef; frames: number; widthRatio?: number; tilt?: number; children?: React.ReactNode }> = ({ look, style, media, frames, widthRatio, tilt, children }) => {
  const box = useDeviceBox(media, look, widthRatio);
  return (
    <div style={{ position: 'absolute', left: box.left, top: box.top }}>
      <DeviceEntrance style={style} durationInFrames={frames} tilt={tilt}>
        <Device look={look} media={{ ...media, aspect: media.aspect }} width={box.w} />
        {children}
      </DeviceEntrance>
    </div>
  );
};

export const HookScene: React.FC<SceneProps<'hook'>> = ({ scene, look, style }) => (
  <AbsoluteFill>
    <Caption look={look} style={style} text={scene.text} big />
    <DeviceAt look={look} style={style} media={scene.media} frames={scene.frames} widthRatio={0.84} tilt={style === 'energetic' ? -6 : 0} />
  </AbsoluteFill>
);

export const DeviceScene: React.FC<SceneProps<'device'>> = ({ scene, look, style }) => (
  <AbsoluteFill>
    <Caption look={look} style={style} text={scene.caption} />
    <DeviceAt look={look} style={style} media={scene.media} frames={scene.frames} tilt={style === 'energetic' ? 5 : 0} />
  </AbsoluteFill>
);

/** Camera flies into a region of the real UI and a ring marks it. */
export const ZoomScene: React.FC<SceneProps<'zoom'>> = ({ scene, look, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const box = useDeviceBox(scene.media, look);
  const r = scene.rect;
  const sr = screenRect(look, box.w, scene.media.aspect);
  const bezel = sr.x;
  const bezelTop = sr.y;
  const sw = sr.w;
  const sh = sr.h;
  // Region centre in canvas coordinates, and the zoom that makes it ~86 % of the canvas width.
  const cx = box.left + bezel + (r.x + r.w / 2) * sw;
  const cy = box.top + bezelTop + (r.y + r.h / 2) * sh;
  const zoom = Math.min(2.6, (width * 0.96) / (r.w * sw));
  const t = interpolate(frame, [0.6 * fps, 1.5 * fps], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  // The zoomed layer is clipped below the caption so the UI never runs over the text.
  const clipTop = isLandscape(look.deviceFamily) ? 0 : height * 0.22;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `inset(${clipTop * t}px 0px 0px 0px round ${width * 0.06 * t}px)` }}>
      <AbsoluteFill
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          scale: 1 + (zoom - 1) * t,
          translate: `${((isLandscape(look.deviceFamily) ? width * 0.7 : width / 2) - cx) * t}px ${((isLandscape(look.deviceFamily) ? height * 0.5 : height * 0.62) - cy) * t}px`,
        }}
      >
        <DeviceAt look={look} style={style} media={scene.media} frames={scene.frames}>
          <div
            style={{
              position: 'absolute',
              left: bezel + r.x * sw - 6,
              top: bezelTop + r.y * sh - 6,
              width: r.w * sw + 12,
              height: r.h * sh + 12,
              borderRadius: sw * 0.05,
              border: `${Math.max(2, sw * 0.008)}px solid ${look.accent}`,
              boxShadow: `0 0 ${sw * 0.06}px ${look.accent}`,
              opacity: interpolate(frame, [1.3 * fps, 1.7 * fps], [0, 1], clamp),
            }}
          />
        </DeviceAt>
      </AbsoluteFill>
      </AbsoluteFill>
      <Caption look={look} style={style} text={scene.caption} />
    </AbsoluteFill>
  );
};

export const SplitScene: React.FC<SceneProps<'split'>> = ({ scene, look, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const wide = isLandscape(look.deviceFamily);
  const w = wide ? width * 0.3 : Math.min(width * 0.47, (height * 0.7) / scene.media.aspect);
  const enter = (delay: number, from: number) =>
    interpolate(frame, [delay, delay + 0.7 * fps], [from, 0], { ...clamp, easing: style === 'energetic' ? Easing.spring({ damping: 12 }) : outExpo });
  return (
    <AbsoluteFill>
      <Caption look={look} style={style} text={scene.caption} />
      <div style={{ position: 'absolute', top: wide ? height * 0.16 : height * 0.27, left: wide ? width * 0.42 : width / 2 - w * 0.96, rotate: wide ? '0deg' : '-4deg', translate: `${enter(0, -width)}px 0px` }}>
        <Device look={look} media={scene.media} width={w} />
      </div>
      <div style={{ position: 'absolute', top: wide ? height * 0.34 : height * 0.31, left: wide ? width * 0.66 : width / 2 - w * 0.04, rotate: wide ? '0deg' : '4deg', translate: `${enter(0.15 * fps, width)}px 0px` }}>
        <Device look={look} media={scene.media2} width={w} />
      </div>
    </AbsoluteFill>
  );
};

/** Full-screen kinetic typography card. */
export const TextScene: React.FC<SceneProps<'text'>> = ({ scene, look, style }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: width * 0.08 }}>
      {style === 'kinetic' ? (
        // A wash of accent colour that sweeps across behind the words.
        <AbsoluteFill
          style={{
            background: look.accent,
            opacity: 0.18,
            transformOrigin: 'left',
            scale: `${interpolate(frame, [0, 0.35 * fps], [0, 1], { ...clamp, easing: outExpo })} 1`,
          }}
        />
      ) : null}
      <KineticText look={look} text={scene.text} size={Math.round(width * 0.14)} big />
    </AbsoluteFill>
  );
};

export const StatScene: React.FC<SceneProps<'stat'>> = ({ scene, look, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  // Large device bleeding off the bottom, under the counter block.
  const wide = isLandscape(look.deviceFamily);
  const box = useDeviceBox(scene.media, look);
  const w = wide ? box.w : Math.min(width * 0.74, (height * 0.7) / scene.media.aspect);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: wide ? height * 0.22 : height * 0.06, left: 0, right: wide ? width * 0.58 : 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: height * 0.01 }}>
        <Counter look={look} value={scene.value} suffix={scene.suffix} locale={scene.locale} size={Math.round(width * 0.24)} />
        <div style={{ fontFamily: fontStack(look.bodyFont), fontWeight: 600, fontSize: width * 0.05, color: look.textMuted, opacity: interpolate(frame, [0.5 * fps, 0.9 * fps], [0, 1], clamp) }}>{scene.label}</div>
        <div style={{ marginTop: height * 0.01, padding: `0 ${width * 0.07}px` }}>
          <KineticText look={look} text={scene.caption} size={Math.round(width * 0.07)} delay={0.6 * fps} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: wide ? box.left : (width - w) / 2, top: wide ? box.top : height * 0.42 }}>
        <DeviceEntrance style={style} durationInFrames={scene.frames}>
          <Device look={look} media={scene.media} width={w} />
        </DeviceEntrance>
      </div>
    </AbsoluteFill>
  );
};

export const BadgesScene: React.FC<SceneProps<'badges'>> = ({ scene, look, style }) => {
  const { fps, width, height } = useVideoConfig();
  const wide = isLandscape(look.deviceFamily);
  const landscapeBox = useDeviceBox(scene.media, look);
  const box = wide ? landscapeBox : { top: height * 0.25, w: Math.min(width * 0.72, (height * 0.8) / scene.media.aspect) };
  const left = wide ? landscapeBox.left : (width - box.w) / 2;
  const size = Math.round(wide ? height * 0.045 : width * 0.04);
  return (
    <AbsoluteFill>
      <Caption look={look} style={style} text={scene.caption} />
      <div style={{ position: 'absolute', left, top: box.top }}>
        <DeviceEntrance style={style} durationInFrames={scene.frames}>
          <Device look={look} media={scene.media} width={box.w} />
        </DeviceEntrance>
      </div>
      {scene.chips.map((chip, i) => {
        const right = i % 2 === 1;
        return (
          <div key={i} style={{ position: 'absolute', top: box.top + height * (0.12 + i * 0.13), ...(right ? { right: width * 0.04 } : { left: width * 0.04 }) }}>
            <ChipView look={look} chip={chip} size={size} delay={0.5 * fps + i * 0.25 * fps} phase={i} sticker={style === 'energetic' && i === 0} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const OutroScene: React.FC<SceneProps<'outro'> & { icon?: string }> = ({ scene, look, icon }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const iconSize = width * 0.28;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: height * 0.025 }}>
      {icon ? (
        <div style={{ position: 'relative', width: iconSize, height: iconSize }}>
          {/* Expanding ring pulse behind the icon */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: iconSize * 0.3,
              border: `${iconSize * 0.03}px solid ${look.accent}`,
              scale: interpolate(frame, [0.3 * fps, 1.3 * fps], [1, 1.8], { ...clamp, easing: Easing.out(Easing.cubic) }),
              opacity: interpolate(frame, [0.3 * fps, 1.3 * fps], [0.8, 0], clamp),
            }}
          />
          <Img
            src={staticFile(icon)}
            style={{
              width: iconSize,
              height: iconSize,
              borderRadius: iconSize * 0.225,
              boxShadow: '0 20px 60px rgba(0,0,0,.45)',
              scale: interpolate(frame, [0, 0.6 * fps], [0.3, 1], { ...clamp, easing: Easing.spring({ damping: 10 }), output: 'perceptual-scale' }),
              rotate: interpolate(frame, [0, 0.6 * fps], ['-20deg', '0deg'], { ...clamp, easing: outExpo }),
            }}
          />
        </div>
      ) : null}
      <div style={{ padding: `0 ${width * 0.08}px` }}>
        <KineticText look={look} text={scene.title} size={Math.round(width * 0.12)} delay={0.35 * fps} big />
      </div>
      {scene.subtitle ? (
        <div
          style={{
            fontFamily: fontStack(look.bodyFont),
            fontSize: width * 0.05,
            fontWeight: 500,
            color: look.textMuted,
            textAlign: 'center',
            padding: `0 ${width * 0.1}px`,
            opacity: interpolate(frame, [0.8 * fps, 1.2 * fps], [0, 1], clamp),
            translate: interpolate(frame, [0.8 * fps, 1.2 * fps], ['0px 20px', '0px 0px'], { ...clamp, easing: outExpo }),
          }}
        >
          {scene.subtitle}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export function renderScene(scene: Scene, p: Pick<AppPreviewProps, 'look' | 'style' | 'icon'>): React.ReactNode {
  const common = { look: p.look, style: p.style };
  switch (scene.kind) {
    case 'hook':
      return <HookScene scene={scene} {...common} />;
    case 'device':
      return <DeviceScene scene={scene} {...common} />;
    case 'zoom':
      return <ZoomScene scene={scene} {...common} />;
    case 'split':
      return <SplitScene scene={scene} {...common} />;
    case 'text':
      return <TextScene scene={scene} {...common} />;
    case 'stat':
      return <StatScene scene={scene} {...common} />;
    case 'badges':
      return <BadgesScene scene={scene} {...common} />;
    case 'outro':
      return <OutroScene scene={scene} {...common} icon={p.icon} />;
  }
}
