/**
 * The controlled intervention library (11 interventions). Source of truth for what an
 * intervention IS: when it fits, what it must never do, and which wordings are approved.
 * The wording itself lives in the translation files under `interventions.<key>.<variantId>`.
 *
 * The Behavior Engine selects a key and a variant. The AI may only personalize the wording
 * of that variant; it can never change the action, scope or safety constraints.
 * Full definitions: INTERVENTIONS.md at the repository root.
 */

export type Context =
  | "TRUE_HUNGER"
  | "STRESS"
  | "FATIGUE"
  | "CRAVING"
  | "SOCIAL"
  | "ENVIRONMENT"
  | "HABIT"
  | "UNCLEAR";

/** PRE_CONTEXT: hours before a predicted risk. IN_CONTEXT: at the moment. POST_EVENT: after. RECOVERY: after a hard day or an absence. */
export type Timing = "PRE_CONTEXT" | "IN_CONTEXT" | "POST_EVENT" | "RECOVERY";

/** Only known when the user reports it. When unknown, treat it as BEFORE_EATING. */
export type EatingPhase = "BEFORE_EATING" | "DURING_EATING" | "ANY";

export type Mode = "NORMAL" | "RECOVERY";

/** 1 = ASK (a short question), 2 = a small action the user may choose, 3 = a short guided action (steps, timer or return prompt). Level 0 is DO_NOTHING and is not an intervention. */
export type Level = 1 | 2 | 3;

export type Constraint =
  | "never_as_restriction"
  | "no_fixed_substitute"
  | "never_for_compensation"
  | "never_link_to_calories"
  | "never_as_punishment"
  | "no_food_prohibition"
  | "must_end_with_permission"
  | "no_followup_intervention_on_true_hunger"
  | "never_compensate"
  | "never_restart_language"
  | "pre_context_only";

export const INTERVENTION_KEYS = [
  "pause",
  "check_hunger",
  "portion_first",
  "slow_down",
  "replace_context",
  "micro_walk",
  "eat_intentionally",
  "environment",
  "delay",
  "self_compassion_recovery",
  "ask_instead",
] as const;

export type InterventionKey = (typeof INTERVENTION_KEYS)[number];

export interface Variant {
  id: string;
  /** Narrows the intervention's contexts for this wording. */
  contexts?: readonly Context[];
  /** Overrides the intervention's eating phase for this wording. */
  eatingPhase?: EatingPhase;
}

export interface InterventionDef {
  key: InterventionKey;
  contexts: readonly Context[];
  timing: readonly Timing[];
  eatingPhase: EatingPhase;
  mode: Mode;
  levels: { min: Level; max: Level };
  variants: readonly Variant[];
  constraints: readonly Constraint[];
  /** Tunable numbers; the wording receives them as ICU placeholders. */
  params: Readonly<Record<string, number>>;
  /** Whether "how did it help?" is asked afterwards. A short question (ASK) is not rated. */
  asksOutcome: boolean;
}

const ALL_CONTEXTS: readonly Context[] = [
  "TRUE_HUNGER",
  "STRESS",
  "FATIGUE",
  "CRAVING",
  "SOCIAL",
  "ENVIRONMENT",
  "HABIT",
  "UNCLEAR",
];

const DEFAULT_VARIANT: readonly Variant[] = [{ id: "default" }];

export const INTERVENTIONS: Readonly<Record<InterventionKey, InterventionDef>> = {
  pause: {
    key: "pause",
    contexts: ["CRAVING", "HABIT", "SOCIAL", "UNCLEAR"],
    timing: ["IN_CONTEXT"],
    eatingPhase: "ANY",
    mode: "NORMAL",
    levels: { min: 1, max: 2 },
    variants: [{ id: "before_second_portion", eatingPhase: "DURING_EATING" }],
    constraints: [],
    params: {},
    asksOutcome: true,
  },
  check_hunger: {
    key: "check_hunger",
    contexts: ["FATIGUE", "STRESS", "HABIT", "UNCLEAR"],
    timing: ["IN_CONTEXT"],
    eatingPhase: "BEFORE_EATING",
    mode: "NORMAL",
    levels: { min: 1, max: 2 },
    variants: [
      { id: "tired_or_hungry", contexts: ["FATIGUE"] },
      { id: "open", contexts: ["STRESS", "HABIT", "UNCLEAR"] },
    ],
    constraints: ["no_followup_intervention_on_true_hunger"],
    params: { pauseSeconds: 10 },
    asksOutcome: true,
  },
  portion_first: {
    key: "portion_first",
    contexts: ["HABIT", "SOCIAL", "CRAVING"],
    timing: ["IN_CONTEXT"],
    eatingPhase: "BEFORE_EATING",
    mode: "NORMAL",
    levels: { min: 2, max: 2 },
    variants: DEFAULT_VARIANT,
    constraints: ["never_as_restriction"],
    params: {},
    asksOutcome: true,
  },
  slow_down: {
    key: "slow_down",
    contexts: ["HABIT", "TRUE_HUNGER"],
    timing: ["IN_CONTEXT"],
    eatingPhase: "ANY",
    mode: "NORMAL",
    levels: { min: 2, max: 2 },
    variants: [
      { id: "utensils_between_bites", contexts: ["HABIT"], eatingPhase: "ANY" },
      // Formerly "Next Bite". With true hunger it is only allowed while the user is already eating.
      { id: "notice_before_next_bite", contexts: ["HABIT", "TRUE_HUNGER"], eatingPhase: "DURING_EATING" },
    ],
    constraints: [],
    params: {},
    asksOutcome: true,
  },
  replace_context: {
    key: "replace_context",
    contexts: ["HABIT", "CRAVING", "STRESS"],
    timing: ["IN_CONTEXT"],
    eatingPhase: "BEFORE_EATING",
    mode: "NORMAL",
    levels: { min: 2, max: 2 },
    variants: DEFAULT_VARIANT,
    constraints: ["no_fixed_substitute"],
    params: {},
    asksOutcome: true,
  },
  micro_walk: {
    key: "micro_walk",
    contexts: ["STRESS", "FATIGUE", "CRAVING", "HABIT"],
    timing: ["IN_CONTEXT", "POST_EVENT"],
    eatingPhase: "BEFORE_EATING",
    mode: "NORMAL",
    levels: { min: 2, max: 3 },
    variants: DEFAULT_VARIANT,
    constraints: ["never_for_compensation", "never_link_to_calories", "never_as_punishment"],
    params: { walkMinutes: 5 },
    asksOutcome: true,
  },
  eat_intentionally: {
    key: "eat_intentionally",
    contexts: ["HABIT", "ENVIRONMENT"],
    timing: ["IN_CONTEXT"],
    eatingPhase: "BEFORE_EATING",
    mode: "NORMAL",
    levels: { min: 2, max: 2 },
    variants: DEFAULT_VARIANT,
    constraints: [],
    params: {},
    asksOutcome: true,
  },
  environment: {
    key: "environment",
    contexts: ["ENVIRONMENT", "HABIT"],
    timing: ["PRE_CONTEXT"],
    eatingPhase: "ANY",
    mode: "NORMAL",
    levels: { min: 2, max: 3 },
    variants: DEFAULT_VARIANT,
    constraints: ["no_food_prohibition", "pre_context_only"],
    params: {},
    asksOutcome: true,
  },
  delay: {
    key: "delay",
    contexts: ["CRAVING"],
    timing: ["IN_CONTEXT"],
    eatingPhase: "BEFORE_EATING",
    mode: "NORMAL",
    levels: { min: 2, max: 3 },
    variants: DEFAULT_VARIANT,
    constraints: ["must_end_with_permission"],
    params: { delayMinutes: 10 },
    asksOutcome: true,
  },
  self_compassion_recovery: {
    key: "self_compassion_recovery",
    contexts: ALL_CONTEXTS,
    timing: ["RECOVERY"],
    eatingPhase: "ANY",
    mode: "RECOVERY",
    levels: { min: 2, max: 3 },
    variants: DEFAULT_VARIANT,
    constraints: ["never_compensate", "never_restart_language"],
    params: {},
    asksOutcome: true,
  },
  ask_instead: {
    key: "ask_instead",
    contexts: ["UNCLEAR"],
    timing: ["IN_CONTEXT"],
    eatingPhase: "ANY",
    mode: "NORMAL",
    levels: { min: 1, max: 1 },
    variants: DEFAULT_VARIANT,
    constraints: [],
    params: {},
    asksOutcome: false,
  },
};

/** Engine rules approved on 2026-10-01 (tunable constants). */
export const INTERVENTION_RULES = {
  /** Interventions the user starts themselves are not counted. */
  dailyProactiveBudget: 1,
  /** "Not really" this many times in a row, in the same context, pauses that pair. */
  cooldownAfterConsecutiveNotReally: 2,
  cooldownDays: 14,
} as const;

export function getIntervention(key: InterventionKey): InterventionDef {
  return INTERVENTIONS[key];
}
