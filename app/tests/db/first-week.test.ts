import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USER_A, USER_B, as, createTestDb } from "./harness";

/**
 * First Week ending (B6) on a real Postgres: the one additive CHECK of 20261001160000_first_week_end.sql, the
 * transition's conditional update as the signed-in user, and the two events it relies on. Row Level Security in
 * general is covered by rls.test.ts.
 */

const MIGRATION = "20261001160000_first_week_end.sql";
const CONSTRAINT = "profiles_weekly_cycle_has_end";
const STARTED = "2026-10-01T09:30:00.000Z";
const NOW = "2026-10-19T00:05:00.000Z";
const LATER = "2026-10-20T08:00:00.000Z";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const asA = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_A, fn);
const asB = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_B, fn);

/** The state of a user who finished onboarding and is in the First Week (superuser, so RLS does not interfere). */
const putInFirstWeek = (userId: string) =>
  db.query(
    `update public.profiles
        set lifecycle_state = 'FIRST_WEEK', onboarding_completed_at = $2::timestamptz, first_week_started_at = $2::timestamptz,
            first_week_ended_at = null
      where user_id = $1`,
    [userId, STARTED],
  );

beforeEach(async () => {
  await db.exec("delete from public.events");
  await putInFirstWeek(USER_A);
  await putInFirstWeek(USER_B);
});

/** The exact update of completeFirstWeek (src/lib/firstWeek/complete.ts), as SQL. */
const transition = (userId: string, ended = NOW) =>
  db.query<{ user_id: string }>(
    `update public.profiles set lifecycle_state = 'WEEKLY_CYCLE', first_week_ended_at = $2::timestamptz
      where user_id = $1 and lifecycle_state = 'FIRST_WEEK' returning user_id`,
    [userId, ended],
  );

const profileOf = async (userId: string) =>
  (await db.query<{ lifecycle_state: string; first_week_ended_at: string | null }>(
    "select lifecycle_state, to_char(first_week_ended_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as first_week_ended_at from public.profiles where user_id = $1",
    [userId],
  )).rows[0];

describe("the CHECK profiles_weekly_cycle_has_end", () => {
  it("rejects a WEEKLY_CYCLE row without first_week_ended_at, and accepts one with it", async () => {
    await expect(db.query("update public.profiles set lifecycle_state = 'WEEKLY_CYCLE' where user_id = $1", [USER_A])).rejects.toThrow(CONSTRAINT);
    await db.query("update public.profiles set lifecycle_state = 'WEEKLY_CYCLE', first_week_ended_at = $2 where user_id = $1", [USER_A, NOW]);
    expect((await profileOf(USER_A)).lifecycle_state).toBe("WEEKLY_CYCLE");
  });

  it("does not constrain the earlier states, whatever first_week_ended_at holds", async () => {
    for (const state of ["NEW", "ONBOARDING", "FIRST_WEEK"]) {
      await expect(
        db.query("update public.profiles set lifecycle_state = $2, first_week_ended_at = null where user_id = $1", [USER_A, state]),
      ).resolves.toBeDefined();
    }
  });

  it("can be applied to a database that already has rows (FIRST_WEEK, ended_at null) without touching them", async () => {
    await db.exec(`alter table public.profiles drop constraint ${CONSTRAINT}`);
    expect((await profileOf(USER_A)).first_week_ended_at).toBeNull();

    const sql = readFileSync(join(process.env.MIGRATIONS_DIR ?? join(process.cwd(), "supabase", "migrations"), MIGRATION), "utf8");
    await expect(db.exec(sql)).resolves.toBeDefined();

    expect(await profileOf(USER_A)).toEqual({ lifecycle_state: "FIRST_WEEK", first_week_ended_at: null });
    // And it is back in force.
    await expect(db.query("update public.profiles set lifecycle_state = 'WEEKLY_CYCLE' where user_id = $1", [USER_A])).rejects.toThrow(CONSTRAINT);
  });

  it("is additive: it adds no column and no table", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'first_week_ended_at'");
    expect(rows[0].n).toBe(1);
  });

  it("lets a replay-style reset go back to ONBOARDING with first_week_ended_at kept (no second CHECK ties it to the start)", async () => {
    await transition(USER_A);
    await db.query("update public.profiles set lifecycle_state = 'ONBOARDING' where user_id = $1", [USER_A]);
    // Re-finishing writes a NEWER start, and the old end is still there: an `ended >= started` check would break this.
    await db.query("update public.profiles set first_week_started_at = $2, lifecycle_state = 'FIRST_WEEK' where user_id = $1", [USER_A, LATER]);
    const { rows } = await db.query<{ ok: boolean }>("select first_week_ended_at < first_week_started_at as ok from public.profiles where user_id = $1", [USER_A]);
    expect(rows[0].ok).toBe(true);
  });
});

describe("the transition's conditional update, as the signed-in user", () => {
  it("the first call changes one row and sets both fields; the second changes none and keeps the original moment", async () => {
    const first = await asA(() => transition(USER_A, NOW));
    expect(first.rows).toEqual([{ user_id: USER_A }]);
    expect(await profileOf(USER_A)).toEqual({ lifecycle_state: "WEEKLY_CYCLE", first_week_ended_at: NOW });

    const second = await asA(() => transition(USER_A, LATER));
    expect(second.rows).toEqual([]);
    expect(await profileOf(USER_A)).toEqual({ lifecycle_state: "WEEKLY_CYCLE", first_week_ended_at: NOW });
  });

  it("filters on the expected state: a NEW or ONBOARDING profile is never moved", async () => {
    await db.query("update public.profiles set lifecycle_state = 'ONBOARDING' where user_id = $1", [USER_A]);
    expect((await asA(() => transition(USER_A))).rows).toEqual([]);
    expect((await profileOf(USER_A)).lifecycle_state).toBe("ONBOARDING");
  });

  it("another user cannot transition the row (row level security: no row matches)", async () => {
    const attempt = await asB(() => transition(USER_A));
    expect(attempt.rows).toEqual([]);
    expect(await profileOf(USER_A)).toEqual({ lifecycle_state: "FIRST_WEEK", first_week_ended_at: null });
    expect((await profileOf(USER_B)).lifecycle_state).toBe("FIRST_WEEK");
  });

  it("anon cannot update profiles at all", async () => {
    await expect(as(db, "anon", null, () => transition(USER_A))).rejects.toThrow(/permission denied/);
    expect((await profileOf(USER_A)).lifecycle_state).toBe("FIRST_WEEK");
  });
});

describe("the events the First Week writes", () => {
  const insertEvent = (name: string, payload: object, occurredAt = NOW) =>
    db.query("insert into public.events (name, payload, occurred_at) values ($1, $2::jsonb, $3::timestamptz)", [name, JSON.stringify(payload), occurredAt]);
  const readEvents = () => db.query<{ name: string; payload: object }>("select name, payload from public.events order by id");

  it("the owner can insert first_week_completed and read it back, and cannot insert one for someone else", async () => {
    await asA(() => insertEvent("first_week_completed", { reason: "enough_data", had_enough_data: true, available_days: 5, confirmed_meals: 10 }));
    expect((await asA(readEvents)).rows).toEqual([
      { name: "first_week_completed", payload: { reason: "enough_data", had_enough_data: true, available_days: 5, confirmed_meals: 10 } },
    ]);
    await expect(
      asA(() => db.query("insert into public.events (user_id, name) values ($1, 'first_week_completed')", [USER_B])),
    ).rejects.toThrow(/row-level security/);
  });

  it("the owner can insert the snooze with the card in its payload, read it back, and nobody else can read or forge it", async () => {
    await asA(() => insertEvent("first_week_card_snoozed", { card: "summary" }));
    expect((await asA(readEvents)).rows).toEqual([{ name: "first_week_card_snoozed", payload: { card: "summary" } }]);
    expect((await asB(readEvents)).rows).toEqual([]);
    await expect(
      asA(() => db.query("insert into public.events (user_id, name, payload) values ($1, 'first_week_card_snoozed', '{\"card\":\"summary\"}')", [USER_B])),
    ).rejects.toThrow(/row-level security/);
  });

  it("events stay append-only for the owner (no update, no delete)", async () => {
    await asA(() => insertEvent("first_week_card_snoozed", { card: "summary" }));
    await expect(asA(() => db.query("delete from public.events"))).rejects.toThrow(/permission denied/);
    await expect(asA(() => db.query("update public.events set name = 'x'"))).rejects.toThrow(/permission denied/);
  });

  it("reads back by the snooze reader's filter: this user, this name, newer than the cut-off", async () => {
    await asA(() => insertEvent("first_week_card_snoozed", { card: "welcome_back" }, "2026-10-18T10:00:00.000Z"));
    await asA(() => insertEvent("first_week_card_snoozed", { card: "summary" }, "2026-10-10T10:00:00.000Z"));
    const { rows } = await asA(() =>
      db.query<{ payload: { card: string } }>(
        "select payload from public.events where user_id = $1 and name = 'first_week_card_snoozed' and occurred_at > $2::timestamptz order by occurred_at desc limit 10",
        [USER_A, "2026-10-18T00:00:00.000Z"],
      ),
    );
    expect(rows.map((r) => r.payload.card)).toEqual(["welcome_back"]);
  });
});
