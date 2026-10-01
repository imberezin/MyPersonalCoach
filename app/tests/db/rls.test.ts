import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the real migrations on a real Postgres (PGlite, no Docker needed) with a small shim
 * of what Supabase provides (roles, auth.users, auth.uid()). These tests are the guarantee
 * that one user can never read or change another user's data.
 */

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant select on auth.users to service_role;
`;

let db: PGlite;

type Role = "authenticated" | "anon" | "service_role";

async function as<T>(role: Role, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

const count = async (table: string) =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n);

/** One valid insert per user-owned table, run as the signed-in user (user_id comes from its default). */
const OWNED_TABLES: Array<{ table: string; insert?: string }> = [
  { table: "profiles" }, // created by the sign-up trigger
  { table: "user_preferences" }, // created by the sign-up trigger
  { table: "offline_periods", insert: "insert into public.offline_periods (type, start_at, end_at) values ('SHABBAT', now(), now() + interval '1 day')" },
  { table: "meal_raw_inputs", insert: "insert into public.meal_raw_inputs (kind, text_content) values ('text', 'schnitzel and rice')" },
  { table: "meal_understandings", insert: "insert into public.meal_understandings (raw_input_id, provider) select id, 'fake' from public.meal_raw_inputs limit 1" },
  { table: "meal_entries", insert: `insert into public.meal_entries (occurred_at, meal_type, items, source) values (now(), 'lunch', '[{"food":"rice"}]'::jsonb, 'user_manual')` },
  { table: "weight_entries", insert: "insert into public.weight_entries (weight_kg) values (118.7)" },
  { table: "activity_entries", insert: "insert into public.activity_entries (activity_type, duration_min) values ('walking', 20)" },
  { table: "sleep_entries", insert: "insert into public.sleep_entries (night_date, hours, quality) values (current_date, 6.5, 3)" },
  { table: "stress_entries", insert: "insert into public.stress_entries (level) values (3)" },
  { table: "events", insert: "insert into public.events (name) values ('meal_saved')" },
  { table: "patterns", insert: "insert into public.patterns (kind) values ('evening_fatigue_and_hunger')" },
  { table: "pattern_evidence", insert: "insert into public.pattern_evidence (pattern_id, observed_at) select id, now() from public.patterns limit 1" },
  { table: "intervention_instances", insert: "insert into public.intervention_instances (intervention_key, variant, level, context, proactive) values ('pause', 'before_second_portion', 2, 'CRAVING', true)" },
  { table: "experiments", insert: "insert into public.experiments (intervention_key, status) values ('pause', 'ACTIVE')" },
  { table: "weekly_summaries", insert: "insert into public.weekly_summaries (week_start, opening_mode) values (current_date, 'LEARN')" },
  { table: "push_subscriptions", insert: "insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/abc', 'k', 'a')" },
];

const SERVER_WRITTEN = [
  { table: "notification_log", insert: "insert into public.notification_log (user_id, channel) values ($1, 'web_push')" },
  { table: "ai_requests", insert: "insert into public.ai_requests (user_id, operation, provider, outcome) values ($1, 'analyzeMeal', 'fake', 'ok')" },
  { table: "app_errors", insert: "insert into public.app_errors (user_id, area, message) values ($1, 'ai', 'boom')" },
  { table: "audit_log", insert: "insert into public.audit_log (user_id, table_name, row_id, action) values ($1, 'test_table', 'x', 'UPDATE')" },
];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_SHIM);

  // MIGRATIONS_DIR lets a mutation check point at a deliberately broken copy of the schema.
  const dir = process.env.MIGRATIONS_DIR ?? join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }

  await db.query("insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')", [USER_A, USER_B]);

  // User A creates one row in every table (as the signed-in user, so RLS and defaults are exercised).
  await as("authenticated", USER_A, async () => {
    for (const { insert } of OWNED_TABLES) if (insert) await db.exec(insert);
  });
});

afterAll(async () => {
  await db.close();
});

describe("sign-up", () => {
  it("creates a profile and a preferences row for every new user", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.profiles");
    expect(rows[0].n).toBe(2);
  });

  it("starts with every notification type switched off", async () => {
    const { rows } = await db.query<{ notifications: Record<string, boolean> }>(
      "select notifications from public.user_preferences where user_id = $1",
      [USER_A],
    );
    expect(Object.values(rows[0].notifications).every((v) => v === false)).toBe(true);
  });
});

describe("row level security", () => {
  it("is enabled on every table in the public schema", async () => {
    const { rows } = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  it("gives the anonymous role no access at all", async () => {
    for (const { table } of OWNED_TABLES) {
      await expect(as("anon", null, () => db.query(`select * from public.${table}`)), table).rejects.toThrow(/permission denied/);
    }
  });

  for (const { table } of OWNED_TABLES) {
    it(`${table}: the owner sees their row`, async () => {
      expect(await as("authenticated", USER_A, () => count(table))).toBe(1);
    });

    it(`${table}: another user sees nothing, and can neither change nor delete it`, async () => {
      await as("authenticated", USER_B, async () => {
        const selectCount = table === "profiles" || table === "user_preferences" ? 1 : 0; // B has their own profile rows
        expect(await count(table)).toBe(selectCount);

        if (table === "events") return; // append-only: nobody gets UPDATE/DELETE (tested below)
        const updated = await db.query(`update public.${table} set user_id = user_id where user_id = $1 returning 1`, [USER_A]);
        expect(updated.rows).toHaveLength(0);
        const deleted = await db.query(`delete from public.${table} where user_id = $1 returning 1`, [USER_A]);
        expect(deleted.rows).toHaveLength(0);
      });
      expect(await as("authenticated", USER_A, () => count(table))).toBe(1);
    });
  }

  it("refuses to let a user write a row that belongs to someone else", async () => {
    await expect(
      as("authenticated", USER_B, () =>
        db.query("insert into public.weight_entries (user_id, weight_kg) values ($1, 100)", [USER_A]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let a user hand their own row to someone else", async () => {
    await expect(
      as("authenticated", USER_A, () =>
        db.query("update public.weight_entries set user_id = $1", [USER_B]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("tables written by the server", () => {
  for (const { table, insert } of SERVER_WRITTEN) {
    it(`${table}: the owner can read it but cannot write it; the service role can`, async () => {
      await expect(as("authenticated", USER_A, () => db.query(insert, [USER_A]))).rejects.toThrow(
        /permission denied|row-level security/,
      );
      await as("service_role", null, () => db.query(insert, [USER_A]));

      expect(await as("authenticated", USER_A, () => count(table))).toBeGreaterThanOrEqual(1);
      expect(await as("authenticated", USER_B, () => count(table))).toBe(0);
    });
  }
});

describe("events are append-only for the owner", () => {
  it("cannot be edited or deleted by the owner", async () => {
    await expect(as("authenticated", USER_A, () => db.query("update public.events set name = 'x'"))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", USER_A, () => db.query("delete from public.events"))).rejects.toThrow(/permission denied/);
  });
});

describe("integrity rules", () => {
  it("allows at most one active experiment per user", async () => {
    await expect(
      as("authenticated", USER_A, () =>
        db.query("insert into public.experiments (intervention_key, status) values ('delay', 'ACTIVE')"),
      ),
    ).rejects.toThrow(/duplicate key|unique/);
  });

  it("allows a finished experiment next to the active one", async () => {
    await as("authenticated", USER_A, () =>
      db.query("insert into public.experiments (intervention_key, status) values ('delay', 'DONE')"),
    );
  });

  it("rejects values outside the agreed ranges", async () => {
    const bad = [
      "insert into public.stress_entries (level) values (6)",
      "insert into public.weight_entries (weight_kg) values (-5)",
      "insert into public.sleep_entries (night_date, hours, quality) values (current_date - 1, 25, 3)",
      "insert into public.offline_periods (type, start_at, end_at) values ('SHABBAT', now(), now() - interval '1 hour')",
      "insert into public.patterns (kind, status) values ('x', 'MAYBE')",
    ];
    for (const sql of bad) {
      await expect(as("authenticated", USER_A, () => db.query(sql)), sql).rejects.toThrow();
    }
  });
});

describe("audit trail", () => {
  it("records an edit of a confirmed meal, visible only to its owner", async () => {
    await as("authenticated", USER_A, () => db.query("update public.meal_entries set meal_type = 'dinner'"));
    const { rows } = await as("authenticated", USER_A, () =>
      db.query<{ action: string; table_name: string }>("select action, table_name from public.audit_log where table_name = 'meal_entries'"),
    );
    expect(rows).toEqual([{ action: "UPDATE", table_name: "meal_entries" }]);
    expect(await as("authenticated", USER_B, () => count("audit_log"))).toBe(0);
  });
});

describe("account deletion", () => {
  it("removes every trace of the user and leaves other users untouched", async () => {
    await as("authenticated", USER_A, () => db.query("delete from public.weight_entries")); // an audited delete first
    await db.query("delete from auth.users where id = $1", [USER_A]);

    for (const { table } of [...OWNED_TABLES, ...SERVER_WRITTEN]) {
      const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where user_id = $1`, [USER_A]);
      expect(rows[0].n, table).toBe(0);
    }
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.profiles where user_id = $1", [USER_B]);
    expect(rows[0].n).toBe(1);
  });
});
