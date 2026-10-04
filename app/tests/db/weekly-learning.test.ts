import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USER_A, USER_B, as, createTestDb } from "./harness";

/**
 * Weekly Learning (migration 20261002130000) on a real Postgres: the three CHECKs (a weekly row belongs to a local Sunday,
 * `content` is a small object, a finished experiment carries a consistent answer), the open/result write shapes under row
 * level security, and the ERASURE triggers: a weekly row never outlives the meal or weight of its local week. The pure
 * rules are tested elsewhere; what is pinned here is what only the database can promise.
 */

const MIGRATION = "20261002130000_weekly_learning.sql";
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? join(process.cwd(), "supabase", "migrations");
const FN = "erase_weekly_summary_of_changed_source";
const USER_C = "33333333-3333-4333-8333-333333333333";
const SUNDAY_1 = "2026-09-13";
const SUNDAY_2 = "2026-09-20";
const SUNDAY_3 = "2026-09-27";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  // Superuser cleanup between tests. Experiments first (they may point at patterns), meals and weights, then the rest.
  await db.exec(`
    delete from public.experiments; delete from public.weekly_summaries; delete from public.weight_entries;
    delete from public.meal_entries; delete from public.audit_log; delete from public.events;
    update public.profiles set timezone = 'Asia/Jerusalem';
  `);
});

const asA = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_A, fn);
const asB = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_B, fn);
const asAnon = <T>(fn: () => Promise<T>) => as(db, "anon", null, fn);

const count = async (table: string, where = "true", params: unknown[] = [], d: PGlite = db) =>
  Number((await d.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`, params)).rows[0].n);

const weekStarts = async (userId: string, d: PGlite = db) =>
  (await d.query<{ week_start: string }>("select to_char(week_start, 'YYYY-MM-DD') as week_start from public.weekly_summaries where user_id = $1 order by week_start", [userId])).rows.map((r) => r.week_start);

/** The open step exactly as openWeeklyStory sends it (an upsert that ignores duplicates), as the signed-in user. Returns the number of rows it created. */
const open = (userAs: typeof asA, userId: string, weekStart: string, mode = "LEARN") =>
  userAs(async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.weekly_summaries (user_id, week_start, opening_mode, content, generated_at, viewed_at)
       values ($1, $2::date, $3, '{"v":1}'::jsonb, $4::timestamptz, $4::timestamptz)
       on conflict (user_id, week_start) do nothing returning id`,
      [userId, weekStart, mode, "2026-09-20T07:30:00.000Z"],
    );
    return rows.length;
  });

/** A weekly row inserted by the superuser, for the erasure cases. */
const seedWeek = (userId: string, weekStart: string, mode = "CELEBRATE") =>
  db.query("insert into public.weekly_summaries (user_id, week_start, opening_mode) values ($1, $2::date, $3)", [userId, weekStart, mode]);

async function meal(userId: string, iso: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.meal_entries (user_id, occurred_at, items, source) values ($1, $2::timestamptz, $3::jsonb, 'user_manual') returning id",
    [userId, iso, JSON.stringify([{ name: "bread", portion: null }])],
  );
  return rows[0].id;
}

async function weight(userId: string, iso: string, kg = 79.5): Promise<string> {
  const { rows } = await db.query<{ id: string }>("insert into public.weight_entries (user_id, weight_kg, measured_at) values ($1, $2, $3::timestamptz) returning id", [userId, kg, iso]);
  return rows[0].id;
}

const deleteMeal = (userAs: typeof asA, id: string) => userAs(async () => (await db.query<{ ok: boolean }>("select public.delete_meal_entry($1::uuid) as ok", [id])).rows[0].ok);
const deleteWeight = (userAs: typeof asA, id: string) => userAs(async () => (await db.query<{ ok: boolean }>("select public.delete_weight_entry($1::uuid) as ok", [id])).rows[0].ok);

/** An experiment as the superuser: the columns that matter to the checks. */
const experiment = (a: { userId?: string; status: string; tried?: string | null; helpfulness?: string | null; key?: string; startedAt?: string | null }) =>
  db.query<{ id: string }>(
    "insert into public.experiments (user_id, intervention_key, status, tried, helpfulness, started_at) values ($1, $2, $3, $4, $5, $6::timestamptz) returning id",
    [a.userId ?? USER_A, a.key ?? "eat_intentionally", a.status, a.tried ?? null, a.helpfulness ?? null, a.startedAt === undefined ? "2026-09-14T08:00:00Z" : a.startedAt],
  );

describe("the migration is applied", () => {
  it("the file exists, sorts after the earlier migrations, and the function and its three triggers are in the schema", async () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    // After the last file that existed when it was written (the Shabbat top-up), and the only file with its timestamp.
    expect(files.indexOf(MIGRATION)).toBeGreaterThan(files.indexOf("20261002120000_shabbat_topup.sql"));
    expect(files.filter((f) => f.startsWith(MIGRATION.slice(0, 14)))).toEqual([MIGRATION]);

    const { rows: fn } = await db.query<{ prosecdef: boolean; config: string[] | null; rettype: string }>(
      `select p.prosecdef, p.proconfig as config, t.typname as rettype
         from pg_proc p join pg_type t on t.oid = p.prorettype
        where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
      [FN],
    );
    expect(fn).toHaveLength(1);
    // SECURITY INVOKER, an empty search_path, and a trigger function (so it cannot be called directly).
    expect(fn[0].prosecdef).toBe(false);
    expect(fn[0].config).toEqual(["search_path=\"\""]);
    expect(fn[0].rettype).toBe("trigger");

    const { rows: triggers } = await db.query<{ tgname: string; tgrelid: string }>(
      "select t.tgname, c.relname as tgrelid from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and t.tgname like '%erase_weekly_summary%' order by t.tgname",
    );
    expect(triggers.map((t) => [t.tgname, t.tgrelid])).toEqual([
      ["meal_entries_erase_weekly_summary", "meal_entries"],
      ["weight_entries_erase_weekly_summary_delete", "weight_entries"],
      ["weight_entries_erase_weekly_summary_update", "weight_entries"],
    ]);
  });

  it("replaces no function of another item and is plain additive SQL", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8");
    expect(sql).not.toMatch(/create or replace function public\.delete_(meal|weight)_entry/i);
    expect(sql).not.toMatch(/create or replace function public\.audit_changes/i);
    expect(sql).not.toMatch(/\bcreate table\b|\badd column\b|\bdrop (table|column)\b/i);
  });
});

describe("a weekly summary belongs to a local Sunday", () => {
  it("a Sunday is accepted and a Monday is rejected by the database", async () => {
    expect(await open(asA, USER_A, SUNDAY_1)).toBe(1);
    await expect(open(asA, USER_A, "2026-09-14")).rejects.toThrow(/weekly_summaries_week_start_is_sunday/);
    await expect(open(asA, USER_A, "2026-09-19")).rejects.toThrow(/weekly_summaries_week_start_is_sunday/);
    expect(await count("weekly_summaries")).toBe(1);
  });

  it("content must be an object of at most 2000 characters", async () => {
    const insert = (content: string) =>
      db.query("insert into public.weekly_summaries (user_id, week_start, opening_mode, content) values ($1, $2::date, 'LEARN', $3::jsonb)", [USER_A, SUNDAY_1, content]);
    await expect(insert("[1,2]")).rejects.toThrow(/weekly_summaries_content_is_object/);
    await expect(insert("5")).rejects.toThrow(/weekly_summaries_content_is_object/);
    await expect(insert('"text"')).rejects.toThrow(/weekly_summaries_content_is_object/);
    await expect(insert(JSON.stringify({ v: 1, line: { text: "x".repeat(2100) } }))).rejects.toThrow(/weekly_summaries_content_is_object/);
    await insert(JSON.stringify({ v: 1, line: { text: "x".repeat(400), locale: "he", source: "ai", mode: "LEARN", key: "learn" } }));
    expect(await count("weekly_summaries")).toBe(1);
  });
});

describe("a finished experiment carries a consistent answer", () => {
  it("DONE needs tried, and tried NO has no helpfulness while tried YES has one", async () => {
    await expect(experiment({ status: "DONE", tried: null, helpfulness: null })).rejects.toThrow(/experiments_result_consistent/);
    await expect(experiment({ status: "DONE", tried: "YES", helpfulness: null })).rejects.toThrow(/experiments_result_consistent/);
    await expect(experiment({ status: "DONE", tried: "NO", helpfulness: "UNKNOWN" })).rejects.toThrow(/experiments_result_consistent/);
    await expect(experiment({ status: "DONE", tried: "NO", helpfulness: "HELPFUL" })).rejects.toThrow(/experiments_result_consistent/);
    await experiment({ status: "DONE", tried: "NO", helpfulness: null });
    await experiment({ status: "DONE", tried: "YES", helpfulness: "UNKNOWN", key: "slow_down" });
    await experiment({ status: "DONE", tried: "YES", helpfulness: "HELPFUL", key: "pause" });
    expect(await count("experiments", "status = 'DONE'")).toBe(3);
  });

  it("an ACTIVE or SKIPPED row needs no answer", async () => {
    await experiment({ status: "SKIPPED", startedAt: null });
    await experiment({ status: "ACTIVE", tried: null });
    expect(await count("experiments")).toBe(2);
  });

  it("the result UPDATE as A: ACTIVE to DONE once, a second call changes nothing", async () => {
    await experiment({ status: "ACTIVE" });
    const answer = () =>
      asA(async () => {
        const { rows } = await db.query<{ intervention_key: string; wording_source: string | null }>(
          `update public.experiments set status = 'DONE', ended_at = $1::timestamptz, tried = 'YES', helpfulness = 'HELPFUL'
            where user_id = $2 and status = 'ACTIVE' returning intervention_key, wording_source`,
          ["2026-09-20T07:30:00.000Z", USER_A],
        );
        return rows;
      });
    expect(await answer()).toEqual([{ intervention_key: "eat_intentionally", wording_source: null }]);
    expect(await answer()).toEqual([]);
    const { rows } = await db.query<{ status: string; ended_at: Date }>("select status, ended_at from public.experiments");
    expect(rows[0].status).toBe("DONE");
    expect(rows[0].ended_at.toISOString()).toBe("2026-09-20T07:30:00.000Z");
  });

  it("B cannot answer A's experiment, even by naming A", async () => {
    await experiment({ status: "ACTIVE" });
    const attempt = () =>
      asB(async () => (await db.query("update public.experiments set status = 'DONE', tried = 'NO' where user_id = $1 and status = 'ACTIVE' returning id", [USER_A])).rows);
    expect(await attempt()).toEqual([]);
    expect(await count("experiments", "status = 'ACTIVE'")).toBe(1);
  });

  it("after DONE a new OFFERED row can be created, and a second open row is rejected", async () => {
    await experiment({ status: "DONE", tried: "YES", helpfulness: "SOMEWHAT" });
    await asA(() => db.query("insert into public.experiments (intervention_key, status) values ('slow_down', 'OFFERED')"));
    await expect(asA(() => db.query("insert into public.experiments (intervention_key, status) values ('pause', 'OFFERED')"))).rejects.toThrow(/experiments_one_open/);
    expect(await count("experiments", "status in ('OFFERED', 'ACTIVE')")).toBe(1);
  });
});

describe("the open step under row level security", () => {
  it("the first call inserts one row, the second (on conflict do nothing) none, and the row keeps its first opening mode", async () => {
    expect(await open(asA, USER_A, SUNDAY_1, "LEARN")).toBe(1);
    expect(await open(asA, USER_A, SUNDAY_1, "CELEBRATE")).toBe(0);
    const { rows } = await db.query<{ opening_mode: string; content: unknown; viewed_at: Date; generated_at: Date }>("select opening_mode, content, viewed_at, generated_at from public.weekly_summaries");
    expect(rows).toHaveLength(1);
    expect(rows[0].opening_mode).toBe("LEARN");
    expect(rows[0].content).toEqual({ v: 1 });
    // The injected instant, not the database clock.
    expect(rows[0].viewed_at.toISOString()).toBe("2026-09-20T07:30:00.000Z");
    expect(rows[0].generated_at.toISOString()).toBe("2026-09-20T07:30:00.000Z");
  });

  it("the line update changes only content", async () => {
    await open(asA, USER_A, SUNDAY_1);
    const { rows } = await asA(() =>
      db.query<{ id: string }>(
        "update public.weekly_summaries set content = $1::jsonb where user_id = $2 and week_start = $3::date returning id",
        [JSON.stringify({ v: 1, line: { text: "x", locale: "he", source: "ai", mode: "LEARN", key: "learn" } }), USER_A, SUNDAY_1],
      ),
    );
    expect(rows).toHaveLength(1);
    const after = await db.query<{ opening_mode: string; content: { line?: unknown } }>("select opening_mode, content from public.weekly_summaries");
    expect(after.rows[0].opening_mode).toBe("LEARN");
    expect(after.rows[0].content.line).toBeDefined();
  });

  it("B cannot read, update, delete or insert A's weekly row, and anon cannot touch the table", async () => {
    await open(asA, USER_A, SUNDAY_1);
    expect(await asB(async () => (await db.query("select id from public.weekly_summaries")).rows)).toEqual([]);
    expect(await asB(async () => (await db.query("update public.weekly_summaries set opening_mode = 'RESET' where user_id = $1 returning id", [USER_A])).rows)).toEqual([]);
    expect(await asB(async () => (await db.query("delete from public.weekly_summaries where user_id = $1 returning id", [USER_A])).rows)).toEqual([]);
    await expect(asB(() => open(asB, USER_A, SUNDAY_2))).rejects.toThrow(/row-level security/);
    await expect(asAnon(() => db.query("select id from public.weekly_summaries"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => db.query("insert into public.weekly_summaries (user_id, week_start, opening_mode) values ($1, $2::date, 'LEARN')", [USER_A, SUNDAY_2]))).rejects.toThrow(/permission denied/);
    expect(await weekStarts(USER_A)).toEqual([SUNDAY_1]);
  });

  it("A can insert weekly_card_snoozed and pattern_question_answered events and read them, and B cannot", async () => {
    await asA(async () => {
      await db.query("insert into public.events (name, payload, occurred_at) values ('weekly_card_snoozed', $1::jsonb, $2::timestamptz)", [JSON.stringify({ week: SUNDAY_1 }), "2026-09-20T07:30:00Z"]);
      await db.query("insert into public.events (name, payload) values ('pattern_question_answered', $1::jsonb)", [JSON.stringify({ answer: "confirm", level: "CANDIDATE" })]);
    });
    const names = (userAs: typeof asA) => userAs(async () => (await db.query<{ name: string }>("select name from public.events order by name")).rows.map((r) => r.name));
    expect(await names(asA)).toEqual(["pattern_question_answered", "weekly_card_snoozed"]);
    expect(await names(asB)).toEqual([]);
  });
});

describe("erasure: a weekly row never outlives the meal of its local week", () => {
  it("deleting a meal removes ONLY the row of its LOCAL week, by the profile's zone, not UTC", async () => {
    await seedWeek(USER_A, SUNDAY_1);
    await seedWeek(USER_A, SUNDAY_2);
    await seedWeek(USER_B, SUNDAY_2);

    // Saturday 2026-09-19 23:30 Jerusalem (UTC+3) = 20:30Z: still the week of 09-13.
    const lateSaturday = await meal(USER_A, "2026-09-19T20:30:00Z");
    // Sunday 2026-09-20 00:30 Jerusalem = Saturday 21:30Z: the NEW week. A UTC computation puts it in 09-13 and fails here.
    const earlySunday = await meal(USER_A, "2026-09-19T21:30:00Z");

    expect(await deleteMeal(asA, lateSaturday)).toBe(true);
    expect(await weekStarts(USER_A)).toEqual([SUNDAY_2]);
    expect(await weekStarts(USER_B)).toEqual([SUNDAY_2]);

    await seedWeek(USER_A, SUNDAY_1);
    expect(await deleteMeal(asA, earlySunday)).toBe(true);
    expect(await weekStarts(USER_A)).toEqual([SUNDAY_1]);
    // B's row stays in both.
    expect(await weekStarts(USER_B)).toEqual([SUNDAY_2]);
  });

  it("a week in another time zone is computed in that zone", async () => {
    await db.query("update public.profiles set timezone = 'America/New_York' where user_id = $1", [USER_A]);
    await seedWeek(USER_A, SUNDAY_1);
    await seedWeek(USER_A, SUNDAY_2);
    // 2026-09-20 02:00Z is Saturday 22:00 in New York (UTC-4): the week of 09-13.
    const id = await meal(USER_A, "2026-09-20T02:00:00Z");
    await deleteMeal(asA, id);
    expect(await weekStarts(USER_A)).toEqual([SUNDAY_2]);
  });

  it("deleting a meal that has no weekly row is a no-op, and a meal of another week leaves the row", async () => {
    await seedWeek(USER_A, SUNDAY_2);
    const other = await meal(USER_A, "2026-09-09T10:00:00Z");
    expect(await deleteMeal(asA, other)).toBe(true);
    expect(await weekStarts(USER_A)).toEqual([SUNDAY_2]);
  });

  it("B deleting B's own meal never touches A's row, and B cannot delete A's meal at all", async () => {
    await seedWeek(USER_A, SUNDAY_2);
    const mineA = await meal(USER_A, "2026-09-21T10:00:00Z");
    const mineB = await meal(USER_B, "2026-09-21T10:00:00Z");
    expect(await deleteMeal(asB, mineA)).toBe(false);
    expect(await weekStarts(USER_A)).toEqual([SUNDAY_2]);
    expect(await deleteMeal(asB, mineB)).toBe(true);
    expect(await weekStarts(USER_A)).toEqual([SUNDAY_2]);
  });

  it("the function filters on the owner itself, not only through row level security: a delete by a role that bypasses RLS touches only the owner's row", async () => {
    await seedWeek(USER_A, SUNDAY_2);
    await seedWeek(USER_B, SUNDAY_2);
    const mineA = await meal(USER_A, "2026-09-21T10:00:00Z");
    // The superuser (RLS does not apply) deletes A's meal directly: B's row of the same local week must stay.
    await db.query("delete from public.meal_entries where id = $1::uuid", [mineA]);
    expect(await weekStarts(USER_A)).toEqual([]);
    expect(await weekStarts(USER_B)).toEqual([SUNDAY_2]);
  });

  it("after the erasure the open step succeeds again (the card may come back)", async () => {
    expect(await open(asA, USER_A, SUNDAY_2)).toBe(1);
    const id = await meal(USER_A, "2026-09-22T10:00:00Z");
    expect(await open(asA, USER_A, SUNDAY_2)).toBe(0);
    await deleteMeal(asA, id);
    expect(await weekStarts(USER_A)).toEqual([]);
    expect(await open(asA, USER_A, SUNDAY_2, "RESET")).toBe(1);
  });
});

describe("erasure: a weekly row never outlives the weight of its local week", () => {
  it("delete_weight_entry removes the row of the weight's local week", async () => {
    await seedWeek(USER_A, SUNDAY_1);
    await seedWeek(USER_A, SUNDAY_2);
    const id = await weight(USER_A, "2026-09-16T05:00:00Z");
    expect(await deleteWeight(asA, id)).toBe(true);
    expect(await weekStarts(USER_A)).toEqual([SUNDAY_2]);
  });

  it("changing the kilograms removes the row of that week", async () => {
    await seedWeek(USER_A, SUNDAY_1);
    const id = await weight(USER_A, "2026-09-16T05:00:00Z");
    await asA(() => db.query("update public.weight_entries set weight_kg = 78.9 where id = $1", [id]));
    expect(await weekStarts(USER_A)).toEqual([]);
  });

  it("moving a weigh-in to another week removes BOTH the old and the new week's rows", async () => {
    await seedWeek(USER_A, SUNDAY_1);
    await seedWeek(USER_A, SUNDAY_2);
    await seedWeek(USER_A, SUNDAY_3);
    const id = await weight(USER_A, "2026-09-16T05:00:00Z");
    await asA(() => db.query("update public.weight_entries set measured_at = '2026-09-23T05:00:00Z' where id = $1", [id]));
    expect(await weekStarts(USER_A)).toEqual([SUNDAY_3]);
  });

  it("a note-only edit and an edit that sets the same kilograms remove nothing", async () => {
    await seedWeek(USER_A, SUNDAY_1);
    const id = await weight(USER_A, "2026-09-16T05:00:00Z", 79.5);
    await asA(() => db.query("update public.weight_entries set note = 'after a trip' where id = $1", [id]));
    await asA(() => db.query("update public.weight_entries set weight_kg = 79.5 where id = $1", [id]));
    await asA(() => db.query("update public.weight_entries set weight_kg = 79.5, measured_at = '2026-09-16T05:00:00Z' where id = $1", [id]));
    expect(await weekStarts(USER_A)).toEqual([SUNDAY_1]);
  });

  it("B's weight changes never touch A's row", async () => {
    await seedWeek(USER_A, SUNDAY_1);
    const id = await weight(USER_B, "2026-09-16T05:00:00Z");
    await deleteWeight(asB, id);
    expect(await weekStarts(USER_A)).toEqual([SUNDAY_1]);
  });
});

describe("erasure is safe", () => {
  it("a time zone the database does not know falls back to Asia/Jerusalem, and the delete does not fail", async () => {
    await db.query("update public.profiles set timezone = 'Not/AZone' where user_id = $1", [USER_A]);
    await seedWeek(USER_A, SUNDAY_2);
    // Saturday 21:30Z is Sunday 00:30 in the fallback zone: the week of 09-20.
    const id = await meal(USER_A, "2026-09-19T21:30:00Z");
    expect(await deleteMeal(asA, id)).toBe(true);
    expect(await weekStarts(USER_A)).toEqual([]);
  });

  it("a person without a profile row falls back too", async () => {
    await db.query("delete from public.profiles where user_id = $1", [USER_A]);
    await seedWeek(USER_A, SUNDAY_2);
    const id = await weight(USER_A, "2026-09-22T05:00:00Z");
    expect(await deleteWeight(asA, id)).toBe(true);
    expect(await weekStarts(USER_A)).toEqual([]);
    await db.query("insert into public.profiles (user_id) values ($1) on conflict do nothing", [USER_A]);
  });

  it("deleting the auth user (the account deletion cascade) still works", async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'c@example.test')", [USER_C]);
    await seedWeek(USER_C, SUNDAY_2);
    await meal(USER_C, "2026-09-22T10:00:00Z");
    await weight(USER_C, "2026-09-22T05:00:00Z");
    await db.query("delete from auth.users where id = $1", [USER_C]);
    expect(await count("meal_entries", "user_id = $1", [USER_C])).toBe(0);
    expect(await count("weekly_summaries", "user_id = $1", [USER_C])).toBe(0);
  });

  it("a trigger function cannot be called directly, by anyone", async () => {
    await expect(db.query(`select public.${FN}()`)).rejects.toThrow(/trigger/i);
    await expect(asA(() => db.query(`select public.${FN}()`))).rejects.toThrow(/trigger/i);
    await expect(asAnon(() => db.query(`select public.${FN}()`))).rejects.toThrow(/trigger/i);
  });
});

describe("the migration is safe on a database that already has rows", () => {
  /** A database built from the migrations that sort BEFORE this one only, as the deploy would find it. */
  async function oldDatabase<T>(body: (old: PGlite, apply: () => Promise<void>) => Promise<T>): Promise<T> {
    const before = mkdtempSync(join(tmpdir(), "migrations-before-weekly-"));
    const previous = process.env.MIGRATIONS_DIR;
    let old: PGlite | null = null;
    try {
      for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f < MIGRATION)) cpSync(join(MIGRATIONS_DIR, file), join(before, file));
      process.env.MIGRATIONS_DIR = before;
      old = await createTestDb();
    } finally {
      if (previous === undefined) delete process.env.MIGRATIONS_DIR;
      else process.env.MIGRATIONS_DIR = previous;
    }
    try {
      return await body(old, async () => {
        await old!.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8"));
      });
    } finally {
      await old.close();
      rmSync(before, { recursive: true, force: true });
    }
  }

  async function populate(d: PGlite) {
    await d.query("insert into public.weekly_summaries (user_id, week_start, opening_mode, content) values ($1, $2::date, 'LEARN', '{}'::jsonb)", [USER_A, SUNDAY_2]);
    await d.query("insert into public.experiments (user_id, intervention_key, status, started_at) values ($1, 'eat_intentionally', 'ACTIVE', '2026-09-14T08:00:00Z')", [USER_A]);
    await d.query("insert into public.experiments (user_id, intervention_key, status, ended_at) values ($1, 'slow_down', 'SKIPPED', '2026-09-10T08:00:00Z')", [USER_A]);
    await d.query("insert into public.meal_entries (user_id, occurred_at, items, source) values ($1, '2026-09-22T10:00:00Z', '[{\"name\":\"bread\"}]'::jsonb, 'user_manual')", [USER_A]);
    await d.query("insert into public.weight_entries (user_id, weight_kg, measured_at) values ($1, 79.5, '2026-09-22T05:00:00Z')", [USER_A]);
  }
  const tally = async (d: PGlite) => ({
    weekly: await count("weekly_summaries", "true", [], d),
    experiments: await count("experiments", "true", [], d),
    meals: await count("meal_entries", "true", [], d),
    weights: await count("weight_entries", "true", [], d),
  });

  it("applies to rows written before it, and deletes none of them", async () => {
    await oldDatabase(async (old, apply) => {
      await populate(old);
      const before = await tally(old);
      expect(before).toEqual({ weekly: 1, experiments: 2, meals: 1, weights: 1 });
      expect((await old.query("select 1 from pg_proc where proname = $1", [FN])).rows).toHaveLength(0);

      await apply();

      expect(await tally(old)).toEqual(before);
      expect((await old.query("select 1 from pg_proc where proname = $1", [FN])).rows).toHaveLength(1);
    });
  });

  it("the file can be applied again after its objects are dropped, and nothing existing is deleted", async () => {
    await populate(db);
    const before = await tally(db);
    await db.exec(`
      drop trigger meal_entries_erase_weekly_summary on public.meal_entries;
      drop trigger weight_entries_erase_weekly_summary_delete on public.weight_entries;
      drop trigger weight_entries_erase_weekly_summary_update on public.weight_entries;
      drop function public.${FN}();
      alter table public.weekly_summaries drop constraint weekly_summaries_week_start_is_sunday, drop constraint weekly_summaries_content_is_object;
      alter table public.experiments drop constraint experiments_result_consistent;
    `);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8"));
    expect(await tally(db)).toEqual(before);
    // And the rules are back in force.
    await expect(open(asA, USER_A, "2026-09-14")).rejects.toThrow(/weekly_summaries_week_start_is_sunday/);
  });
});
