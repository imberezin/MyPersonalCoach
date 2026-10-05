import { describe, expect, it } from "vitest";
import { parseSeedArgs, type SeedOptions } from "../../scripts/seed-demo/args";
import { formatExplain, type ExplainFacts } from "../../scripts/seed-demo/explain";
import {
  runSeed,
  type DbSession,
  type ExperimentRow,
  type MealRow,
  type SeedDeps,
  type SignInResult,
  type StackStatus,
  type WeeklySummaryRow,
  type WeightEntryRow,
} from "../../scripts/seed-demo/run";
import type { PlannedPatternAnswer } from "../../scripts/seed-demo/weekly";
import type { ShabbatPeriodRow } from "@/domain/onboarding/shabbatRows";

/**
 * The runner with every outside thing faked. The rule under test: what it prints is counts, instants, the demo e-mail and
 * short codes, never the password, a key, a user id or a `.env` path, for every mode and for failures whose underlying
 * error text DOES contain those secrets.
 */

const PASSWORD = "Sup3r-secret-pw-ZXCV";
const PUBLISHABLE_KEY = "sb_publishable_ABCDEF123456";
const ADMIN_KEY = "sb_secret_QWERTY987654";
const USER_ID = "11111111-2222-4333-8444-555555555555";
const JWT = "eyJhbGciOiJIUzI1NiJ9.payload.signature";
const EMAIL = "demo@eating-coach.test";
const LOCAL: StackStatus = { apiUrl: "http://127.0.0.1:54321", publishableKey: PUBLISHABLE_KEY };
const SECRETS = [PASSWORD, PUBLISHABLE_KEY, ADMIN_KEY, USER_ID, JWT];

function opts(flags: Record<string, string | boolean>): SeedOptions {
  const parsed = parseSeedArgs(JSON.stringify(flags));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const CLEAN_FACTS = (over: Partial<ExplainFacts> = {}): ExplainFacts => ({
  email: EMAIL,
  now: new Date("2026-09-16T06:00:00.000Z"), // Wed 09:00 Asia/Jerusalem
  clockFile: "2026-09-16T09:00:00+03:00",
  timeZone: "Asia/Jerusalem",
  lifecycle: "FIRST_WEEK",
  progress: { availableDays: 3, confirmedMeals: 10, availableDaysSinceLastMeal: 0 },
  step: { kind: "KEEP_GOING" },
  signal: {
    occurrences: [
      { mealId: "m1", occurredAt: new Date("2026-09-14T18:40:00.000Z"), localDay: "2026-09-14" },
      { mealId: "m2", occurredAt: new Date("2026-09-15T19:05:00.000Z"), localDay: "2026-09-15" },
    ],
    row: null,
    view: "EARLY_SIGNAL",
  },
  excluded: [],
  storedEvidence: null,
  earlySignal: { due: true, level: "EARLY_SIGNAL" },
  quietHours: { kind: "WINDOW", startMinute: 0, endMinute: 480 },
  home: { state: { key: "EARLY_SIGNAL", signal: "late_evening_meals" }, action: { kind: "ANSWER_EARLY_SIGNAL" }, degraded: false, weeklyLink: false },
  selection: { kind: "NONE", reason: "pattern_not_established" },
  dailyCap: 40,
  weight: null,
  weekly: { kind: "NOT_WEEKLY_CYCLE" },
  ...over,
});

interface Rig {
  deps: SeedDeps;
  lines: string[];
  calls: string[];
  profile: unknown[];
  shabbat: ShabbatPeriodRow[];
  meals: MealRow[];
  weights: WeightEntryRow[];
  experiments: ExperimentRow[];
  answers: PlannedPatternAnswer[];
  weekly: WeeklySummaryRow[];
  clock: { instant: Date | null };
  text(): string;
}

function rig(over: { stack?: StackStatus | null; password?: string | undefined; signIn?: SeedDeps["signIn"]; session?: Partial<DbSession>; adminFails?: boolean; existingClock?: Date } = {}): Rig {
  const lines: string[] = [];
  const calls: string[] = [];
  const profile: unknown[] = [];
  const shabbat: ShabbatPeriodRow[] = [];
  const meals: MealRow[] = [];
  const weights: WeightEntryRow[] = [];
  const experiments: ExperimentRow[] = [];
  const answers: PlannedPatternAnswer[] = [];
  const weekly: WeeklySummaryRow[] = [];
  const clock = { instant: over.existingClock ?? (null as Date | null) };

  const session: DbSession = {
    email: EMAIL,
    async writeProfile(fields) {
      calls.push("writeProfile");
      profile.push(fields);
    },
    async upsertShabbat(rows) {
      calls.push("upsertShabbat");
      shabbat.push(...rows);
    },
    async listPeriods() {
      calls.push("listPeriods");
      return shabbat.map((r, i) => ({ id: `period-${i}`, startAt: new Date(r.start_at) }));
    },
    async upsertMeals(rows) {
      calls.push("upsertMeals");
      meals.push(...rows);
      return rows.length;
    },
    async dropMeals(count) {
      calls.push(`dropMeals:${count}`);
      return typeof count === "number" ? count : 7;
    },
    async upsertWeights(rows) {
      calls.push("upsertWeights");
      weights.push(...rows);
      return rows.length;
    },
    async dropWeights(count) {
      calls.push(`dropWeights:${count}`);
      return typeof count === "number" ? count : 5;
    },
    async upsertExperiments(rows) {
      calls.push("upsertExperiments");
      experiments.push(...rows);
      return rows.length;
    },
    async writePatternAnswer(answer) {
      calls.push("writePatternAnswer");
      answers.push(answer);
      return true;
    },
    async upsertWeeklySummary(row) {
      calls.push("upsertWeeklySummary");
      weekly.push(row);
      return 1;
    },
    async explain() {
      calls.push("explain");
      return CLEAN_FACTS();
    },
    ...over.session,
  };

  const deps: SeedDeps = {
    log: (line) => lines.push(line),
    now: () => new Date("2026-10-02T12:34:56.000Z"),
    password: "password" in over ? over.password : PASSWORD,
    readStack: () => (over.stack === undefined ? LOCAL : over.stack),
    admin: {
      async createUser() {
        calls.push("createUser");
        if (over.adminFails) throw new Error(`admin refused ${ADMIN_KEY} for ${PASSWORD}`);
      },
      async deleteUser() {
        calls.push("deleteUser");
        return true;
      },
    },
    signIn:
      over.signIn ??
      (async (): Promise<SignInResult> => {
        calls.push("signIn");
        return { ok: true, session };
      }),
    clock: {
      read: () => (clock.instant ? new Date(clock.instant) : null),
      write(instant) {
        calls.push("clockWrite");
        clock.instant = instant;
        return instant.toISOString().replace("Z", "+00:00");
      },
      remove() {
        calls.push("clockRemove");
        const had = clock.instant !== null;
        clock.instant = null;
        return had;
      },
    },
  };
  return { deps, lines, calls, profile, shabbat, meals, weights, experiments, answers, weekly, clock, text: () => lines.join("\n") };
}

function expectNoLeak(r: Rig) {
  const text = r.text();
  for (const secret of SECRETS) expect(text, `leaked ${secret.slice(0, 8)}...`).not.toContain(secret);
  expect(text).not.toMatch(/\.env/i);
  expect(text).not.toMatch(/eyJ|sb_|service_role|secret_key/i);
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/); // no uuid: not a user id, not a meal id
}

const WARNING = /dev clock is ON: \S+; meals cannot be saved through the UI until you run --clock-off or --mode relative/;
const warnings = (r: Rig) => r.lines.filter((l) => l.includes("dev clock is ON"));

describe("a seeding run", () => {
  it("fixed mode: seeds, writes the clock and prints ONE warning line; nothing secret is printed", async () => {
    const r = rig();
    const result = await runSeed(opts({ scenario: "day3" }), r.deps);
    expect(result).toEqual({ ok: true });

    expect(r.calls).toEqual(["signIn", "writeProfile", "upsertShabbat", "listPeriods", "upsertMeals", "clockWrite"]);
    expect(r.profile).toHaveLength(1);
    expect(r.profile[0]).toMatchObject({ lifecycle_state: "FIRST_WEEK", first_week_ended_at: null, goal_type: "numeric" });
    expect(r.meals).toHaveLength(10);
    expect(r.shabbat.length).toBeGreaterThanOrEqual(3);
    expect(r.clock.instant?.toISOString()).toBe("2026-09-16T06:00:00.000Z");

    expect(r.text()).toContain(`Seeded ${EMAIL}: 10 meals planned (10 new)`);
    expect(warnings(r)).toHaveLength(1);
    expect(warnings(r)[0]).toMatch(WARNING);
    expect(warnings(r)[0]).toContain("2026-09-16T09:00:00+03:00");
    expectNoLeak(r);
  });

  it("relative mode: writes NO clock file, removes an old one and prints no warning", async () => {
    const r = rig({ existingClock: new Date("2026-09-16T06:00:00Z") });
    const result = await runSeed(opts({ scenario: "day3", mode: "relative" }), r.deps);
    expect(result).toEqual({ ok: true });
    expect(r.calls).toContain("clockRemove");
    expect(r.calls).not.toContain("clockWrite");
    expect(r.clock.instant).toBeNull();
    expect(warnings(r)).toHaveLength(0);
    expect(r.text()).toContain("No dev clock is written");
    expectNoLeak(r);
  });

  it("--clock-off in a seeding run leaves no clock file and prints no warning", async () => {
    const r = rig();
    await runSeed(opts({ scenario: "day3", "clock-off": true }), r.deps);
    expect(r.calls).not.toContain("clockWrite");
    expect(warnings(r)).toHaveLength(0);
  });

  it("--fresh deletes the guarded user first, then creates it when the sign-in is refused", async () => {
    const r = rig();
    const attempts: string[] = [];
    r.deps.signIn = async (): Promise<SignInResult> => {
      attempts.push(`signIn${attempts.length + 1}`);
      if (attempts.length === 1) return { ok: false, code: "invalid_credentials" };
      return { ok: true, session: stubSession(r) };
    };
    const result = await runSeed(opts({ scenario: "day3", fresh: true }), r.deps);
    expect(result).toEqual({ ok: true });
    expect(r.calls.indexOf("deleteUser")).toBeGreaterThanOrEqual(0);
    expect(r.calls.indexOf("deleteUser")).toBeLessThan(r.calls.indexOf("createUser"));
    expect(attempts).toEqual(["signIn1", "signIn2"]);
    expect(r.text()).toContain(`Recreating ${EMAIL}`);
    expectNoLeak(r);
  });

  it("only a refused password creates a user: any other sign-in failure stops there", async () => {
    const r = rig({ signIn: async () => ({ ok: false, code: "failed" }) });
    expect(await runSeed(opts({ scenario: "day3" }), r.deps)).toEqual({ ok: false, code: "sign_in_failed" });
    expect(r.calls).not.toContain("createUser");
    expect(r.text()).toContain("Sign-in failed.");
    expectNoLeak(r);
  });

  it("links the after-Shabbat report to the Shabbat that just ended, and no other meal", async () => {
    const r = rig();
    await runSeed(opts({ scenario: "shabbat-week" }), r.deps);
    const reports = r.meals.filter((m) => m.aggregated);
    expect(reports).toHaveLength(1);
    const linked = reports[0].offline_period_id;
    expect(linked).toMatch(/^period-\d+$/);
    const period = r.shabbat[Number((linked as string).replace("period-", ""))];
    expect(new Date(period.end_at).getTime()).toBeLessThan(new Date(reports[0].occurred_at).getTime());
    expect(new Date(period.end_at).getTime()).toBeGreaterThan(new Date(reports[0].occurred_at).getTime() - 6 * 3_600_000);
    expect(r.meals.filter((m) => !m.aggregated && m.offline_period_id !== null)).toHaveLength(0);
  });

  it("a user that exists is never created again (no admin call at all)", async () => {
    const r = rig();
    await runSeed(opts({ scenario: "day3" }), r.deps);
    expect(r.calls).not.toContain("createUser");
    expect(r.calls).not.toContain("deleteUser");
  });
});

describe("a run with weigh-ins", () => {
  it("writes the weights after the meals, sets the lifecycle and the clock, and prints counts only", async () => {
    const r = rig();
    expect(await runSeed(opts({ scenario: "w-down" }), r.deps)).toEqual({ ok: true });
    expect(r.calls).toEqual(["signIn", "writeProfile", "upsertShabbat", "listPeriods", "upsertMeals", "upsertWeights", "clockWrite"]);
    expect(r.meals).toHaveLength(0);
    expect(r.weights).toHaveLength(6);
    expect(r.weights.map((w) => w.weight_kg)).toEqual([79.6, 78.9, 78.1, 77.4, 76.9, 76.2]);
    expect(r.profile[0]).toMatchObject({ lifecycle_state: "WEEKLY_CYCLE", goal_type: "numeric", start_weight_kg: 80, goal_weight_kg: 72, first_week_ended_at: "2026-09-27T09:00:00.000Z" });
    expect(r.clock.instant?.toISOString()).toBe("2026-10-28T07:00:00.000Z"); // Wed 09:00 Asia/Jerusalem

    expect(r.text()).toContain("Weights: 6 planned (6 new), start 80 kg, goal 72 kg.");
    expect(r.text()).toContain("Lifecycle: WEEKLY_CYCLE; the First Week ended 2026-09-27T12:00:00+03:00.");
    expect(warnings(r)).toHaveLength(1);
    expectNoLeak(r);
  });

  it("a First Week run without weights never touches the weights", async () => {
    const r = rig();
    await runSeed(opts({ scenario: "day3" }), r.deps);
    expect(r.calls).not.toContain("upsertWeights");
    expect(r.weights).toHaveLength(0);
    expect(r.text()).not.toContain("Weights:");
    expect(r.text()).not.toContain("Lifecycle:");
  });

  it("--goal-weight none is said plainly, and a junk-only run still writes the one entry", async () => {
    const r = rig();
    await runSeed(opts({ scenario: "w-nogoal" }), r.deps);
    expect(r.text()).toContain("no goal weight");
    expect(r.profile[0]).toMatchObject({ goal_type: "none", goal_weight_kg: null });
    const junk = rig();
    await runSeed(opts({ scenario: "w-none", "junk-weights": "on", days: "40" }), junk.deps);
    expect(junk.weights.map((w) => w.weight_kg)).toEqual([181]);
    expectNoLeak(junk);
  });

  it("--drop-weights deletes through the session and says the change log keeps no weight", async () => {
    const r = rig();
    expect(await runSeed(opts({ "drop-weights": "3" }), r.deps)).toEqual({ ok: true });
    expect(r.calls).toEqual(["signIn", "dropWeights:3"]);
    expect(r.text()).toContain("Deleted 3 weight entries");
    expect(r.text()).toContain("only that one was removed");
    const one = rig({ session: { dropWeights: async () => 1 } });
    await runSeed(opts({ "drop-weights": "1" }), one.deps);
    expect(one.text()).toContain("Deleted 1 weight entry");
    const all = rig();
    await runSeed(opts({ "drop-weights": "all" }), all.deps);
    expect(all.calls).toEqual(["signIn", "dropWeights:all"]);
    const both = rig();
    await runSeed(opts({ "drop-weights": "2", "drop-meals": "1" }), both.deps);
    expect(both.calls).toEqual(["signIn", "dropMeals:1", "dropWeights:2"]);
    for (const x of [r, one, all, both]) expectNoLeak(x);
  });

  it("--drop-weights never creates a user and never seeds", async () => {
    const r = rig({ signIn: async () => ({ ok: false, code: "invalid_credentials" }) });
    expect(await runSeed(opts({ "drop-weights": "1" }), r.deps)).toEqual({ ok: false, code: "sign_in_failed" });
    expect(r.calls).not.toContain("createUser");
    expectNoLeak(r);
  });

  it("a failing write is a short code and nothing of the error", async () => {
    const boom = async () => {
      throw new Error(`blew up: ${PASSWORD} ${ADMIN_KEY} ${JWT} ${USER_ID} C:\app\.env.local`);
    };
    const write = rig({ session: { upsertWeights: boom } });
    expect(await runSeed(opts({ scenario: "w-down" }), write.deps)).toEqual({ ok: false, code: "weights_failed" });
    const drop = rig({ session: { dropWeights: boom } });
    expect(await runSeed(opts({ "drop-weights": "2" }), drop.deps)).toEqual({ ok: false, code: "drop_failed" });
    expectNoLeak(write);
    expectNoLeak(drop);
  });

  it("the refusals of the guard hold for the weight modes: a hosted stack and a real e-mail change nothing", async () => {
    const hosted = rig({ stack: { apiUrl: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: PUBLISHABLE_KEY } });
    expect(await runSeed(opts({ scenario: "w-down" }), hosted.deps)).toEqual({ ok: false, code: "not_local_stack" });
    expect(hosted.calls).toEqual([]);
    const real = rig();
    expect(await runSeed({ ...opts({ "drop-weights": "all" }), email: "someone@example.com" }, real.deps)).toEqual({ ok: false, code: "bad_email_suffix" });
    expect(real.calls).toEqual([]);
    expect(real.text()).not.toContain("someone@example.com");
  });

  it("the guard holds for the Weekly Learning rows: a hosted stack and a real e-mail change nothing", async () => {
    const hosted = rig({ stack: { apiUrl: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: PUBLISHABLE_KEY } });
    expect(await runSeed(opts({ scenario: "w3-result-due", "pattern-answer": "unsure@10", "weekly-opened": "8" }), hosted.deps)).toEqual({ ok: false, code: "not_local_stack" });
    expect(hosted.calls).toEqual([]);
    const real = rig();
    expect(await runSeed({ ...opts({ scenario: "w3-result-due" }), email: "someone@example.com" }, real.deps)).toEqual({ ok: false, code: "bad_email_suffix" });
    expect(real.calls).toEqual([]);
    expect(real.experiments).toEqual([]);
  });

  it("--explain after a weight run is asked at the clock the run wrote", async () => {
    let explainedAt: Date | null = null;
    const r = rig({
      session: {
        async explain(a) {
          explainedAt = a.now;
          return CLEAN_FACTS();
        },
      },
    });
    await runSeed(opts({ scenario: "w-milestone", explain: true }), r.deps);
    expect(explainedAt).toEqual(new Date("2026-10-28T07:00:00.000Z"));
    expectNoLeak(r);
  });
});

/** A session object that records into the given rig. */
function stubSession(r: Rig): DbSession {
  return {
    email: EMAIL,
    writeProfile: async () => void r.calls.push("writeProfile"),
    upsertShabbat: async () => void r.calls.push("upsertShabbat"),
    listPeriods: async () => [],
    upsertMeals: async (rows) => (r.calls.push("upsertMeals"), rows.length),
    dropMeals: async () => 0,
    upsertWeights: async (rows) => (r.calls.push("upsertWeights"), rows.length),
    dropWeights: async () => 0,
    upsertExperiments: async (rows) => (r.calls.push("upsertExperiments"), rows.length),
    writePatternAnswer: async () => (r.calls.push("writePatternAnswer"), true),
    upsertWeeklySummary: async () => (r.calls.push("upsertWeeklySummary"), 1),
    explain: async () => CLEAN_FACTS(),
  };
}

describe("a Weekly Learning run", () => {
  it("a weekly preset without extra rows seeds the profile, the Shabbat rows and the meals, and touches no weekly table", async () => {
    const r = rig();
    expect(await runSeed(opts({ scenario: "w2-learn" }), r.deps)).toEqual({ ok: true });
    expect(r.calls).toEqual(["signIn", "writeProfile", "upsertShabbat", "listPeriods", "upsertMeals", "clockWrite"]);
    expect(r.profile[0]).toMatchObject({ lifecycle_state: "WEEKLY_CYCLE", observes_shabbat: true, first_week_ended_at: "2026-09-20T07:00:00.000Z" }); // Sun 10:00 Asia/Jerusalem
    expect(r.clock.instant?.toISOString()).toBe("2026-09-27T06:00:00.000Z"); // Sun 09:00 of day 15
    expect(r.text()).toContain("Lifecycle: WEEKLY_CYCLE; the First Week ended 2026-09-20T10:00:00+03:00.");
    expect(r.text()).not.toContain("Experiments:");
    expect(r.text()).not.toContain("Pattern answer:");
    expect(r.text()).not.toContain("Weekly summary:");
    expectNoLeak(r);
  });

  it("an experiment preset writes the experiments after the meals and says how many, with no uuid", async () => {
    const r = rig();
    expect(await runSeed(opts({ scenario: "w3-result-due" }), r.deps)).toEqual({ ok: true });
    expect(r.calls).toEqual(["signIn", "writeProfile", "upsertShabbat", "listPeriods", "upsertMeals", "upsertExperiments", "clockWrite"]);
    expect(r.experiments).toHaveLength(1);
    expect(r.experiments[0]).toMatchObject({ status: "ACTIVE", intervention_key: "eat_intentionally", variant: "default", wording_source: "library", wording_locale: "he", ended_at: null });
    expect(r.text()).toContain("Experiments: 1 planned (1 new): active.");
    expectNoLeak(r);

    const history = rig();
    await runSeed(opts({ scenario: "w4-history-rotation" }), history.deps);
    expect(history.calls).toEqual(["signIn", "writeProfile", "upsertShabbat", "listPeriods", "upsertMeals", "upsertWeights", "upsertExperiments", "clockWrite"]);
    expect(history.text()).toContain("Experiments: 2 planned (2 new): done, done.");
    expect(history.text()).toContain("Weights: 4 planned (4 new), start 80 kg, goal 72 kg.");
    expectNoLeak(history);
  });

  it("the pattern answer is written after the meals and the experiments, and a refusal is said plainly", async () => {
    const r = rig();
    await runSeed(opts({ scenario: "w2-learn", "pattern-answer": "reject@10" }), r.deps);
    expect(r.calls).toEqual(["signIn", "writeProfile", "upsertShabbat", "listPeriods", "upsertMeals", "writePatternAnswer", "clockWrite"]);
    expect(r.answers).toHaveLength(1);
    expect(r.answers[0]).toMatchObject({ answer: "reject", syncStatus: "OBSERVATION", occurrences: [] });
    expect(r.text()).toContain("Pattern answer: reject recorded at 2026-09-22T09:00:00+03:00, 0 evidence rows.");
    expectNoLeak(r);

    const refused = rig({ session: { writePatternAnswer: async () => false } });
    await runSeed(opts({ scenario: "w2-learn", "pattern-answer": "confirm@10" }), refused.deps);
    expect(refused.text()).toContain("Pattern answer: not written, the pattern was already rejected");
  });

  it("--weekly-opened writes the opened row of the week with the mode its story had, stamped on the Sunday after it", async () => {
    const r = rig();
    await runSeed(opts({ scenario: "w2-learn", "weekly-opened": "8" }), r.deps);
    expect(r.calls).toEqual(["signIn", "writeProfile", "upsertShabbat", "listPeriods", "upsertMeals", "upsertWeeklySummary", "clockWrite"]);
    expect(r.weekly).toEqual([
      { week_start: "2026-09-20", opening_mode: "LEARN", content: { v: 1 }, generated_at: "2026-09-27T06:00:00.000Z", viewed_at: "2026-09-27T06:00:00.000Z" },
    ]);
    expect(r.text()).toContain("Weekly summary: the week of 2026-09-20 is opened (LEARN, 1 new), stamped 2026-09-27T09:00:00+03:00.");
    expectNoLeak(r);

    const celebrate = rig();
    await runSeed(opts({ scenario: "w2-celebrate", "weekly-opened": "15" }), celebrate.deps);
    expect(celebrate.weekly[0]).toMatchObject({ week_start: "2026-09-27", opening_mode: "CELEBRATE" });
  });

  it("--weekly-opened for a week that had no weekly moment writes nothing and says so", async () => {
    const r = rig();
    await runSeed(opts({ scenario: "w2-too-short", "weekly-opened": "8" }), r.deps);
    expect(r.calls).not.toContain("upsertWeeklySummary");
    expect(r.text()).toContain("Weekly summary: not written, that week has no weekly moment");
    expectNoLeak(r);
  });

  it("a repeated run reports the rows that were already there", async () => {
    const r = rig({ session: { upsertExperiments: async () => 0, upsertWeeklySummary: async () => 0 } });
    await runSeed(opts({ scenario: "w3-result-due", "weekly-opened": "15" }), r.deps);
    expect(r.text()).toContain("Experiments: 1 planned (0 new): active.");
    expect(r.text()).toContain("already there");
  });

  it("--explain after a weekly run is asked at the clock the run wrote", async () => {
    let explainedAt: Date | null = null;
    const r = rig({
      session: {
        async explain(a) {
          explainedAt = a.now;
          return CLEAN_FACTS();
        },
      },
    });
    await runSeed(opts({ scenario: "w3-result-due", explain: true }), r.deps);
    expect(explainedAt).toEqual(new Date("2026-10-04T06:00:00.000Z")); // Sunday day 22, 09:00 Asia/Jerusalem
    expectNoLeak(r);
  });
});

describe("the other modes", () => {
  it("--reset removes the user and nothing else; it needs the password but never prints it", async () => {
    const r = rig();
    const result = await runSeed(opts({ reset: true }), r.deps);
    expect(result).toEqual({ ok: true });
    expect(r.calls).toEqual(["deleteUser"]);
    expect(r.text()).toContain(`Removed ${EMAIL}`);
    expectNoLeak(r);
  });

  it("--drop-meals deletes through the session and says patterns were not touched", async () => {
    const r = rig();
    expect(await runSeed(opts({ "drop-meals": "3" }), r.deps)).toEqual({ ok: true });
    expect(r.calls).toEqual(["signIn", "dropMeals:3"]);
    expect(r.text()).toContain("Deleted 3 confirmed meals");
    expect(r.text()).toContain("Patterns and evidence were not touched");
    const all = rig();
    await runSeed(opts({ "drop-meals": "all" }), all.deps);
    expect(all.calls).toEqual(["signIn", "dropMeals:all"]);
    expectNoLeak(r);
    expectNoLeak(all);
  });

  it("--clock-only sets the clock without a password or a sign-in", async () => {
    const r = rig({ password: undefined });
    const result = await runSeed(opts({ "clock-only": true, "as-of": "day 3 21:00" }), r.deps);
    expect(result).toEqual({ ok: true });
    expect(r.calls).toEqual(["clockWrite"]);
    expect(r.clock.instant?.toISOString()).toBe("2026-09-16T18:00:00.000Z"); // Wed 21:00 Asia/Jerusalem
    expect(warnings(r)).toHaveLength(1);
    expect(warnings(r)[0]).toMatch(WARNING);
    expectNoLeak(r);
  });

  it("--clock-shift moves an existing clock, or starts from the real time with a note", async () => {
    const r = rig({ existingClock: new Date("2026-09-16T06:00:00Z") });
    await runSeed(opts({ "clock-shift": "+25h" }), r.deps);
    expect(r.clock.instant?.toISOString()).toBe("2026-09-17T07:00:00.000Z");
    await runSeed(opts({ "clock-shift": "-2h" }), r.deps);
    expect(r.clock.instant?.toISOString()).toBe("2026-09-17T05:00:00.000Z");

    const fresh = rig();
    await runSeed(opts({ "clock-shift": "+1d" }), fresh.deps);
    expect(fresh.clock.instant?.toISOString()).toBe("2026-10-03T12:34:56.000Z");
    expect(fresh.text()).toContain("There was no dev clock file");
  });

  it("--clock-off removes the file and prints no warning", async () => {
    const r = rig({ existingClock: new Date("2026-09-16T06:00:00Z") });
    expect(await runSeed(opts({ "clock-off": true }), r.deps)).toEqual({ ok: true });
    expect(r.clock.instant).toBeNull();
    expect(r.text()).toContain("Dev clock removed");
    expect(warnings(r)).toHaveLength(0);
    const none = rig();
    await runSeed(opts({ "clock-off": true }), none.deps);
    expect(none.text()).toContain("There was no dev clock file");
  });

  it("--explain alone signs in and prints the decisions; it never seeds", async () => {
    const r = rig({ existingClock: new Date("2026-09-16T06:00:00Z") });
    expect(await runSeed(opts({ explain: true }), r.deps)).toEqual({ ok: true });
    expect(r.calls).toEqual(["signIn", "explain"]);
    expect(r.text()).toContain("late evenings: 2");
    expect(r.text()).toContain("live level: EARLY_SIGNAL");
    expectNoLeak(r);
  });

  it("a seeding run can explain right after (the clock it just wrote is the 'now')", async () => {
    let explainedAt: Date | null = null;
    const r = rig({
      session: {
        async explain(a) {
          explainedAt = a.now;
          return CLEAN_FACTS();
        },
      },
    });
    await runSeed(opts({ scenario: "day3", explain: true }), r.deps);
    expect(explainedAt).toEqual(new Date("2026-09-16T06:00:00.000Z"));
    const rel = rig({
      session: {
        async explain(a) {
          explainedAt = a.now;
          return CLEAN_FACTS({ clockFile: null });
        },
      },
    });
    await runSeed(opts({ scenario: "day3", mode: "relative", explain: true }), rel.deps);
    expect(explainedAt).toEqual(new Date("2026-10-02T12:34:56.000Z")); // no clock file: the real time
  });
});

describe("--explain output", () => {
  it("prints the assumption line and nothing about the real configuration", () => {
    const lines = formatExplain(CLEAN_FACTS());
    expect(lines).toContain("wording gate evaluated assuming AI is configured, daily cap 40, nothing used yet");
    const text = lines.join("\n");
    expect(text).not.toMatch(/GEMINI|GROQ|AI_PROVIDER|AI_DAILY_CAP|api key|unconfigured/i);
    // 2 evenings, EARLY_SIGNAL: the gate is closed for the pattern, not for the configuration.
    expect(lines).toContain("wording gate: CLOSED (pattern_not_established)");
  });

  it("--daily-cap changes only the cap of the assumption", () => {
    const candidate = CLEAN_FACTS({
      signal: {
        occurrences: [1, 2, 3].map((n) => ({ mealId: `m${n}`, occurredAt: new Date(`2026-09-1${n}T18:30:00Z`), localDay: `2026-09-1${n}` })),
        row: null,
        view: "CANDIDATE",
      },
      progress: { availableDays: 4, confirmedMeals: 10, availableDaysSinceLastMeal: 0 },
    });
    expect(formatExplain({ ...candidate, dailyCap: 40 })).toContain("wording gate: OPEN");
    const closed = formatExplain({ ...candidate, dailyCap: 9 });
    expect(closed).toContain("wording gate evaluated assuming AI is configured, daily cap 9, nothing used yet");
    expect(closed).toContain("wording gate: CLOSED (allowance_reserve)");
    expect(formatExplain({ ...candidate, progress: { availableDays: 3, confirmedMeals: 10, availableDaysSinceLastMeal: 0 } })).toContain("wording gate: CLOSED (too_few_days)");
  });

  it("names why the Early Signal card is not on screen at this instant", () => {
    const at = (iso: string) => CLEAN_FACTS({ now: new Date(iso), home: { state: { key: "MORNING" }, action: null, degraded: false, weeklyLink: false } }).now;
    const quiet = formatExplain(CLEAN_FACTS({ now: at("2026-09-16T00:00:00Z") })).join("\n"); // 03:00 local
    expect(quiet).toContain("quiet hours 00:00-08:00");
    const evening = formatExplain(CLEAN_FACTS({ now: at("2026-09-16T18:30:00Z") })).join("\n"); // 21:30 local
    expect(evening).toContain("the signal's own hours (from 21:00)");
    const shown = formatExplain(CLEAN_FACTS()).join("\n");
    expect(shown).toContain("Early Signal: it would be on screen now");
  });

  it("lists the late-evening meals that are not counted, and why", () => {
    const text = formatExplain(
      CLEAN_FACTS({
        excluded: [
          { localDay: "2026-09-19", time: "22:15", why: "aggregated" },
          { localDay: "2026-09-17", time: "21:40", why: "after_the_clock" },
        ],
      }),
    ).join("\n");
    expect(text).toContain("2026-09-19 22:15, an after-Shabbat report");
    expect(text).toContain("2026-09-17 21:40, dated after the clock");
  });

  it("reports the stored mirror and whether it differs from the live level", () => {
    const row = { id: "p1", status: "OBSERVATION" as const, feedback: "unsure" as const, feedbackAt: new Date("2026-09-16T06:00:00Z") };
    const same = formatExplain(CLEAN_FACTS({ signal: { occurrences: [], row, view: "EARLY_SIGNAL" }, storedEvidence: 2 })).join("\n");
    expect(same).toContain("stored pattern row: status OBSERVATION, answer unsure at 2026-09-16T06:00:00.000Z, 2 evidence rows");
    expect(same).toContain("the stored status matches the live level");
    const differs = formatExplain(CLEAN_FACTS({ signal: { occurrences: [], row, view: "CANDIDATE" }, storedEvidence: 3 })).join("\n");
    expect(differs).toContain("differs from the live level (stored OBSERVATION, live CANDIDATE)");
    expect(formatExplain(CLEAN_FACTS()).join("\n")).toContain("stored pattern row: none");
  });

  it("copes with everything unknown", () => {
    const text = formatExplain(
      CLEAN_FACTS({ lifecycle: null, progress: null, step: null, signal: null, earlySignal: null, quietHours: null, selection: null }),
    ).join("\n");
    expect(text).toContain("lifecycle: unknown");
    expect(text).toContain("late evenings: unknown");
    expect(text).toContain("wording gate: unknown");
    expect(text).toContain("experiment selection: unknown");
  });
});

describe("refusals and failures never leak", () => {
  it("a hosted stack is refused before anything else happens", async () => {
    const r = rig({ stack: { apiUrl: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: PUBLISHABLE_KEY } });
    const result = await runSeed(opts({ scenario: "day3" }), r.deps);
    expect(result).toEqual({ ok: false, code: "not_local_stack" });
    expect(r.calls).toEqual([]);
    expect(r.text()).not.toContain("supabase.co");
    expectNoLeak(r);
  });

  it("a stack that is not running is a short message and no fallback", async () => {
    const r = rig({ stack: null });
    expect(await runSeed(opts({ scenario: "day3" }), r.deps)).toEqual({ ok: false, code: "stack_unavailable" });
    expect(r.calls).toEqual([]);
    expect(r.text()).toContain("npm run local:start");
    expectNoLeak(r);
  });

  it("an e-mail that is not a throwaway one is refused and not echoed", async () => {
    const r = rig();
    const options = { ...opts({}), email: "owner@gmail.com" };
    expect(await runSeed(options, r.deps)).toEqual({ ok: false, code: "bad_email_suffix" });
    expect(r.calls).toEqual([]);
    expect(r.text()).not.toContain("owner@gmail.com");
  });

  it("a missing or short password stops before any sign-in and is never echoed", async () => {
    const missing = rig({ password: undefined });
    expect(await runSeed(opts({ scenario: "day3" }), missing.deps)).toEqual({ ok: false, code: "password_missing" });
    expect(missing.calls).toEqual([]);
    const empty = rig({ password: "" });
    expect(await runSeed(opts({ scenario: "day3" }), empty.deps)).toEqual({ ok: false, code: "password_missing" });
    const short = rig({ password: "short" });
    expect(await runSeed(opts({ scenario: "day3" }), short.deps)).toEqual({ ok: false, code: "password_too_short" });
    expect(short.calls).toEqual([]);
    expect(short.text()).not.toContain("short\n");
    for (const r of [missing, empty, short]) expectNoLeak(r);
  });

  it("a signed-in user whose e-mail differs from the guarded one is refused", async () => {
    const r = rig({ session: { email: "someone@eating-coach.test" } });
    expect(await runSeed(opts({ scenario: "day3" }), r.deps)).toEqual({ ok: false, code: "email_mismatch" });
    expect(r.calls).toEqual(["signIn"]);
    const elsewhere = rig({ session: { email: "owner@gmail.com" } });
    expect(await runSeed(opts({ scenario: "day3" }), elsewhere.deps)).toEqual({ ok: false, code: "email_mismatch" });
  });

  it("a sign-in that throws an error full of secrets is reported as a short code", async () => {
    const r = rig({
      signIn: async () => {
        throw new Error(`fetch failed for ${LOCAL.apiUrl} with ${PASSWORD} ${PUBLISHABLE_KEY} ${ADMIN_KEY} ${JWT} user ${USER_ID} /app/.env.local`);
      },
    });
    const result = await runSeed(opts({ scenario: "day3" }), r.deps);
    expect(result).toEqual({ ok: false, code: "sign_in_failed" });
    expect(r.text()).toContain("Failed at sign_in");
    expectNoLeak(r);
  });

  it.each([
    ["writeProfile", "profile_failed"],
    ["upsertShabbat", "shabbat_failed"],
    ["upsertMeals", "meals_failed"],
    ["dropMeals", "drop_failed"],
    ["explain", "explain_failed"],
    ["upsertExperiments", "experiments_failed"],
    ["writePatternAnswer", "pattern_failed"],
    ["upsertWeeklySummary", "weekly_failed"],
  ])("a failing %s is %s and prints nothing of the error", async (method, code) => {
    const boom = async () => {
      throw new Error(`${method} blew up: ${PASSWORD} ${ADMIN_KEY} ${JWT} ${USER_ID} C:\\app\\.env.local`);
    };
    const r = rig({ session: { [method]: boom } });
    const flagsOf: Record<string, Record<string, string | boolean>> = {
      dropMeals: { "drop-meals": "2" },
      explain: { explain: true },
      upsertExperiments: { scenario: "w3-result-due" },
      writePatternAnswer: { scenario: "w2-learn", "pattern-answer": "confirm@10" },
      upsertWeeklySummary: { scenario: "w2-learn", "weekly-opened": "8" },
    };
    const flags: Record<string, string | boolean> = flagsOf[method] ?? { scenario: "day3" };
    const result = await runSeed(opts(flags), r.deps);
    expect(result).toEqual({ ok: false, code });
    expectNoLeak(r);
  });

  it("an existing user with a different password is explained, and the admin key is not asked for what it cannot do", async () => {
    const r = rig({
      signIn: async () => ({ ok: false, code: "invalid_credentials" }),
      adminFails: true,
    });
    const result = await runSeed(opts({ scenario: "day3" }), r.deps);
    expect(result).toEqual({ ok: false, code: "user_create_failed" });
    expect(r.text()).toContain("add --fresh to recreate it");
    expectNoLeak(r);
  });

  it("drop, explain and clock never create a user", async () => {
    for (const flags of [{ "drop-meals": "1" }, { explain: true }] as Record<string, string | boolean>[]) {
      const r = rig({ signIn: async () => ({ ok: false, code: "invalid_credentials" }) });
      expect(await runSeed(opts(flags), r.deps)).toEqual({ ok: false, code: "sign_in_failed" });
      expect(r.calls).not.toContain("createUser");
      expectNoLeak(r);
    }
  });

  it("the motivation text never reaches a line", async () => {
    const r = rig();
    await runSeed(opts({ scenario: "day5-early-finish", motivation: "my-private-reason-for-this-run", goals: "lose_weight" }), r.deps);
    expect(r.text()).not.toContain("my-private-reason-for-this-run");
    // It is stored (that is the point), only not printed.
    expect(JSON.stringify(r.profile)).toContain("my-private-reason-for-this-run");
  });
});

describe("the demo user is the only target of every call", () => {
  it("passes the guarded e-mail (trimmed, lower-cased) to the admin and sign-in calls", async () => {
    const seen: string[] = [];
    const r = rig();
    r.deps.admin.deleteUser = async (_s, email) => (seen.push(`delete:${email}`), true);
    r.deps.signIn = async (_s, email): Promise<SignInResult> => (seen.push(`signIn:${email}`), { ok: true, session: stubSession(r) });
    await runSeed(opts({ scenario: "day3", fresh: true, email: "  Mixed.Case@Eating-Coach.TEST " }), r.deps);
    expect(seen).toEqual(["delete:mixed.case@eating-coach.test", "signIn:mixed.case@eating-coach.test"]);
  });
});
