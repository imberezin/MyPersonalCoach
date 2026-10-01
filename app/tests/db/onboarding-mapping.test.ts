import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ACTIVITY_BASELINE_KEYS,
  GOAL_FOCUS_KEYS,
  ONBOARDING_ROW_COLUMNS,
  STEP_IDS,
  normalizeRow,
  planStep,
  prefillFor,
  type OnboardingRow,
  type ProfilePatch,
  type RawFields,
  type StepId,
  type StepIntent,
  type StepPlan,
} from "@/domain/onboarding";
import { PLACES } from "@/domain/places";
import { USER_A, as, createTestDb } from "./harness";

/**
 * The planner's output replayed on the real schema: every write the planner can produce must be
 * accepted by the migration's CHECKs, and reading the row back must show the answer again.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const NOW = new Date("2026-10-01T09:00:00.000Z");

const asA = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_A, fn);

/** Columns whose value must be cast, because the driver sends parameters untyped. */
const CAST: Record<string, string> = {
  goal_focus: "::text[]",
  kashrut: "::jsonb",
  food_preferences: "::jsonb",
  activity_preferences: "::jsonb",
  onboarding_completed_at: "::timestamptz",
  first_week_started_at: "::timestamptz",
};

const ALLOWED_COLUMNS = new Set([
  ...ONBOARDING_ROW_COLUMNS.split(", "),
  "onboarding_completed_at",
  "first_week_started_at",
]);

async function writeProfile(patch: ProfilePatch): Promise<void> {
  const entries = Object.entries(patch);
  if (entries.length === 0) return;
  for (const [column] of entries) expect(ALLOWED_COLUMNS, `column ${column}`).toContain(column);

  const sets = entries.map(([column], i) => `${column} = $${i + 1}${CAST[column] ?? ""}`);
  const values = entries.map(([column, value]) =>
    CAST[column] === "::jsonb" ? JSON.stringify(value) : value,
  );
  await asA(() => db.query(`update public.profiles set ${sets.join(", ")}`, values));
}

async function writeNotifications(notifications: object): Promise<void> {
  await asA(() => db.query("update public.user_preferences set notifications = $1::jsonb", [JSON.stringify(notifications)]));
}

/** The row the way the server reads it: the profiles select list plus user_preferences.notifications. */
async function readRow(): Promise<OnboardingRow> {
  return asA(async () => {
    const profile = await db.query(`select ${ONBOARDING_ROW_COLUMNS} from public.profiles`);
    const prefs = await db.query("select notifications from public.user_preferences");
    const row = normalizeRow(profile.rows[0], prefs.rows[0]);
    expect(row).not.toBeNull();
    return row as OnboardingRow;
  });
}

interface Replay {
  plan: StepPlan;
  row: OnboardingRow;
}

/** Plans one step against the stored row, applies the plan to the database and reads the row back. */
async function replay(
  step: StepId,
  raw: RawFields,
  options: { intent?: StepIntent; pushConfigured?: boolean } = {},
): Promise<Replay> {
  const result = planStep({
    step,
    intent: options.intent ?? "continue",
    raw,
    row: await readRow(),
    now: NOW,
    pushConfigured: options.pushConfigured ?? true,
  });
  if (!result.ok) throw new Error(`${step} was rejected by the planner: ${JSON.stringify(result.error)}`);

  await writeProfile(result.plan.profilePatch);
  if (result.plan.notifications) await writeNotifications(result.plan.notifications);
  return { plan: result.plan, row: await readRow() };
}

/** A user who just signed up: every onboarding column at its default. */
async function resetToNew(): Promise<void> {
  await db.exec(`
    update public.profiles set lifecycle_state='NEW', onboarding_step=null, onboarding_completed_at=null, first_week_started_at=null,
      goal_type='none', goal_weight_kg=null, start_weight_kg=null, goal_focus='{}', observes_shabbat=null, wants_other_offline=false,
      place_key=null, city=null, latitude=null, longitude=null, in_israel=null, candle_lighting_minutes=null, timezone='Asia/Jerusalem',
      age=null, height_cm=null, motivation=null, kashrut='{}', food_preferences='{}', activity_preferences='{}';
    update public.user_preferences set notifications='{"coach":false,"meal_reporting":false,"activity":false,"weekly_weigh_in":false,"weekly_summary":false}';`);
}

/** A1 done: the row is ONBOARDING, the state every later step needs. */
async function startOnboarding(): Promise<void> {
  await resetToNew();
  const { row } = await replay("welcome", {});
  expect(row.lifecycle_state).toBe("ONBOARDING");
}

afterEach(resetToNew);

describe("every step, in order, on the real schema", () => {
  it("accepts each plan and shows each answer again", async () => {
    await resetToNew();

    let { row } = await replay("welcome", {});
    expect(row.lifecycle_state).toBe("ONBOARDING");
    expect(row.onboarding_step).toBe("welcome");

    ({ row } = await replay("goals", { goals: ["lose_weight", "be_active"] }));
    expect(prefillFor("goals", row)).toEqual({ goals: ["lose_weight", "be_active"] });
    expect(row.goal_type).toBe("behavioral");

    ({ row } = await replay("weight", { weight: "99,56" }));
    expect(prefillFor("weight", row)).toEqual({ weight: "99.6" });

    ({ row } = await replay("goal-weight", { goal_weight: "85" }));
    expect(prefillFor("goal-weight", row)).toEqual({ goal_weight: "85" });
    expect(row.goal_type).toBe("numeric");

    ({ row } = await replay("about-you", { age: "41", height: "180,5" }));
    expect(prefillFor("about-you", row)).toEqual({ age: "41", height: "180.5" });

    ({ row } = await replay("movement", { movement: "some_walking" }));
    expect(prefillFor("movement", row)).toEqual({ movement: "some_walking" });

    ({ row } = await replay("food", { likes: "  שקשוקה ", dislikes: "", style: "מבושל" }));
    expect(prefillFor("food", row)).toEqual({ likes: "שקשוקה", dislikes: "", style: "מבושל" });

    ({ row } = await replay("kashrut", { kashrut: ["kashrut", "meat_dairy", "other_preferences"] }));
    expect(prefillFor("kashrut", row)).toEqual({ kashrut: ["kashrut", "meat_dairy", "other_preferences"] });

    ({ row } = await replay("offline", { offline: ["shabbat", "other"], place: "jerusalem", candle_minutes: "" }));
    expect(prefillFor("offline", row)).toEqual({ offline: ["shabbat", "other"], place: "jerusalem", candle_minutes: "40" });
    expect(row.timezone).toBe("Asia/Jerusalem");

    ({ row } = await replay("why", { motivation: "ליהנות מהחיים\r\nבלי מאבק" }));
    expect(prefillFor("why", row)).toEqual({ motivation: "ליהנות מהחיים\nבלי מאבק" });

    ({ row } = await replay("notifications", { phase: "choices", notify: ["reporting", "weekly_summary"] }, { pushConfigured: true }));
    expect(prefillFor("notifications", row)).toEqual({ phase: "", notify: ["reporting", "weekly_summary"] });
    // The choices were saved, the step stays open until the device panel is done.
    expect(row.onboarding_step).toBe("why");

    ({ row } = await replay("notifications", { phase: "device" }));
    expect(row.onboarding_step).toBe("notifications");

    const finished = await replay("ready", {});
    expect(finished.plan.finish).toBe(true);
    expect(finished.plan.shabbat).toEqual({ placeKey: "jerusalem", candleMinutes: 40 });
    expect(finished.row.lifecycle_state).toBe("FIRST_WEEK");
    expect(finished.row.onboarding_step).toBe("ready");

    const { rows } = await asA(() =>
      db.query<{ done: string; started: string }>(
        "select onboarding_completed_at::text as done, first_week_started_at::text as started from public.profiles",
      ),
    );
    expect(rows[0].done).not.toBeNull();
    expect(rows[0].done).toBe(rows[0].started);
  });
});

describe("answers that clear or skip", () => {
  it("clears the goal weight and the goal type when the weight is emptied", async () => {
    await startOnboarding();
    await replay("goals", { goals: ["lose_weight"] });
    await replay("weight", { weight: "90" });
    await replay("goal-weight", { goal_weight: "80" });

    const { row } = await replay("weight", { weight: "" });
    expect(row.start_weight_kg).toBeNull();
    expect(row.goal_weight_kg).toBeNull();
    expect(row.goal_type).toBe("behavioral");
  });

  it("saves a goal weight above the start weight without complaint", async () => {
    await startOnboarding();
    await replay("weight", { weight: "70" });
    const { row } = await replay("goal-weight", { goal_weight: "75" });
    expect(row.goal_weight_kg).toBe(75);
    expect(row.goal_type).toBe("numeric");
  });

  it("accepts the bounds of every numeric range", async () => {
    await startOnboarding();
    for (const [weight, age, height] of [
      ["20", "10", "80"],
      ["500", "120", "250"],
    ]) {
      const { row } = await replay("weight", { weight });
      expect(row.start_weight_kg).toBe(Number(weight));
      await replay("about-you", { age, height });
      expect((await readRow()).age).toBe(Number(age));
      expect((await readRow()).height_cm).toBe(Number(height));
    }
  });

  it("declines the goal weight", async () => {
    await startOnboarding();
    await replay("weight", { weight: "90" });
    await replay("goal-weight", { goal_weight: "80" });
    const { row } = await replay("goal-weight", { goal_weight: "80" }, { intent: "decline" });
    expect(row.goal_weight_kg).toBeNull();
    expect(row.goal_type).toBe("none");
  });

  it("keeps every answer on a skip and moves only the pointer", async () => {
    await startOnboarding();
    await replay("goals", { goals: ["feel_lighter"] });
    const before = await readRow();
    const { row } = await replay("weight", { weight: "ignored" }, { intent: "skip" });
    expect(row).toEqual({ ...before, onboarding_step: "weight" });
  });

  it("clears the Shabbat columns on a later 'no', keeping the timezone", async () => {
    await startOnboarding();
    await replay("offline", { offline: ["shabbat"], place: "new_york", candle_minutes: "18" });
    expect((await readRow()).timezone).toBe("America/New_York");

    const { plan, row } = await replay("offline", { offline: ["none"], place: "", candle_minutes: "" });
    expect(plan.shabbat).toBe("clear");
    expect(prefillFor("offline", row)).toEqual({ offline: ["none"], place: "", candle_minutes: "" });
    expect(row.in_israel).toBeNull();
    expect(row.timezone).toBe("America/New_York");
  });

  it("stores interest in other times alone", async () => {
    await startOnboarding();
    const { row } = await replay("offline", { offline: ["other"] });
    expect(prefillFor("offline", row)).toEqual({ offline: ["other"], place: "", candle_minutes: "" });
  });

  it("keeps an explicit 18 minutes in Israel", async () => {
    await startOnboarding();
    const { row } = await replay("offline", { offline: ["shabbat"], place: "tel_aviv", candle_minutes: "18" });
    expect(row.candle_lighting_minutes).toBe(18);
  });

  it("saves all five notification keys and keeps activity", async () => {
    await startOnboarding();
    await writeNotifications({ coach: false, meal_reporting: false, activity: true, weekly_weigh_in: false, weekly_summary: false });
    const { plan, row } = await replay("notifications", { phase: "choices", notify: [] }, { pushConfigured: false });
    expect(plan.notifications).toEqual({ coach: false, meal_reporting: false, activity: true, weekly_weigh_in: false, weekly_summary: false });
    expect(row.notifications.activity).toBe(true);
    expect(row.onboarding_step).toBe("notifications");
  });

  it("merges the food answers into the stored object and keeps the kashrut flag of A8", async () => {
    await startOnboarding();
    await replay("kashrut", { kashrut: ["other_preferences"] });
    const { row } = await replay("food", { likes: "x", dislikes: "", style: "" });
    expect(row.food_preferences).toEqual({ other_preferences: true, likes: "x" });
    expect(prefillFor("kashrut", row)).toEqual({ kashrut: ["other_preferences"] });
  });

  it("keeps a text of 1000 emoji (code points, within the 2000-character CHECK)", async () => {
    await startOnboarding();
    const motivation = "😀".repeat(1000);
    const { row } = await replay("why", { motivation });
    expect(row.motivation).toBe(motivation);
  });
});

describe("every key the planner can write is accepted by the schema", () => {
  it("accepts each goal key on its own", async () => {
    await startOnboarding();
    for (const key of GOAL_FOCUS_KEYS) {
      const { row } = await replay("goals", { goals: [key] });
      expect(row.goal_focus).toEqual([key]);
    }
  });

  it("accepts each movement key", async () => {
    await startOnboarding();
    for (const key of ACTIVITY_BASELINE_KEYS) {
      const { row } = await replay("movement", { movement: key });
      expect(prefillFor("movement", row)).toEqual({ movement: key });
    }
  });

  it("accepts every step id as the pointer", async () => {
    for (const step of STEP_IDS) {
      await expect(asA(() => db.query("update public.profiles set onboarding_step = $1", [step]))).resolves.toBeDefined();
    }
  });

  it("accepts every curated place with its default minutes", async () => {
    await startOnboarding();
    for (const place of PLACES) {
      const { row } = await replay("offline", { offline: ["shabbat"], place: place.key, candle_minutes: "" });
      expect(row.place_key).toBe(place.key);
      expect(row.city).toBe(place.cityName);
      expect(row.in_israel).toBe(place.inIsrael);
      expect(row.timezone).toBe(place.timezone);
      expect(row.candle_lighting_minutes).toBe(place.candleDefault);
    }
  });

  it("rejects values the planner never produces", async () => {
    const BAD = [
      "goal_focus = '{nonsense}'",
      "onboarding_step = 'x'",
      `activity_preferences = '{"baseline": "zzz"}'`,
    ];
    for (const set of BAD) {
      await expect(asA(() => db.query(`update public.profiles set ${set}`))).rejects.toThrow(/check constraint/);
    }
  });
});

describe("the planner gives the database nothing it refuses", () => {
  it("never plans a write while the row is NEW, except the first step", async () => {
    await resetToNew();
    const row = await readRow();
    for (const step of STEP_IDS.filter((s) => s !== "welcome")) {
      const result = planStep({ step, intent: "continue", raw: {}, row, now: NOW, pushConfigured: true });
      expect(result.ok).toBe(false);
    }
  });

  it("finishes only from ONBOARDING and the finished row passes the timestamp CHECK", async () => {
    await startOnboarding();
    const first = await replay("ready", {});
    expect(first.row.lifecycle_state).toBe("FIRST_WEEK");

    const again = planStep({ step: "ready", intent: "continue", raw: {}, row: first.row, now: NOW, pushConfigured: true });
    expect(again.ok).toBe(false);
  });
});
