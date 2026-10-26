import { z } from 'zod';
import { StoreEnum } from './targets.js';

/** What a review item is; drives the gallery section and the summary counts. */
export const ReviewItemKind = z.enum(['screenshot', 'preview', 'creative', 'event', 'metadata', 'cpp', 'other']);
export type ReviewItemKind = z.infer<typeof ReviewItemKind>;

/** One file that would be uploaded (or whose content is uploaded), relative to the app root. */
export const HashedFile = z.object({
  path: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
});
export type HashedFile = z.infer<typeof HashedFile>;

/** One reviewable unit: a screenshot, a video, a locale's metadata, a CPP, an event… */
export const ReviewItem = z.object({
  /** Stable id: the file path for media, `metadata/<store>/<locale>` for text, `cpp/<id>`, `event/<id>`. */
  id: z.string(),
  kind: ReviewItemKind,
  store: StoreEnum,
  /** Platform id (ios, macos, android…) or `any` for store-level items. */
  platform: z.string(),
  locale: z.string().optional(),
  target: z.string().optional(),
  label: z.string(),
  /** Files (relative to the app root) whose content this item covers. */
  files: z.array(z.string()),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

export const ReviewRejection = z.object({
  item: z.string(),
  comment: z.string().min(1),
  at: z.string(),
});
export type ReviewRejection = z.infer<typeof ReviewRejection>;

/**
 * `metadata/approval.json` — the user's sign-off on the exact bytes that `vitrin upload` may send.
 * A real upload refuses unless `status` is `approved` and every hash still matches the files on disk.
 */
export const ApprovalManifest = z.object({
  version: z.literal(1).default(1),
  status: z.enum(['approved', 'changes-requested']),
  approvedAt: z.string(),
  /** How the decision was recorded: the review server buttons or `vitrin approve`. */
  via: z.enum(['review-server', 'cli']),
  /** sha256 over every path + hash in `files` and `metadataJson` (see `overallHash()` in the CLI). */
  overallHash: z.string(),
  /** Media and text files that would be uploaded (metadata/store/metadata, screenshots, app-previews, creatives…). */
  files: z.array(HashedFile),
  /** Source JSON that the upload reads text from (metadata, CPP suggestions, In-App Events). */
  metadataJson: z.array(HashedFile),
  items: z.array(ReviewItem),
  rejections: z.array(ReviewRejection).default([]),
  /** Written by a real upload of exactly this content; `vitrin finalize` requires a clean read-back. */
  upload: z
    .object({
      uploadedAt: z.string(),
      overallHash: z.string(),
      readBack: z.enum(['ok', 'differences']),
      differences: z.array(z.string()).default([]),
    })
    .optional(),
  /** Set by `vitrin finalize`: whether the user had the research data deleted (keep/discard: older Vitrin versions). */
  finalized: z.object({ at: z.string(), mode: z.enum(['keep-research', 'delete-research', 'keep', 'discard']) }).optional(),
});
export type ApprovalManifest = z.infer<typeof ApprovalManifest>;

/** `metadata/review-feedback.json` — rejected items with the user's comments, for Claude to fix. */
export const ReviewFeedback = z.object({
  generatedAt: z.string(),
  overallHash: z.string(),
  rejections: z.array(ReviewRejection.extend({ label: z.string(), kind: ReviewItemKind, locale: z.string().optional(), files: z.array(z.string()) })),
});
export type ReviewFeedback = z.infer<typeof ReviewFeedback>;

/** `metadata/review-snapshot.json` — what the last generated report showed, so approval binds to that content. */
export const ReviewSnapshot = z.object({
  generatedAt: z.string(),
  overallHash: z.string(),
  files: z.array(HashedFile),
  metadataJson: z.array(HashedFile),
  items: z.array(ReviewItem),
});
export type ReviewSnapshot = z.infer<typeof ReviewSnapshot>;
