import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USER_A, USER_B, as, createTestDb } from "../db/harness";
import { parseSeedArgs, SEED_SCENARIOS, type SeedOptions } from "../../scripts/seed-demo/args";
import { buildSeedPlan, periodBeforeMeal, resolveRelative, toMealRow, toProfileUpdate, type SeedPlan } from "../../scripts/seed-demo/plan";
import { seedShabbatRows, seedShabbatSeries, toPlanShabbat } from "../../scripts/seed-demo/shabbat";
import { toWeightRow } from "../../scripts/seed-demo/weights";
import { toExperimentRow, toPatternAnswerPatch, toSyncOccurrences } from "../../scripts/seed-demo/weekly";
import { planWeeklyOpened, toWeeklySummaryRow } from "../../scripts/seed-demo/weeklyEval";

/**
 * The rows the seed writes, applied to the REAL schema (PGlite, in memory: no Docker, no network) as the signed-in user, so
 * every CHECK, foreign key and row level security rule the app's database has is exercised by exactly what the runner sends.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

const asA = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_A, fn);

function options(flags: Record<string, string | boolean | string[]>): SeedOptions {
  const parsed = parseSeedArgs(JSON.stringify(flags));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/** What the runner does for one run, written as SQL with the same conflict rules as the supabase-js calls in db.ts. */
async function applyRun(o: SeedOptions, userId = USER_A) {
  const series = seedShabbatSeries(o);
  const plan = buildSeedPlan(o, toPlanShabbat(series));

  const fields = toProfileUpdate(o, plan.startedAt) as Record<string, unknown>;
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}${Array.isArray(fields[k]) ? "::text[]" : ""}`).join(", ");
  const updated = await db.query(`update public.profiles set ${sets} where user_id = $1 returning user_id`, [userId, ...keys.map((k) => fields[k])]);
  expect(updated.rows).toHaveLength(1);

  if (o.shabbat) {
    for (const row of seedShabbatRows(series, plan.startedAt)) {
      await db.query(
        `insert into public.offline_periods (user_id, type, start_at, end_at, source, metadata)
         values ($1, 'SHABBAT', $2, $3, 'auto', $4::jsonb) on conflict (user_id, type, start_at) do nothing`,
        [userId, row.start_at, row.end_at, JSON.stringify(row.metadata)],
      );
    }
  }
  const periods = (await db.query<{ id: string; start_at: string }>("select id, start_at from public.offline_periods where user_id = $1 and type = 'SHABBAT'", [userId])).rows;

  let created = 0;
  for (const meal of plan.meals) {
    const period = meal.aggregated ? periodBeforeMeal(meal, plan.offline) : null;
    const periodId = period ? (periods.find((p) => new Date(p.start_at).getTime() === period.start.getTime())?.id ?? null) : null;
    const row = toMealRow(meal, periodId);
    const result = await db.query(
      `insert into public.meal_entries (id, occurred_at, confirmed_at, meal_type, items, source, aggregated, offline_period_id)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8) on conflict (id) do nothing returning id`,
      [row.id, row.occurred_at, row.confirmed_at, row.meal_type, JSON.stringify(row.items), row.source, row.aggregated, row.offline_period_id],
    );
    created += result.rows.length;
  }

  // The weigh-ins, with the same conflict rule as the supabase-js call in db.ts (insert, ignore duplicates).
  let weightsCreated = 0;
  for (const weight of plan.weights) {
    const row = toWeightRow(weight);
    const result = await db.query(
      `insert into public.weight_entries (id, weight_kg, measured_at, source) values ($1, $2, $3, $4) on conflict (id) do nothing returning id`,
      [row.id, row.weight_kg, row.measured_at, row.source],
    );
    weightsCreated += result.rows.length;
  }

  // The Weekly Learning rows, with the same conflict rules as the supabase-js calls in db.ts.
  let experimentsCreated = 0;
  for (const experiment of plan.experiments) {
    const row = toExperimentRow(experiment);
    const result = await db.query(
      `insert into public.experiments (id, intervention_key, variant, status, wording, wording_source, wording_locale, created_at, started_at, ended_at, tried, helpfulness)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (id) do nothing returning id`,
      [row.id, row.intervention_key, row.variant, row.status, row.wording, row.wording_source, row.wording_locale, row.created_at, row.started_at, row.ended_at, row.tried, row.helpfulness],
    );
    experimentsCreated += result.rows.length;
  }

  let patternWritten: boolean | null = null;
  if (plan.patternAnswer !== null) {
    const answer = plan.patternAnswer;
    const synced = await db.query<{ id: string }>("select public.sync_pattern_evidence($1, $2, $3::jsonb) as id", ["late_evening_meals", answer.syncStatus, JSON.stringify(toSyncOccurrences(answer))]);
    const patch = toPatternAnswerPatch(answer);
    const keys = Object.keys(patch);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const updated = await db.query(`update public.patterns set ${sets} where id = $1 and status <> 'REJECTED' returning id`, [synced.rows[0].id, ...keys.map((k) => patch[k])]);
    patternWritten = updated.rows.length > 0;
  }

  const opened = planWeeklyOpened(o, plan);
  let weeklyCreated = 0;
  if (opened !== null) {
    const row = toWeeklySummaryRow(opened);
    const result = await db.query(
      `insert into public.weekly_summaries (user_id, week_start, opening_mode, content, generated_at, viewed_at)
       values ($1, $2, $3, $4::jsonb, $5, $6) on conflict (user_id, week_start) do nothing returning id`,
      [userId, row.week_start, row.opening_mode, JSON.stringify(row.content), row.generated_at, row.viewed_at],
    );
    weeklyCreated = result.rows.length;
  }
  return { plan, created, weightsCreated, series, experimentsCreated, patternWritten, opened, weeklyCreated };
}

const weightCount = async (userId: string) => Number((await db.query<{ n: string }>("select count(*) as n from public.weight_entries where user_id = $1", [userId])).rows[0].n);
const mealCount = async (userId: string) => Number((await db.query<{ n: string }>("select count(*) as n from public.meal_entries where user_id = $1", [userId])).rows[0].n);
const countOf = async (table: "experiments" | "weekly_summaries" | "patterns" | "pattern_evidence", userId: string) =>
  Number((await db.query<{ n: string }>(`select count(*) as n from public.${table} where user_id = $1`, [userId])).rows[0].n);
/** Everything a weekly run leaves, removed with the owner's own privileges (a test cleanup, not an app path). */
async function clearWeekly(userId = USER_A) {
  await db.query("delete from public.weekly_summaries where user_id = $1", [userId]);
  await db.query("delete from public.experiments where user_id = $1", [userId]);
  await db.query("delete from public.patterns where user_id = $1", [userId]);
}

describe("the seed's rows satisfy the real schema", () => {
  it.each(SEED_SCENARIOS)("%s: profile, Shabbat periods and meals are accepted, and a re-run adds nothing", async (scenario) => {
    await db.query("delete from public.meal_entries where user_id = $1", [USER_A]);
    await clearWeekly();
    await db.query("delete from public.weight_entries where user_id = $1", [USER_A]);
    await db.query("delete from public.offline_periods where user_id = $1", [USER_A]);

    const first = await asA(() => applyRun(options({ scenario })));
    expect(first.experimentsCreated).toBe(first.plan.experiments.length);
    expect(await countOf("experiments", USER_A)).toBe(first.plan.experiments.length);
    expect(first.created).toBe(first.plan.meals.length);
    expect(await mealCount(USER_A)).toBe(first.plan.meals.length);
    expect(first.weightsCreated).toBe(first.plan.weights.length);
    expect(await weightCount(USER_A)).toBe(first.plan.weights.length);

    const again = await asA(() => applyRun(options({ scenario })));
    expect(again.created).toBe(0);
    expect(again.weightsCreated).toBe(0);
    expect(again.experimentsCreated).toBe(0);
    expect(await countOf("experiments", USER_A)).toBe(first.plan.experiments.length);
    expect(await mealCount(USER_A)).toBe(first.plan.meals.length);
    expect(await weightCount(USER_A)).toBe(first.plan.weights.length);
  });

  it("the profile becomes a First Week profile with the goals and the motivation as given", async () => {
    await asA(() => applyRun(options({ scenario: "day3", goals: "lose_weight,feel_lighter", motivation: "<b>5 ק\"ג</b>" })));
    const { rows } = await db.query<Record<string, unknown>>(
      "select lifecycle_state, onboarding_step, goal_focus, motivation, goal_type, goal_weight_kg, observes_shabbat, place_key, first_week_ended_at, timezone from public.profiles where user_id = $1",
      [USER_A],
    );
    expect(rows[0]).toMatchObject({
      lifecycle_state: "FIRST_WEEK",
      onboarding_step: "ready",
      goal_focus: ["lose_weight", "feel_lighter"],
      motivation: '<b>5 ק"ג</b>',
      goal_type: "numeric",
      observes_shabbat: true,
      place_key: "jerusalem",
      first_week_ended_at: null,
      timezone: "Asia/Jerusalem",
    });
    expect(Number(rows[0].goal_weight_kg)).toBe(72);
  });

  it("every goal choice the flag accepts is accepted by the database", async () => {
    for (const goals of ["none", "not_sure", "lose_weight", "improve_eating,understand_overeating", "lose_weight,feel_lighter,improve_eating,be_active,understand_overeating"]) {
      await asA(() => applyRun(options({ scenario: "day1-empty", goals })));
    }
    await asA(() => applyRun(options({ scenario: "day1-empty", motivation: "none" })));
    expect((await db.query<{ motivation: string | null }>("select motivation from public.profiles where user_id = $1", [USER_A])).rows[0].motivation).toBeNull();
  });

  it("a re-run after the person pressed 'Let's continue' puts the profile back in the First Week", async () => {
    await asA(() => applyRun(options({ scenario: "day3" })));
    await db.query("update public.profiles set lifecycle_state = 'WEEKLY_CYCLE', first_week_ended_at = now() where user_id = $1", [USER_A]);
    await asA(() => applyRun(options({ scenario: "day3" })));
    const { rows } = await db.query<{ lifecycle_state: string; first_week_ended_at: string | null }>("select lifecycle_state, first_week_ended_at from public.profiles where user_id = $1", [USER_A]);
    expect(rows[0]).toEqual({ lifecycle_state: "FIRST_WEEK", first_week_ended_at: null });
  });

  it("the Saturday-night report is linked to the Shabbat that just ended, and no other meal is", async () => {
    await db.query("delete from public.meal_entries where user_id = $1", [USER_A]);
    await db.query("delete from public.offline_periods where user_id = $1", [USER_A]);
    const { plan } = await asA(() => applyRun(options({ scenario: "shabbat-week" })));
    const rows = (await db.query<{ aggregated: boolean; offline_period_id: string | null; end_at: string | null; occurred_at: string }>(
      `select e.aggregated, e.offline_period_id, p.end_at, e.occurred_at
         from public.meal_entries e left join public.offline_periods p on p.id = e.offline_period_id
        where e.user_id = $1`,
      [USER_A],
    )).rows;
    expect(rows.filter((r) => r.aggregated)).toHaveLength(1);
    const report = rows.find((r) => r.aggregated)!;
    expect(report.offline_period_id).not.toBeNull();
    expect(new Date(report.end_at!).getTime()).toBeLessThan(new Date(report.occurred_at).getTime());
    expect(rows.filter((r) => !r.aggregated && r.offline_period_id !== null)).toHaveLength(0);
    expect(plan.meals.filter((m) => m.aggregated)).toHaveLength(1);
  });

  it("relative mode rows are accepted too", async () => {
    await db.query("delete from public.meal_entries where user_id = $1", [USER_A]);
    const o = resolveRelative(options({ scenario: "day5-early-finish", mode: "relative" }), new Date("2026-10-02T12:34:56Z"));
    const { created, plan } = await asA(() => applyRun(o));
    expect(created).toBe(plan.meals.length);
    expect(plan.meals.length).toBeGreaterThan(10);
  });
});

describe("the Weekly Learning rows satisfy the real schema", () => {
  const MIXED = { days: "30", "late-days": "none", exp: ["skipped@5:eat_intentionally", "done@9:helpful", "done@16:not_tried:slow_down", "active@23:micro_walk"] };

  it("an experiment in each status is accepted, with the answer in the form the database checks", async () => {
    await clearWeekly();
    const run = await asA(() => applyRun(options({ scenario: "w4-down", ...MIXED })));
    expect(run.experimentsCreated).toBe(4);
    const rows = (await db.query<Record<string, unknown>>(
      "select status, intervention_key, variant, wording_source, wording_locale, char_length(wording) as len, started_at, ended_at, tried, helpfulness, source_pattern_id, created_at from public.experiments where user_id = $1 order by created_at",
      [USER_A],
    )).rows;
    expect(rows.map((r) => [r.status, r.intervention_key, r.tried, r.helpfulness])).toEqual([
      ["SKIPPED", "eat_intentionally", null, null],
      ["DONE", "eat_intentionally", "YES", "HELPFUL"],
      // "I did not get to try" is tried NO with NO helpfulness (not applicable), never UNKNOWN.
      ["DONE", "slow_down", "NO", null],
      ["ACTIVE", "micro_walk", null, null],
    ]);
    expect(rows.every((r) => r.wording_source === "library" && r.wording_locale === "he" && r.source_pattern_id === null)).toBe(true);
    expect(rows.every((r) => Number(r.len) >= 1 && Number(r.len) <= 400)).toBe(true);
    expect(rows[0].started_at).toBeNull(); // an offer that was skipped never started
    expect(rows[1].started_at).not.toBeNull();
    expect(rows[1].ended_at).not.toBeNull();
    expect(rows[3].ended_at).toBeNull();
    // The times are the plan's, not the real clock.
    expect(new Date(rows[1].created_at as string).getTime()).toBe(run.plan.experiments[1].createdAt.getTime());
  });

  it("every status and every answer of --exp is accepted by the database", async () => {
    for (const result of ["helpful", "somewhat", "not_really", "unknown", "not_tried"]) {
      await clearWeekly();
      const run = await asA(() => applyRun(options({ scenario: "w4-down", days: "20", "late-days": "none", exp: `done@9:${result}` })));
      expect(run.experimentsCreated, result).toBe(1);
    }
    for (const status of ["offered", "active", "skipped"]) {
      await clearWeekly();
      const run = await asA(() => applyRun(options({ scenario: "w4-down", days: "20", "late-days": "none", exp: `${status}@9:slow_down` })));
      expect(run.experimentsCreated, status).toBe(1);
    }
  });

  it("the library sentence of the experiment is stored, in Hebrew", async () => {
    await clearWeekly();
    await asA(() => applyRun(options({ scenario: "w3-result-due" })));
    const row = (await db.query<{ wording: string; variant: string }>("select wording, variant from public.experiments where user_id = $1", [USER_A])).rows[0];
    expect(row.variant).toBe("default");
    expect(row.wording).toBe("בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך.");
  });

  it("the database allows one open experiment at a time, which is why --exp refuses two open rows", async () => {
    await clearWeekly();
    await asA(() => applyRun(options({ scenario: "w3-result-due" })));
    await expect(
      asA(() => db.query("insert into public.experiments (intervention_key, status, variant, wording, wording_source, wording_locale) values ('slow_down', 'OFFERED', 'utensils_between_bites', 'x', 'library', 'he')")),
    ).rejects.toThrow();
  });

  it("the experiment ids follow the position in --exp: a re-run with another set adds nothing (use --fresh to change the history)", async () => {
    await clearWeekly();
    await asA(() => applyRun(options({ scenario: "w3-result-due" })));
    const again = await asA(() => applyRun(options({ scenario: "w3-result-due", exp: "active@10:slow_down" })));
    expect(again.experimentsCreated).toBe(0);
    expect(await countOf("experiments", USER_A)).toBe(1);
  });

  it("--pattern-answer: each answer is written the way the app writes it, and a rejection leaves no evidence", async () => {
    const flags = { scenario: "w2-learn" } as const;
    for (const answer of ["confirm", "unsure"]) {
      await clearWeekly();
      const run = await asA(() => applyRun(options({ ...flags, "pattern-answer": `${answer}@12` })));
      const plan = run.plan.patternAnswer;
      expect(plan?.occurrences.length, answer).toBe(5); // the evenings of days 2, 3, 9, 10 and 11, by day 12 at 09:00
      const row = (await db.query<{ status: string; user_feedback: string; user_feedback_at: string }>("select status, user_feedback, user_feedback_at from public.patterns where user_id = $1", [USER_A])).rows[0];
      expect(row.user_feedback, answer).toBe(answer);
      expect(new Date(row.user_feedback_at).getTime()).toBe(plan?.answeredAt.getTime());
      expect(row.status).toBe(plan?.syncStatus);
      expect(await countOf("pattern_evidence", USER_A)).toBe(5);
    }
    await clearWeekly();
    await asA(() => applyRun(options({ ...flags, "pattern-answer": "reject@12" })));
    const rejected = (await db.query<{ status: string; user_feedback: string }>("select status, user_feedback from public.patterns where user_id = $1", [USER_A])).rows[0];
    expect(rejected).toEqual({ status: "REJECTED", user_feedback: "reject" });
    expect(await countOf("pattern_evidence", USER_A)).toBe(0);
  });

  it("a rejection is final: a later run with another answer changes nothing, and the same answer is a harmless repeat", async () => {
    await clearWeekly();
    await asA(() => applyRun(options({ scenario: "w2-learn", "pattern-answer": "reject@12" })));
    const other = await asA(() => applyRun(options({ scenario: "w2-learn", "pattern-answer": "confirm@12" })));
    expect(other.patternWritten).toBe(false);
    const row = (await db.query<{ status: string; user_feedback: string }>("select status, user_feedback from public.patterns where user_id = $1", [USER_A])).rows[0];
    expect(row).toEqual({ status: "REJECTED", user_feedback: "reject" });
    expect(await countOf("pattern_evidence", USER_A)).toBe(0);
  });

  it("--weekly-opened writes one row on a Sunday with the mode the story had, once", async () => {
    await clearWeekly();
    const first = await asA(() => applyRun(options({ scenario: "w2-learn", "weekly-opened": "8" })));
    expect(first.weeklyCreated).toBe(1);
    const row = (await db.query<Record<string, unknown>>("select week_start::text as week_start, opening_mode, content, generated_at, viewed_at from public.weekly_summaries where user_id = $1", [USER_A])).rows[0];
    expect(row).toMatchObject({ week_start: "2026-09-20", opening_mode: "LEARN", content: { v: 1 } });
    expect(new Date(row.viewed_at as string).toISOString()).toBe("2026-09-27T06:00:00.000Z");
    expect(new Date(row.generated_at as string).toISOString()).toBe("2026-09-27T06:00:00.000Z");

    // A later press of the person is never overwritten by a re-run.
    await db.query("update public.weekly_summaries set viewed_at = $2 where user_id = $1", [USER_A, "2026-09-28T07:00:00.000Z"]);
    const again = await asA(() => applyRun(options({ scenario: "w2-learn", "weekly-opened": "8" })));
    expect(again.weeklyCreated).toBe(0);
    const kept = (await db.query<{ viewed_at: string }>("select viewed_at from public.weekly_summaries where user_id = $1", [USER_A])).rows[0];
    expect(new Date(kept.viewed_at).toISOString()).toBe("2026-09-28T07:00:00.000Z");
  });

  it("the opened row goes with its source: deleting a meal of that week erases it, a meal of another week does not", async () => {
    await clearWeekly();
    await db.query("delete from public.meal_entries where user_id = $1", [USER_A]);
    const run = await asA(() => applyRun(options({ scenario: "w2-learn", "weekly-opened": "8" })));
    expect(await countOf("weekly_summaries", USER_A)).toBe(1);

    const otherWeek = run.plan.meals.find((m) => m.day <= 6);
    await asA(() => db.query("select public.delete_meal_entry($1)", [otherWeek?.id]));
    expect(await countOf("weekly_summaries", USER_A)).toBe(1);

    const thisWeek = run.plan.meals.find((m) => m.day === 10);
    await asA(() => db.query("select public.delete_meal_entry($1)", [thisWeek?.id]));
    expect(await countOf("weekly_summaries", USER_A)).toBe(0);
  });

  it("another user has none of these rows, and the same plan for another e-mail does not collide", async () => {
    await clearWeekly();
    await clearWeekly(USER_B);
    await asA(() => applyRun(options({ scenario: "w3-result-due" }), USER_A));
    expect(await countOf("experiments", USER_B)).toBe(0);
    const second = await as(db, "authenticated", USER_B, () => applyRun(options({ scenario: "w3-result-due", email: "second@eating-coach.test" }), USER_B));
    expect(second.experimentsCreated).toBe(1);
    expect(await countOf("experiments", USER_A)).toBe(1);
    expect(await countOf("experiments", USER_B)).toBe(1);
    await clearWeekly(USER_B);
  });

  it("the profile of a weekly preset has its transition stamp, and the Shabbat-rows-missing preset keeps observes_shabbat with no rows", async () => {
    await db.query("delete from public.offline_periods where user_id = $1", [USER_A]);
    await asA(() => applyRun(options({ scenario: "w2-shabbat-rows-missing" })));
    const profile = (await db.query<Record<string, unknown>>("select lifecycle_state, observes_shabbat, first_week_ended_at from public.profiles where user_id = $1", [USER_A])).rows[0];
    expect(profile).toMatchObject({ lifecycle_state: "WEEKLY_CYCLE", observes_shabbat: true });
    expect(new Date(profile.first_week_ended_at as string).toISOString()).toBe("2026-09-20T07:00:00.000Z");
    expect(Number((await db.query<{ n: string }>("select count(*) as n from public.offline_periods where user_id = $1", [USER_A])).rows[0].n)).toBe(0);
  });
});

describe("row level security: a run touches only its own user", () => {
  it("the other user has no rows after a run, and the same plan for another e-mail does not collide on a primary key", async () => {
    await db.query("delete from public.meal_entries");
    await asA(() => applyRun(options({ scenario: "day3" }), USER_A));
    expect(await mealCount(USER_B)).toBe(0);
    const second = await as(db, "authenticated", USER_B, () => applyRun(options({ scenario: "day3", email: "second@eating-coach.test" }), USER_B));
    expect(second.created).toBe(second.plan.meals.length);
    expect(await mealCount(USER_B)).toBe(second.plan.meals.length);
    expect(await mealCount(USER_A)).toBe(second.plan.meals.length);
  });
});

describe("--drop-meals", () => {
  it("deletes the newest confirmed meals through RLS and leaves the rest", async () => {
    await db.query("delete from public.meal_entries");
    const { plan } = await asA(() => applyRun(options({ scenario: "day5-early-finish" })));
    const newest = [...plan.meals].sort((a, b) => b.confirmedAt.getTime() - a.confirmedAt.getTime()).slice(0, 2).map((m) => m.id);
    await asA(async () => {
      const ids = (await db.query<{ id: string }>("select id from public.meal_entries where user_id = $1 order by confirmed_at desc limit 2", [USER_A])).rows.map((r) => r.id);
      expect(ids).toEqual(newest);
      await db.query("delete from public.meal_entries where id = any($1::uuid[])", [ids]);
    });
    expect(await mealCount(USER_A)).toBe(plan.meals.length - 2);
  });
});

describe("the weight presets' rows", () => {
  it("the weekly-cycle profile is accepted with its end of the First Week, and a goal of none ties goal_type to no weight", async () => {
    await asA(() => applyRun(options({ scenario: "w-down" })));
    const down = (await db.query<Record<string, unknown>>("select lifecycle_state, first_week_ended_at, goal_type, goal_weight_kg, start_weight_kg from public.profiles where user_id = $1", [USER_A])).rows[0];
    expect(down).toMatchObject({ lifecycle_state: "WEEKLY_CYCLE", goal_type: "numeric" });
    expect(down.first_week_ended_at).not.toBeNull();
    expect([Number(down.start_weight_kg), Number(down.goal_weight_kg)]).toEqual([80, 72]);

    await asA(() => applyRun(options({ scenario: "w-nogoal" })));
    const none = (await db.query<Record<string, unknown>>("select goal_type, goal_weight_kg from public.profiles where user_id = $1", [USER_A])).rows[0];
    expect(none).toEqual({ goal_type: "none", goal_weight_kg: null });

    await asA(() => applyRun(options({ scenario: "w-rising" })));
    expect(Number((await db.query<{ s: string }>("select start_weight_kg as s from public.profiles where user_id = $1", [USER_A])).rows[0].s)).toBe(76);
  });

  it("the junk entry of 181 kg and the daily values are accepted, and what is stored is what the plan says", async () => {
    await db.query("delete from public.weight_entries where user_id = $1", [USER_A]);
    const { plan } = await asA(() => applyRun(options({ scenario: "w-junk" })));
    const rows = (await db.query<{ id: string; weight_kg: string; source: string; measured_at: string }>(
      "select id, weight_kg, source, measured_at from public.weight_entries where user_id = $1 order by measured_at",
      [USER_A],
    )).rows;
    expect(rows.map((r) => Number(r.weight_kg))).toEqual(plan.weights.map((w) => w.weightKg));
    expect(rows.map((r) => r.weight_kg)).toContain("181.00");
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(["manual"]));
    expect(rows.map((r) => new Date(r.measured_at).getTime())).toEqual(plan.weights.map((w) => w.measuredAt.getTime()));
  });

  it("the same plan for another e-mail does not collide, and the other user keeps their rows", async () => {
    await db.query("delete from public.weight_entries");
    await asA(() => applyRun(options({ scenario: "w-down" }), USER_A));
    expect(await weightCount(USER_B)).toBe(0);
    const second = await as(db, "authenticated", USER_B, () => applyRun(options({ scenario: "w-down", email: "second@eating-coach.test" }), USER_B));
    expect(second.weightsCreated).toBe(6);
    expect(await weightCount(USER_B)).toBe(6);
    expect(await weightCount(USER_A)).toBe(6);
  });
});

describe("--drop-weights", () => {
  it("deletes the newest weigh-ins through RLS and the change log keeps no weight", async () => {
    await db.query("delete from public.weight_entries");
    await db.query("delete from public.audit_log where table_name = 'weight_entries'");
    const { plan } = await asA(() => applyRun(options({ scenario: "w-down" })));
    const newest = [...plan.weights].sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime()).slice(0, 2).map((w) => w.id);

    await asA(async () => {
      const ids = (await db.query<{ id: string }>("select id from public.weight_entries where user_id = $1 order by measured_at desc limit 2", [USER_A])).rows.map((r) => r.id);
      expect(ids).toEqual(newest);
      await db.query("delete from public.weight_entries where id = any($1::uuid[])", [ids]);
    });
    expect(await weightCount(USER_A)).toBe(plan.weights.length - 2);

    const audit = await db.query<{ action: string; old_data: unknown; new_data: unknown }>("select action, old_data, new_data from public.audit_log where table_name = 'weight_entries'");
    expect(audit.rows).toEqual([
      { action: "DELETE", old_data: null, new_data: null },
      { action: "DELETE", old_data: null, new_data: null },
    ]);
    // Neither the weight nor its key appears anywhere in the trail.
    const text = (await db.query<{ t: string }>("select coalesce(string_agg(to_jsonb(a)::text, ' '), '') as t from public.audit_log a")).rows[0].t;
    expect(text).not.toContain("weight_kg");
    expect(text).not.toMatch(/76\.2|76\.9/);
  });
});

describe("the plan itself is never a plan of a different shape than the one tested", () => {
  it("buildSeedPlan is deterministic for the rows too", () => {
    const o = options({ scenario: "day4-candidate" });
    const series = seedShabbatSeries(o);
    const a: SeedPlan = buildSeedPlan(o, toPlanShabbat(series));
    const b: SeedPlan = buildSeedPlan(o, toPlanShabbat(series));
    expect(a.meals.map((m) => toMealRow(m, null))).toEqual(b.meals.map((m) => toMealRow(m, null)));
  });
});
