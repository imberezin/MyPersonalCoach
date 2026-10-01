import { z } from "zod";

/**
 * Output contracts for AI operations. The gateway validates every provider answer against
 * these: a provider's output is never trusted, and a field the model could not determine is
 * `null` / listed in `unclear`, never invented.
 */

export const mealItemSchema = z.object({
  food: z.string().min(1).max(80),
  /** Free-text portion estimate ("about a cup"), or null when unknown. It is an estimate. */
  portion: z.string().max(60).nullable(),
  confidence: z.number().min(0).max(1),
  uncertain: z.boolean(),
});

export const mealUnderstandingSchema = z.object({
  items: z.array(mealItemSchema).max(30),
  /** Parts of the input the model could not understand. The UI shows them as missing. */
  unclear: z.array(z.string().max(120)).max(10),
  overallConfidence: z.number().min(0).max(1),
});

export const transcriptSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
});

export const insightSchema = z.object({ text: z.string().max(600) });

export const coachReplySchema = z.object({ text: z.string().max(1200) });

export const patternCandidateSchema = z.object({
  kind: z.string().min(1).max(80),
  occurrences: z.number().int().min(0),
  note: z.string().max(300).optional(),
});
export const patternCandidatesSchema = z.array(patternCandidateSchema).max(10);

export type MealItem = z.infer<typeof mealItemSchema>;
export type MealUnderstanding = z.infer<typeof mealUnderstandingSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type Insight = z.infer<typeof insightSchema>;
export type CoachReply = z.infer<typeof coachReplySchema>;
export type PatternCandidate = z.infer<typeof patternCandidateSchema>;
