/**
 * Onboarding (screens A1 to A12): the vocabulary shared by the planner, the server and the UI.
 * Pure types and constants, no I/O. The step ids are also the values stored in
 * profiles.onboarding_step, so the database CHECK must list exactly these.
 */
import type { LifecycleState } from "../firstWeek";

export const STEP_IDS = [
  "welcome",
  "goals",
  "weight",
  "goal-weight",
  "about-you",
  "movement",
  "food",
  "kashrut",
  "offline",
  "why",
  "notifications",
  "ready",
] as const;
export type StepId = (typeof STEP_IDS)[number];

export interface StepMeta {
  /** The screen's code in the spec, "A1" to "A12". */
  code: string;
  skippable: boolean;
}

export const STEP_META: Record<StepId, StepMeta> = {
  welcome: { code: "A1", skippable: false },
  goals: { code: "A2", skippable: false },
  weight: { code: "A3", skippable: true },
  "goal-weight": { code: "A4", skippable: false },
  "about-you": { code: "A5", skippable: true },
  movement: { code: "A6", skippable: true },
  food: { code: "A7", skippable: true },
  kashrut: { code: "A8", skippable: true },
  offline: { code: "A9", skippable: false },
  why: { code: "A10", skippable: true },
  notifications: { code: "A11", skippable: true },
  ready: { code: "A12", skippable: false },
};

export const GOAL_FOCUS_KEYS = [
  "lose_weight",
  "feel_lighter",
  "improve_eating",
  "be_active",
  "understand_overeating",
  "not_sure",
] as const;
export type GoalFocusKey = (typeof GOAL_FOCUS_KEYS)[number];

export const ACTIVITY_BASELINE_KEYS = [
  "almost_none",
  "some_walking",
  "active_part_of_week",
  "active_most_of_week",
  "varies",
] as const;
export type ActivityBaselineKey = (typeof ACTIVITY_BASELINE_KEYS)[number];

export const KASHRUT_CHOICES = ["kashrut", "meat_dairy", "other_preferences"] as const;
export const OFFLINE_CHOICES = ["shabbat", "other", "none"] as const;
export const NOTIFY_CHOICES = ["reporting", "coach", "weekly_summary", "weekly_weigh_in"] as const;
export type NotifyChoice = (typeof NOTIFY_CHOICES)[number];

export type GoalType = "numeric" | "behavioral" | "none";

/** user_preferences.notifications: always all five keys, because the column is replaced as a whole. */
export interface NotificationsJson {
  coach: boolean;
  meal_reporting: boolean;
  activity: boolean;
  weekly_weigh_in: boolean;
  weekly_summary: boolean;
}

export const NOTIFICATION_KEY_FOR: Record<NotifyChoice, keyof NotificationsJson> = {
  reporting: "meal_reporting",
  coach: "coach",
  weekly_summary: "weekly_summary",
  weekly_weigh_in: "weekly_weigh_in",
};

/** Inclusive bounds. They match the CHECKs on profiles, so the database never disagrees with the form. */
export const RANGES = {
  weightKg: { min: 20, max: 500 },
  ageYears: { min: 10, max: 120 },
  heightCm: { min: 80, max: 250 },
  candleMinutes: { min: 0, max: 90 },
} as const;

/** Counted in code points, not UTF-16 units, so an emoji is one character. */
export const TEXT_LIMITS = { food: 300, motivation: 1000 } as const;

/** How many upcoming Shabbat periods are stored. Bridges the weekly job that does not exist yet. */
export const SHABBAT_HORIZON_WEEKS = 8;

/** The numeric range behind a form field, or null when the field is not a bounded number. */
export function rangeForField(field: string): { min: number; max: number } | null {
  switch (field) {
    case "weight":
    case "goal_weight":
      return RANGES.weightKg;
    case "age":
      return RANGES.ageYears;
    case "height":
      return RANGES.heightCm;
    case "candle_minutes":
      return RANGES.candleMinutes;
    default:
      return null;
  }
}

/** Exactly what the form submitted: one string per field, an array for multi-value fields. */
export type RawFields = Record<string, string | string[]>;

export type StepIntent = "continue" | "skip" | "decline";

export const STEP_ERROR_CODES = [
  "invalid_number",
  "out_of_range",
  "too_long",
  "invalid_choice",
  "conflicting_choices",
  "place_required",
  "unknown_place",
  "not_configured",
  "unauthenticated",
  "save_error",
  "step_not_available",
  "profile_missing",
] as const;
export type StepErrorCode = (typeof STEP_ERROR_CODES)[number];

export interface StepError {
  code: StepErrorCode;
  /** The form field a number or text error belongs to. */
  field?: string;
}

/** The form fields each step reads. Anything else a client posts is ignored. */
export const STEP_FIELDS: Record<StepId, readonly string[]> = {
  welcome: [],
  goals: ["goals"],
  weight: ["weight"],
  "goal-weight": ["goal_weight"],
  "about-you": ["age", "height"],
  movement: ["movement"],
  food: ["likes", "dislikes", "style"],
  kashrut: ["kashrut"],
  offline: ["offline", "place", "candle_minutes"],
  why: ["motivation"],
  notifications: ["phase", "notify"],
  ready: [],
};

/** Fields that can carry several values; the form is read with getAll for these. */
export const MULTI_FIELDS: ReadonlySet<string> = new Set(["goals", "kashrut", "offline", "notify"]);

export type JsonObject = Record<string, unknown>;

/** The profiles columns onboarding touches, plus user_preferences.notifications. Numerics are already numbers. */
export interface OnboardingRow {
  lifecycle_state: LifecycleState;
  onboarding_step: StepId | null;
  goal_focus: GoalFocusKey[];
  goal_type: GoalType;
  start_weight_kg: number | null;
  goal_weight_kg: number | null;
  age: number | null;
  height_cm: number | null;
  motivation: string | null;
  kashrut: JsonObject;
  food_preferences: JsonObject;
  activity_preferences: JsonObject;
  place_key: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  in_israel: boolean | null;
  timezone: string;
  candle_lighting_minutes: number | null;
  observes_shabbat: boolean | null;
  wants_other_offline: boolean;
  notifications: NotificationsJson;
}

/** Keys are exact profiles column names, so the object can be sent to the database as it is. */
export type ProfilePatch = Partial<Omit<OnboardingRow, "notifications">> & {
  /** ISO string. */
  onboarding_completed_at?: string;
  /** ISO string. */
  first_week_started_at?: string;
};

/** What the server must write for one submitted step. */
export interface StepPlan {
  /** May be empty, in which case there is no profile write. */
  profilePatch: ProfilePatch;
  /** A11: the user_preferences write. */
  notifications?: NotificationsJson;
  /** A9, and A12 when the user observes Shabbat. */
  shabbat?: { placeKey: string; candleMinutes: number } | "clear";
  /** A12. */
  finish?: true;
  /** A path, with an optional ?phase=device. "/" when finishing. */
  redirectTo: string;
}
