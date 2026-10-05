import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OLD_DATABASE_TIMEOUT_MS, USER_A, USER_B, as, createTestDb } from "./harness";

/**
 * Weight reporting on a real Postgres: the optional note, the content-free audit trail and delete_weight_entry.
 * This file is the ONLY proof that the weight trail is content-free (delete-meal.test.ts keeps its meals facts):
 * the whole database is swept for the number and the note that were typed, before and after a delete, an edit
 * and an edit followed by a delete.
 */

const NEW_MIGRATION = "20261001180000_weight_reporting.sql";
const NOTE_MARKER = "ZZ_WEIGHT_NOTE_MARKER_4471";
const OTHER_NOTE_MARKER = "ZZ_WEIGHT_NOTE_MARKER_9902";
// numeric(5,2) values with a shape no other column in the database can produce.
const KG = 187.63;
const KG_EDITED = 186.41;
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";
const ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("delete from public.weight_entries; delete from public.meal_entries; delete from public.audit_log; delete from public.events;");
});

const asA = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_A, fn);
const asB = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_B, fn);
const asAnon = <T>(fn: () => Promise<T>) => as(db, "anon", null, fn);

/** Inserts a weigh-in as the given user and returns its id. */
async function addWeight(userAs: typeof asA, a: { id?: string; kg?: number; note?: string | null; at?: string } = {}): Promise<string> {
  return userAs(async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.weight_entries (id, weight_kg, note, measured_at) values (coalesce($1::uuid, gen_random_uuid()), $2, $3, coalesce($4::timestamptz, now())) returning id",
      [a.id ?? null, a.kg ?? KG, a.note === undefined ? NOTE_MARKER : a.note, a.at ?? null],
    );
    return rows[0].id;
  });
}

const remove = (userAs: typeof asA, id: string | null) =>
  userAs(async () => (await db.query<{ ok: boolean }>("select public.delete_weight_entry($1::uuid) as ok", [id])).rows[0].ok);

type AuditRow = { table_name: string; row_id: string; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null };
const auditRows = async (where = "true", d: PGlite = db): Promise<AuditRow[]> =>
  (await d.query<AuditRow>(`select table_name, row_id, action, old_data, new_data from public.audit_log where ${where} order by id`)).rows;

const count = async (table: string, where = "true", params: unknown[] = [], d: PGlite = db) =>
  Number((await d.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`, params)).rows[0].n);

/** Per public table, how many rows contain `marker` anywhere in any column (the sweep does not depend on a list somebody forgets to extend). */
async function sweep(marker: string, d: PGlite = db): Promise<Record<string, number>> {
  const { rows: tables } = await d.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
  );
  const found: Record<string, number> = {};
  for (const { table_name } of tables) {
    const { rows } = await d.query<{ n: number }>(`select count(*)::int as n from public."${table_name}" t where to_jsonb(t)::text like $1`, [`%${marker}%`]);
    if (rows[0].n > 0) found[table_name] = rows[0].n;
  }
  return found;
}

const privilege = async (role: string, fn: string) =>
  (await db.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).rows[0].ok;

const MARKERS = [String(KG), String(KG_EDITED), NOTE_MARKER, OTHER_NOTE_MARKER];

/** A database built from the migrations that sort BEFORE this one only (so the previous trigger is in force), as the deploy would find it. */
async function oldDatabase<T>(body: (old: PGlite, apply: () => Promise<void>) => Promise<T>): Promise<T> {
  const source = process.env.MIGRATIONS_DIR ?? join(process.cwd(), "supabase", "migrations");
  const before = mkdtempSync(join(tmpdir(), "migrations-before-weight-"));
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
    return await body(old, async () => {
      await old!.exec(readFileSync(join(source, NEW_MIGRATION), "utf8"));
    });
  } finally {
    await old.close();
    rmSync(before, { recursive: true, force: true });
  }
}

describe("the note column", () => {
  it("is nullable: a weight without a note is valid", async () => {
    const id = await addWeight(asA, { note: null });
    const { rows } = await db.query<{ note: string | null }>("select note from public.weight_entries where id = $1", [id]);
    expect(rows[0].note).toBeNull();
  });

  it("accepts 1 and 200 characters and refuses 0 and 201", async () => {
    await addWeight(asA, { note: "x" });
    await addWeight(asA, { note: "y".repeat(200) });
    await expect(addWeight(asA, { note: "" })).rejects.toThrow(/weight_entries_note_length/);
    await expect(addWeight(asA, { note: "z".repeat(201) })).rejects.toThrow(/weight_entries_note_length/);
    expect(await count("weight_entries")).toBe(2);
  });

  it("counts characters, not bytes: 200 emoji fit", async () => {
    await addWeight(asA, { note: "\u{1F600}".repeat(200) });
    await expect(addWeight(asA, { note: "\u{1F600}".repeat(201) })).rejects.toThrow(/weight_entries_note_length/);
  });

  it("an update that sets the note to an empty string is refused, null clears it", async () => {
    const id = await addWeight(asA);
    await expect(asA(() => db.query("update public.weight_entries set note = '' where id = $1", [id]))).rejects.toThrow(/weight_entries_note_length/);
    await asA(() => db.query("update public.weight_entries set note = null where id = $1", [id]));
    expect((await db.query<{ note: string | null }>("select note from public.weight_entries where id = $1", [id])).rows[0].note).toBeNull();
  });

  it("is additive: a row written before the migration stays valid after it", async () => {
    await oldDatabase(async (old, apply) => {
      await old.query("insert into public.weight_entries (id, user_id, weight_kg) values ($1, $2, 118.7)", [ID_1, USER_A]);
      expect((await old.query("select column_name from information_schema.columns where table_name = 'weight_entries' and column_name = 'note'")).rows).toHaveLength(0);

      await apply();

      const { rows } = await old.query<{ weight_kg: string; note: string | null }>("select weight_kg, note from public.weight_entries where id = $1", [ID_1]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].weight_kg)).toBe(118.7);
      expect(rows[0].note).toBeNull();
      // And the old row can be edited under the new rules.
      await old.query("update public.weight_entries set weight_kg = 117.2 where id = $1", [ID_1]);
    });
  }, OLD_DATABASE_TIMEOUT_MS);
});

describe("row level security on weights", () => {
  it("another user cannot read, update or delete the row", async () => {
    const id = await addWeight(asA);
    expect(await asB(async () => (await db.query("select id from public.weight_entries where id = $1", [id])).rows)).toHaveLength(0);
    expect(await asB(async () => (await db.query("update public.weight_entries set weight_kg = 50 where id = $1 returning id", [id])).rows)).toHaveLength(0);
    expect(await asB(async () => (await db.query("delete from public.weight_entries where id = $1 returning id", [id])).rows)).toHaveLength(0);
    const { rows } = await db.query<{ weight_kg: string; note: string }>("select weight_kg, note from public.weight_entries where id = $1", [id]);
    expect(Number(rows[0].weight_kg)).toBe(KG);
    expect(rows[0].note).toBe(NOTE_MARKER);
  });

  it("an insert cannot be made for somebody else", async () => {
    await expect(asB(() => db.query("insert into public.weight_entries (user_id, weight_kg) values ($1, 80)", [USER_A]))).rejects.toThrow(/row-level security/);
  });
});

describe("insert ... on conflict (id) do nothing", () => {
  const upsert = (userAs: typeof asA, id: string, kg: number) =>
    userAs(async () =>
      (await db.query<{ id: string }>("insert into public.weight_entries (id, weight_kg) values ($1, $2) on conflict (id) do nothing returning id", [id, kg])).rows,
    );

  it("twice with the same id is one row (a double tap saves once)", async () => {
    expect(await upsert(asA, ID_1, 80)).toHaveLength(1);
    expect(await upsert(asA, ID_1, 81)).toHaveLength(0);
    expect(await count("weight_entries", "user_id = $1", [USER_A])).toBe(1);
    expect(Number((await db.query<{ w: string }>("select weight_kg as w from public.weight_entries where id = $1", [ID_1])).rows[0].w)).toBe(80);
  });

  it("with another user's id writes nothing, raises nothing, and leaves their row untouched", async () => {
    await addWeight(asA, { id: ID_1, kg: 80, note: null });
    expect(await upsert(asB, ID_1, 99)).toHaveLength(0);
    expect(await count("weight_entries")).toBe(1);
    const { rows } = await db.query<{ user_id: string; w: string }>("select user_id, weight_kg as w from public.weight_entries where id = $1", [ID_1]);
    expect(rows[0].user_id).toBe(USER_A);
    expect(Number(rows[0].w)).toBe(80);
  });
});

describe("delete_weight_entry", () => {
  it("is idempotent: true, then false, and false for an unknown id and for null", async () => {
    const id = await addWeight(asA);
    expect(await remove(asA, id)).toBe(true);
    expect(await remove(asA, id)).toBe(false);
    expect(await remove(asA, UNKNOWN_ID)).toBe(false);
    expect(await remove(asA, null)).toBe(false);
    expect(await count("weight_entries")).toBe(0);
  });

  it("another user's id is false and the row survives, with no audit row", async () => {
    const id = await addWeight(asA);
    expect(await remove(asB, id)).toBe(false);
    expect(await count("weight_entries", "id = $1", [id])).toBe(1);
    expect(await auditRows()).toEqual([]);
  });

  it("deletes the caller's own weight without touching another user's", async () => {
    const mine = await addWeight(asB, { note: OTHER_NOTE_MARKER });
    const theirs = await addWeight(asA);
    expect(await remove(asB, mine)).toBe(true);
    expect(await count("weight_entries", "id = $1", [theirs])).toBe(1);
  });

  it("raises not_authenticated (SQLSTATE 28000) when nobody is signed in", async () => {
    await expect(as(db, "authenticated", null, () => db.query("select public.delete_weight_entry($1::uuid)", [UNKNOWN_ID]))).rejects.toMatchObject({
      message: expect.stringContaining("not_authenticated"),
      code: "28000",
    });
  });

  it("is executable by authenticated and by nobody else (not anon, not public)", async () => {
    expect(await privilege("authenticated", "public.delete_weight_entry(uuid)")).toBe(true);
    expect(await privilege("anon", "public.delete_weight_entry(uuid)")).toBe(false);
    expect(await privilege("public", "public.delete_weight_entry(uuid)")).toBe(false);
    await expect(asAnon(() => db.query("select public.delete_weight_entry($1::uuid)", [UNKNOWN_ID]))).rejects.toThrow(/permission denied/);
  });

  it("is written as an invoker function with an empty search_path that locks the row and filters on the caller", async () => {
    const { rows } = await db.query<{ def: string; secdef: boolean; config: string[] | null }>(
      `select pg_get_functiondef(p.oid) as def, p.prosecdef as secdef, p.proconfig as config
         from pg_proc p where p.oid = 'public.delete_weight_entry(uuid)'::regprocedure`,
    );
    const def = rows[0].def.toLowerCase();
    expect(rows[0].secdef).toBe(false);
    expect(rows[0].config).toEqual(['search_path=""']);
    const select = def.indexOf("select w.id");
    expect(select).toBeGreaterThan(-1);
    expect(def.indexOf("for update", select)).toBeGreaterThan(select);
    expect(def.indexOf("for update", select)).toBeLessThan(def.indexOf("delete from public.weight_entries"));
    expect(def).toContain("user_id = v_uid");
  });
});

describe("the audit trail holds no weight and no note", () => {
  it("a DELETE writes exactly the id, table, action and time", async () => {
    const id = await addWeight(asA);
    await remove(asA, id);
    expect(await auditRows()).toEqual([{ table_name: "weight_entries", row_id: id, action: "DELETE", old_data: null, new_data: null }]);
    const { rows } = await db.query<{ ok: boolean }>("select at > now() - interval '1 minute' as ok from public.audit_log");
    expect(rows[0].ok).toBe(true);
  });

  it("a plain DELETE by the owner is just as content-free as the function", async () => {
    const id = await addWeight(asA);
    await asA(() => db.query("delete from public.weight_entries where id = $1", [id]));
    expect(await auditRows()).toEqual([{ table_name: "weight_entries", row_id: id, action: "DELETE", old_data: null, new_data: null }]);
  });

  it("an UPDATE row has no weight_kg and no note, but keeps id, user_id and measured_at", async () => {
    const id = await addWeight(asA, { at: "2026-10-07T09:30:00Z" });
    await asA(() => db.query("update public.weight_entries set weight_kg = $2, note = $3 where id = $1", [id, KG_EDITED, OTHER_NOTE_MARKER]));
    const rows = await auditRows("action = 'UPDATE'");
    expect(rows).toHaveLength(1);
    for (const side of [rows[0].old_data, rows[0].new_data]) {
      expect(Object.keys(side ?? {})).not.toContain("weight_kg");
      expect(Object.keys(side ?? {})).not.toContain("note");
      expect(side).toMatchObject({ id, user_id: USER_A });
      expect(new Date(String((side as Record<string, unknown>).measured_at)).toISOString()).toBe("2026-10-07T09:30:00.000Z");
    }
  });

  it("an edit that only moves the time is audited without the numbers too", async () => {
    const id = await addWeight(asA, { at: "2026-10-07T09:30:00Z" });
    await asA(() => db.query("update public.weight_entries set measured_at = '2026-10-06T09:30:00Z' where id = $1", [id]));
    const rows = await auditRows("action = 'UPDATE'");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(String(KG));
    expect(JSON.stringify(rows)).not.toContain(NOTE_MARKER);
  });

  it("the whole database is free of the number and the note after an edit and a delete", async () => {
    const id = await addWeight(asA);
    // The sweep is not vacuous: before anything is deleted it does find the number and the note, in the table that holds them.
    expect(await sweep(String(KG))).toEqual({ weight_entries: 1 });
    expect(await sweep(NOTE_MARKER)).toEqual({ weight_entries: 1 });

    await asA(() => db.query("update public.weight_entries set weight_kg = $2, note = $3 where id = $1", [id, KG_EDITED, OTHER_NOTE_MARKER]));
    for (const marker of [String(KG), NOTE_MARKER]) expect(await sweep(marker), marker).toEqual({});
    expect(await sweep(String(KG_EDITED))).toEqual({ weight_entries: 1 });

    expect(await remove(asA, id)).toBe(true);
    for (const marker of MARKERS) expect(await sweep(marker), marker).toEqual({});
    // And the audit table as a whole, serialized: this is what the owner could ever read back.
    const { rows } = await db.query<{ t: string }>("select coalesce(string_agg(to_jsonb(a)::text, ' '), '') as t from public.audit_log a");
    for (const marker of MARKERS) expect(rows[0].t).not.toContain(marker);
    expect((await auditRows()).map((r) => r.action)).toEqual(["UPDATE", "DELETE"]);
  });

  it("the meal branch is unchanged: an UPDATE without items, a content-free DELETE", async () => {
    const { rows } = await asA(() =>
      db.query<{ id: string }>(
        "insert into public.meal_entries (occurred_at, meal_type, items, source) values (now(), 'lunch', $1::jsonb, 'user_manual') returning id",
        [JSON.stringify([{ name: "ZZ_MEAL_NAME_MARKER", portion: null }])],
      ),
    );
    const id = rows[0].id;
    await db.query("update public.meal_entries set meal_type = 'dinner' where id = $1", [id]);
    await db.query("delete from public.meal_entries where id = $1", [id]);
    const audit = await auditRows("table_name = 'meal_entries'");
    expect(audit.map((r) => r.action)).toEqual(["UPDATE", "DELETE"]);
    expect(audit[0].old_data).toMatchObject({ id, meal_type: "lunch", user_id: USER_A });
    expect(audit[0].new_data).toMatchObject({ id, meal_type: "dinner" });
    expect(Object.keys(audit[0].old_data ?? {})).not.toContain("items");
    expect(Object.keys(audit[0].new_data ?? {})).not.toContain("items");
    expect(audit[1]).toMatchObject({ row_id: id, old_data: null, new_data: null });
    expect(JSON.stringify(audit)).not.toContain("ZZ_MEAL_NAME_MARKER");
  });

  it("deleting the whole account leaves no weight audit rows", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    await db.query("insert into auth.users (id, email) values ($1, 'c@example.test')", [other]);
    await db.query("insert into public.weight_entries (user_id, weight_kg, note) values ($1, $2, $3)", [other, KG, NOTE_MARKER]);
    await db.query("delete from auth.users where id = $1", [other]);
    expect(await count("weight_entries", "user_id = $1", [other])).toBe(0);
    expect(await count("audit_log", "user_id = $1", [other])).toBe(0);
  });

  it("keeps the owner able to read, but not change or clear, the trail", async () => {
    const id = await addWeight(asA);
    await remove(asA, id);
    expect(await asA(async () => (await db.query("select id from public.audit_log")).rows)).toHaveLength(1);
    await expect(asA(() => db.query("delete from public.audit_log"))).rejects.toThrow(/permission denied/);
    expect(await asB(async () => (await db.query("select id from public.audit_log")).rows)).toHaveLength(0);
  });

  it("keeps the trigger function out of reach after it was replaced again", async () => {
    for (const role of ["anon", "authenticated", "public"]) expect(await privilege(role, "public.audit_changes()"), role).toBe(false);
  });
});

describe("the migration scrubs what the previous trigger already wrote", () => {
  it("removes the weight from old UPDATE rows and leaves everything else alone", async () => {
    await oldDatabase(async (old, apply) => {
      await old.query("insert into public.weight_entries (id, user_id, weight_kg) values ($1, $2, $3)", [ID_1, USER_A, KG]);
      await old.query("update public.weight_entries set weight_kg = $2 where id = $1", [ID_1, KG_EDITED]);
      await old.query("insert into public.meal_entries (user_id, occurred_at, meal_type, items, source) values ($1, now(), 'lunch', $2::jsonb, 'user_manual')", [
        USER_A,
        JSON.stringify([{ name: "bread", portion: null }]),
      ]);
      await old.query("update public.meal_entries set meal_type = 'dinner'");

      // The old trigger really did store the numbers (the test would prove nothing otherwise).
      const before = await old.query<{ n: number }>("select count(*)::int as n from public.audit_log where old_data::text like $1 and new_data::text like $2", [`%${KG}%`, `%${KG_EDITED}%`]);
      expect(before.rows[0].n).toBe(1);

      await apply();

      const trail = await old.query<{ n: number }>("select count(*)::int as n from public.audit_log t where to_jsonb(t)::text like $1 or to_jsonb(t)::text like $2", [`%${KG}%`, `%${KG_EDITED}%`]);
      expect(trail.rows[0].n).toBe(0);
      const weight = (await auditRows("table_name = 'weight_entries'", old))[0];
      expect(weight.action).toBe("UPDATE");
      expect(Object.keys(weight.old_data ?? {})).not.toContain("weight_kg");
      expect(Object.keys(weight.new_data ?? {})).not.toContain("weight_kg");
      expect(weight.old_data).toMatchObject({ id: ID_1, user_id: USER_A });
      // A meal row keeps its own summary.
      const meal = (await auditRows("table_name = 'meal_entries'", old))[0];
      expect(meal.old_data).toMatchObject({ meal_type: "lunch" });
      expect(meal.new_data).toMatchObject({ meal_type: "dinner" });
    });
  }, OLD_DATABASE_TIMEOUT_MS);
});

describe("the order of the migrations", () => {
  it("this file is the LAST one that replaces audit_changes() (create or replace is last-writer-wins)", () => {
    const dir = process.env.MIGRATIONS_DIR ?? join(process.cwd(), "supabase", "migrations");
    const replacers = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => /create\s+(or\s+replace\s+)?function\s+public\.audit_changes\s*\(/i.test(readFileSync(join(dir, f), "utf8")));
    expect(replacers[replacers.length - 1]).toBe(NEW_MIGRATION);
  });
});
