import type { InterventionKey } from "../interventions/library";
import type { PatternKind } from "../patterns/types";
import type { ExperimentScope } from "./types";

/**
 * Which approved library intervention answers which pattern. OWNER-APPROVABLE DEFAULT (Q6): changing it is a
 * one-line edit after the owner decides, and map.test.ts proves every entry names an existing key and variant
 * with approved text in both catalogs.
 *
 * late_evening_meals -> eat_intentionally / default: it is about HOW the next meal is eaten, not WHEN. No food,
 * no amount, no "less", no verdict on the hour. (Considered and rejected: environment, replace_context,
 * check_hunger, portion_first; they presuppose tempting foods, a hard hour, hunger or fatigue, or a limit, none
 * of which the data can claim.)
 */
export const PATTERN_EXPERIMENT_MAP: Readonly<
  Record<PatternKind, { key: InterventionKey; variantId: string; scope: ExperimentScope }>
> = {
  late_evening_meals: { key: "eat_intentionally", variantId: "default", scope: "next_meal" },
};
