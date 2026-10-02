import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RESUME_WINDOW_MS } from "@/domain/food/routes";
import { USER_A, USER_B, as, createTestDb } from "./harness";

/**
 * "My meals", delete a meal: delete_meal_entry and the content-free audit trail, on a real Postgres.
 * The point of the file is that a deleted meal is really gone: the whole database is swept for a marker
 * that was typed into the report, and the order of the deletes is pinned (the entry goes before the
 * understanding, or ON DELETE SET NULL would audit the meal's content as an update).
 */

const MARKER = "ZZ_PRIVATE_MARKER_5512";
const STALE_MARKER = "ZZ_STALE_MARKER_5512";
const NEW_MIGRATION = "20261001150000_delete_meal.sql";
const REQUEST_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const NOW = "2026-10-01T10:00:00.000Z";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

let db: PGlite;
let api: ReturnType<typeof makeApi>;

beforeAll(async () => {
  db = await createTestDb();
  api = makeApi(db);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  // Superuser cleanup between tests. Entries first: deleting a raw input only nulls their understanding_id.
  await db.exec(`
    delete from public.pattern_evidence; delete from public.patterns;
    delete from public.meal_entries; delete from public.meal_raw_inputs;
    delete from public.offline_periods; delete from public.weight_entries;
    delete from public.events; delete from public.audit_log;
  `);
});

const asA = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_A, fn);
const asB = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_B, fn);
const asService = <T>(fn: () => Promise<T>) => as(db, "service_role", null, fn);

const ITEMS = (name: string) => [
  { name, portion: { kind: "amount", amount: 2, unit: "slice", estimated: false }, uncertain: false, confidence: 0.9 },
  { name: "coffee", portion: null, uncertain: true, confidence: 0.5 },
];
const CONFIRMED_ITEMS = (name: string) => [{ name, portion: { kind: "amount", amount: 2, unit: "slice", estimated: false } }, { name: "coffee", portion: null }];

/** `marker` is the private word typed into the report and found in the AI items (default MARKER). */
interface CreateArgs {
  requestId?: string | null;
  text?: string;
  marker?: string;
}

/** The RPC helpers of the food migration, bound to one database (the scrub test builds a second one). */
function makeApi(d: PGlite) {
  const create = (userId: string, a: CreateArgs = {}) =>
    as(d, "authenticated", userId, async () => {
      const marker = a.marker ?? MARKER;
      const text = a.text ?? `two slices of bread and ${marker}`;
      const { rows } = await d.query<{ id: string }>(
        `select public.create_meal_understanding($1::uuid, 'text', $2, 'fake', 'fake-model', 'meal-v1', $3::jsonb, $4::jsonb, 0.8::numeric, 'breakfast', $5::timestamptz) as id`,
        [a.requestId ?? null, text, JSON.stringify(ITEMS(marker)), JSON.stringify([`${marker} unclear`]), NOW],
      );
      return rows[0].id;
    });

  const confirm = (userId: string, id: string) =>
    as(d, "authenticated", userId, async () => {
      // A working copy with the marker too; confirm clears it.
      await d.query("update public.meal_understandings set draft = $2::jsonb where id = $1::uuid", [
        id,
        JSON.stringify({ items: [{ name: MARKER, portion: null, uncertain: false }], mealType: "breakfast", occurredAt: NOW }),
      ]);
      const { rows } = await d.query<{ id: string }>("select public.confirm_meal_understanding($1::uuid, $2::timestamptz, 'breakfast', $3::jsonb, 'ai_unedited') as id", [
        id,
        NOW,
        JSON.stringify(CONFIRMED_ITEMS(MARKER)),
      ]);
      return rows[0].id;
    });

  const remove = (userId: string | null, entryId: string | null) =>
    as(d, "authenticated", userId, async () => {
      const { rows } = await d.query<{ ok: boolean }>("select public.delete_meal_entry($1::uuid) as ok", [entryId]);
      return rows[0].ok;
    });

  return { create, confirm, remove };
}

/** A confirmed meal with the marker everywhere, and the ids of its three rows. */
async function savedMeal(userId = USER_A, a: CreateArgs = {}) {
  const understandingId = await api.create(userId, a);
  const entryId = await api.confirm(userId, understandingId);
  const { rows } = await db.query<{ raw_input_id: string }>("select raw_input_id from public.meal_understandings where id = $1", [understandingId]);
  return { understandingId, entryId, rawId: rows[0].raw_input_id };
}

/** Makes a pending report older than `hours` (as the superuser: created_at has no owner policy to hide behind). */
const backdateMinutes = (understandingId: string, minutes: number) =>
  db.query("update public.meal_understandings set created_at = now() - make_interval(mins => $2) where id = $1", [understandingId, minutes]);
const backdate = (understandingId: string, hours: number) => backdateMinutes(understandingId, hours * 60);

// The app's resume window, in minutes. The SQL literal in the migration must equal it; the fixtures below sit
// five minutes either side, so a threshold that drifts from the app constant in either direction is caught.
const RESUME_MINUTES = RESUME_WINDOW_MS / 60_000;

/** Row counts as the superuser, so row level security does not hide anything. */
const count = async (table: string, where = "true", params: unknown[] = []) =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`, params)).rows[0].n);

const exists = async (table: string, id: string) => (await count(table, "id = $1", [id])) === 1;

/** Every base table of the public schema: the sweep must not depend on a list somebody forgets to extend. */
async function publicTables(d: PGlite = db): Promise<string[]> {
  const { rows } = await d.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
  );
  return rows.map((r) => r.table_name);
}

/** Per table, how many rows contain the marker anywhere in any column. */
async function sweep(marker = MARKER, d: PGlite = db): Promise<Record<string, number>> {
  const found: Record<string, number> = {};
  for (const table of await publicTables(d)) {
    const { rows } = await d.query<{ n: number }>(`select count(*)::int as n from public."${table}" t where to_jsonb(t)::text like $1`, [`%${marker}%`]);
    found[table] = rows[0].n;
  }
  return found;
}

const nonZero = (counts: Record<string, number>) => Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));

/** The rows of the three meal tables that are NOT the given ones, as JSON, for a before/after comparison. */
async function others(skip: { entryId: string; understandingId: string; rawId: string }) {
  const q = async (table: string, id: string) =>
    (await db.query<{ row: unknown }>(`select to_jsonb(t) as row from public.${table} t where t.id <> $1 order by t.id`, [id])).rows.map((r) => r.row);
  return {
    entries: await q("meal_entries", skip.entryId),
    understandings: await q("meal_understandings", skip.understandingId),
    raws: await q("meal_raw_inputs", skip.rawId),
  };
}

type AuditRow = { table_name: string; row_id: string; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null };
const auditRows = async (where = "true"): Promise<AuditRow[]> =>
  (await db.query<AuditRow>(`select table_name, row_id, action, old_data, new_data from public.audit_log where ${where} order by id`)).rows;

describe("delete_meal_entry: erasure", () => {
  it("removes the entry, the understanding and the typed text", async () => {
    const meal = await savedMeal();
    expect(await api.remove(USER_A, meal.entryId)).toBe(true);
    expect(await count("meal_entries", "user_id = $1", [USER_A])).toBe(0);
    expect(await count("meal_understandings", "user_id = $1", [USER_A])).toBe(0);
    expect(await count("meal_raw_inputs", "user_id = $1", [USER_A])).toBe(0);
  });

  it("leaves the marker nowhere in the database, audit_log included", async () => {
    const meal = await savedMeal();
    // The sweep is not vacuous: it does see the marker before the delete, in every table that holds it.
    const before = nonZero(await sweep());
    expect(Object.keys(before).sort()).toEqual(["meal_entries", "meal_raw_inputs", "meal_understandings"]);
    expect((await publicTables()).length).toBeGreaterThanOrEqual(18);

    expect(await api.remove(USER_A, meal.entryId)).toBe(true);
    expect(nonZero(await sweep())).toEqual({});
  });

  it("is atomic: when the last step fails nothing is deleted", async () => {
    const meal = await savedMeal();
    await db.exec(`
      create function public.zz_fail_raw_delete() returns trigger language plpgsql as $$ begin raise exception 'zz_forced_failure'; end; $$;
      create trigger zz_fail_raw_delete before delete on public.meal_raw_inputs for each row execute function public.zz_fail_raw_delete();
    `);
    try {
      await expect(api.remove(USER_A, meal.entryId)).rejects.toThrow("zz_forced_failure");
    } finally {
      await db.exec("drop trigger zz_fail_raw_delete on public.meal_raw_inputs; drop function public.zz_fail_raw_delete();");
    }
    expect(await exists("meal_entries", meal.entryId)).toBe(true);
    expect(await exists("meal_understandings", meal.understandingId)).toBe(true);
    expect(await exists("meal_raw_inputs", meal.rawId)).toBe(true);
    expect(await auditRows()).toEqual([]);
  });
});

describe("delete_meal_entry: the audit trail holds no content", () => {
  it("writes one DELETE row with the id, table, action and time only", async () => {
    const meal = await savedMeal();
    await api.remove(USER_A, meal.entryId);
    const rows = await auditRows();
    expect(rows).toEqual([{ table_name: "meal_entries", row_id: meal.entryId, action: "DELETE", old_data: null, new_data: null }]);
    const { rows: at } = await db.query<{ ok: boolean }>("select at > now() - interval '1 minute' as ok from public.audit_log");
    expect(at[0].ok).toBe(true);
  });

  it("still audits an UPDATE of a meal, as a summary without the food names", async () => {
    const meal = await savedMeal();
    await db.query("update public.meal_entries set meal_type = 'dinner' where id = $1", [meal.entryId]);
    const rows = await auditRows("action = 'UPDATE'");
    expect(rows).toHaveLength(1);
    expect(rows[0].table_name).toBe("meal_entries");
    expect(rows[0].old_data).toMatchObject({ id: meal.entryId, meal_type: "breakfast", user_id: USER_A });
    expect(rows[0].new_data).toMatchObject({ id: meal.entryId, meal_type: "dinner" });
    expect(Object.keys(rows[0].old_data ?? {})).not.toContain("items");
    expect(Object.keys(rows[0].new_data ?? {})).not.toContain("items");
    expect(JSON.stringify(rows)).not.toContain(MARKER);
  });

  it("audits a weight the same way: a content-free DELETE, an UPDATE with no weight", async () => {
    const { rows } = await asA(() => db.query<{ id: string }>("insert into public.weight_entries (weight_kg) values (118.7) returning id"));
    const id = rows[0].id;
    await db.query("update public.weight_entries set weight_kg = 117.2 where id = $1", [id]);
    await asA(() => db.query("delete from public.weight_entries where id = $1", [id]));
    const audit = await auditRows("table_name = 'weight_entries'");
    expect(audit.map((r) => r.action)).toEqual(["UPDATE", "DELETE"]);
    expect(audit[0].old_data).toMatchObject({ id });
    expect(Object.keys(audit[0].old_data ?? {})).not.toContain("weight_kg");
    expect(audit[1]).toMatchObject({ row_id: id, old_data: null, new_data: null });
  });

  it("logs nothing when the whole account is deleted", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    await db.query("insert into auth.users (id, email) values ($1, 'c@example.test')", [other]);
    await db.query("insert into public.meal_entries (user_id, occurred_at, meal_type, items, source) values ($1, now(), 'lunch', $2::jsonb, 'user_manual')", [
      other,
      JSON.stringify(CONFIRMED_ITEMS(MARKER)),
    ]);
    await db.query("delete from auth.users where id = $1", [other]);
    expect(await count("audit_log", "user_id = $1", [other])).toBe(0);
    expect(await count("meal_entries", "user_id = $1", [other])).toBe(0);
  });

  it("writes an UPDATE row, without the food names, when an offline period that a meal points at goes away", async () => {
    const meal = await savedMeal();
    const { rows } = await asA(() =>
      db.query<{ id: string }>(
        "insert into public.offline_periods (type, start_at, end_at, source) values ('SHABBAT', now() + interval '1 day', now() + interval '2 days', 'auto') returning id",
      ),
    );
    const periodId = rows[0].id;
    await db.query("update public.meal_entries set offline_period_id = $2 where id = $1", [meal.entryId, periodId]);
    await db.exec("delete from public.audit_log");

    // What replace_future_auto_shabbat does: the meal is UPDATED by ON DELETE SET NULL, nobody edits it.
    await asA(() => db.query("delete from public.offline_periods where id = $1", [periodId]));
    const updates = await auditRows("action = 'UPDATE'");
    expect(updates).toHaveLength(1);
    expect(updates[0].old_data).toMatchObject({ id: meal.entryId, offline_period_id: periodId });
    expect(updates[0].new_data).toMatchObject({ id: meal.entryId, offline_period_id: null });
    expect(Object.keys(updates[0].old_data ?? {})).not.toContain("items");
    expect(JSON.stringify(updates)).not.toContain(MARKER);

    expect(await api.remove(USER_A, meal.entryId)).toBe(true);
    expect(nonZero(await sweep())).toEqual({});
  });
});

describe("delete_meal_entry: the order of the deletes", () => {
  it("never makes the audit trigger see the meal as updated", async () => {
    const meal = await savedMeal();
    await api.remove(USER_A, meal.entryId);
    // If the understanding went first, ON DELETE SET NULL would have UPDATEd the entry and been audited.
    expect(await auditRows("action = 'UPDATE'")).toEqual([]);
    expect((await auditRows()).map((r) => r.action)).toEqual(["DELETE"]);
  });

  it("is written as an invoker function that locks the entry and deletes the entry before the understanding", async () => {
    const { rows } = await db.query<{ def: string; secdef: boolean; config: string[] | null }>(
      `select pg_get_functiondef(p.oid) as def, p.prosecdef as secdef, p.proconfig as config
         from pg_proc p where p.oid = 'public.delete_meal_entry(uuid)'::regprocedure`,
    );
    const def = rows[0].def.toLowerCase();
    expect(rows[0].secdef).toBe(false);
    expect(rows[0].config).toEqual(["search_path=\"\""]);
    // The entry itself is locked (the stale purge has its own "for update skip locked", which must not count).
    const selectEntry = def.indexOf("select e.understanding_id");
    const lock = def.indexOf("for update", selectEntry);
    expect(selectEntry).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(selectEntry);
    expect(lock).toBeLessThan(def.indexOf("delete from public.pattern_evidence"));
    const entry = def.indexOf("delete from public.meal_entries");
    const understanding = def.indexOf("delete from public.meal_understandings");
    expect(entry).toBeGreaterThan(-1);
    expect(understanding).toBeGreaterThan(-1);
    expect(entry).toBeLessThan(understanding);
    // Every statement also filters on the caller, a second lock behind row level security.
    expect(def).toContain("user_id = v_uid");
  });
});

describe("delete_meal_entry: idempotent and calm", () => {
  it("answers false the second time, for an unknown id and for null, without an error", async () => {
    const meal = await savedMeal();
    expect(await api.remove(USER_A, meal.entryId)).toBe(true);
    expect(await api.remove(USER_A, meal.entryId)).toBe(false);
    expect(await api.remove(USER_A, UNKNOWN_ID)).toBe(false);
    expect(await api.remove(USER_A, null)).toBe(false);
  });
});

describe("delete_meal_entry: other people and other rows", () => {
  it("cannot delete somebody else's meal: false, and nothing is touched", async () => {
    const meal = await savedMeal(USER_A);
    expect(await api.remove(USER_B, meal.entryId)).toBe(false);
    expect(await exists("meal_entries", meal.entryId)).toBe(true);
    expect(await exists("meal_understandings", meal.understandingId)).toBe(true);
    expect(await exists("meal_raw_inputs", meal.rawId)).toBe(true);
    expect(await auditRows()).toEqual([]);
  });

  it("deletes the caller's own meal without touching another user's", async () => {
    const mine = await savedMeal(USER_B);
    const theirs = await savedMeal(USER_A);
    expect(await api.remove(USER_B, mine.entryId)).toBe(true);
    expect(await exists("meal_entries", theirs.entryId)).toBe(true);
    expect(await exists("meal_understandings", theirs.understandingId)).toBe(true);
    expect(await exists("meal_raw_inputs", theirs.rawId)).toBe(true);
  });

  it("leaves the other meals and a fresh unfinished report exactly as they were", async () => {
    const keep = await savedMeal(USER_A, { text: `keep me ${MARKER}` });
    const fresh = await api.create(USER_A, { text: "a report I am still writing" });
    const doomed = await savedMeal(USER_A);
    const before = await others(doomed);
    expect(before.understandings.some((u) => (u as { id: string }).id === fresh)).toBe(true);

    expect(await api.remove(USER_A, doomed.entryId)).toBe(true);
    expect(await others(doomed)).toEqual(before);
    expect(await exists("meal_entries", keep.entryId)).toBe(true);
  });

  it("deletes a meal that has no understanding, and nothing else", async () => {
    const keep = await savedMeal(USER_A);
    const { rows } = await asA(() =>
      db.query<{ id: string }>(
        `insert into public.meal_entries (occurred_at, meal_type, items, source) values (now(), 'lunch', '[{"name":"rice"}]'::jsonb, 'user_manual') returning id`,
      ),
    );
    expect(await api.remove(USER_A, rows[0].id)).toBe(true);
    expect(await exists("meal_entries", rows[0].id)).toBe(false);
    expect(await exists("meal_entries", keep.entryId)).toBe(true);
    expect(await exists("meal_understandings", keep.understandingId)).toBe(true);
    expect(await exists("meal_raw_inputs", keep.rawId)).toBe(true);
  });

  it("keeps the typed text while another understanding still uses it", async () => {
    const meal = await savedMeal();
    const { rows } = await asService(() =>
      db.query<{ id: string }>("insert into public.meal_understandings (user_id, raw_input_id, provider) values ($1, $2, 'fake') returning id", [USER_A, meal.rawId]),
    );
    expect(await api.remove(USER_A, meal.entryId)).toBe(true);
    expect(await exists("meal_understandings", meal.understandingId)).toBe(false);
    expect(await exists("meal_raw_inputs", meal.rawId)).toBe(true);
    expect(await exists("meal_understandings", rows[0].id)).toBe(true);
  });

  it("removes the evidence that points at the meal and nothing else", async () => {
    const meal = await savedMeal(USER_A);
    const other = await savedMeal(USER_A, { text: "another meal" });
    const { rows: patterns } = await asService(() =>
      db.query<{ id: string; user_id: string }>(
        "insert into public.patterns (user_id, kind) values ($1, 'evening_fatigue'), ($2, 'evening_fatigue') returning id, user_id",
        [USER_A, USER_B],
      ),
    );
    const patternA = patterns.find((p) => p.user_id === USER_A)!.id;
    const patternB = patterns.find((p) => p.user_id === USER_B)!.id;
    const evidence = async (userId: string, patternId: string, table: string, sourceId: string) =>
      (
        await asService(() =>
          db.query<{ id: string }>(
            "insert into public.pattern_evidence (user_id, pattern_id, observed_at, source_table, source_id) values ($1, $2, now(), $3, $4) returning id",
            [userId, patternId, table, sourceId],
          ),
        )
      ).rows[0].id;
    const gone = await evidence(USER_A, patternA, "meal_entries", meal.entryId);
    const otherMeal = await evidence(USER_A, patternA, "meal_entries", other.entryId);
    const otherTable = await evidence(USER_A, patternA, "weight_entries", meal.entryId);
    const otherUser = await evidence(USER_B, patternB, "meal_entries", meal.entryId);

    expect(await api.remove(USER_A, meal.entryId)).toBe(true);

    expect(await exists("pattern_evidence", gone)).toBe(false);
    for (const id of [otherMeal, otherTable, otherUser]) expect(await exists("pattern_evidence", id)).toBe(true);
    // A pattern is not a meal: it stays.
    expect(await exists("patterns", patternA)).toBe(true);
    expect(await exists("patterns", patternB)).toBe(true);
  });
});

describe("delete_meal_entry: unfinished reports", () => {
  it("purges the caller's stale unfinished reports and keeps a fresh one", async () => {
    const stale = await api.create(USER_A, { marker: STALE_MARKER });
    const fresh = await api.create(USER_A, { text: "fresh" });
    const meal = await savedMeal(USER_A);
    await backdateMinutes(stale, RESUME_MINUTES + 5);
    await backdateMinutes(fresh, RESUME_MINUTES - 5);
    const staleRaw = (await db.query<{ raw_input_id: string }>("select raw_input_id from public.meal_understandings where id = $1", [stale])).rows[0].raw_input_id;
    const freshRaw = (await db.query<{ raw_input_id: string }>("select raw_input_id from public.meal_understandings where id = $1", [fresh])).rows[0].raw_input_id;

    expect(await api.remove(USER_A, meal.entryId)).toBe(true);

    expect(await exists("meal_understandings", stale)).toBe(false);
    expect(await exists("meal_raw_inputs", staleRaw)).toBe(false);
    expect(await exists("meal_understandings", fresh)).toBe(true);
    expect(await exists("meal_raw_inputs", freshRaw)).toBe(true);
    // The typed text and the items of the stale report are gone from the whole database too.
    expect(nonZero(await sweep(STALE_MARKER))).toEqual({});
  });

  it("purges them when the call finds no meal as well", async () => {
    const stale = await api.create(USER_A, { marker: STALE_MARKER });
    await backdate(stale, 5);
    expect(nonZero(await sweep(STALE_MARKER))).not.toEqual({});
    expect(await api.remove(USER_A, UNKNOWN_ID)).toBe(false);
    expect(await exists("meal_understandings", stale)).toBe(false);
    expect(nonZero(await sweep(STALE_MARKER))).toEqual({});
  });

  it("does not touch another user's stale report", async () => {
    const theirs = await api.create(USER_B, { text: "theirs" });
    await backdate(theirs, 30);
    const meal = await savedMeal(USER_A);
    expect(await api.remove(USER_A, meal.entryId)).toBe(true);
    expect(await exists("meal_understandings", theirs)).toBe(true);
  });

  it("does not touch a confirmed report, however old", async () => {
    const old = await savedMeal(USER_A);
    await backdate(old.understandingId, 100);
    const meal = await savedMeal(USER_A);
    expect(await api.remove(USER_A, meal.entryId)).toBe(true);
    expect(await exists("meal_entries", old.entryId)).toBe(true);
    expect(await exists("meal_understandings", old.understandingId)).toBe(true);
    expect(await exists("meal_raw_inputs", old.rawId)).toBe(true);
  });

  it("keeps the typed text of a stale report that a non-stale understanding still uses", async () => {
    const stale = await api.create(USER_A, { text: "shared text" });
    await backdate(stale, 3);
    const raw = (await db.query<{ raw_input_id: string }>("select raw_input_id from public.meal_understandings where id = $1", [stale])).rows[0].raw_input_id;
    const { rows } = await asService(() =>
      db.query<{ id: string }>("insert into public.meal_understandings (user_id, raw_input_id, provider) values ($1, $2, 'fake') returning id", [USER_A, raw]),
    );
    expect(await api.remove(USER_A, UNKNOWN_ID)).toBe(false);
    expect(await exists("meal_raw_inputs", raw)).toBe(true);
    expect(await exists("meal_understandings", rows[0].id)).toBe(true);
    expect(await exists("meal_understandings", stale)).toBe(true);
  });
});

describe("after a delete", () => {
  it("the old report cannot be confirmed any more, and the same request id makes a new report", async () => {
    const understandingId = await api.create(USER_A, { requestId: REQUEST_1 });
    const entryId = await api.confirm(USER_A, understandingId);
    expect(await api.remove(USER_A, entryId)).toBe(true);

    await expect(api.confirm(USER_A, understandingId)).rejects.toThrow("not_found");
    const again = await api.create(USER_A, { requestId: REQUEST_1 });
    expect(again).not.toBe(understandingId);
    expect(await exists("meal_understandings", again)).toBe(true);
  });

  it("the Home probe finds no meal once the last one is gone", async () => {
    const meal = await savedMeal();
    const probe = () => asA(async () => (await db.query("select id from public.meal_entries limit 1")).rows);
    expect(await probe()).toHaveLength(1);
    await api.remove(USER_A, meal.entryId);
    expect(await probe()).toEqual([]);
  });
});

describe("who may call it", () => {
  const privilege = async (role: string, fn: string) =>
    (await db.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).rows[0].ok;

  it("allows signed-in users and refuses anon", async () => {
    expect(await privilege("authenticated", "public.delete_meal_entry(uuid)")).toBe(true);
    expect(await privilege("anon", "public.delete_meal_entry(uuid)")).toBe(false);
    await expect(as(db, "anon", null, () => db.query("select public.delete_meal_entry($1::uuid)", [UNKNOWN_ID]))).rejects.toThrow(/permission denied/);
  });

  it("raises not_authenticated when nobody is signed in", async () => {
    await expect(api.remove(null, UNKNOWN_ID)).rejects.toThrow("not_authenticated");
  });

  it("keeps the audit trigger function out of reach after it was replaced", async () => {
    for (const role of ["anon", "authenticated", "public"]) {
      expect(await privilege(role, "public.audit_changes()"), role).toBe(false);
    }
  });

  it("still lets the owner read, but not change or clear, the audit trail", async () => {
    const meal = await savedMeal();
    await api.remove(USER_A, meal.entryId);
    expect(await asA(async () => (await db.query("select id from public.audit_log")).rows)).toHaveLength(1);
    await expect(asA(() => db.query("delete from public.audit_log"))).rejects.toThrow(/permission denied/);
    expect(await asB(async () => (await db.query("select id from public.audit_log")).rows)).toHaveLength(0);
  });
});

describe("the migration scrubs what the old trigger already wrote", () => {
  it("empties old DELETE rows and removes the food names from old UPDATE rows", async () => {
    // A database with only the migrations that sort BEFORE the new one (later files replace the trigger again), so the old trigger writes the old kind of rows.
    const source = process.env.MIGRATIONS_DIR ?? join(process.cwd(), "supabase", "migrations");
    const before = mkdtempSync(join(tmpdir(), "migrations-before-"));
    const previous = process.env.MIGRATIONS_DIR;
    let old: PGlite | null = null;
    try {
      for (const file of readdirSync(source).filter((f) => f.endsWith(".sql") && f < NEW_MIGRATION)) cpSync(join(source, file), join(before, file));
      process.env.MIGRATIONS_DIR = before;
      old = await createTestDb();
    } finally {
      if (previous === undefined) delete process.env.MIGRATIONS_DIR;
      else process.env.MIGRATIONS_DIR = previous;
    }

    try {
      const oldApi = makeApi(old);
      const kept = await oldApi.confirm(USER_A, await oldApi.create(USER_A));
      const removed = await oldApi.confirm(USER_A, await oldApi.create(USER_A));
      await old.query("update public.meal_entries set meal_type = 'dinner' where id = $1", [kept]);
      await old.query("delete from public.meal_entries where id = $1", [removed]);
      await old.query("insert into public.weight_entries (user_id, weight_kg) values ($1, 118.7)", [USER_A]);
      await old.query("update public.weight_entries set weight_kg = 117.2");

      // The old trigger really did store the food names (the test would prove nothing otherwise).
      const stored = await old.query<{ n: number }>("select count(*)::int as n from public.audit_log where old_data::text like $1", [`%${MARKER}%`]);
      expect(stored.rows[0].n).toBe(2);

      await old.exec(readFileSync(join(source, NEW_MIGRATION), "utf8"));

      // The live meals still hold their own text; the TRAIL no longer does.
      const trail = await old.query<{ n: number }>("select count(*)::int as n from public.audit_log t where to_jsonb(t)::text like $1", [`%${MARKER}%`]);
      expect(trail.rows[0].n).toBe(0);
      const rows = (
        await old.query<AuditRow>("select table_name, row_id, action, old_data, new_data from public.audit_log order by id")
      ).rows;
      expect(rows).toHaveLength(3);
      const deleted = rows.find((r) => r.action === "DELETE")!;
      expect(deleted).toMatchObject({ table_name: "meal_entries", row_id: removed, old_data: null, new_data: null });
      const meal = rows.find((r) => r.action === "UPDATE" && r.table_name === "meal_entries")!;
      expect(meal.row_id).toBe(kept);
      expect(meal.old_data).toMatchObject({ id: kept, meal_type: "breakfast" });
      expect(meal.new_data).toMatchObject({ id: kept, meal_type: "dinner" });
      expect(Object.keys(meal.old_data ?? {})).not.toContain("items");
      expect(Object.keys(meal.new_data ?? {})).not.toContain("items");
      // A weight keeps its before/after summary: only the meal's free text was ever at stake.
      const weight = rows.find((r) => r.action === "UPDATE" && r.table_name === "weight_entries")!;
      expect(weight.old_data).toMatchObject({ weight_kg: 118.7 });
    } finally {
      await old?.close();
      rmSync(before, { recursive: true, force: true });
    }
  });
});
