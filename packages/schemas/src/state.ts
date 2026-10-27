import { z } from 'zod';
import { ImageQuality } from './design.js';

export const StageName = z.enum([
  'init',
  'doctor',
  'analyze',
  'research',
  'write',
  'capture',
  'design',
  'video',
  'validate',
  'review',
  'upload',
  'submit',
]);
export type StageName = z.infer<typeof StageName>;

export const StageRecord = z.object({
  completedAt: z.string(),
  inputHash: z.string(),
  outputs: z.array(z.string()).default([]),
  status: z.enum(['ok', 'warning', 'blocked']).default('ok'),
  note: z.string().optional(),
});

export const VitrinState = z.object({
  version: z.literal(1).default(1),
  stages: z.partialRecord(StageName, StageRecord).default({}),
});
export type VitrinState = z.infer<typeof VitrinState>;

export const Severity = z.enum(['error', 'warning', 'info']);

export const Issue = z.object({
  severity: Severity,
  code: z.string(),
  message: z.string(),
  file: z.string().optional(),
  locale: z.string().optional(),
  field: z.string().optional(),
  /** Concrete hint for the fixer (Claude) — what to change. */
  fix: z.string().optional(),
});
export type Issue = z.infer<typeof Issue>;

export const ValidationReport = z.object({
  generatedAt: z.string(),
  ok: z.boolean(),
  counts: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
  issues: z.array(Issue),
  /** Per-locale field measurements for the review report. */
  measurements: z
    .record(
      z.string(),
      z.record(z.string(), z.object({ chars: z.number(), bytes: z.number(), limit: z.number(), unit: z.enum(['chars', 'bytes']) })),
    )
    .default({}),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

/** Written by `vitrin design` for every rendered image; consumed by validate. */
export const RenderManifest = z.object({
  generatedAt: z.string(),
  artDirection: z.string(),
  images: z.array(
    z.object({
      file: z.string(),
      target: z.string(),
      locale: z.string(),
      shot: z.string(),
      width: z.number(),
      height: z.number(),
      overflow: z.array(z.string()).default([]),
      headlinePx: z.number().optional(),
      headlineLines: z.number().optional(),
      minContrast: z.number().optional(),
      safeAreaViolations: z.array(z.string()).default([]),
      thumbnailLegible: z.boolean().optional(),
      /** Quality-bar measurements (device ratio, empty bands, glyph contrast, thumbnail test). */
      quality: ImageQuality.optional(),
      /** Where the screens on the image came from: device families and locales of the raw captures used. */
      capture: z.object({ families: z.array(z.string()), locales: z.array(z.string()) }).optional(),
    }),
  ),
  videos: z
    .array(
      z.object({
        file: z.string(),
        target: z.string(),
        locale: z.string(),
        id: z.string(),
        durationSec: z.number().optional(),
      }),
    )
    .default([]),
});
export type RenderManifest = z.infer<typeof RenderManifest>;
