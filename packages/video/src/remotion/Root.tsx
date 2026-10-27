import React from 'react';
import { Composition } from 'remotion';
import { compositionSize, FPS_PREVIEW, previewDurationFrames, type AppPreviewProps, type LoopProps } from '../types.js';
import { AppPreview, Loop } from './compositions.js';

const defaultLook = {
  background: ['#101028', '#2B2D7A', '#6C3CE0'],
  accent: '#FFB547',
  text: '#FFFFFF',
  textMuted: '#C9CBF2',
  surface: '#1B1C3F',
  badgeBackground: '#FFFFFF',
  badgeText: '#1B1C3F',
  headlineFont: 'Inter',
  bodyFont: 'Inter',
  headlineWeight: 800,
  dir: 'ltr' as const,
  deviceFamily: 'iphone' as 'iphone' | 'ipad' | 'mac' | 'tv' | 'vision',
  aspect: 2622 / 1206,
};

const placeholder = { path: 'placeholder.png', kind: 'image' as const, from: 0, aspect: 2622 / 1206 };
const defaultPreview: AppPreviewProps = {
  look: defaultLook,
  style: 'showcase',
  transitions: ['push', 'leak', 'iris'],
  transitionFrames: 12,
  lightLeaks: true,
  scenes: [
    { kind: 'hook', frames: 66, text: 'One tap, *every day*', media: placeholder },
    {
      kind: 'flow',
      frames: 120,
      caption: 'Check it *off*',
      steps: [
        { media: placeholder, tap: { x: 0.5, y: 0.4 }, change: 'push' },
        { media: placeholder, tap: { x: 0.8, y: 0.12 }, change: 'fade' },
        { media: placeholder, change: 'scroll' },
      ],
    },
    { kind: 'device', frames: 66, caption: 'See your *progress*', media: placeholder },
    { kind: 'outro', frames: 72, title: 'Find your *rhythm*', subtitle: '', media: placeholder },
  ],
};

const defaultLoop: LoopProps = { look: defaultLook, copy: 'Copy', media: [], durationSec: 10, layout: 'header' };

/**
 * Compositions are authored at half the delivery size and rendered with `scale: 2`:
 * AppPreview iPhone 443×960 → 886×1920, iPad 600×800 → 1200×1600, Mac/TV 960×540 → 1920×1080, Header 1920×823 → 3840×1646, Search 1920×1280 → 3840×2560.
 */
export const Root: React.FC = () => (
  <>
    <Composition
      id="AppPreview"
      component={AppPreview}
      width={443}
      height={960}
      fps={FPS_PREVIEW}
      durationInFrames={450}
      defaultProps={defaultPreview}
      calculateMetadata={({ props }) => ({
        durationInFrames: previewDurationFrames(props),
        ...compositionSize(props.look.deviceFamily),
      })}
    />
    <Composition
      id="HeaderLoop"
      component={Loop}
      width={1920}
      height={823}
      fps={30}
      durationInFrames={300}
      defaultProps={{ ...defaultLoop, layout: 'header' }}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(props.durationSec * 30) })}
    />
    <Composition
      id="SearchLoop"
      component={Loop}
      width={1920}
      height={1280}
      fps={30}
      durationInFrames={300}
      defaultProps={{ ...defaultLoop, layout: 'search' }}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(props.durationSec * 30) })}
    />
    <Composition
      id="EventCard"
      component={Loop}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={450}
      defaultProps={{ ...defaultLoop, layout: 'event', durationSec: 15 }}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(props.durationSec * 30) })}
    />
  </>
);
