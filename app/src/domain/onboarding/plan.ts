/**
 * The onboarding planner: turns one submitted step into a write plan, or into a typed error
 * with the typed values echoed back. Pure. It never reads the environment and never throws for
 * user input; the server only authenticates, calls this, and runs the plan.
 *
 * Calm rules that shape it: empty, "not sure", "no" and declining are all valid answers, and no
 * number is judged (a goal at or above the starting weight is saved without a word).
 */
import { canTransition } from "../firstWeek";
import { getPlace, validateShabbatChoice } from "../places";
import {
  ACTIVITY_BASELINE_KEYS,
  GOAL_FOCUS_KEYS,
  KASHRUT_CHOICES,
  NOTIFICATION_KEY_FOR,
  NOTIFY_CHOICES,
  OFFLINE_CHOICES,
  RANGES,
  STEP_META,
  TEXT_LIMITS,
  type GoalFocusKey,
  type GoalType,
  type JsonObject,
  type NotificationsJson,
  type OnboardingRow,
  type ProfilePatch,
  type RawFields,
  type StepError,
  type StepErrorCode,
  type StepId,
  type StepIntent,
  type StepPlan,
} from "./model";
import { parseDecimal, parseIntegerStrict, sanitizeText } from "./parse";
import { HOME_PATH, maxPointer, stepAfter, stepPath } from "./steps";

/** A numeric goal exists exactly when there is a goal weight; otherwise a goal of any kind is behavioral. */
export function deriveGoalType(goalFocus: readonly GoalFocusKey[], goalWeightKg: number | null): GoalType {
  if (goalWeightKg !== null) return "numeric";
  return goalFocus.some((k) => k !== "not_sure") ? "behavioral" : "none";
}

export interface PlanInput {
  step: StepId;
  intent: StepIntent;
  raw: RawFields;
  row: OnboardingRow;
  now: Date;
  pushConfigured: boolean;
}

export type PlanResult =
  | { ok: true; plan: StepPlan }
  | { ok: false; error: StepError; values: RawFields };

const DEVICE_PHASE_PATH = `${stepPath("notifications")}?phase=device`;

/** One string field; a field the form did not send reads as empty. */
const single = (raw: RawFields, name: string): string => {
  const v = raw[name];
  return typeof v === "string" ? v : "";
};

/** A multi-value field, without repeats. */
const list = (raw: RawFields, name: string): string[] => {
  const v = raw[name];
  if (Array.isArray(v)) return [...new Set(v)];
  return typeof v === "string" && v !== "" ? [v] : [];
};

/** Splits a submitted list into known values and whether anything unknown was in it. */
function pick<T extends string>(values: string[], allowed: readonly T[]): { chosen: T[]; unknown: boolean } {
  const chosen = values.filter((v): v is T => (allowed as readonly string[]).includes(v));
  return { chosen, unknown: chosen.length !== values.length };
}

/** The pointer write: only when it moves forward. */
function pointerPatch(row: OnboardingRow, step: StepId): ProfilePatch {
  const next = maxPointer(row.onboarding_step, step);
  return next === row.onboarding_step ? {} : { onboarding_step: next };
}

/** A normal advance: the data, the pointer, and the next visible step (given the weight after this write). */
function advance(
  row: OnboardingRow,
  step: StepId,
  data: ProfilePatch,
  weightAfter: number | null,
  extra: Partial<StepPlan> = {},
): { ok: true; plan: StepPlan } {
  return {
    ok: true,
    plan: {
      profilePatch: { ...data, ...pointerPatch(row, step) },
      redirectTo: stepPath(stepAfter(step, { start_weight_kg: weightAfter })),
      ...extra,
    },
  };
}

export function planStep({ step, intent, raw, row, now, pushConfigured }: PlanInput): PlanResult {
  const fail = (code: StepErrorCode, field?: string): PlanResult => ({
    ok: false,
    error: field === undefined ? { code } : { code, field },
    values: raw,
  });

  // Only the first screen can be reached from NEW.
  if (row.lifecycle_state === "NEW" && step !== "welcome") return fail("step_not_available");

  // A skip changes no answer. On a step that cannot be skipped it is treated as a normal continue.
  if (intent === "skip" && STEP_META[step].skippable) {
    return advance(row, step, {}, row.start_weight_kg);
  }

  switch (step) {
    case "welcome": {
      const data: ProfilePatch = canTransition(row.lifecycle_state, "ONBOARDING")
        ? { lifecycle_state: "ONBOARDING" }
        : {};
      return advance(row, step, data, row.start_weight_kg);
    }

    case "goals": {
      const { chosen, unknown } = pick(list(raw, "goals"), GOAL_FOCUS_KEYS);
      if (unknown) return fail("invalid_choice", "goals");
      if (chosen.includes("not_sure") && chosen.length > 1) return fail("conflicting_choices", "goals");
      return advance(
        row,
        step,
        { goal_focus: chosen, goal_type: deriveGoalType(chosen, row.goal_weight_kg) },
        row.start_weight_kg,
      );
    }

    case "weight": {
      const parsed = parseDecimal(single(raw, "weight"), RANGES.weightKg);
      if (!parsed.ok) return fail(parsed.code, "weight");
      const weight = parsed.value;
      // Without a starting weight there is no goal weight either.
      const goalWeight = weight === null ? null : row.goal_weight_kg;
      const data: ProfilePatch = {
        start_weight_kg: weight,
        goal_type: deriveGoalType(row.goal_focus, goalWeight),
        ...(weight === null ? { goal_weight_kg: null } : {}),
      };
      return advance(row, step, data, weight);
    }

    case "goal-weight": {
      let goalWeight: number | null = null;
      if (intent !== "decline") {
        const parsed = parseDecimal(single(raw, "goal_weight"), RANGES.weightKg);
        if (!parsed.ok) return fail(parsed.code, "goal_weight");
        goalWeight = parsed.value;
      }
      return advance(
        row,
        step,
        { goal_weight_kg: goalWeight, goal_type: deriveGoalType(row.goal_focus, goalWeight) },
        row.start_weight_kg,
      );
    }

    case "about-you": {
      const age = parseIntegerStrict(single(raw, "age"), RANGES.ageYears);
      if (!age.ok) return fail(age.code, "age");
      const height = parseDecimal(single(raw, "height"), RANGES.heightCm);
      if (!height.ok) return fail(height.code, "height");
      return advance(row, step, { age: age.value, height_cm: height.value }, row.start_weight_kg);
    }

    case "movement": {
      const movement = single(raw, "movement");
      if (movement === "") return advance(row, step, {}, row.start_weight_kg);
      if (!(ACTIVITY_BASELINE_KEYS as readonly string[]).includes(movement)) return fail("invalid_choice", "movement");
      return advance(
        row,
        step,
        { activity_preferences: { ...row.activity_preferences, baseline: movement } },
        row.start_weight_kg,
      );
    }

    case "food": {
      const food: JsonObject = { ...row.food_preferences };
      for (const field of ["likes", "dislikes", "style"] as const) {
        const text = sanitizeText(single(raw, field), TEXT_LIMITS.food);
        if (!text.ok) return fail(text.code, field);
        if (text.value === "") delete food[field];
        else food[field] = text.value;
      }
      return advance(row, step, { food_preferences: food }, row.start_weight_kg);
    }

    case "kashrut": {
      const { chosen, unknown } = pick(list(raw, "kashrut"), KASHRUT_CHOICES);
      if (unknown) return fail("invalid_choice", "kashrut");
      return advance(
        row,
        step,
        {
          kashrut: { ...row.kashrut, kashrut: chosen.includes("kashrut"), meat_dairy: chosen.includes("meat_dairy") },
          food_preferences: { ...row.food_preferences, other_preferences: chosen.includes("other_preferences") },
        },
        row.start_weight_kg,
      );
    }

    case "offline":
      return planOffline(raw, row, fail);

    case "why": {
      const text = sanitizeText(single(raw, "motivation"), TEXT_LIMITS.motivation);
      if (!text.ok) return fail(text.code, "motivation");
      return advance(row, step, { motivation: text.value === "" ? null : text.value }, row.start_weight_kg);
    }

    case "notifications":
      return planNotifications(raw, row, pushConfigured, fail);

    case "ready": {
      // Only ONBOARDING can finish; a second submit after finishing lands here too.
      if (!canTransition(row.lifecycle_state, "FIRST_WEEK")) return fail("step_not_available");

      const stamp = now.toISOString();
      // Safety net for a Shabbat sync that came back "pending" at A9: finishing tries it again,
      // whether the answer was to set the periods or to clear them (the clear is idempotent).
      const placeKey = row.observes_shabbat === true ? row.place_key : null;
      let resync: Pick<StepPlan, "shabbat"> = {};
      if (row.observes_shabbat === false) resync = { shabbat: "clear" };
      else if (placeKey !== null && getPlace(placeKey) !== undefined && row.candle_lighting_minutes !== null) {
        resync = { shabbat: { placeKey, candleMinutes: row.candle_lighting_minutes } };
      }
      return {
        ok: true,
        plan: {
          profilePatch: {
            lifecycle_state: "FIRST_WEEK",
            onboarding_completed_at: stamp,
            first_week_started_at: stamp,
            onboarding_step: "ready",
          },
          finish: true,
          redirectTo: HOME_PATH,
          ...resync,
        },
      };
    }
  }
}

type Fail = (code: StepErrorCode, field?: string) => PlanResult;

function planOffline(raw: RawFields, row: OnboardingRow, fail: Fail): PlanResult {
  const { chosen, unknown } = pick(list(raw, "offline"), OFFLINE_CHOICES);
  if (unknown) return fail("invalid_choice", "offline");
  if (chosen.includes("none") && chosen.length > 1) return fail("conflicting_choices", "offline");

  const wantsOther = chosen.includes("other");

  // "none", "other times only" and an empty answer all mean: no Shabbat, clear any earlier rows.
  if (!chosen.includes("shabbat")) {
    return advance(
      row,
      "offline",
      {
        observes_shabbat: false,
        wants_other_offline: wantsOther,
        place_key: null,
        city: null,
        latitude: null,
        longitude: null,
        in_israel: null,
        candle_lighting_minutes: null,
      },
      row.start_weight_kg,
      { shabbat: "clear" },
    );
  }

  const minutes = parseIntegerStrict(single(raw, "candle_minutes"), RANGES.candleMinutes);
  if (!minutes.ok) return fail(minutes.code, "candle_minutes");

  const choice = validateShabbatChoice(single(raw, "place").trim(), minutes.value);
  if (!choice.ok) return fail(choice.code, choice.code === "out_of_range" ? "candle_minutes" : "place");

  const { place, candleMinutes } = choice;
  return advance(
    row,
    "offline",
    {
      observes_shabbat: true,
      wants_other_offline: wantsOther,
      place_key: place.key,
      city: place.cityName,
      latitude: place.latitude,
      longitude: place.longitude,
      in_israel: place.inIsrael,
      timezone: place.timezone,
      candle_lighting_minutes: candleMinutes,
    },
    row.start_weight_kg,
    { shabbat: { placeKey: place.key, candleMinutes } },
  );
}

function planNotifications(raw: RawFields, row: OnboardingRow, pushConfigured: boolean, fail: Fail): PlanResult {
  // The device panel only asks for the permission; the choices were saved on the way in.
  if (single(raw, "phase") === "device") return advance(row, "notifications", {}, row.start_weight_kg);

  const { chosen, unknown } = pick(list(raw, "notify"), NOTIFY_CHOICES);
  if (unknown) return fail("invalid_choice", "notify");

  // The column is replaced as a whole, so all five keys are sent. "activity" has no question yet.
  const notifications: NotificationsJson = {
    coach: false,
    meal_reporting: false,
    activity: row.notifications.activity,
    weekly_weigh_in: false,
    weekly_summary: false,
  };
  for (const choice of chosen) notifications[NOTIFICATION_KEY_FOR[choice]] = true;

  // Nothing chosen, or push not set up on the server: nothing to ask the device, the step is done.
  if (chosen.length === 0 || !pushConfigured) {
    return advance(row, "notifications", {}, row.start_weight_kg, { notifications });
  }

  // The step stays open (no pointer) until the device panel is finished, so an iPhone user who
  // leaves to install the app comes back to this step.
  return { ok: true, plan: { profilePatch: {}, notifications, redirectTo: DEVICE_PHASE_PATH } };
}
