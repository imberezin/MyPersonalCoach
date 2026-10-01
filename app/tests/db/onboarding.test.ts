import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USER_A, USER_B, as, createTestDb } from "./harness";

/**
 * The onboarding migration on a real Postgres: the new columns, the CHECKs that keep them
 * coherent, and replace_future_auto_shabbat. Row Level Security itself is covered by rls.test.ts.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const asA = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_A, fn);
const asB = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_B, fn);

const updateProfile = (set: string) => db.query(`update public.profiles set ${set}`);

/** The state of a user who finished onboarding with every optional answer given. */
const FULL_PROFILE = `
  lifecycle_state = 'FIRST_WEEK', onboarding_step = 'ready',
  onboarding_completed_at = now(), first_week_started_at = now(),
  goal_type = 'numeric', goal_weight_kg = 80, start_weight_kg = 90, goal_focus = '{lose_weight,be_active}',
  observes_shabbat = true, wants_other_offline = true,
  place_key = 'jerusalem', city = 'Jerusalem', latitude = 31.78, longitude = 35.22, in_israel = true, candle_lighting_minutes = 40,
  age = 40, height_cm = 180, motivation = 'x',
  kashrut = '{"kashrut": true}', food_preferences = '{"likes": "x"}', activity_preferences = '{"baseline": "varies"}'`;

/** The "reset onboarding for re-testing" SQL of SETUP-CHECKLIST.md. */
const DEV_RESET = `
  update public.profiles set lifecycle_state='NEW', onboarding_step=null, onboarding_completed_at=null, first_week_started_at=null,
    goal_type='none', goal_weight_kg=null, start_weight_kg=null, goal_focus='{}', observes_shabbat=null, wants_other_offline=false,
    place_key=null, city=null, latitude=null, longitude=null, in_israel=null, candle_lighting_minutes=null,
    age=null, height_cm=null, motivation=null, kashrut='{}', food_preferences='{}', activity_preferences='{}';
  delete from public.offline_periods where type='SHABBAT' and source='auto';
  update public.user_preferences set notifications='{"coach":false,"meal_reporting":false,"activity":false,"weekly_weigh_in":false,"weekly_summary":false}';
  delete from public.push_subscriptions;`;

describe("migration on top of the init schema", () => {
  it("gives the existing sign-up profile the defaults and satisfies every new CHECK", async () => {
    const { rows } = await db.query<Record<string, unknown>>(
      `select goal_focus, onboarding_step, observes_shabbat, wants_other_offline, place_key, goal_type, lifecycle_state
         from public.profiles where user_id = $1`,
      [USER_A],
    );
    expect(rows).toEqual([
      {
        goal_focus: [],
        onboarding_step: null,
        observes_shabbat: null,
        wants_other_offline: false,
        place_key: null,
        goal_type: "none",
        lifecycle_state: "NEW",
      },
    ]);
  });

  it("can validate the new constraints against the existing rows", async () => {
    await db.exec("alter table public.profiles validate constraint profiles_lifecycle_timestamps");
    await db.exec("alter table public.push_subscriptions validate constraint push_subscriptions_shape");
  });
});

describe("profiles columns and row level security", () => {
  it("lets the owner update the new columns", async () => {
    await asA(() => updateProfile("goal_focus = '{lose_weight,be_active}', onboarding_step = 'goals', wants_other_offline = true"));
    const { rows } = await asA(() => db.query("select goal_focus, onboarding_step, wants_other_offline from public.profiles"));
    expect(rows).toEqual([{ goal_focus: ["lose_weight", "be_active"], onboarding_step: "goals", wants_other_offline: true }]);
    await db.exec(DEV_RESET);
  });

  it("keeps another user from seeing or changing them", async () => {
    await asA(() => updateProfile("goal_focus = '{lose_weight}', onboarding_step = 'goals'"));

    await asB(async () => {
      const seen = await db.query("select goal_focus from public.profiles where user_id = $1", [USER_A]);
      expect(seen.rows).toHaveLength(0);
      const changed = await db.query(
        "update public.profiles set onboarding_step = 'ready' where user_id = $1 returning 1",
        [USER_A],
      );
      expect(changed.rows).toHaveLength(0);
    });

    const { rows } = await asA(() => db.query("select onboarding_step from public.profiles"));
    expect(rows).toEqual([{ onboarding_step: "goals" }]);
    await db.exec(DEV_RESET);
  });
});

describe("profiles CHECKs", () => {
  const REJECTED: Array<{ name: string; set: string; constraint: string }> = [
    { name: "an unknown goal key", set: "goal_focus = '{lose_weight,nonsense}'", constraint: "profiles_goal_focus_valid" },
    { name: "not_sure together with another goal", set: "goal_focus = '{not_sure,lose_weight}'", constraint: "profiles_goal_focus_not_sure_alone" },
    { name: "a numeric goal without a goal weight", set: "goal_type = 'numeric', goal_weight_kg = null", constraint: "profiles_goal_type_matches_weight" },
    { name: "a goal weight with a non-numeric goal type", set: "goal_type = 'none', goal_weight_kg = 80", constraint: "profiles_goal_type_matches_weight" },
    { name: "an unknown onboarding step", set: "onboarding_step = 'x'", constraint: "profiles_onboarding_step_valid" },
    { name: "observing Shabbat without a place", set: "observes_shabbat = true", constraint: "profiles_shabbat_needs_place" },
    {
      name: "observing Shabbat with a place but no minutes",
      set: "observes_shabbat = true, place_key = 'jerusalem', latitude = 31.78, longitude = 35.22, in_israel = true",
      constraint: "profiles_shabbat_needs_place",
    },
    { name: "FIRST_WEEK without both timestamps", set: "lifecycle_state = 'FIRST_WEEK', onboarding_completed_at = now()", constraint: "profiles_lifecycle_timestamps" },
    { name: "a json array in kashrut", set: "kashrut = '[]'::jsonb", constraint: "profiles_preferences_shape" },
    { name: "a json scalar in food_preferences", set: "food_preferences = '\"x\"'::jsonb", constraint: "profiles_preferences_shape" },
    { name: "an unknown activity baseline", set: `activity_preferences = '{"baseline": "zzz"}'`, constraint: "profiles_activity_baseline_valid" },
    { name: "a motivation over 2000 characters", set: "motivation = repeat('x', 2001)", constraint: "profiles_motivation_length" },
    { name: "a place key over 64 characters", set: "place_key = repeat('x', 65)", constraint: "profiles_place_key_length" },
  ];

  for (const { name, set, constraint } of REJECTED) {
    it(`rejects ${name}`, async () => {
      await expect(asA(() => updateProfile(set))).rejects.toThrow(constraint);
    });
  }

  it("accepts the full finished state and every valid goal key, baseline and step", async () => {
    await asA(() => updateProfile(FULL_PROFILE));
    const goals = ["lose_weight", "feel_lighter", "improve_eating", "be_active", "understand_overeating", "not_sure"];
    for (const goal of goals) await asA(() => updateProfile(`goal_focus = '{${goal}}'`));
    for (const baseline of ["almost_none", "some_walking", "active_part_of_week", "active_most_of_week", "varies"]) {
      await asA(() => updateProfile(`activity_preferences = '{"baseline": "${baseline}"}'`));
    }
    await db.exec(DEV_RESET);
  });

  it("accepts the dev-reset statements of SETUP-CHECKLIST.md after a finished onboarding", async () => {
    await asA(() => updateProfile(FULL_PROFILE));
    await asA(() => db.exec(DEV_RESET));

    const { rows } = await asA(() =>
      db.query<Record<string, unknown>>(
        `select lifecycle_state, onboarding_step, onboarding_completed_at, first_week_started_at, goal_type, goal_weight_kg,
                start_weight_kg, goal_focus, observes_shabbat, wants_other_offline, place_key, candle_lighting_minutes,
                kashrut, food_preferences, activity_preferences
           from public.profiles`,
      ),
    );
    expect(rows).toEqual([
      {
        lifecycle_state: "NEW",
        onboarding_step: null,
        onboarding_completed_at: null,
        first_week_started_at: null,
        goal_type: "none",
        goal_weight_kg: null,
        start_weight_kg: null,
        goal_focus: [],
        observes_shabbat: null,
        wants_other_offline: false,
        place_key: null,
        candle_lighting_minutes: null,
        kashrut: {},
        food_preferences: {},
        activity_preferences: {},
      },
    ]);
  });
});

describe("notifications shape", () => {
  const setNotifications = (json: string) =>
    asA(() => db.query("update public.user_preferences set notifications = $1::jsonb", [json]));

  const ALL = { coach: true, meal_reporting: false, activity: false, weekly_weigh_in: true, weekly_summary: false };

  it("accepts an object with all five booleans", async () => {
    await setNotifications(JSON.stringify(ALL));
    await db.exec(DEV_RESET);
  });

  it("rejects an object that misses a key", async () => {
    const withoutCoach: Partial<typeof ALL> = { ...ALL };
    delete withoutCoach.coach;
    await expect(setNotifications(JSON.stringify(withoutCoach))).rejects.toThrow("user_preferences_notifications_shape");
  });

  it("rejects a non-boolean value", async () => {
    await expect(setNotifications(JSON.stringify({ ...ALL, coach: "yes" }))).rejects.toThrow("user_preferences_notifications_shape");
    await expect(setNotifications(JSON.stringify({ ...ALL, activity: null }))).rejects.toThrow("user_preferences_notifications_shape");
  });

  it("rejects an array", async () => {
    await expect(setNotifications("[true, false]")).rejects.toThrow("user_preferences_notifications_shape");
  });
});

describe("push subscriptions", () => {
  const insertSubscription = (endpoint: string, p256dh = "k", auth = "a") =>
    asA(() =>
      db.query("insert into public.push_subscriptions (endpoint, p256dh, auth) values ($1, $2, $3)", [endpoint, p256dh, auth]),
    );

  it("accepts an https endpoint with keys", async () => {
    await insertSubscription("https://push.example/abc");
  });

  it("rejects an http endpoint", async () => {
    await expect(insertSubscription("http://push.example/abc")).rejects.toThrow("push_subscriptions_shape");
  });

  it("rejects empty keys", async () => {
    await expect(insertSubscription("https://push.example/empty-p256dh", "")).rejects.toThrow("push_subscriptions_shape");
    await expect(insertSubscription("https://push.example/empty-auth", "k", "")).rejects.toThrow("push_subscriptions_shape");
  });

  it("rejects an endpoint over 2048 characters", async () => {
    await expect(insertSubscription(`https://push.example/${"x".repeat(2048)}`)).rejects.toThrow("push_subscriptions_shape");
  });
});

describe("replace_future_auto_shabbat", () => {
  type Row = { start_at: string; end_at: string; metadata: Record<string, unknown> };

  /** A one-day period that starts `startDays` from now (negative = in the past). */
  const period = (startDays: number, tag = "x"): Row => ({
    start_at: new Date(Date.now() + startDays * 86_400_000).toISOString(),
    end_at: new Date(Date.now() + (startDays + 1) * 86_400_000).toISOString(),
    metadata: { tag },
  });

  const replace = (rows: unknown) =>
    asA(async () => {
      const { rows: out } = await db.query<{ n: number }>(
        "select public.replace_future_auto_shabbat($1::jsonb) as n",
        [JSON.stringify(rows)],
      );
      return out[0].n;
    });

  const insertDirect = (userId: string, row: Row, source: "auto" | "manual", type = "SHABBAT") =>
    as(db, "authenticated", userId, () =>
      db.query(
        "insert into public.offline_periods (type, start_at, end_at, source, metadata) values ($1, $2, $3, $4, $5::jsonb)",
        [type, row.start_at, row.end_at, source, JSON.stringify(row.metadata)],
      ),
    );

  const listFor = (userId: string) =>
    as(db, "authenticated", userId, async () => {
      const { rows } = await db.query<{ source: string; tag: string; start_at: Date }>(
        "select source, metadata ->> 'tag' as tag, start_at from public.offline_periods order by start_at",
      );
      return rows.map((r) => `${r.source}:${r.tag}`);
    });

  beforeEach(async () => {
    await db.exec("delete from public.offline_periods");
  });

  it("is idempotent: the same rows twice give the same count and no duplicates", async () => {
    const rows = [period(2, "a"), period(9, "b")];
    expect(await replace(rows)).toBe(2);
    expect(await replace(rows)).toBe(2);
    expect(await listFor(USER_A)).toEqual(["auto:a", "auto:b"]);
  });

  it("replaces future automatic rows when the input changes", async () => {
    await replace([period(2, "old1"), period(9, "old2")]);
    await replace([period(3, "new1"), period(10, "new2"), period(17, "new3")]);
    expect(await listFor(USER_A)).toEqual(["auto:new1", "auto:new2", "auto:new3"]);
  });

  it("keeps past automatic rows and manual rows, and removes only future automatic ones", async () => {
    await insertDirect(USER_A, period(-10, "past"), "auto");
    await insertDirect(USER_A, period(5, "manual"), "manual");
    await insertDirect(USER_A, period(6, "other_type"), "auto", "HOLIDAY");
    await insertDirect(USER_A, period(7, "future_auto"), "auto");

    await replace([period(2, "fresh")]);
    expect(await listFor(USER_A)).toEqual(["auto:past", "auto:fresh", "manual:manual", "auto:other_type"]);
  });

  it("clears only the future automatic rows when given an empty array", async () => {
    await insertDirect(USER_A, period(-10, "past"), "auto");
    await insertDirect(USER_A, period(5, "manual"), "manual");
    await replace([period(2, "a"), period(9, "b")]);

    expect(await replace([])).toBe(0);
    expect(await listFor(USER_A)).toEqual(["auto:past", "manual:manual"]);
  });

  it("never touches another user's rows", async () => {
    await insertDirect(USER_B, period(2, "b_future"), "auto");
    await replace([period(2, "a")]);
    await replace([]);
    expect(await listFor(USER_B)).toEqual(["auto:b_future"]);
  });

  it("raises for anything that is not a json array", async () => {
    await expect(replace({ start_at: "x" })).rejects.toThrow("p_rows must be a json array");
    await expect(replace(null)).rejects.toThrow("p_rows must be a json array");
  });

  it("raises for more than 60 rows and accepts exactly 60", async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => period(1 + i, `r${i}`));
    await expect(replace(many(61))).rejects.toThrow("at most 60");
    expect(await replace(many(60))).toBe(60);
  });

  it("is denied to the anonymous role", async () => {
    await expect(
      as(db, "anon", null, () => db.query("select public.replace_future_auto_shabbat('[]'::jsonb)")),
    ).rejects.toThrow(/permission denied/);
  });

  it("raises when there is no signed-in user", async () => {
    await expect(
      as(db, "authenticated", null, () => db.query("select public.replace_future_auto_shabbat('[]'::jsonb)")),
    ).rejects.toThrow("not_authenticated");
  });
});
