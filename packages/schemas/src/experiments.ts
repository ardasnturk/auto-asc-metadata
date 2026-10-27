import { z } from 'zod';
import { AscLocale, Timestamp } from './common.js';
import { ShotCopy } from './design.js';

/** One treatment of a Product Page Optimization test: what differs from the original product page. */
export const ExperimentTreatment = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Treatment name in App Store Connect. */
  name: z.string().min(1).max(64),
  /** The one thing that differs from the original, in a sentence. */
  change: z.string().min(1),
  /** Shot ids from shots.json in this treatment's order; empty = the original order. */
  shots: z.array(z.string()).default([]),
  /** Per-shot copy for this treatment: `{ "<shot id>": { "<locale>": { headline, subheadline?, kicker? } } }`. */
  copy: z.record(z.string(), z.record(AscLocale, ShotCopy)).default({}),
  /** Icon test: the alternate app icon's name in the binary (it has to ship in the build under review). */
  appIconName: z.string().optional(),
});
export type ExperimentTreatment = z.infer<typeof ExperimentTreatment>;

/**
 * A Product Page Optimization test (App Store, organic traffic): up to three treatments against the original, one
 * test at a time, 7–90 days, a winner only at ≥ 90 % confidence.
 */
export const Experiment = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Test name in App Store Connect. */
  name: z.string().min(1).max(64),
  element: z.enum(['screenshots', 'icon']).default('screenshots'),
  /** "If we <change>, <metric> will <improve> because <reason>." */
  hypothesis: z.string().min(1),
  metric: z.string().default('conversion rate'),
  /** Smallest relative lift worth detecting (0.1 = +10 %). */
  minimumDetectableEffect: z.number().min(0.01).max(1).default(0.1),
  /** Share of product page visitors that enter the test, in percent (App Store Connect `trafficProportion`). */
  trafficProportion: z.number().int().min(1).max(100).default(50),
  /** From App Store Connect → Analytics, for the duration estimate. */
  dailyPageViews: z.number().positive().optional(),
  /** Current product page conversion rate (0.3 = 30 %). */
  baselineConversion: z.number().min(0.001).max(1).optional(),
  /** Locales the treatments are made for (default: every store locale). */
  locales: z.array(AscLocale).optional(),
  treatments: z.array(ExperimentTreatment).min(1).max(3),
  /** Written after the test ended, from what App Store Connect showed; it decides the next test. */
  result: z
    .object({
      endedAt: Timestamp,
      /** `original`, a treatment id, or `inconclusive`. */
      winner: z.string(),
      liftPct: z.number().optional(),
      confidence: z.number().min(0).max(1).optional(),
      notes: z.string().default(''),
    })
    .optional(),
});
export type Experiment = z.infer<typeof Experiment>;

/** `metadata/experiments.json` — written by Claude; `vitrin upload --experiment <id>` creates one test. */
export const ExperimentPlan = z.object({ experiments: z.array(Experiment).default([]) });
export type ExperimentPlan = z.infer<typeof ExperimentPlan>;

/**
 * Days until each arm has the sample a two-sided 95 % test with 80 % power needs to see `mde` (≈ 16 · p(1 − p) /
 * (p · mde)² visitors per arm). The test's share of traffic is split between the original and the treatments; the
 * smaller arm decides. Undefined without page views or a baseline.
 */
export function experimentDays(e: Pick<Experiment, 'dailyPageViews' | 'baselineConversion' | 'minimumDetectableEffect' | 'trafficProportion' | 'treatments'>): number | undefined {
  if (!e.dailyPageViews || !e.baselineConversion) return undefined;
  const p = e.baselineConversion;
  const perArm = (16 * p * (1 - p)) / (p * e.minimumDetectableEffect) ** 2;
  const share = e.trafficProportion / 100;
  const smallestArm = Math.min(share / e.treatments.length, 1 - share) * e.dailyPageViews;
  return smallestArm > 0 ? Math.ceil(perArm / smallestArm) : undefined;
}
