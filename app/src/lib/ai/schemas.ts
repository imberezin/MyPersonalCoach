import { z } from "zod";
import {
  FOOD_LIMITS,
  buildPortion,
  isMealType,
  parseLocalTime,
  sanitizeFoodName,
  sanitizeUnclear,
  type MealType,
  type TimeHint,
  type UnderstoodItem,
  type UnderstoodMeal,
} from "@/domain/food";

/**
 * Output contracts for AI operations. The gateway validates every provider answer against
 * these: a provider's output is never trusted, and a field the model could not determine is
 * `null` / listed in `unclear`, never invented.
 */

/** Hostile-size bounds on the wire shape. The model is asked for far fewer; these only reject junk. */
export const WIRE_LIMITS = { itemsMax: 50, unclearMax: 20 } as const;

/**
 * The meal answer exactly as the model writes it (snake_case, see prompts/mealSchema.ts for the
 * JSON Schema that is sent to the provider). Strict on STRUCTURE (the arrays, the name and the
 * numbers); lenient on everything that is only a hint: a field of the wrong type or an unknown
 * enum word becomes `null` instead of failing the whole answer. Unknown keys are stripped, so a
 * model that volunteers nutrition values or a health score has them dropped here.
 */
export const mealWireItemSchema = z.object({
  name: z.string(),
  portion_size: z.string().nullable().catch(null),
  portion_amount: z.number().nullable().catch(null),
  portion_unit: z.string().nullable().catch(null),
  portion_estimated: z.boolean().catch(false),
  confidence: z.number(),
  uncertain: z.boolean().catch(false),
});

export const mealWireSchema = z.object({
  items: z.array(mealWireItemSchema).max(WIRE_LIMITS.itemsMax),
  unclear: z.array(z.string()).max(WIRE_LIMITS.unclearMax),
  overall_confidence: z.number(),
  meal_type: z.string().nullable().catch(null),
  day: z.string().nullable().catch(null),
  local_time: z.string().nullable().catch(null),
  not_food: z.boolean().catch(false),
});

export type MealWire = z.infer<typeof mealWireSchema>;
export type MealWireItem = z.infer<typeof mealWireItemSchema>;

// A food name that reads as an instruction to the model. The prompt already tells the model to ignore
// those, and a person confirms every list, so this is only a cheap second line: such an "item" is
// dropped instead of being shown as a food.
const INSTRUCTION_LIKE =
  /\b(ignore|disregard|forget)\b[^.]{0,30}\b(previous|prior|above|earlier|instructions?|rules?)\b|\bsystem\s+prompt\b|התעלם\s+מ|תתעלם\s+מ|הוראות\s+קודמות/i;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

function lowerWord(value: string | null): string | null {
  const word = value?.trim().toLowerCase();
  return word ? word : null;
}

function toItem(wire: MealWireItem): UnderstoodItem | null {
  const name = sanitizeFoodName(wire.name);
  if (name === null || INSTRUCTION_LIKE.test(name)) return null;

  // An exact amount wins over a size when the model sent both; an unusable amount falls back to the size.
  const portion =
    buildPortion({ amount: wire.portion_amount, unit: wire.portion_unit, estimated: wire.portion_estimated }) ??
    buildPortion({ size: wire.portion_size, estimated: wire.portion_estimated });

  const confidence = round2(clamp01(wire.confidence));
  return { name, portion, uncertain: wire.uncertain || confidence < FOOD_LIMITS.uncertainBelow, confidence };
}

/**
 * Turns the wire answer into the app's value. Never throws. An answer with zero usable items is
 * valid and empty: the caller maps it to "nothing found", it is not a provider error.
 */
export function toUnderstoodMeal(wire: MealWire): UnderstoodMeal {
  const items: UnderstoodItem[] = [];
  const seen = new Set<string>();
  for (const raw of wire.items) {
    const item = toItem(raw);
    if (!item) continue;
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= FOOD_LIMITS.itemsMax) break;
  }

  const unclear: string[] = [];
  for (const raw of wire.unclear) {
    const text = sanitizeUnclear(raw);
    if (text !== null && !INSTRUCTION_LIKE.test(text) && !unclear.includes(text)) unclear.push(text);
    if (unclear.length >= FOOD_LIMITS.unclearMax) break;
  }

  const mealType = lowerWord(wire.meal_type);
  const dayWord = lowerWord(wire.day);
  const day: TimeHint["day"] | null = dayWord === "today" || dayWord === "yesterday" ? dayWord : null;
  const minuteOfDay = parseLocalTime(wire.local_time);

  return {
    items,
    unclear,
    overallConfidence: round2(clamp01(wire.overall_confidence)),
    mealTypeHint: mealType !== null && isMealType(mealType) ? (mealType as MealType) : null,
    timeHint: day === null && minuteOfDay === null ? null : { day: day ?? "today", minuteOfDay },
    notFood: wire.not_food,
  };
}

export const mealUnderstandingSchema = mealWireSchema.transform(toUnderstoodMeal);

export const transcriptSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
});

export const insightSchema = z.object({ text: z.string().max(600) });

/**
 * The reworded experiment sentence. 1 to 400 characters is a hostile-size bound only, equal to the
 * `experiments.wording` column check; the real cap and every other rule live in `validateWording`.
 * Unknown keys are dropped.
 */
export const experimentWordingSchema = z.object({ text: z.string().min(1).max(400) });

/**
 * The reworded weekly opening line (Weekly Learning). The same shape and bound as the experiment wording: 1 to 400
 * characters only rejects hostile sizes; the real cap and every other rule live in `validateWording`.
 */
export const weeklyLineSchema = z.object({ text: z.string().min(1).max(400) });

export const coachReplySchema = z.object({ text: z.string().max(1200) });

export const patternCandidateSchema = z.object({
  kind: z.string().min(1).max(80),
  occurrences: z.number().int().min(0),
  note: z.string().max(300).optional(),
});
export const patternCandidatesSchema = z.array(patternCandidateSchema).max(10);

export type MealUnderstanding = UnderstoodMeal;
export type Transcript = z.infer<typeof transcriptSchema>;
export type Insight = z.infer<typeof insightSchema>;
export type ExperimentWording = z.infer<typeof experimentWordingSchema>;
export type WeeklyLine = z.infer<typeof weeklyLineSchema>;
export type CoachReply = z.infer<typeof coachReplySchema>;
export type PatternCandidate = z.infer<typeof patternCandidateSchema>;
