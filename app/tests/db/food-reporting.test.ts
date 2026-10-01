import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USER_A, USER_B, as, createTestDb } from "./harness";

/**
 * The food reporting migration on a real Postgres: the new columns and CHECKs, the three RPCs
 * (create, confirm, discard) and who may call them. Row Level Security itself is covered by
 * rls.test.ts, which also proves the older insert shapes still pass on top of this migration.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  // Superuser cleanup between tests. Entries first: deleting a raw input only nulls their understanding_id.
  await db.exec("delete from public.meal_entries; delete from public.meal_raw_inputs; delete from public.audit_log;");
  await db.exec("delete from public.ai_requests; delete from public.app_errors;");
});

const asA = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_A, fn);
const asService = <T>(fn: () => Promise<T>) => as(db, "service_role", null, fn);

const REQUEST_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const REQUEST_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const NOW = "2026-10-01T10:00:00.000Z";

const ITEMS = [
  { name: "bread", portion: { kind: "amount", amount: 2, unit: "slice", estimated: false }, uncertain: false, confidence: 0.9 },
  { name: "coffee", portion: null, uncertain: true, confidence: 0.5 },
];
const CONFIRMED_ITEMS = [{ name: "bread", portion: { kind: "amount", amount: 2, unit: "slice", estimated: false } }, { name: "coffee", portion: null }];

interface CreateArgs {
  requestId?: string | null;
  kind?: string;
  text?: string | null;
  provider?: string;
  items?: unknown;
  unclear?: unknown;
  overall?: number | null;
  mealType?: string | null;
  occurredAt?: string;
}

/** create_meal_understanding as the given user; resolves to the report id. */
const create = (userId: string, a: CreateArgs = {}) =>
  as(db, "authenticated", userId, async () => {
    const { rows } = await db.query<{ id: string }>(
      `select public.create_meal_understanding($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::numeric, $10, $11::timestamptz) as id`,
      [
        a.requestId ?? null,
        a.kind ?? "text",
        a.text === undefined ? "two slices of bread and coffee" : a.text,
        a.provider ?? "fake",
        a.provider === "manual" ? null : "fake-model",
        a.provider === "manual" ? null : "meal-v1",
        JSON.stringify(a.items ?? ITEMS),
        JSON.stringify(a.unclear ?? ["something blurry"]),
        a.overall === undefined ? 0.8 : a.overall,
        a.mealType === undefined ? "breakfast" : a.mealType,
        a.occurredAt ?? NOW,
      ],
    );
    return rows[0].id;
  });

interface ConfirmArgs {
  source?: string;
  items?: unknown;
  mealType?: string;
  occurredAt?: string;
}

const confirm = (userId: string, id: string, a: ConfirmArgs = {}) =>
  as(db, "authenticated", userId, async () => {
    const { rows } = await db.query<{ id: string }>(
      "select public.confirm_meal_understanding($1::uuid, $2::timestamptz, $3, $4::jsonb, $5) as id",
      [id, a.occurredAt ?? NOW, a.mealType ?? "breakfast", JSON.stringify(a.items ?? CONFIRMED_ITEMS), a.source ?? "ai_unedited"],
    );
    return rows[0].id;
  });

const discard = (userId: string, id: string) =>
  as(db, "authenticated", userId, async () => {
    const { rows } = await db.query<{ ok: boolean }>("select public.discard_meal_understanding($1::uuid) as ok", [id]);
    return rows[0].ok;
  });

/** Row counts as the superuser, so row level security does not hide anything. */
const count = async (table: string, where = "true") =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`)).rows[0].n);

describe("meal_raw_inputs", () => {
  const insertRaw = (set: string, values: unknown[] = []) =>
    asA(() => db.query(`insert into public.meal_raw_inputs (kind, text_content, photo_ref, client_request_id) values ${set}`, values));

  it("rejects a photo report that has a photo reference, and accepts a text one", async () => {
    await expect(insertRaw("('photo', null, 'bucket/file.jpg', null)")).rejects.toThrow("meal_raw_inputs_photo_not_stored");
    await insertRaw("('text', 'schnitzel', null, null)");
    await insertRaw("('photo', 'a note', null, null)");
  });

  it("only forbids a photo reference for the photo kind (a Shabbat batch may use one later)", async () => {
    await insertRaw("('shabbat_freeform', null, 'bucket/batch.zip', null)");
  });

  it("rejects text over 600 characters and accepts exactly 600", async () => {
    await insertRaw("('text', $1, null, null)", ["x".repeat(600)]);
    await expect(insertRaw("('text', $1, null, null)", ["x".repeat(601)])).rejects.toThrow("meal_raw_inputs_text_length");
  });

  it("allows one raw input per user and client request id, and any number without one", async () => {
    await insertRaw("('text', 'a', null, $1::uuid)", [REQUEST_1]);
    await expect(insertRaw("('text', 'b', null, $1::uuid)", [REQUEST_1])).rejects.toThrow("meal_raw_inputs_client_request");
    await insertRaw("('text', 'c', null, null), ('text', 'd', null, null)");
  });
});

describe("meal_understandings columns", () => {
  const rawId = async () => {
    const { rows } = await asA(() => db.query<{ id: string }>("insert into public.meal_raw_inputs (kind, text_content) values ('text', 'x') returning id"));
    return rows[0].id;
  };
  /** Inserts an understanding for a fresh raw input. `values` start at $2 ($1 is the raw input). */
  const insertU = async (columns: string, placeholders: string, values: unknown[] = []) => {
    const raw = await rawId();
    return asA(() =>
      db.query(`insert into public.meal_understandings (raw_input_id, provider, ${columns}) values ($1, 'fake', ${placeholders})`, [raw, ...values]),
    );
  };

  it("accepts the shapes the app writes", async () => {
    await insertU("items, unclear, draft, proposed_meal_type, proposed_occurred_at", "$2::jsonb, $3::jsonb, $4::jsonb, 'lunch', now()", [
      JSON.stringify(ITEMS),
      JSON.stringify(["x"]),
      JSON.stringify({ items: [], mealType: "lunch", occurredAt: NOW }),
    ]);
  });

  it("rejects an unknown proposed meal type", async () => {
    await expect(insertU("proposed_meal_type", "'brunch'")).rejects.toThrow(/proposed_meal_type/);
  });

  it("rejects more than 30 items, more than 10 unclear parts, and a draft that is not an object", async () => {
    const many = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: `f${i}` })));
    await expect(insertU("items", "$2::jsonb", [many(31)])).rejects.toThrow("meal_understandings_items_size");
    await insertU("items", "$2::jsonb", [many(30)]);
    await expect(insertU("unclear", "$2::jsonb", [JSON.stringify(Array.from({ length: 11 }, () => "x"))])).rejects.toThrow(
      "meal_understandings_unclear_size",
    );
    await expect(insertU("draft", "$2::jsonb", ["[]"])).rejects.toThrow("meal_understandings_draft_shape");
  });

  it("rejects items bigger than 16 KB", async () => {
    const big = JSON.stringify([{ name: "x".repeat(17_000) }]);
    await expect(insertU("items", "$2::jsonb", [big])).rejects.toThrow("meal_understandings_items_size");
  });
});

describe("create_meal_understanding", () => {
  it("creates the raw input and the pending understanding in one call", async () => {
    const id = await create(USER_A, { requestId: REQUEST_1 });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const { rows } = await asA(() =>
      db.query<Record<string, unknown>>(
        `select u.status, u.provider, u.model, u.prompt_version, u.overall_confidence::text as overall, u.proposed_meal_type,
                u.proposed_occurred_at, u.draft, u.items, u.unclear, r.kind, r.text_content, r.photo_ref, r.client_request_id,
                r.occurred_at
           from public.meal_understandings u join public.meal_raw_inputs r on r.id = u.raw_input_id where u.id = $1`,
        [id],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "pending",
      provider: "fake",
      model: "fake-model",
      prompt_version: "meal-v1",
      overall: "0.80",
      proposed_meal_type: "breakfast",
      draft: null,
      items: ITEMS,
      unclear: ["something blurry"],
      kind: "text",
      text_content: "two slices of bread and coffee",
      photo_ref: null,
      client_request_id: REQUEST_1,
    });
    expect(new Date(rows[0].proposed_occurred_at as string).toISOString()).toBe(NOW);
    expect(new Date(rows[0].occurred_at as string).toISOString()).toBe(NOW);
  });

  it("stores a photo report with its note and never a photo reference", async () => {
    const id = await create(USER_A, { kind: "photo", text: null });
    const { rows } = await asA(() =>
      db.query("select r.kind, r.text_content, r.photo_ref from public.meal_understandings u join public.meal_raw_inputs r on r.id = u.raw_input_id where u.id = $1", [id]),
    );
    expect(rows).toEqual([{ kind: "photo", text_content: null, photo_ref: null }]);
  });

  it("returns the SAME id for a second call with the same request id and creates nothing", async () => {
    const first = await create(USER_A, { requestId: REQUEST_1 });
    const second = await create(USER_A, { requestId: REQUEST_1, text: "something else entirely" });
    expect(second).toBe(first);
    expect(await count("meal_raw_inputs")).toBe(1);
    expect(await count("meal_understandings")).toBe(1);
  });

  it("makes a new report for a different request id, and for no request id", async () => {
    const a = await create(USER_A, { requestId: REQUEST_1 });
    const b = await create(USER_A, { requestId: REQUEST_2 });
    const c = await create(USER_A);
    const d = await create(USER_A);
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it("lets two users use the same request id", async () => {
    const a = await create(USER_A, { requestId: REQUEST_1 });
    const b = await create(USER_B, { requestId: REQUEST_1 });
    expect(a).not.toBe(b);
    expect(await count("meal_understandings")).toBe(2);
  });

  it("refuses a kind that is not photo or text", async () => {
    await expect(create(USER_A, { kind: "voice" })).rejects.toThrow("bad_kind");
    await expect(create(USER_A, { kind: "shabbat_freeform" })).rejects.toThrow("bad_kind");
  });

  it("raises when there is no signed-in user, and is denied to the anonymous role", async () => {
    await expect(create("", {})).rejects.toThrow("not_authenticated");
    await expect(
      as(db, "anon", null, () =>
        db.query("select public.create_meal_understanding(null, 'text', 'x', 'fake', null, null, '[]', '[]', null, 'other', now())"),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("rolls both inserts back when the understanding is invalid", async () => {
    const tooMany = Array.from({ length: 31 }, (_, i) => ({ name: `f${i}` }));
    await expect(create(USER_A, { items: tooMany })).rejects.toThrow("meal_understandings_items_size");
    expect(await count("meal_raw_inputs")).toBe(0);
  });

  describe("lazy cleanup", () => {
    const backdate = (id: string, hours: number) =>
      asService(() =>
        db.query("update public.meal_understandings set created_at = now() - make_interval(hours => $2) where id = $1", [id, hours]),
      );

    it("deletes the caller's pending reports older than 24 hours, with their raw text", async () => {
      const stale = await create(USER_A, { requestId: REQUEST_1 });
      const fresh = await create(USER_A, { requestId: REQUEST_2 });
      await backdate(stale, 25);
      await backdate(fresh, 23);

      await create(USER_A);

      const ids = (await db.query<{ id: string }>("select id from public.meal_understandings")).rows.map((r) => r.id);
      expect(ids).toContain(fresh);
      expect(ids).not.toContain(stale);
      expect(await count("meal_raw_inputs", "text_content is not null")).toBe(2); // fresh + the new one
    });

    it("never deletes a confirmed report, however old, nor its entry (even when a stale pending one is cleaned in the same call)", async () => {
      const stale = await create(USER_A);
      const id = await create(USER_A);
      const entry = await confirm(USER_A, id);
      await backdate(stale, 30);
      await backdate(id, 100);

      await create(USER_A);

      expect(await count("meal_understandings", `id = '${stale}'`)).toBe(0);
      expect(await count("meal_understandings", `id = '${id}' and status = 'accepted'`)).toBe(1);
      expect(await count("meal_entries", `id = '${entry}' and understanding_id = '${id}'`)).toBe(1);
    });

    it("never deletes another user's stale report", async () => {
      const theirs = await create(USER_B);
      await backdate(theirs, 72);

      await create(USER_A);

      expect(await count("meal_understandings", `id = '${theirs}'`)).toBe(1);
    });

    it("leaves a stale report alone when its request id is retried (the retry is answered first)", async () => {
      const stale = await create(USER_A, { requestId: REQUEST_1 });
      await backdate(stale, 30);
      expect(await create(USER_A, { requestId: REQUEST_1 })).toBe(stale);
      expect(await count("meal_understandings", `id = '${stale}'`)).toBe(1);
    });
  });
});

describe("confirm_meal_understanding", () => {
  it("turns a pending report into an entry and marks it accepted (ai_unedited)", async () => {
    const id = await create(USER_A);
    const entryId = await confirm(USER_A, id, { mealType: "lunch", occurredAt: "2026-10-01T09:30:00.000Z" });

    const { rows } = await asA(() =>
      db.query<Record<string, unknown>>(
        "select user_id, understanding_id, meal_type, items, source, aggregated, occurred_at from public.meal_entries where id = $1",
        [entryId],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: USER_A, understanding_id: id, meal_type: "lunch", items: CONFIRMED_ITEMS, source: "ai_unedited", aggregated: false });
    expect(new Date(rows[0].occurred_at as string).toISOString()).toBe("2026-10-01T09:30:00.000Z");

    const u = await asA(() => db.query("select status, draft from public.meal_understandings where id = $1", [id]));
    expect(u.rows).toEqual([{ status: "accepted", draft: null }]);
  });

  it("marks the understanding edited for ai_edited and clears the draft", async () => {
    const id = await create(USER_A);
    await asA(() =>
      db.query(`update public.meal_understandings set draft = '{"items": [], "mealType": "lunch", "occurredAt": "${NOW}"}'::jsonb where id = $1`, [id]),
    );

    await confirm(USER_A, id, { source: "ai_edited" });

    const u = await asA(() => db.query("select status, draft from public.meal_understandings where id = $1", [id]));
    expect(u.rows).toEqual([{ status: "edited", draft: null }]);
    expect(await count("meal_entries", "source = 'ai_edited'")).toBe(1);
  });

  it("accepts a manual list as user_manual", async () => {
    const id = await create(USER_A, { provider: "manual", items: [{ name: "bread", portion: null, uncertain: false, confidence: 1 }], unclear: [] });
    await confirm(USER_A, id, { source: "user_manual", items: [{ name: "bread", portion: null }] });
    expect(await count("meal_entries", "source = 'user_manual'")).toBe(1);
    expect(await count("meal_understandings", `id = '${id}' and status = 'accepted'`)).toBe(1);
  });

  it("is idempotent: a second call returns the same entry and creates no second row", async () => {
    const id = await create(USER_A);
    const first = await confirm(USER_A, id);
    const second = await confirm(USER_A, id, { mealType: "dinner", source: "ai_edited" });
    expect(second).toBe(first);
    expect(await count("meal_entries")).toBe(1);
    expect(await count("meal_entries", "meal_type = 'breakfast'")).toBe(1); // the second call changed nothing
  });

  it("refuses user_manual for an AI report and an ai_* source for a manual report", async () => {
    const ai = await create(USER_A);
    await expect(confirm(USER_A, ai, { source: "user_manual" })).rejects.toThrow("bad_source");

    const manual = await create(USER_A, { provider: "manual" });
    await expect(confirm(USER_A, manual, { source: "ai_unedited" })).rejects.toThrow("bad_source");
    await expect(confirm(USER_A, manual, { source: "ai_edited" })).rejects.toThrow("bad_source");
    await expect(confirm(USER_A, ai, { source: "something_else" })).rejects.toThrow("bad_source");
    expect(await count("meal_entries")).toBe(0);
  });

  it("rejects no items and 31 items, and accepts 1 and 30", async () => {
    const id = await create(USER_A);
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `f${i}`, portion: null }));
    await expect(confirm(USER_A, id, { items: [] })).rejects.toThrow("bad_items");
    await expect(confirm(USER_A, id, { items: items(31) })).rejects.toThrow("bad_items");
    expect(await count("meal_entries")).toBe(0);
    await confirm(USER_A, id, { items: items(30) });
    const other = await create(USER_A);
    await confirm(USER_A, other, { items: items(1) });
    expect(await count("meal_entries")).toBe(2);
  });

  it("gives another user not_found and changes nothing", async () => {
    const id = await create(USER_A);
    await expect(confirm(USER_B, id)).rejects.toThrow("not_found");
    await expect(confirm(USER_A, "99999999-9999-4999-8999-999999999999")).rejects.toThrow("not_found");
    expect(await count("meal_entries")).toBe(0);
    expect(await count("meal_understandings", "status = 'pending'")).toBe(1);
  });

  it("gives not_pending for a rejected report", async () => {
    const id = await create(USER_A);
    await asService(() => db.query("update public.meal_understandings set status = 'rejected' where id = $1", [id]));
    await expect(confirm(USER_A, id)).rejects.toThrow("not_pending");
  });

  it("gives not_pending when the entry of an accepted report is gone", async () => {
    const id = await create(USER_A);
    await confirm(USER_A, id);
    await asA(() => db.query("delete from public.meal_entries"));
    await expect(confirm(USER_A, id)).rejects.toThrow("not_pending");
  });

  it("is denied to the anonymous role and raises without a user", async () => {
    const id = await create(USER_A);
    await expect(
      as(db, "anon", null, () => db.query("select public.confirm_meal_understanding($1::uuid, now(), 'lunch', '[{}]', 'ai_unedited')", [id])),
    ).rejects.toThrow(/permission denied/);
    await expect(confirm("", id)).rejects.toThrow("not_authenticated");
  });
});

describe("meal_entries constraints", () => {
  const insertEntry = (understandingId: string | null, items = '[{"name": "x", "portion": null}]') =>
    asA(() =>
      db.query(
        "insert into public.meal_entries (understanding_id, occurred_at, meal_type, items, source) values ($1, now(), 'lunch', $2::jsonb, 'user_manual')",
        [understandingId, items],
      ),
    );

  it("allows one entry per understanding", async () => {
    const id = await create(USER_A);
    await insertEntry(id);
    await expect(insertEntry(id)).rejects.toThrow("meal_entries_one_per_understanding");
  });

  it("allows any number of entries without an understanding", async () => {
    await insertEntry(null);
    await insertEntry(null);
    await insertEntry(null);
    expect(await count("meal_entries")).toBe(3);
  });

  it("keeps an old-style entry (one item, no understanding) valid", async () => {
    await asA(() =>
      db.query(`insert into public.meal_entries (occurred_at, meal_type, items, source) values (now(), 'lunch', '[{"food":"rice"}]'::jsonb, 'user_manual')`),
    );
  });

  it("bounds the items: 1 to 30, and 16 KB", async () => {
    await expect(insertEntry(null, "[]")).rejects.toThrow("meal_entries_items_size");
    const many = JSON.stringify(Array.from({ length: 31 }, (_, i) => ({ name: `f${i}` })));
    await expect(insertEntry(null, many)).rejects.toThrow("meal_entries_items_size");
    await expect(insertEntry(null, JSON.stringify([{ name: "x".repeat(17_000) }]))).rejects.toThrow("meal_entries_items_size");
  });
});

describe("discard_meal_understanding", () => {
  it("deletes a pending report with its raw input", async () => {
    const id = await create(USER_A);
    expect(await discard(USER_A, id)).toBe(true);
    expect(await count("meal_understandings")).toBe(0);
    expect(await count("meal_raw_inputs")).toBe(0);
  });

  it("leaves a confirmed report and its entry untouched and returns false", async () => {
    const id = await create(USER_A);
    const entry = await confirm(USER_A, id);

    expect(await discard(USER_A, id)).toBe(false);

    expect(await count("meal_understandings", `id = '${id}' and status = 'accepted'`)).toBe(1);
    expect(await count("meal_raw_inputs")).toBe(1);
    expect(await count("meal_entries", `id = '${entry}' and understanding_id = '${id}'`)).toBe(1);
  });

  it("returns false for another user's id and for an id that does not exist, touching nothing", async () => {
    const id = await create(USER_A);
    expect(await discard(USER_B, id)).toBe(false);
    expect(await discard(USER_A, "99999999-9999-4999-8999-999999999999")).toBe(false);
    expect(await count("meal_understandings", `id = '${id}'`)).toBe(1);
  });

  it("deletes only the report asked for", async () => {
    const keep = await create(USER_A);
    const drop = await create(USER_A);
    expect(await discard(USER_A, drop)).toBe(true);
    expect(await count("meal_understandings", `id = '${keep}'`)).toBe(1);
    expect(await count("meal_raw_inputs")).toBe(1);
  });

  it("confirm after discard finds nothing", async () => {
    const id = await create(USER_A);
    await discard(USER_A, id);
    await expect(confirm(USER_A, id)).rejects.toThrow("not_found");
  });

  it("is denied to the anonymous role and raises without a user", async () => {
    const id = await create(USER_A);
    await expect(as(db, "anon", null, () => db.query("select public.discard_meal_understanding($1::uuid)", [id]))).rejects.toThrow(/permission denied/);
    await expect(discard("", id)).rejects.toThrow("not_authenticated");
  });
});

describe("the locks that make confirm and discard safe", () => {
  // PGlite has ONE session, so a true interleaving cannot be reproduced here. The next best thing is
  // to pin the property that makes the interleaving safe: both functions lock the row with FOR UPDATE.
  const definition = async (name: string) => {
    const { rows } = await db.query<{ def: string }>("select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [name]);
    return rows[0].def;
  };

  it("discard locks the PENDING understanding before it deletes", async () => {
    const def = await definition("discard_meal_understanding");
    expect(def).toMatch(/u\.status = 'pending'\s+for update/i);
    expect(def.search(/for update/i)).toBeLessThan(def.search(/delete from public\.meal_raw_inputs/i));
  });

  it("confirm locks the understanding before it reads its status", async () => {
    const def = await definition("confirm_meal_understanding");
    expect(def).toMatch(/for update/i);
    expect(def.search(/for update/i)).toBeLessThan(def.search(/v_u\.status in/i));
  });

  it("create locks the stale reports (skipping locked ones) before it deletes their raw inputs", async () => {
    const def = await definition("create_meal_understanding");
    expect(def).toMatch(/for update skip locked/i);
    expect(def.search(/for update skip locked/i)).toBeLessThan(def.search(/delete from public\.meal_raw_inputs/i));
  });

  it("every function is SECURITY INVOKER with an empty search path", async () => {
    const { rows } = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      `select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('create_meal_understanding', 'confirm_meal_understanding', 'discard_meal_understanding')`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.prosecdef, row.proname).toBe(false);
      expect(row.proconfig, row.proname).toEqual(["search_path=\"\""]);
    }
  });
});

describe("who may execute the functions", () => {
  const SIGNATURES = [
    "public.create_meal_understanding(uuid, text, text, text, text, text, jsonb, jsonb, numeric, text, timestamptz)",
    "public.confirm_meal_understanding(uuid, timestamptz, text, jsonb, text)",
    "public.discard_meal_understanding(uuid)",
  ];

  for (const signature of SIGNATURES) {
    it(`${signature.split("(")[0]}: authenticated yes, anon no`, async () => {
      const { rows } = await db.query<Record<string, boolean>>(
        `select has_function_privilege('authenticated', $1, 'execute') as authenticated,
                has_function_privilege('anon', $1, 'execute') as anon`,
        [signature],
      );
      expect(rows[0]).toEqual({ authenticated: true, anon: false });
    });
  }
});

describe("ai_requests and app_errors (written by the server only)", () => {
  const insertRequest = (userId: string, operation = "analyzeMeal") =>
    db.query("insert into public.ai_requests (user_id, operation, provider, model, latency_ms, input_tokens, output_tokens, outcome) values ($1, $2, 'gemini', 'm', 900, 100, 50, 'ok')", [userId, operation]);

  it("lets the owner read but not write them, and the service role write", async () => {
    await expect(asA(() => insertRequest(USER_A))).rejects.toThrow(/permission denied/);
    await expect(asA(() => db.query("insert into public.app_errors (user_id, area, message) values ($1, 'ai', 'x')", [USER_A]))).rejects.toThrow(/permission denied/);
    await expect(asA(() => db.query("update public.ai_requests set outcome = 'ok'"))).rejects.toThrow(/permission denied/);

    await asService(() => insertRequest(USER_A));
    await asService(() => db.query("insert into public.app_errors (user_id, area, message, context) values ($1, 'ai', 'provider_auth', '{\"status\": 401}')", [USER_A]));
    expect(await count("ai_requests")).toBe(1);
    expect(await count("app_errors")).toBe(1);
  });

  it("shows each user only their own rows, and the allowance queries (count since a time) see only the caller's", async () => {
    await asService(async () => {
      await insertRequest(USER_A);
      await insertRequest(USER_A, "analyzeText");
      await insertRequest(USER_A, "somethingElse");
      await insertRequest(USER_B);
    });

    const allowanceCount = (userId: string) =>
      as(db, "authenticated", userId, async () => {
        const { rows } = await db.query<{ n: number }>(
          "select count(*)::int as n from public.ai_requests where operation in ('analyzeMeal', 'analyzeText') and created_at >= now() - interval '60 seconds'",
        );
        return rows[0].n;
      });

    expect(await allowanceCount(USER_A)).toBe(2);
    expect(await allowanceCount(USER_B)).toBe(1);

    const own = await asA(() => db.query("select user_id from public.ai_requests"));
    expect(new Set(own.rows.map((r) => (r as { user_id: string }).user_id))).toEqual(new Set([USER_A]));
  });

  it("has no column that could hold a prompt, a text or an image", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ai_requests' order by ordinal_position",
    );
    expect(rows.map((r) => r.column_name)).toEqual(["id", "user_id", "operation", "provider", "model", "latency_ms", "input_tokens", "output_tokens", "outcome", "created_at"]);
  });
});

describe("audit trail", () => {
  it("still records an update of a confirmed meal", async () => {
    const id = await create(USER_A);
    const entry = await confirm(USER_A, id);

    await asA(() => db.query("update public.meal_entries set meal_type = 'dinner' where id = $1", [entry]));

    const { rows } = await asA(() =>
      db.query("select action, table_name, row_id from public.audit_log where table_name = 'meal_entries'"),
    );
    expect(rows).toEqual([{ action: "UPDATE", table_name: "meal_entries", row_id: entry }]);
  });
});
