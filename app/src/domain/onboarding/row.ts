/**
 * The database row as the onboarding code sees it, and the form values that show it again
 * (prefill, so Back and a reload keep every answer).
 */
import type { LifecycleState } from "../firstWeek";
import {
  ACTIVITY_BASELINE_KEYS,
  GOAL_FOCUS_KEYS,
  NOTIFICATION_KEY_FOR,
  NOTIFY_CHOICES,
  type GoalFocusKey,
  type GoalType,
  type JsonObject,
  type NotificationsJson,
  type OnboardingRow,
  type RawFields,
  type StepId,
} from "./model";
import { isStepId } from "./steps";

/** The select list for profiles. user_preferences.notifications is read separately. */
export const ONBOARDING_ROW_COLUMNS = [
  "lifecycle_state",
  "onboarding_step",
  "goal_focus",
  "goal_type",
  "start_weight_kg",
  "goal_weight_kg",
  "age",
  "height_cm",
  "motivation",
  "kashrut",
  "food_preferences",
  "activity_preferences",
  "place_key",
  "city",
  "latitude",
  "longitude",
  "in_israel",
  "timezone",
  "candle_lighting_minutes",
  "observes_shabbat",
  "wants_other_offline",
].join(", ");

const LIFECYCLE_STATES: readonly LifecycleState[] = ["NEW", "ONBOARDING", "FIRST_WEEK", "WEEKLY_CYCLE"];
const GOAL_TYPES: readonly GoalType[] = ["numeric", "behavioral", "none"];
// The column default. Only reached if a row somehow comes back without it.
const FALLBACK_TIMEZONE = "Asia/Jerusalem";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** PostgREST can return numeric columns as strings, so numbers are always coerced. */
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const toText = (v: unknown): string | null => (typeof v === "string" ? v : null);
const toBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const toObject = (v: unknown): JsonObject => (isObject(v) ? { ...v } : {});

function toGoalFocus(v: unknown): GoalFocusKey[] {
  if (!Array.isArray(v)) return [];
  const known = v.filter((k): k is GoalFocusKey => (GOAL_FOCUS_KEYS as readonly unknown[]).includes(k));
  return [...new Set(known)];
}

function toNotifications(prefs: unknown): NotificationsJson {
  const source = isObject(prefs) && isObject(prefs.notifications) ? prefs.notifications : {};
  return {
    coach: source.coach === true,
    meal_reporting: source.meal_reporting === true,
    activity: source.activity === true,
    weekly_weigh_in: source.weekly_weigh_in === true,
    weekly_summary: source.weekly_summary === true,
  };
}

/**
 * Builds the row from the two raw query results. Returns null when the profile is missing, or
 * when its lifecycle state is not one this code knows (guessing a state could skip a step).
 * Unknown goal keys and an unknown step pointer are dropped rather than trusted.
 */
export function normalizeRow(profile: unknown, prefs: unknown): OnboardingRow | null {
  if (!isObject(profile)) return null;
  const lifecycle = profile.lifecycle_state;
  if (!LIFECYCLE_STATES.includes(lifecycle as LifecycleState)) return null;

  return {
    lifecycle_state: lifecycle as LifecycleState,
    onboarding_step: isStepId(profile.onboarding_step) ? profile.onboarding_step : null,
    goal_focus: toGoalFocus(profile.goal_focus),
    goal_type: GOAL_TYPES.includes(profile.goal_type as GoalType) ? (profile.goal_type as GoalType) : "none",
    start_weight_kg: toNumber(profile.start_weight_kg),
    goal_weight_kg: toNumber(profile.goal_weight_kg),
    age: toNumber(profile.age),
    height_cm: toNumber(profile.height_cm),
    motivation: toText(profile.motivation),
    kashrut: toObject(profile.kashrut),
    food_preferences: toObject(profile.food_preferences),
    activity_preferences: toObject(profile.activity_preferences),
    place_key: toText(profile.place_key),
    city: toText(profile.city),
    latitude: toNumber(profile.latitude),
    longitude: toNumber(profile.longitude),
    in_israel: toBool(profile.in_israel),
    timezone: toText(profile.timezone) ?? FALLBACK_TIMEZONE,
    candle_lighting_minutes: toNumber(profile.candle_lighting_minutes),
    observes_shabbat: toBool(profile.observes_shabbat),
    wants_other_offline: profile.wants_other_offline === true,
    notifications: toNotifications(prefs),
  };
}

const numberText = (n: number | null): string => (n === null ? "" : String(n));
const textOf = (o: JsonObject, key: string): string => (typeof o[key] === "string" ? o[key] : "");

/**
 * The form values that reproduce the saved answers, shaped like what the form submits
 * (numbers as text, choices as arrays). Fields the user never answered are empty.
 */
export function prefillFor(step: StepId, row: OnboardingRow): RawFields {
  switch (step) {
    case "goals":
      return { goals: [...row.goal_focus] };
    case "weight":
      return { weight: numberText(row.start_weight_kg) };
    case "goal-weight":
      return { goal_weight: numberText(row.goal_weight_kg) };
    case "about-you":
      return { age: numberText(row.age), height: numberText(row.height_cm) };
    case "movement": {
      const baseline = row.activity_preferences.baseline;
      const known = (ACTIVITY_BASELINE_KEYS as readonly unknown[]).includes(baseline);
      return { movement: known ? (baseline as string) : "" };
    }
    case "food":
      return {
        likes: textOf(row.food_preferences, "likes"),
        dislikes: textOf(row.food_preferences, "dislikes"),
        style: textOf(row.food_preferences, "style"),
      };
    case "kashrut": {
      const chosen: string[] = [];
      if (row.kashrut.kashrut === true) chosen.push("kashrut");
      if (row.kashrut.meat_dairy === true) chosen.push("meat_dairy");
      if (row.food_preferences.other_preferences === true) chosen.push("other_preferences");
      return { kashrut: chosen };
    }
    case "offline": {
      const chosen: string[] = [];
      if (row.observes_shabbat === true) chosen.push("shabbat");
      if (row.wants_other_offline) chosen.push("other");
      // An explicit "no" is shown as chosen; "never answered" stays empty.
      if (chosen.length === 0 && row.observes_shabbat === false) chosen.push("none");
      return {
        offline: chosen,
        place: row.place_key ?? "",
        candle_minutes: numberText(row.candle_lighting_minutes),
      };
    }
    case "why":
      return { motivation: row.motivation ?? "" };
    case "notifications":
      return {
        phase: "",
        notify: NOTIFY_CHOICES.filter((c) => row.notifications[NOTIFICATION_KEY_FOR[c]]),
      };
    case "welcome":
    case "ready":
      return {};
  }
}
