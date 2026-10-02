import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USER_A, USER_B, as, createTestDb } from "./harness";

/**
 * Pattern detection (migration 20261001170000) on a real Postgres: the single evidence writer
 * sync_pattern_evidence, the answer's timestamp, and the experiments states. The pure rules are tested elsewhere;
 * what is pinned here is that the stored mirror always ends up equal to the live meals, that the person's own
 * answer is never erased, that a rejected pattern holds no evidence, and that the migration is safe on existing rows.
 */

const MIGRATION = "20261001170000_pattern_detection.sql";
const KIND = "late_evening_meals";
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? join(process.cwd(), "supabase", "migrations");
const NOW = "2026-10-12T09:30:00.000Z";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  // Superuser cleanup between tests. Experiments and evidence first (they point at patterns), meals last.
  await db.exec(`
    delete from public.experiments; delete from public.pattern_evidence; delete from public.patterns;
    delete from public.meal_entries; delete from public.audit_log; delete from public.events;
  `);
});

const asA = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_A, fn);
const asB = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_B, fn);

/** A confirmed meal inserted directly (as the superuser), eaten at `iso`. */
async function meal(userId: string, iso = "2026-10-05T18:40:00Z"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.meal_entries (user_id, occurred_at, items, source) values ($1, $2::timestamptz, $3::jsonb, 'user_manual') returning id",
    [userId, iso, JSON.stringify([{ name: "bread", portion: null }])],
  );
  return rows[0].id;
}

/** Three late evenings of `userId`. */
const threeMeals = async (userId = USER_A) => [await meal(userId, "2026-10-05T18:40:00Z"), await meal(userId, "2026-10-06T19:10:00Z"), await meal(userId, "2026-10-07T18:05:00Z")];

type Occ = string | { meal_id: string; observed_at: string };
const toOccurrences = (list: readonly Occ[]) =>
  list.map((o, i) => (typeof o === "string" ? { meal_id: o, observed_at: new Date(Date.UTC(2026, 9, 5 + i, 18, 40)).toISOString() } : o));

/** The writer, as a signed-in user. */
const sync = (userId: string | null, status: string | null, list: readonly Occ[] | unknown, kind: string = KIND) =>
  as(db, "authenticated", userId, async () => {
    const { rows } = await db.query<{ id: string }>("select public.sync_pattern_evidence($1, $2, $3::jsonb) as id", [
      kind,
      status,
      JSON.stringify(Array.isArray(list) ? toOccurrences(list as Occ[]) : list),
    ]);
    return rows[0].id;
  });

const syncA = (status: string, list: readonly Occ[], kind = KIND) => sync(USER_A, status, list, kind);

interface EvidenceRow {
  id: string;
  pattern_id: string;
  source_table: string | null;
  source_id: string | null;
  observed_at: Date;
}
const evidence = async (patternId?: string) =>
  (await db.query<EvidenceRow>(
    `select id, pattern_id, source_table, source_id, observed_at from public.pattern_evidence
      ${patternId ? "where pattern_id = $1" : ""} order by source_id`,
    patternId ? [patternId] : [],
  )).rows;
const sourceIds = async (patternId?: string) => (await evidence(patternId)).map((e) => e.source_id).sort();

interface PatternRowDb {
  id: string;
  user_id: string;
  status: string;
  user_feedback: string | null;
  user_feedback_at: Date | null;
  validated_at: Date | null;
  updated_at: Date;
}
const patternRows = async (where = "true", params: unknown[] = []) =>
  (await db.query<PatternRowDb>(`select id, user_id, status, user_feedback, user_feedback_at, validated_at, updated_at from public.patterns where ${where}`, params)).rows;
const patternOf = async (userId = USER_A) => (await patternRows("user_id = $1 and kind = $2", [userId, KIND]))[0];

const count = async (table: string, where = "true", params: unknown[] = []) =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`, params)).rows[0].n);

// ---------------------------------------------------------------------------------------------------------

describe("migration 2: the unique evidence key", () => {
  it("applies on top of every earlier file, and refuses two evidence rows for the same (pattern, source)", async () => {
    const [m1] = await threeMeals();
    const patternId = await syncA("OBSERVATION", [m1]);
    await expect(
      db.query("insert into public.pattern_evidence (user_id, pattern_id, observed_at, source_table, source_id) values ($1, $2, now(), 'meal_entries', $3)", [
        USER_A,
        patternId,
        m1,
      ]),
    ).rejects.toThrow("pattern_evidence_unique_source");
  });
});

describe("sync_pattern_evidence: create and idempotence", () => {
  it("creates the pattern as OBSERVATION with exactly the given evidence rows, pointing at the meals", async () => {
    const [m1, m2] = await threeMeals();
    const id = await syncA("OBSERVATION", [m1, m2]);

    const pattern = await patternOf();
    expect(pattern).toMatchObject({ id, status: "OBSERVATION", user_feedback: null, user_feedback_at: null, validated_at: null });
    const rows = await evidence(id);
    expect(rows.map((r) => [r.source_table, r.source_id]).sort()).toEqual([["meal_entries", m1], ["meal_entries", m2]].sort());
    expect(rows.every((r) => r.observed_at instanceof Date)).toBe(true);
  });

  it("a second identical call changes nothing: same row ids, same observed_at, same updated_at", async () => {
    const [m1, m2] = await threeMeals();
    const id = await syncA("CANDIDATE", [m1, m2]);
    const before = { evidence: await evidence(id), pattern: await patternOf() };

    expect(await syncA("CANDIDATE", [m1, m2])).toBe(id);
    const after = { evidence: await evidence(id), pattern: await patternOf() };

    expect(after.evidence).toEqual(before.evidence);
    expect(after.pattern.updated_at.getTime()).toBe(before.pattern.updated_at.getTime());
    expect(after.pattern).toEqual(before.pattern);
  });

  it("a changed observed_at is updated in place (same row id)", async () => {
    const [m1] = await threeMeals();
    const id = await syncA("OBSERVATION", [{ meal_id: m1, observed_at: "2026-10-05T18:40:00.000Z" }]);
    const before = await evidence(id);
    await syncA("OBSERVATION", [{ meal_id: m1, observed_at: "2026-10-05T18:50:00.000Z" }]);
    const after = await evidence(id);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after[0].observed_at.toISOString()).toBe("2026-10-05T18:50:00.000Z");
  });

  it("the unique key per user makes a second call find the same pattern, not create another", async () => {
    const [m1] = await threeMeals();
    const first = await syncA("OBSERVATION", [m1]);
    const second = await syncA("OBSERVATION", [m1]);
    expect(second).toBe(first);
    expect(await count("patterns")).toBe(1);
  });
});

describe("sync_pattern_evidence: set equality", () => {
  it("adds the missing, deletes the rest, and keeps the pattern row when the set becomes empty", async () => {
    const [m1, m2, m3] = await threeMeals();
    const id = await syncA("OBSERVATION", [m1, m2]);

    await syncA("CANDIDATE", [m1, m2, m3]);
    expect(await sourceIds(id)).toEqual([m1, m2, m3].sort());

    await syncA("OBSERVATION", [m1]);
    expect(await sourceIds(id)).toEqual([m1]);

    await syncA("OBSERVATION", []);
    expect(await sourceIds(id)).toEqual([]);
    expect(await patternOf()).toMatchObject({ id, status: "OBSERVATION" });
  });

  it("removes evidence of another source table under the same pattern too (this kind's evidence comes only from meals)", async () => {
    const [m1] = await threeMeals();
    const id = await syncA("OBSERVATION", [m1]);
    await db.query("insert into public.pattern_evidence (user_id, pattern_id, observed_at, source_table, source_id) values ($1, $2, now(), 'weight_entries', $3)", [USER_A, id, m1]);
    await db.query("insert into public.pattern_evidence (user_id, pattern_id, observed_at, source_table, source_id) values ($1, $2, now(), null, null)", [USER_A, id]);
    expect(await count("pattern_evidence")).toBe(3);

    await syncA("OBSERVATION", [m1]);
    expect((await evidence(id)).map((e) => [e.source_table, e.source_id])).toEqual([["meal_entries", m1]]);
  });

  it("only touches the rows of THIS pattern kind", async () => {
    const [m1, m2] = await threeMeals();
    const other = await syncA("OBSERVATION", [m1], "some_other_kind");
    const mine = await syncA("OBSERVATION", [m2]);
    await syncA("OBSERVATION", []);
    expect(await sourceIds(other)).toEqual([m1]);
    expect(await sourceIds(mine)).toEqual([]);
  });
});

describe("sync_pattern_evidence: the meal-exists guard", () => {
  it("skips an occurrence whose meal does not exist, or belongs to someone else, without an error", async () => {
    const [mine] = await threeMeals();
    const theirs = await meal(USER_B);
    const id = await syncA("OBSERVATION", [mine, UNKNOWN_ID, theirs]);
    expect(await sourceIds(id)).toEqual([mine]);
  });

  it("a meal_id that is not a uuid raises", async () => {
    await meal(USER_A); // (the cast is evaluated while the guard looks the meal up)
    await expect(syncA("OBSERVATION", [{ meal_id: "not-a-uuid", observed_at: NOW }])).rejects.toThrow(/uuid/i);
  });

  it("a sync that raced a delete (its list still holds the deleted meal) inserts nothing for it", async () => {
    const [m1, m2] = await threeMeals();
    const id = await syncA("OBSERVATION", [m1, m2]);
    await asA(() => db.query("select public.delete_meal_entry($1::uuid) as ok", [m2])); // erases m2's evidence, then the meal
    expect(await sourceIds(id)).toEqual([m1]);

    await syncA("OBSERVATION", [m1, m2]); // the sync that started before the delete finished
    expect(await sourceIds(id)).toEqual([m1]);
  });
});

describe("sync_pattern_evidence and delete_meal_entry: two idempotent writers that commute", () => {
  const removeViaRpc = (mealId: string) => asA(() => db.query("select public.delete_meal_entry($1::uuid) as ok", [mealId]));

  it("delete_meal_entry erases the evidence of the meal at once and leaves patterns alone (a stale mirror); the next sync converges it", async () => {
    const [m1, m2, m3] = await threeMeals();
    const id = await syncA("CANDIDATE", [m1, m2, m3]);

    await removeViaRpc(m2);
    expect(await sourceIds(id)).toEqual([m1, m3].sort()); // erased before any sync
    expect(await patternOf()).toMatchObject({ id, status: "CANDIDATE" }); // the mirror is stale, on purpose

    await syncA("OBSERVATION", [m1, m3]);
    expect(await sourceIds(id)).toEqual([m1, m3].sort());
    expect(await patternOf()).toMatchObject({ id, status: "OBSERVATION" });
  });

  it("a plain delete (no RPC, evidence left behind) followed by the sync reaches the same end state", async () => {
    const [m1, m2, m3] = await threeMeals();
    const id = await syncA("CANDIDATE", [m1, m2, m3]);
    // No foreign key on source_id: the evidence row outlives the meal until the sync runs.
    await db.query("delete from public.meal_entries where id = $1", [m2]);
    expect(await sourceIds(id)).toEqual([m1, m2, m3].sort());

    await syncA("OBSERVATION", [m1, m3]);
    expect(await sourceIds(id)).toEqual([m1, m3].sort());
    expect(await patternOf()).toMatchObject({ status: "OBSERVATION" });
  });

  it("the sync first and the RPC second end in the same state, and running the sync twice changes nothing more", async () => {
    const [m1, m2, m3] = await threeMeals();
    const id = await syncA("CANDIDATE", [m1, m2, m3]);
    await syncA("OBSERVATION", [m1, m3]); // (the app would only sync a set the meals still back)
    await removeViaRpc(m2);
    const once = await evidence(id);
    await syncA("OBSERVATION", [m1, m3]);
    await syncA("OBSERVATION", [m1, m3]);
    expect(await evidence(id)).toEqual(once);
    expect((await patternOf()).status).toBe("OBSERVATION");
  });

  it("when the representative meal of an evening is deleted but another that evening remains, the evidence row moves to the remaining meal", async () => {
    const early = await meal(USER_A, "2026-10-05T18:10:00Z");
    const later = await meal(USER_A, "2026-10-05T19:40:00Z");
    const id = await syncA("OBSERVATION", [{ meal_id: early, observed_at: "2026-10-05T18:10:00.000Z" }]);
    await removeViaRpc(early);
    expect(await sourceIds(id)).toEqual([]);
    await syncA("OBSERVATION", [{ meal_id: later, observed_at: "2026-10-05T19:40:00.000Z" }]);
    expect(await sourceIds(id)).toEqual([later]);
  });
});

describe("sync_pattern_evidence: statuses and validation", () => {
  it("VALIDATED sets validated_at once; a second VALIDATED sync keeps the first time; a later OBSERVATION clears it", async () => {
    const [m1] = await threeMeals();
    await syncA("CANDIDATE", [m1]);
    expect((await patternOf()).validated_at).toBeNull();

    await syncA("VALIDATED", [m1]);
    const first = (await patternOf()).validated_at;
    expect(first).toBeInstanceOf(Date);

    await syncA("VALIDATED", [m1]);
    expect((await patternOf()).validated_at?.getTime()).toBe(first?.getTime());

    await syncA("OBSERVATION", [m1]);
    expect((await patternOf()).validated_at).toBeNull();
  });

  it.each([["REJECTED"], [""], [null], ["x"], ["candidate"]])("the status %j raises bad_status", async (status) => {
    await expect(sync(USER_A, status, [])).rejects.toThrow("bad_status");
    expect(await count("patterns")).toBe(0);
  });

  it("a non-array and an array of 201 raise bad_occurrences; 200 is the largest allowed", async () => {
    await expect(sync(USER_A, "OBSERVATION", { meal_id: "x" })).rejects.toThrow("bad_occurrences");
    await expect(sync(USER_A, "OBSERVATION", null)).rejects.toThrow("bad_occurrences");
    await expect(sync(USER_A, "OBSERVATION", Array.from({ length: 201 }, () => ({ meal_id: UNKNOWN_ID, observed_at: NOW })))).rejects.toThrow("bad_occurrences");
    await expect(sync(USER_A, "OBSERVATION", Array.from({ length: 200 }, () => ({ meal_id: UNKNOWN_ID, observed_at: NOW })))).resolves.toBeTruthy();
  });

  it("a kind of 65 characters or none raises bad_kind; 64 is the largest allowed", async () => {
    await expect(sync(USER_A, "OBSERVATION", [], "k".repeat(65))).rejects.toThrow("bad_kind");
    await expect(sync(USER_A, "OBSERVATION", [], "")).rejects.toThrow("bad_kind");
    await expect(sync(USER_A, "OBSERVATION", [], "k".repeat(64))).resolves.toBeTruthy();
  });

  it("writes nothing when the call is refused", async () => {
    await expect(sync(USER_A, "REJECTED", [])).rejects.toThrow();
    expect(await count("patterns")).toBe(0);
    expect(await count("pattern_evidence")).toBe(0);
  });
});

describe("a REJECTED pattern is sticky and holds no evidence", () => {
  /** The exact update recordPatternFeedback sends for "Not related to me". */
  const reject = (id: string) =>
    asA(() =>
      db.query<{ id: string }>(
        "update public.patterns set user_feedback = 'reject', user_feedback_at = $2::timestamptz, status = 'REJECTED' where id = $1 and status <> 'REJECTED' returning id",
        [id, NOW],
      ),
    );

  it("a sync with CANDIDATE and three meals returns the same id and leaves the row and its evidence exactly as they were", async () => {
    const [m1, m2, m3] = await threeMeals();
    const id = await syncA("OBSERVATION", [m1]);
    await db.query("update public.patterns set status = 'REJECTED', user_feedback = 'reject', user_feedback_at = $2 where id = $1", [id, NOW]);
    const before = { pattern: await patternOf(), evidence: await evidence(id) };

    expect(await syncA("CANDIDATE", [m1, m2, m3])).toBe(id);
    expect({ pattern: await patternOf(), evidence: await evidence(id) }).toEqual(before);
    expect(before.pattern.status).toBe("REJECTED");
  });

  it("'not related' on a row that does not exist yet: an empty sync creates it, the update rejects it, and no evidence is stored", async () => {
    await threeMeals();
    const id = await syncA("OBSERVATION", []);
    expect((await reject(id)).rows).toHaveLength(1);
    expect(await patternOf()).toMatchObject({ status: "REJECTED", user_feedback: "reject" });
    expect(await count("pattern_evidence")).toBe(0);
  });

  it("'not related' on a row that already holds three evidence rows removes them first", async () => {
    const meals = await threeMeals();
    const id = await syncA("CANDIDATE", meals);
    expect(await count("pattern_evidence")).toBe(3);

    await syncA("OBSERVATION", []); // the action's first step for "reject"
    expect((await reject(id)).rows).toHaveLength(1);
    expect(await count("pattern_evidence")).toBe(0);
    expect(await patternOf()).toMatchObject({ status: "REJECTED" });
  });

  it("after that, a later sync with three meals still stores nothing", async () => {
    const meals = await threeMeals();
    const id = await syncA("OBSERVATION", []);
    await reject(id);
    await syncA("CANDIDATE", meals);
    expect(await count("pattern_evidence")).toBe(0);
    expect((await patternOf()).status).toBe("REJECTED");
  });

  it("the conditional update does not touch a row that is already rejected (0 rows)", async () => {
    const id = await syncA("OBSERVATION", []);
    await reject(id);
    expect((await reject(id)).rows).toEqual([]);
  });
});

describe("the person's answer is never erased", () => {
  it("user_feedback and user_feedback_at survive every sync", async () => {
    const meals = await threeMeals();
    const id = await syncA("OBSERVATION", meals.slice(0, 2));
    await asA(() => db.query("update public.patterns set user_feedback = 'unsure', user_feedback_at = $2 where id = $1", [id, NOW]));

    for (const [status, list] of [["CANDIDATE", meals], ["VALIDATED", meals], ["OBSERVATION", []]] as const) {
      await syncA(status, list);
      const pattern = await patternOf();
      expect(pattern.user_feedback).toBe("unsure");
      expect(pattern.user_feedback_at?.toISOString()).toBe(NOW);
    }
  });

  it("the check patterns_feedback_has_time refuses an answer without its time and a time without an answer", async () => {
    const id = await syncA("OBSERVATION", []);
    await expect(db.query("update public.patterns set user_feedback = 'confirm' where id = $1", [id])).rejects.toThrow("patterns_feedback_has_time");
    await expect(db.query("update public.patterns set user_feedback_at = now() where id = $1", [id])).rejects.toThrow("patterns_feedback_has_time");
    await expect(db.query("update public.patterns set user_feedback = 'confirm', user_feedback_at = now() where id = $1", [id])).resolves.toBeDefined();
  });

  it("an answer outside the closed set is still refused", async () => {
    const id = await syncA("OBSERVATION", []);
    await expect(db.query("update public.patterns set user_feedback = 'maybe', user_feedback_at = now() where id = $1", [id])).rejects.toThrow();
  });
});

describe("sync_pattern_evidence: row level security and grants", () => {
  it("user B gets their own pattern for the same kind and can neither see nor touch A's evidence", async () => {
    const [m1, m2] = await threeMeals();
    const idA = await syncA("CANDIDATE", [m1, m2]);

    const mealB = await meal(USER_B);
    const idB = await sync(USER_B, "OBSERVATION", [mealB]);
    expect(idB).not.toBe(idA);
    expect(await sourceIds(idA)).toEqual([m1, m2].sort());

    // B syncing an empty set, or even A's meal ids, changes nothing of A's.
    await sync(USER_B, "OBSERVATION", [m1, m2]);
    expect(await sourceIds(idA)).toEqual([m1, m2].sort());
    expect(await sourceIds(idB)).toEqual([]); // A's meals are not B's: the guard skipped them and the set equality emptied B's own
    expect((await asB(() => db.query("select id from public.pattern_evidence"))).rows).toEqual([]);
    expect((await asB(() => db.query("select id from public.patterns"))).rows).toEqual([{ id: idB }]);
  });

  it("anon cannot execute the function (the revoke is really there)", async () => {
    await expect(
      as(db, "anon", null, () => db.query("select public.sync_pattern_evidence($1, 'OBSERVATION', '[]'::jsonb)", [KIND])),
    ).rejects.toThrow(/permission denied/);
  });

  it("a call without a signed-in user raises not_authenticated", async () => {
    await expect(sync(null, "OBSERVATION", [])).rejects.toThrow("not_authenticated");
    expect(await count("patterns")).toBe(0);
  });

  it("is security invoker with an empty search_path", async () => {
    const { rows } = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      "select prosecdef, proconfig from pg_proc where proname = 'sync_pattern_evidence'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(false);
    expect(rows[0].proconfig).toContain("search_path=\"\"");
  });
});

describe("experiments: the OFFERED state, started_at and the one-open rule", () => {
  const insertExperiment = (userId: string, status: string) =>
    db.query<{ id: string }>("insert into public.experiments (user_id, intervention_key, status) values ($1, 'eat_intentionally', $2) returning id", [userId, status]);
  const offered = (userId = USER_A) => insertExperiment(userId, "OFFERED");
  const statusOf = async (id: string) => (await db.query<{ status: string; started_at: Date | null; ended_at: Date | null }>("select status, started_at, ended_at from public.experiments where id = $1", [id])).rows[0];

  it("accepts OFFERED and refuses an unknown status", async () => {
    await expect(offered()).resolves.toBeDefined();
    await expect(insertExperiment(USER_B, "RUNNING")).rejects.toThrow("experiments_status_check");
  });

  it("two open rows for one user violate experiments_one_open, whether OFFERED+OFFERED or ACTIVE next to OFFERED", async () => {
    await offered();
    await expect(offered()).rejects.toThrow("experiments_one_open");
    await expect(db.query("insert into public.experiments (user_id, intervention_key, status, started_at) values ($1, 'eat_intentionally', 'ACTIVE', now())", [USER_A])).rejects.toThrow("experiments_one_open");
    // Another person's open row is not in the way.
    await expect(offered(USER_B)).resolves.toBeDefined();
  });

  it("OFFERED to ACTIVE is a status change of that one row; after it neither a second ACTIVE nor a new OFFERED can be inserted", async () => {
    const id = (await offered()).rows[0].id;
    await asA(() => db.query("update public.experiments set status = 'ACTIVE', started_at = $2::timestamptz where user_id = $1 and status = 'OFFERED'", [USER_A, NOW]));
    expect((await statusOf(id)).status).toBe("ACTIVE");
    await expect(offered()).rejects.toThrow("experiments_one_open");
    await expect(db.query("insert into public.experiments (user_id, intervention_key, status, started_at) values ($1, 'eat_intentionally', 'ACTIVE', now())", [USER_A])).rejects.toThrow(/experiments_one_(open|active)/);
  });

  it("after OFFERED to SKIPPED a new OFFERED row can be inserted", async () => {
    const id = (await offered()).rows[0].id;
    await asA(() => db.query("update public.experiments set status = 'SKIPPED', ended_at = $2::timestamptz where id = $1", [id, NOW]));
    await expect(offered()).resolves.toBeDefined();
  });

  it("the transition case: an OFFERED row closed with the exact skipExperiment update lets the next insert through without a 23505; an ACTIVE row left alone still blocks it", async () => {
    await offered();
    const closed = await asA(() =>
      db.query("update public.experiments set status = 'SKIPPED', ended_at = $2::timestamptz where user_id = $1 and status = 'OFFERED' returning id", [USER_A, NOW]),
    );
    expect(closed.rows).toHaveLength(1);
    await expect(offered()).resolves.toBeDefined(); // Weekly Learning's first insert

    // Now an ACTIVE row: the same close matches nothing, and the index keeps blocking.
    await db.exec("delete from public.experiments");
    await db.query("insert into public.experiments (user_id, intervention_key, status, started_at) values ($1, 'eat_intentionally', 'ACTIVE', now())", [USER_A]);
    const none = await asA(() =>
      db.query("update public.experiments set status = 'SKIPPED', ended_at = $2::timestamptz where user_id = $1 and status = 'OFFERED' returning id", [USER_A, NOW]),
    );
    expect(none.rows).toEqual([]);
    await expect(offered()).rejects.toThrow("experiments_one_open");
  });

  it("started_at: an OFFERED row has none; ACTIVE needs it; a SKIPPED row keeps null", async () => {
    const id = (await offered()).rows[0].id;
    expect((await statusOf(id)).started_at).toBeNull();

    await expect(db.query("update public.experiments set status = 'ACTIVE' where id = $1", [id])).rejects.toThrow("experiments_started_when_active");
    await expect(db.query("insert into public.experiments (user_id, intervention_key, status) values ($1, 'eat_intentionally', 'ACTIVE')", [USER_B])).rejects.toThrow("experiments_started_when_active");

    await db.query("update public.experiments set status = 'ACTIVE', started_at = $2 where id = $1", [id, NOW]);
    expect((await statusOf(id)).started_at?.toISOString()).toBe(NOW);

    await db.exec("delete from public.experiments");
    const skipped = (await offered()).rows[0].id;
    await db.query("update public.experiments set status = 'SKIPPED', ended_at = $2 where id = $1", [skipped, NOW]);
    expect((await statusOf(skipped)).started_at).toBeNull();
  });

  it("DONE also needs a start", async () => {
    const id = (await offered()).rows[0].id;
    await expect(db.query("update public.experiments set status = 'DONE' where id = $1", [id])).rejects.toThrow("experiments_started_when_active");
  });

  it("wording, its source and its locale come together or not at all", async () => {
    const id = (await offered()).rows[0].id;
    await expect(db.query("update public.experiments set wording = 'x' where id = $1", [id])).rejects.toThrow("experiments_wording_all_or_none");
    await expect(db.query("update public.experiments set wording_source = 'library' where id = $1", [id])).rejects.toThrow("experiments_wording_all_or_none");
    await expect(db.query("update public.experiments set wording_locale = 'he' where id = $1", [id])).rejects.toThrow("experiments_wording_all_or_none");
    await expect(db.query("update public.experiments set wording = 'x', wording_source = 'library', wording_locale = 'he' where id = $1", [id])).resolves.toBeDefined();
  });

  it("refuses an unknown source, an unknown locale and a wording of 401 characters (400 is fine, empty is not)", async () => {
    const id = (await offered()).rows[0].id;
    const set = (wording: string, source = "ai", locale = "en") =>
      db.query("update public.experiments set wording = $2, wording_source = $3, wording_locale = $4 where id = $1", [id, wording, source, locale]);
    await expect(set("x", "robot")).rejects.toThrow("experiments_wording_source_check");
    await expect(set("x", "ai", "fr")).rejects.toThrow("experiments_wording_locale_check");
    await expect(set("x".repeat(401))).rejects.toThrow("experiments_wording_length");
    await expect(set("")).rejects.toThrow("experiments_wording_length");
    await expect(set("x".repeat(400))).resolves.toBeDefined();
  });

  it("the exact inserts and upgrade of the repository work as the signed-in user", async () => {
    const pattern = await syncA("CANDIDATE", []);
    const inserted = await asA(() =>
      db.query<{ id: string }>(
        `insert into public.experiments (source_pattern_id, intervention_key, variant, status, wording, wording_source, wording_locale)
         values ($1, 'eat_intentionally', 'default', 'OFFERED', 'library text', 'library', 'he') returning id`,
        [pattern],
      ),
    );
    expect(inserted.rows).toHaveLength(1);
    expect((await statusOf(inserted.rows[0].id)).started_at).toBeNull();

    const upgraded = await asA(() =>
      db.query("update public.experiments set wording = 'ai text', wording_source = 'ai', wording_locale = 'he' where user_id = $1 and status = 'OFFERED' and wording_source = 'library' returning id", [USER_A]),
    );
    expect(upgraded.rows).toHaveLength(1);
    const again = await asA(() =>
      db.query("update public.experiments set wording = 'other', wording_source = 'ai', wording_locale = 'he' where user_id = $1 and status = 'OFFERED' and wording_source = 'library' returning id", [USER_A]),
    );
    expect(again.rows).toEqual([]); // already upgraded
  });

  it("user B cannot update A's experiment (0 rows), and cannot read it", async () => {
    const id = (await offered()).rows[0].id;
    const result = await asB(() => db.query("update public.experiments set status = 'SKIPPED', ended_at = now() where id = $1 returning id", [id]));
    expect(result.rows).toEqual([]);
    expect((await asB(() => db.query("select id from public.experiments"))).rows).toEqual([]);
    expect((await statusOf(id)).status).toBe("OFFERED");
  });

  it("source_pattern_id becomes null when the pattern is deleted (the existing foreign key)", async () => {
    const pattern = await syncA("OBSERVATION", []);
    const id = (await db.query<{ id: string }>("insert into public.experiments (user_id, source_pattern_id, intervention_key, status) values ($1, $2, 'eat_intentionally', 'OFFERED') returning id", [USER_A, pattern])).rows[0].id;
    await db.query("delete from public.patterns where id = $1", [pattern]);
    const { rows } = await db.query<{ source_pattern_id: string | null }>("select source_pattern_id from public.experiments where id = $1", [id]);
    expect(rows[0].source_pattern_id).toBeNull();
  });
});

describe("migration 2 over a database that already has rows", () => {
  it("runs on rows written with the old schema, which stay intact and readable", async () => {
    // Every migration except this one, in a throwaway copy (harness.ts is not edited; it honours MIGRATIONS_DIR).
    const copy = mkdtempSync(join(tmpdir(), "migrations-before-"));
    const previous = process.env.MIGRATIONS_DIR;
    let old: PGlite | undefined;
    try {
      for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f !== MIGRATION)) {
        cpSync(join(MIGRATIONS_DIR, file), join(copy, file));
      }
      process.env.MIGRATIONS_DIR = copy;
      old = await createTestDb();
    } finally {
      if (previous === undefined) delete process.env.MIGRATIONS_DIR;
      else process.env.MIGRATIONS_DIR = previous;
      rmSync(copy, { recursive: true, force: true });
    }

    try {
      const patternId = (await old.query<{ id: string }>("insert into public.patterns (user_id, kind, status) values ($1, 'old_kind', 'CANDIDATE') returning id", [USER_A])).rows[0].id;
      await old.query("insert into public.pattern_evidence (user_id, pattern_id, observed_at, source_table, source_id) values ($1, $2, now(), 'meal_entries', $3), ($1, $2, now(), null, null)", [USER_A, patternId, UNKNOWN_ID]);
      const experimentId = (await old.query<{ id: string }>("insert into public.experiments (user_id, source_pattern_id, intervention_key) values ($1, $2, 'eat_intentionally') returning id", [USER_A, patternId])).rows[0].id;

      await expect(old.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8"))).resolves.toBeDefined();

      const pattern = (await old.query("select kind, status, user_feedback, user_feedback_at from public.patterns where id = $1", [patternId])).rows[0];
      expect(pattern).toEqual({ kind: "old_kind", status: "CANDIDATE", user_feedback: null, user_feedback_at: null });
      expect((await old.query("select count(*)::int as n from public.pattern_evidence where pattern_id = $1", [patternId])).rows[0]).toEqual({ n: 2 });
      const experiment = (await old.query<Record<string, unknown>>("select status, variant, wording, wording_source, wording_locale, started_at from public.experiments where id = $1", [experimentId])).rows[0];
      expect(experiment).toMatchObject({ status: "ACTIVE", variant: null, wording: null, wording_source: null, wording_locale: null });
      expect(experiment.started_at).toBeInstanceOf(Date); // the old default filled it; the new rule (ACTIVE needs a start) holds
    } finally {
      await old.close();
    }
  });
});

describe("the evidence writer's meal guard", () => {
  // PGlite has one connection, so two interleaved transactions cannot be run here. What is pinned is the text: the
  // guard locks the meal row (FOR SHARE), which is what makes a sync wait for an in-flight delete_meal_entry.
  it("takes a FOR SHARE lock on the meal row it checks", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8");
    expect(sql).toMatch(/where e\.id = \(o ->> 'meal_id'\)::uuid and e\.user_id = v_uid for share\)/);
  });
});

describe("the read queries of the app leave the tables alone", () => {
  // The guarantee that no loader or page WRITES is a source scan: src/lib/patterns/readPaths.test.ts. This test only shows
  // that the SELECTs themselves (run under RLS) change nothing.
  it("a FIRST_WEEK profile with late meals and no pattern row still has zero pattern, evidence and experiment rows after the read queries", async () => {
    await db.query(
      `update public.profiles set lifecycle_state = 'FIRST_WEEK', onboarding_completed_at = $2::timestamptz, first_week_started_at = $2::timestamptz where user_id = $1`,
      ["11111111-1111-4111-8111-111111111111", "2026-10-01T09:30:00Z"],
    );
    await threeMeals();

    await asA(async () => {
      // The queries of section 3.4, as SQL (the loaders only ever select).
      await db.query("select id, occurred_at from public.meal_entries where user_id = $1 and aggregated = false and occurred_at >= $2 and occurred_at <= $3 order by occurred_at desc limit 400", [USER_A, "2026-09-09T00:00:00Z", "2026-10-09T10:00:00Z"]);
      await db.query("select id, status, user_feedback, user_feedback_at from public.patterns where user_id = $1 and kind = $2 limit 1", [USER_A, KIND]);
      await db.query("select id, status, source_pattern_id, intervention_key, variant, wording, wording_source, wording_locale, ended_at from public.experiments where user_id = $1 order by created_at desc limit 20", [USER_A]);
      await db.query("select quiet_hours_start, quiet_hours_end from public.user_preferences where user_id = $1 limit 1", [USER_A]);
      await db.query("select payload, occurred_at from public.events where user_id = $1 and name = 'first_week_card_snoozed' limit 10", [USER_A]);
    });

    expect(await count("patterns")).toBe(0);
    expect(await count("pattern_evidence")).toBe(0);
    expect(await count("experiments")).toBe(0);
  });
});
