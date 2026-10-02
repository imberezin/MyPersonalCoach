import { INTERVENTION_RULES, type Constraint, type InterventionKey } from "../interventions/library";
import type { PatternFeedback, PatternKind, PatternView } from "../patterns/types";

/**
 * The first experiment: the vocabulary. The selection is pure (select.ts); the rows live in `experiments`
 * (src/lib/experiments) and the wording of the sentence is ROLE-AI's (src/domain/experiments/wording, not
 * exported from this folder's barrel). The engine selects; the AI may only word.
 */

export type ExperimentStatus = "OFFERED" | "ACTIVE" | "DONE" | "SKIPPED";
/** Closed; the only scope the library's eat_intentionally text speaks of. */
export type ExperimentScope = "next_meal";

/** "Not this time" is respected for the library's own cooldown. */
export const EXPERIMENT_RULES = { skippedCooldownDays: INTERVENTION_RULES.cooldownDays } as const;
/** Experiments read per person. */
export const FIRST_EXPERIMENT_LIMITS = { rows: 20 } as const;

export interface ExperimentFact {
  id: string;
  status: ExperimentStatus;
  sourcePatternId: string | null;
  endedAt: Date | null;
}

/** One pattern as the loader found it: `view` is the LIVE level (never the stored status). `patternId` is null until the person has a row. */
export interface PatternFact {
  patternId: string | null;
  kind: PatternKind;
  view: PatternView;
  feedback: PatternFeedback | null;
  feedbackAt: Date | null;
}

export type ExperimentSelection =
  | {
      kind: "NONE";
      reason:
        | "switch_off"
        | "no_pattern"
        | "pattern_not_established"
        | "pattern_rejected"
        | "pattern_unsure_cooldown"
        | "skipped_recently"
        | "no_mapping";
    }
  /** The engine's whole decision; the AI receives none of it except the approved text. */
  | {
      kind: "OFFER";
      patternKind: PatternKind;
      key: InterventionKey;
      variantId: string;
      scope: ExperimentScope;
      params: Readonly<Record<string, number>>;
      constraints: readonly Constraint[];
    }
  /** An OFFERED row exists and its pattern is still established. */
  | { kind: "PENDING"; experimentId: string }
  | { kind: "ACTIVE"; experimentId: string };
