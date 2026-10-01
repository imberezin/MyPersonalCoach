import { describe, expect, it } from "vitest";
import {
  ONBOARDING_ROW_COLUMNS,
  STEP_ERROR_CODES,
  STEP_IDS,
  deriveGoalType,
  normalizeRow,
  planStep,
  prefillFor,
  type OnboardingRow,
  type RawFields,
  type StepId,
  type StepIntent,
  type StepPlan,
} from ".";

const NOW = new Date("2026-10-01T10:00:00.000Z");

const baseRow = (over: Partial<OnboardingRow> = {}): OnboardingRow => ({
  lifecycle_state: "ONBOARDING",
  onboarding_step: "welcome",
  goal_focus: [],
  goal_type: "none",
  start_weight_kg: null,
  goal_weight_kg: null,
  age: null,
  height_cm: null,
  motivation: null,
  kashrut: {},
  food_preferences: {},
  activity_preferences: {},
  place_key: null,
  city: null,
  latitude: null,
  longitude: null,
  in_israel: null,
  timezone: "Asia/Jerusalem",
  candle_lighting_minutes: null,
  observes_shabbat: null,
  wants_other_offline: false,
  notifications: { coach: false, meal_reporting: false, activity: false, weekly_weigh_in: false, weekly_summary: false },
  ...over,
});

function run(
  step: StepId,
  raw: RawFields = {},
  row: OnboardingRow = baseRow(),
  opts: { intent?: StepIntent; pushConfigured?: boolean } = {},
) {
  return planStep({ step, intent: opts.intent ?? "continue", raw, row, now: NOW, pushConfigured: opts.pushConfigured ?? true });
}

function plan(...args: Parameters<typeof run>): StepPlan {
  const result = run(...args);
  if (!result.ok) throw new Error(`expected a plan, got ${result.error.code}`);
  return result.plan;
}

function error(...args: Parameters<typeof run>) {
  const result = run(...args);
  if (result.ok) throw new Error("expected an error");
  return result;
}

describe("deriveGoalType", () => {
  it("is numeric whenever there is a goal weight", () => {
    expect(deriveGoalType([], 80)).toBe("numeric");
    expect(deriveGoalType(["not_sure"], 80)).toBe("numeric");
  });

  it("is behavioral for a real focus and none otherwise", () => {
    expect(deriveGoalType(["lose_weight"], null)).toBe("behavioral");
    expect(deriveGoalType(["not_sure"], null)).toBe("none");
    expect(deriveGoalType([], null)).toBe("none");
  });
});

describe("common rules", () => {
  it("allows only the welcome step while the user is new", () => {
    const fresh = baseRow({ lifecycle_state: "NEW", onboarding_step: null });
    for (const step of STEP_IDS.filter((s) => s !== "welcome")) {
      expect(error(step, {}, fresh).error).toEqual({ code: "step_not_available" });
    }
    expect(run("welcome", {}, fresh).ok).toBe(true);
  });

  it("echoes the submitted values with an error", () => {
    const raw = { weight: "abc" };
    expect(error("weight", raw).values).toBe(raw);
  });

  it("never moves the pointer backwards", () => {
    const row = baseRow({ onboarding_step: "kashrut" });
    const p = plan("weight", { weight: "80" }, row);
    expect(p.profilePatch).not.toHaveProperty("onboarding_step");
  });

  it("moves the pointer forward and no further than the step done", () => {
    expect(plan("goals", {}, baseRow({ onboarding_step: "welcome" })).profilePatch.onboarding_step).toBe("goals");
  });
});

describe("skip", () => {
  it("writes only the pointer on a skippable step and goes to the next one", () => {
    const row = baseRow({ onboarding_step: "goals", start_weight_kg: 80 });
    const p = plan("weight", { weight: "70" }, row, { intent: "skip" });
    expect(p.profilePatch).toEqual({ onboarding_step: "weight" });
    expect(p.redirectTo).toBe("/onboarding/goal-weight");
  });

  it("goes by the existing weight, not the submitted one", () => {
    const p = plan("weight", { weight: "70" }, baseRow({ onboarding_step: "goals" }), { intent: "skip" });
    expect(p.redirectTo).toBe("/onboarding/about-you");
  });

  it("treats a skip on a step that cannot be skipped as a continue", () => {
    const p = plan("goals", { goals: ["be_active"] }, baseRow(), { intent: "skip" });
    expect(p.profilePatch.goal_focus).toEqual(["be_active"]);
  });

  it("skips the notifications step without a write", () => {
    const p = plan("notifications", { notify: ["coach"] }, baseRow({ onboarding_step: "why" }), { intent: "skip" });
    expect(p.notifications).toBeUndefined();
    expect(p.profilePatch).toEqual({ onboarding_step: "notifications" });
    expect(p.redirectTo).toBe("/onboarding/ready");
  });
});

describe("welcome", () => {
  it("moves a new user to ONBOARDING and sets the pointer", () => {
    const p = plan("welcome", {}, baseRow({ lifecycle_state: "NEW", onboarding_step: null }));
    expect(p.profilePatch).toEqual({ lifecycle_state: "ONBOARDING", onboarding_step: "welcome" });
    expect(p.redirectTo).toBe("/onboarding/goals");
  });

  it("leaves the lifecycle alone when already onboarding", () => {
    const p = plan("welcome", {}, baseRow({ onboarding_step: "weight" }));
    expect(p.profilePatch).toEqual({});
    expect(p.redirectTo).toBe("/onboarding/goals");
  });
});

describe("goals", () => {
  it("accepts an empty answer as no goals chosen", () => {
    const p = plan("goals", { goals: [] });
    expect(p.profilePatch).toMatchObject({ goal_focus: [], goal_type: "none" });
  });

  it("derives a behavioral goal type and removes repeats", () => {
    const p = plan("goals", { goals: ["lose_weight", "be_active", "lose_weight"] });
    expect(p.profilePatch).toMatchObject({ goal_focus: ["lose_weight", "be_active"], goal_type: "behavioral" });
  });

  it("keeps not_sure alone as none", () => {
    expect(plan("goals", { goals: ["not_sure"] }).profilePatch.goal_type).toBe("none");
  });

  it("rejects not_sure together with another choice", () => {
    expect(error("goals", { goals: ["not_sure", "lose_weight"] }).error).toEqual({ code: "conflicting_choices", field: "goals" });
  });

  it("rejects an unknown key", () => {
    expect(error("goals", { goals: ["lose_weight", "bogus"] }).error).toEqual({ code: "invalid_choice", field: "goals" });
  });

  it("keeps the goal type numeric while a goal weight exists", () => {
    const p = plan("goals", { goals: ["be_active"] }, baseRow({ start_weight_kg: 90, goal_weight_kg: 80, goal_type: "numeric" }));
    expect(p.profilePatch.goal_type).toBe("numeric");
  });
});

describe("weight", () => {
  it("saves a weight and offers the goal weight next", () => {
    const p = plan("weight", { weight: "99,5" });
    expect(p.profilePatch.start_weight_kg).toBe(99.5);
    expect(p.redirectTo).toBe("/onboarding/goal-weight");
  });

  it("clears the goal weight when the weight is emptied, and recomputes the goal type", () => {
    const row = baseRow({ onboarding_step: "goal-weight", start_weight_kg: 90, goal_weight_kg: 80, goal_type: "numeric", goal_focus: ["lose_weight"] });
    const p = plan("weight", { weight: "" }, row);
    expect(p.profilePatch).toMatchObject({ start_weight_kg: null, goal_weight_kg: null, goal_type: "behavioral" });
    expect(p.redirectTo).toBe("/onboarding/about-you");
  });

  it("keeps an existing goal weight when the weight changes", () => {
    const row = baseRow({ start_weight_kg: 90, goal_weight_kg: 80, goal_type: "numeric" });
    const p = plan("weight", { weight: "92" }, row);
    expect(p.profilePatch).not.toHaveProperty("goal_weight_kg");
    expect(p.profilePatch.goal_type).toBe("numeric");
  });

  it("reports a bad number with its field", () => {
    expect(error("weight", { weight: "abc" }).error).toEqual({ code: "invalid_number", field: "weight" });
    expect(error("weight", { weight: "19.9" }).error).toEqual({ code: "out_of_range", field: "weight" });
    expect(error("weight", { weight: "500.1" }).error).toEqual({ code: "out_of_range", field: "weight" });
  });

  it("accepts the bounds", () => {
    expect(plan("weight", { weight: "20" }).profilePatch.start_weight_kg).toBe(20);
    expect(plan("weight", { weight: "500" }).profilePatch.start_weight_kg).toBe(500);
  });
});

describe("goal-weight", () => {
  const row = baseRow({ onboarding_step: "weight", start_weight_kg: 90, goal_focus: ["lose_weight"] });

  it("saves a goal weight and makes the goal numeric", () => {
    const p = plan("goal-weight", { goal_weight: "80" }, row);
    expect(p.profilePatch).toMatchObject({ goal_weight_kg: 80, goal_type: "numeric" });
    expect(p.redirectTo).toBe("/onboarding/about-you");
  });

  it("accepts a goal at or above the starting weight without a message", () => {
    expect(plan("goal-weight", { goal_weight: "90" }, row).profilePatch.goal_weight_kg).toBe(90);
    expect(plan("goal-weight", { goal_weight: "95.5" }, row).profilePatch.goal_weight_kg).toBe(95.5);
  });

  it("treats declining and an empty field as no goal weight", () => {
    const withGoal = baseRow({ ...row, goal_weight_kg: 80, goal_type: "numeric" });
    for (const p of [
      plan("goal-weight", { goal_weight: "75" }, withGoal, { intent: "decline" }),
      plan("goal-weight", { goal_weight: "" }, withGoal),
    ]) {
      expect(p.profilePatch).toMatchObject({ goal_weight_kg: null, goal_type: "behavioral" });
    }
  });

  it("falls back to none without a focus", () => {
    const p = plan("goal-weight", {}, baseRow({ start_weight_kg: 90 }), { intent: "decline" });
    expect(p.profilePatch.goal_type).toBe("none");
  });

  it("reports a bad goal weight with its field", () => {
    expect(error("goal-weight", { goal_weight: "x" }, row).error).toEqual({ code: "invalid_number", field: "goal_weight" });
  });
});

describe("about-you", () => {
  it("saves age and height independently", () => {
    expect(plan("about-you", { age: "34", height: "175,5" }).profilePatch).toMatchObject({ age: 34, height_cm: 175.5 });
    expect(plan("about-you", { age: "", height: "180" }).profilePatch).toMatchObject({ age: null, height_cm: 180 });
    expect(plan("about-you", { age: "34", height: "" }).profilePatch).toMatchObject({ age: 34, height_cm: null });
  });

  it("reports which field is wrong", () => {
    expect(error("about-you", { age: "9", height: "180" }).error).toEqual({ code: "out_of_range", field: "age" });
    expect(error("about-you", { age: "30", height: "79" }).error).toEqual({ code: "out_of_range", field: "height" });
    expect(error("about-you", { age: "30.5", height: "" }).error).toEqual({ code: "invalid_number", field: "age" });
  });
});

describe("movement", () => {
  it("merges the baseline into the existing object", () => {
    const p = plan("movement", { movement: "some_walking" }, baseRow({ activity_preferences: { other: 1 } }));
    expect(p.profilePatch.activity_preferences).toEqual({ other: 1, baseline: "some_walking" });
  });

  it("changes nothing when empty", () => {
    expect(plan("movement", { movement: "" }, baseRow({ onboarding_step: "about-you" })).profilePatch).toEqual({ onboarding_step: "movement" });
  });

  it("rejects an unknown option", () => {
    expect(error("movement", { movement: "marathon" }).error).toEqual({ code: "invalid_choice", field: "movement" });
  });
});

describe("food", () => {
  it("saves trimmed text and keeps unrelated keys", () => {
    const row = baseRow({ food_preferences: { other_preferences: true } });
    const p = plan("food", { likes: " rice ", dislikes: "", style: "simple" }, row);
    expect(p.profilePatch.food_preferences).toEqual({ other_preferences: true, likes: "rice", style: "simple" });
  });

  it("removes a key when its field is emptied", () => {
    const row = baseRow({ food_preferences: { likes: "rice", dislikes: "fish" } });
    const p = plan("food", { likes: "", dislikes: "fish", style: "" }, row);
    expect(p.profilePatch.food_preferences).toEqual({ dislikes: "fish" });
  });

  it("rejects text over the limit and names the field", () => {
    expect(error("food", { likes: "", dislikes: "", style: "x".repeat(301) }).error).toEqual({ code: "too_long", field: "style" });
    expect(run("food", { likes: "x".repeat(300), dislikes: "", style: "" }).ok).toBe(true);
  });
});

describe("kashrut", () => {
  it("stores the two kashrut flags and the other-preferences flag apart", () => {
    const p = plan("kashrut", { kashrut: ["kashrut", "other_preferences"] }, baseRow({ kashrut: { note: 1 }, food_preferences: { likes: "a" } }));
    expect(p.profilePatch.kashrut).toEqual({ note: 1, kashrut: true, meat_dairy: false });
    expect(p.profilePatch.food_preferences).toEqual({ likes: "a", other_preferences: true });
  });

  it("treats an empty answer as an explicit none", () => {
    const p = plan("kashrut", { kashrut: [] }, baseRow({ kashrut: { kashrut: true } }));
    expect(p.profilePatch.kashrut).toEqual({ kashrut: false, meat_dairy: false });
    expect(p.profilePatch.food_preferences).toEqual({ other_preferences: false });
  });

  it("rejects an unknown option", () => {
    expect(error("kashrut", { kashrut: ["x"] }).error).toEqual({ code: "invalid_choice", field: "kashrut" });
  });
});

describe("offline", () => {
  const shabbatRaw = (over: RawFields = {}): RawFields => ({ offline: ["shabbat"], place: "jerusalem", candle_minutes: "", ...over });

  it("requires a place for Shabbat", () => {
    expect(error("offline", shabbatRaw({ place: "" })).error).toEqual({ code: "place_required", field: "place" });
    expect(error("offline", { offline: ["shabbat"] }).error).toEqual({ code: "place_required", field: "place" });
  });

  it("rejects a place that is not on the list", () => {
    expect(error("offline", shabbatRaw({ place: "atlantis" })).error).toEqual({ code: "unknown_place", field: "place" });
  });

  it("rejects minutes out of range", () => {
    expect(error("offline", shabbatRaw({ candle_minutes: "91" })).error).toEqual({ code: "out_of_range", field: "candle_minutes" });
    expect(error("offline", shabbatRaw({ candle_minutes: "abc" })).error).toEqual({ code: "invalid_number", field: "candle_minutes" });
  });

  it("uses the place default when the minutes are blank", () => {
    const p = plan("offline", shabbatRaw());
    expect(p.profilePatch.candle_lighting_minutes).toBe(40);
    expect(p.shabbat).toEqual({ placeKey: "jerusalem", candleMinutes: 40 });
  });

  it("keeps the minutes the user confirmed", () => {
    const p = plan("offline", shabbatRaw({ place: "tel_aviv", candle_minutes: "18" }));
    expect(p.profilePatch.candle_lighting_minutes).toBe(18);
    expect(p.shabbat).toEqual({ placeKey: "tel_aviv", candleMinutes: 18 });
  });

  it("copies the place into the profile, including its time zone", () => {
    const p = plan("offline", shabbatRaw({ place: "new_york", candle_minutes: "18" }));
    expect(p.profilePatch).toMatchObject({
      observes_shabbat: true,
      wants_other_offline: false,
      place_key: "new_york",
      city: "New York",
      in_israel: false,
      timezone: "America/New_York",
    });
    expect(p.redirectTo).toBe("/onboarding/why");
  });

  it("combines Shabbat with other times", () => {
    const p = plan("offline", shabbatRaw({ offline: ["shabbat", "other"] }));
    expect(p.profilePatch.wants_other_offline).toBe(true);
    expect(p.profilePatch.observes_shabbat).toBe(true);
  });

  it("does not accept none together with another choice", () => {
    expect(error("offline", { offline: ["none", "shabbat"] }).error).toEqual({ code: "conflicting_choices", field: "offline" });
    expect(error("offline", { offline: ["none", "other"] }).error.code).toBe("conflicting_choices");
  });

  it("rejects an unknown option", () => {
    expect(error("offline", { offline: ["weekend"] }).error).toEqual({ code: "invalid_choice", field: "offline" });
  });

  const cleared = {
    observes_shabbat: false,
    place_key: null,
    city: null,
    latitude: null,
    longitude: null,
    in_israel: null,
    candle_lighting_minutes: null,
  };

  it("clears the place and the Shabbat rows for none, and leaves the time zone alone", () => {
    const row = baseRow({ observes_shabbat: true, place_key: "haifa", city: "Haifa", timezone: "Asia/Jerusalem" });
    const p = plan("offline", { offline: ["none"] }, row);
    expect(p.profilePatch).toMatchObject({ ...cleared, wants_other_offline: false });
    expect(p.profilePatch).not.toHaveProperty("timezone");
    expect(p.shabbat).toBe("clear");
  });

  it("treats an empty answer as none", () => {
    const p = plan("offline", { offline: [] });
    expect(p.profilePatch).toMatchObject({ ...cleared, wants_other_offline: false });
    expect(p.shabbat).toBe("clear");
  });

  it("stores interest only for other times", () => {
    const p = plan("offline", { offline: ["other"] });
    expect(p.profilePatch).toMatchObject({ ...cleared, wants_other_offline: true });
    expect(p.shabbat).toBe("clear");
  });
});

describe("why", () => {
  it("saves the text, or null when empty", () => {
    expect(plan("why", { motivation: "  to feel better " }).profilePatch.motivation).toBe("to feel better");
    expect(plan("why", { motivation: "  " }, baseRow({ motivation: "old" })).profilePatch.motivation).toBeNull();
  });

  it("rejects text over the limit", () => {
    expect(error("why", { motivation: "x".repeat(1001) }).error).toEqual({ code: "too_long", field: "motivation" });
    expect(run("why", { motivation: "x".repeat(1000) }).ok).toBe(true);
  });
});

describe("notifications", () => {
  const row = baseRow({ onboarding_step: "why", notifications: { coach: false, meal_reporting: false, activity: true, weekly_weigh_in: false, weekly_summary: false } });

  it("finishes the step at once when nothing is chosen, keeping the activity flag", () => {
    const p = plan("notifications", { phase: "choices", notify: [] }, row);
    expect(p.notifications).toEqual({ coach: false, meal_reporting: false, activity: true, weekly_weigh_in: false, weekly_summary: false });
    expect(p.profilePatch.onboarding_step).toBe("notifications");
    expect(p.redirectTo).toBe("/onboarding/ready");
  });

  it("opens the device panel and leaves the step open when something is chosen", () => {
    const p = plan("notifications", { phase: "choices", notify: ["reporting", "weekly_summary"] }, row);
    expect(p.notifications).toMatchObject({ meal_reporting: true, weekly_summary: true, coach: false, weekly_weigh_in: false });
    expect(p.profilePatch).not.toHaveProperty("onboarding_step");
    expect(p.redirectTo).toBe("/onboarding/notifications?phase=device");
  });

  it("finishes the step when push is not configured", () => {
    const p = plan("notifications", { phase: "choices", notify: ["coach"] }, row, { pushConfigured: false });
    expect(p.notifications?.coach).toBe(true);
    expect(p.profilePatch.onboarding_step).toBe("notifications");
    expect(p.redirectTo).toBe("/onboarding/ready");
  });

  it("writes no preferences in the device phase and moves on", () => {
    const p = plan("notifications", { phase: "device" }, baseRow({ ...row, notifications: { ...row.notifications, coach: true } }));
    expect(p.notifications).toBeUndefined();
    expect(p.profilePatch).toEqual({ onboarding_step: "notifications" });
    expect(p.redirectTo).toBe("/onboarding/ready");
  });

  it("always sends exactly five boolean keys", () => {
    const p = plan("notifications", { notify: ["coach", "weekly_weigh_in"] }, row);
    expect(Object.keys(p.notifications ?? {}).sort()).toEqual(["activity", "coach", "meal_reporting", "weekly_summary", "weekly_weigh_in"]);
    expect(Object.values(p.notifications ?? {}).every((v) => typeof v === "boolean")).toBe(true);
  });

  it("rejects an unknown option", () => {
    expect(error("notifications", { phase: "choices", notify: ["sms"] }).error).toEqual({ code: "invalid_choice", field: "notify" });
  });
});

describe("ready", () => {
  it("finishes onboarding with one timestamp for both columns", () => {
    const p = plan("ready", {}, baseRow({ onboarding_step: "notifications" }));
    expect(p.finish).toBe(true);
    expect(p.redirectTo).toBe("/");
    expect(p.profilePatch).toEqual({
      lifecycle_state: "FIRST_WEEK",
      onboarding_completed_at: NOW.toISOString(),
      first_week_started_at: NOW.toISOString(),
      onboarding_step: "ready",
    });
    expect(p.shabbat).toBeUndefined();
  });

  it("asks for the Shabbat rows again when the user observes Shabbat", () => {
    const row = baseRow({ observes_shabbat: true, place_key: "haifa", candle_lighting_minutes: 30 });
    expect(plan("ready", {}, row).shabbat).toEqual({ placeKey: "haifa", candleMinutes: 30 });
  });

  it("does not, when the place is unknown or the minutes are missing", () => {
    expect(plan("ready", {}, baseRow({ observes_shabbat: true, place_key: "atlantis", candle_lighting_minutes: 20 })).shabbat).toBeUndefined();
    expect(plan("ready", {}, baseRow({ observes_shabbat: true, place_key: "haifa", candle_lighting_minutes: null })).shabbat).toBeUndefined();
    expect(plan("ready", {}, baseRow({ observes_shabbat: null })).shabbat).toBeUndefined();
  });

  it("asks to clear the Shabbat rows again when the user does not observe Shabbat", () => {
    expect(plan("ready", {}, baseRow({ observes_shabbat: false })).shabbat).toBe("clear");
  });

  it("is not available to a new user or to one who already finished", () => {
    expect(error("ready", {}, baseRow({ lifecycle_state: "NEW" })).error.code).toBe("step_not_available");
    expect(error("ready", {}, baseRow({ lifecycle_state: "FIRST_WEEK" })).error.code).toBe("step_not_available");
  });
});

describe("every plan", () => {
  const allowed = new Set([...ONBOARDING_ROW_COLUMNS.split(", "), "onboarding_completed_at", "first_week_started_at"]);

  const rawFor: Record<StepId, RawFields> = {
    welcome: {},
    goals: { goals: ["lose_weight"] },
    weight: { weight: "90" },
    "goal-weight": { goal_weight: "80" },
    "about-you": { age: "30", height: "170" },
    movement: { movement: "varies" },
    food: { likes: "a", dislikes: "b", style: "c" },
    kashrut: { kashrut: ["kashrut", "meat_dairy", "other_preferences"] },
    offline: { offline: ["shabbat", "other"], place: "haifa", candle_minutes: "" },
    why: { motivation: "x" },
    notifications: { phase: "choices", notify: ["coach"] },
    ready: {},
  };

  it.each(STEP_IDS)("%s writes only known profile columns", (step) => {
    const p = plan(step, rawFor[step]);
    for (const key of Object.keys(p.profilePatch)) expect(allowed.has(key)).toBe(true);
  });

  it("uses an error code the message catalog knows", () => {
    const e = error("weight", { weight: "abc" }).error;
    expect((STEP_ERROR_CODES as readonly string[]).includes(e.code)).toBe(true);
  });
});

describe("normalizeRow", () => {
  const profile = {
    lifecycle_state: "ONBOARDING",
    onboarding_step: "weight",
    goal_focus: ["lose_weight", "bogus", "lose_weight"],
    goal_type: "numeric",
    start_weight_kg: "99.5",
    goal_weight_kg: 90,
    age: 34,
    height_cm: "175.5",
    motivation: "why",
    kashrut: { kashrut: true },
    food_preferences: { likes: "a" },
    activity_preferences: { baseline: "varies" },
    place_key: "haifa",
    city: "Haifa",
    latitude: 32.79,
    longitude: 34.99,
    in_israel: true,
    timezone: "Asia/Jerusalem",
    candle_lighting_minutes: 30,
    observes_shabbat: true,
    wants_other_offline: true,
  };

  it("returns null when there is no profile or the lifecycle is unknown", () => {
    expect(normalizeRow(null, null)).toBeNull();
    expect(normalizeRow("x", null)).toBeNull();
    expect(normalizeRow([], null)).toBeNull();
    expect(normalizeRow({ ...profile, lifecycle_state: "LATER" }, null)).toBeNull();
  });

  it("coerces numerics, drops unknown goal keys and reads the notifications", () => {
    const row = normalizeRow(profile, { notifications: { coach: true, meal_reporting: "yes" } });
    expect(row).toMatchObject({
      onboarding_step: "weight",
      goal_focus: ["lose_weight"],
      start_weight_kg: 99.5,
      goal_weight_kg: 90,
      height_cm: 175.5,
      wants_other_offline: true,
    });
    expect(row?.notifications).toEqual({ coach: true, meal_reporting: false, activity: false, weekly_weigh_in: false, weekly_summary: false });
  });

  it("falls back safely for missing or malformed values", () => {
    const row = normalizeRow({ lifecycle_state: "NEW", onboarding_step: "nope", goal_focus: "x", kashrut: [], goal_type: "?" }, undefined);
    expect(row).toMatchObject({
      onboarding_step: null,
      goal_focus: [],
      goal_type: "none",
      kashrut: {},
      start_weight_kg: null,
      timezone: "Asia/Jerusalem",
      observes_shabbat: null,
      wants_other_offline: false,
    });
    expect(row?.notifications.coach).toBe(false);
  });

  it("selects exactly the columns of the row", () => {
    const row = normalizeRow(profile, null);
    const selected = ONBOARDING_ROW_COLUMNS.split(", ").sort();
    expect(Object.keys(row ?? {}).filter((k) => k !== "notifications").sort()).toEqual(selected);
  });
});

describe("prefillFor", () => {
  const row = normalizeRow(
    {
      lifecycle_state: "ONBOARDING",
      onboarding_step: "why",
      goal_focus: ["be_active", "feel_lighter"],
      goal_type: "numeric",
      start_weight_kg: 99.5,
      goal_weight_kg: 90,
      age: 34,
      height_cm: 175,
      motivation: "because",
      kashrut: { kashrut: true, meat_dairy: false },
      food_preferences: { likes: "a", dislikes: "b", style: "c", other_preferences: true },
      activity_preferences: { baseline: "some_walking" },
      place_key: "haifa",
      latitude: 32.79,
      longitude: 34.99,
      candle_lighting_minutes: 30,
      observes_shabbat: true,
      wants_other_offline: true,
    },
    { notifications: { coach: true, meal_reporting: false, activity: true, weekly_weigh_in: true, weekly_summary: false } },
  ) as OnboardingRow;

  it("turns the saved answers back into form values", () => {
    expect(prefillFor("welcome", row)).toEqual({});
    expect(prefillFor("ready", row)).toEqual({});
    expect(prefillFor("goals", row)).toEqual({ goals: ["be_active", "feel_lighter"] });
    expect(prefillFor("weight", row)).toEqual({ weight: "99.5" });
    expect(prefillFor("goal-weight", row)).toEqual({ goal_weight: "90" });
    expect(prefillFor("about-you", row)).toEqual({ age: "34", height: "175" });
    expect(prefillFor("movement", row)).toEqual({ movement: "some_walking" });
    expect(prefillFor("food", row)).toEqual({ likes: "a", dislikes: "b", style: "c" });
    expect(prefillFor("kashrut", row)).toEqual({ kashrut: ["kashrut", "other_preferences"] });
    expect(prefillFor("offline", row)).toEqual({ offline: ["shabbat", "other"], place: "haifa", candle_minutes: "30" });
    expect(prefillFor("why", row)).toEqual({ motivation: "because" });
    expect(prefillFor("notifications", row)).toEqual({ phase: "", notify: ["coach", "weekly_weigh_in"] });
  });

  it("leaves unanswered fields empty", () => {
    const empty = normalizeRow({ lifecycle_state: "ONBOARDING" }, null) as OnboardingRow;
    expect(prefillFor("weight", empty)).toEqual({ weight: "" });
    expect(prefillFor("movement", empty)).toEqual({ movement: "" });
    expect(prefillFor("offline", empty)).toEqual({ offline: [], place: "", candle_minutes: "" });
    expect(prefillFor("kashrut", empty)).toEqual({ kashrut: [] });
    expect(prefillFor("why", empty)).toEqual({ motivation: "" });
  });

  it("shows an explicit no as the none option", () => {
    const no = normalizeRow({ lifecycle_state: "ONBOARDING", observes_shabbat: false }, null) as OnboardingRow;
    expect(prefillFor("offline", no).offline).toEqual(["none"]);
  });

  it("round-trips through the planner", () => {
    // What the form would submit again from the prefilled values reproduces the same patch.
    const again = plan("goals", prefillFor("goals", row), row);
    expect(again.profilePatch.goal_focus).toEqual(row.goal_focus);
    const weightAgain = plan("weight", prefillFor("weight", row), row);
    expect(weightAgain.profilePatch.start_weight_kg).toBe(row.start_weight_kg);
  });
});
