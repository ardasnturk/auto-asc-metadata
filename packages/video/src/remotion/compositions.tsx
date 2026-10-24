import { linearTiming, TransitionSeries, type TransitionPresentation } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { flip } from '@remotion/transitions/flip';
import { iris } from '@remotion/transitions/iris';
import { pushCut } from '@remotion/transitions/push-cut';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import React from 'react';
import { AbsoluteFill, Easing, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AppPreviewProps, LoopProps, TransitionKind } from '../types.js';
import { Backdrop as LoopBackdrop, Device as LoopDevice, Title } from './components.js';
import { Backdrop, LightLeakOverlay } from './kit.js';
import { renderScene } from './scenes.js';

const ease = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const SLIDE_DIRS = ['from-right', 'from-left', 'from-bottom'] as const;
const WIPE_DIRS = ['from-left', 'from-top-right', 'from-bottom', 'from-right'] as const;

/** Maps a cut kind to a @remotion/transitions presentation; directions alternate along the video. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function presentationFor(kind: TransitionKind, index: number, accent: string, width: number, height: number): TransitionPresentation<any> {
  switch (kind) {
    case 'slide':
      return slide({ direction: SLIDE_DIRS[index % SLIDE_DIRS.length] });
    case 'wipe':
      return wipe({ direction: WIPE_DIRS[index % WIPE_DIRS.length] });
    case 'flip':
      return flip({ direction: index % 2 ? 'from-left' : 'from-right' });
    case 'push':
      return pushCut({ flashColor: accent, flashOpacity: 0.35 });
    case 'iris':
      return iris({ width, height });
    default:
      return fade();
  }
}

/**
 * App Preview: a TransitionSeries of scenes (hook → beats → outro) over an animated backdrop.
 * Cuts use the style's transitions; `leak` cuts are hard cuts covered by a light-leak overlay.
 */
export const AppPreview: React.FC<AppPreviewProps> = (props) => {
  const { width, height } = useVideoConfig();
  const timing = linearTiming({ durationInFrames: props.transitionFrames, easing: Easing.bezier(0.65, 0, 0.35, 1) });
  const children: React.ReactNode[] = [];
  props.scenes.forEach((scene, i) => {
    children.push(
      <TransitionSeries.Sequence key={`s${i}`} name={`${i + 1}. ${scene.kind}`} durationInFrames={scene.frames}>
        {renderScene(scene, props)}
      </TransitionSeries.Sequence>,
    );
    const cut = props.transitions[i];
    if (i === props.scenes.length - 1 || !cut || cut === 'none') return;
    if (cut === 'leak') {
      children.push(
        <TransitionSeries.Overlay key={`o${i}`} durationInFrames={24}>
          <LightLeakOverlay seed={i * 7 + 3} hueShift={i * 40} />
        </TransitionSeries.Overlay>,
      );
    } else {
      children.push(<TransitionSeries.Transition key={`t${i}`} presentation={presentationFor(cut, i, props.look.accent, width, height)} timing={timing} />);
    }
  });
  return (
    <AbsoluteFill>
      <Backdrop look={props.look} style={props.style} />
      <TransitionSeries>{children}</TransitionSeries>
    </AbsoluteFill>
  );
};

/**
 * Seamless loop for the product page header (21:9), search results (3:2) and event cards (16:9).
 * Devices drift on a strip whose offset is periodic in the composition length, so frame N == frame 0.
 * Search results play muted, so all meaning is carried by the text.
 */
export const Loop: React.FC<LoopProps> = (props) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;
  const look = props.look;
  const deviceH = height * (props.layout === 'header' ? 0.86 : 0.78);
  const deviceW = deviceH / look.aspect;
  const gap = deviceW * 0.18;
  const n = Math.max(props.media.length, 1);
  const strip = n * (deviceW + gap);
  const textW = width * (props.layout === 'search' ? 0.44 : 0.4);
  const areaLeft = textW + width * 0.08;
  const offset = -t * strip;
  const items: React.ReactElement[] = [];
  for (let k = 0; k < Math.ceil((width - areaLeft) / strip) + 2; k++) {
    props.media.forEach((m, i) => {
      const x = areaLeft + offset + k * strip + i * (deviceW + gap);
      const bob = Math.sin((t + i / n) * Math.PI * 2) * height * 0.02;
      items.push(<LoopDevice key={`${k}-${i}`} look={look} media={m} width={deviceW} zoom={false} style={{ left: x, top: (height - deviceH) / 2 + bob + height * 0.06 }} />);
    });
  }
  return (
    <AbsoluteFill>
      <LoopBackdrop look={look} drift={t} />
      <AbsoluteFill style={{ overflow: 'hidden', clipPath: `inset(0 0 0 ${areaLeft - width * 0.03}px)` }}>{items}</AbsoluteFill>
      <div style={{ position: 'absolute', left: width * 0.05, top: 0, bottom: 0, width: textW, display: 'flex', alignItems: 'center' }}>
        <Title look={look} text={props.copy} size={Math.round(height * 0.11)} style={{ textAlign: look.dir === 'rtl' ? 'right' : 'left' }} />
      </div>
    </AbsoluteFill>
  );
};
