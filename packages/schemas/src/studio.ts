import { z } from 'zod';

/**
 * Questions Claude leaves for the user when it runs headless in Vitrin Studio (metadata/questions.json). The user
 * cannot answer mid-run, so Claude writes the question here and ends the run; the Studio shows it as a card and
 * starts Claude again with the answer.
 */
export const StudioQuestion = z.object({
  /** Stable kebab-case id, e.g. "design-style". */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** The pipeline stage the answer unblocks (analyze, write, capture, design, video, review, upload …). */
  stage: z.string().optional(),
  /** The question, in the user's language. */
  question: z.string().min(1),
  /** Choices shown as buttons; the user can always answer in their own words as well. */
  options: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) })).default([]),
  askedAt: z.string().optional(),
});
export type StudioQuestion = z.infer<typeof StudioQuestion>;

export const StudioQuestions = z.object({ questions: z.array(StudioQuestion).default([]) });
export type StudioQuestions = z.infer<typeof StudioQuestions>;
