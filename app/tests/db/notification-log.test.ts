import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS } from "@/domain/notifications";
import { OLD_DATABASE_TIMEOUT_MS, USER_A, USER_B, as, createTestDb } from "./harness";

/**
 * The claim of a push (migration 20261007120000) on a real Postgres: one row per (user, kind, moment), which is what makes a
 * double cron tick send once. PGlite has ONE connection, so two overlapping transactions cannot be run here: what is proven is
 * the constraint's semantics (the second insert fails with 23505), and the real protection is that unique constraint in
 * Postgres itself.
 */

const MIGRATION = "20261007120000_notification_moments.sql";
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? join(process.cwd(), "supabase", "migrations");
const WEEK = "weekly:2026-10-11";
const NEXT_WEEK = "weekly:2026-10-18";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("delete from public.notification_log");
});

const asServer = <T>(fn: () => Promise<T>) => as(db, "service_role", null, fn);
const asA = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_A, fn);
const asB = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_B, fn);

/** The claim, as the sender writes it (service role). */
const claim = (userId: string, kind: string | null, moment: string | null, reason: string | null = "pending") =>
  asServer(() =>
    db.query(
      "insert into public.notification_log (user_id, channel, kind, moment_key, suppressed_reason, sent_at) values ($1, 'web_push', $2, $3, $4, $5::timestamptz)",
      [userId, kind, moment, reason, "2026-10-18T05:05:00Z"],
    ),
  );

const code = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe("the columns", () => {
  it("has no column that could hold the text of a notification", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'notification_log' order by ordinal_position",
    );
    expect(rows.map((r) => r.column_name)).toEqual(["id", "user_id", "channel", "intervention_instance_id", "sent_at", "suppressed_reason", "kind", "moment_key"]);
  });

  it("adds no table, function or trigger: plain columns and constraints only", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?(table|function|trigger|index|policy|view)/i);
    expect(sql).not.toMatch(/drop\s|grant\s|revoke\s|disable\s+row/i);
    expect(sql).toMatch(/alter table public\.notification_log/i);
  });
});

describe("the claim", () => {
  it("accepts the first claim for a (user, kind, moment)", async () => {
    expect(await code(claim(USER_A, "weekly_summary", WEEK))).toBeUndefined();
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.notification_log");
    expect(rows[0].n).toBe(1);
  });

  it("refuses the second claim for the same (user, kind, moment) with 23505", async () => {
    await claim(USER_A, "weekly_summary", WEEK);
    expect(await code(claim(USER_A, "weekly_summary", WEEK))).toBe("23505");
    // A finished claim (sent) blocks as well: the unique key does not look at the reason.
    await asServer(() => db.query("update public.notification_log set suppressed_reason = null where user_id = $1", [USER_A]));
    expect(await code(claim(USER_A, "weekly_summary", WEEK, null))).toBe("23505");
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.notification_log");
    expect(rows[0].n).toBe(1);
  });

  it("does not collide across a different week, a different kind or a different user", async () => {
    await claim(USER_A, "weekly_summary", WEEK);
    expect(await code(claim(USER_A, "weekly_summary", NEXT_WEEK))).toBeUndefined();
    expect(await code(claim(USER_A, "weekly_weigh_in", WEEK))).toBeUndefined();
    expect(await code(claim(USER_B, "weekly_summary", WEEK))).toBeUndefined();
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.notification_log");
    expect(rows[0].n).toBe(4);
  });

  it("lets rows without a kind coexist (the table's earlier rows, and the home_card channel)", async () => {
    expect(await code(claim(USER_A, null, null, null))).toBeUndefined();
    expect(await code(claim(USER_A, null, null, null))).toBeUndefined();
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.notification_log where kind is null");
    expect(rows[0].n).toBe(2);
  });

  it("walks the claim's life: pending, then sent (null), failed, or the subscription is gone", async () => {
    await claim(USER_A, "weekly_summary", WEEK);
    for (const reason of [null, "send_failed", "subscription_gone"]) {
      await asServer(() => db.query("update public.notification_log set suppressed_reason = $1 where user_id = $2", [reason, USER_A]));
      const { rows } = await db.query<{ suppressed_reason: string | null }>("select suppressed_reason from public.notification_log where user_id = $1", [USER_A]);
      expect(rows[0].suppressed_reason).toBe(reason);
    }
  });

  it("keeps the time the sender wrote, not the time of the database", async () => {
    await claim(USER_A, "weekly_summary", WEEK);
    const { rows } = await db.query<{ sent_at: Date }>("select sent_at from public.notification_log where user_id = $1", [USER_A]);
    expect(rows[0].sent_at.toISOString()).toBe("2026-10-18T05:05:00.000Z");
  });
});

describe("the constraints", () => {
  it.each([
    ["a kind without a moment", ["weekly_summary", null]],
    ["a moment without a kind", [null, WEEK]],
    ["an unknown kind", ["shouting", WEEK]],
    ["an empty moment key", ["weekly_summary", ""]],
    ["a moment key over 80 characters", ["weekly_summary", `weekly:${"9".repeat(80)}`]],
  ])("refuses %s (check violation)", async (_label, [kind, moment]) => {
    expect(await code(claim(USER_A, kind, moment))).toBe("23514");
  });

  it("accepts a moment key of exactly 80 characters", async () => {
    expect(await code(claim(USER_A, "weekly_summary", "k".repeat(80)))).toBeUndefined();
  });

  it("has the same five kinds as the code, and as the preference keys of user_preferences", async () => {
    const { rows } = await db.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notification_log_kind_known'",
    );
    const listed = [...rows[0].def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...NOTIFICATION_KINDS].sort());

    const prefs = await db.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'user_preferences_notifications_shape'",
    );
    for (const kind of NOTIFICATION_KINDS) expect(prefs.rows[0].def, kind).toContain(`'${kind}'`);
  });
});

describe("who may write and read", () => {
  it("lets the owner read their own claims, and nobody else's", async () => {
    await claim(USER_A, "weekly_summary", WEEK);
    await claim(USER_B, "weekly_summary", WEEK);
    const own = await asA(() => db.query<{ user_id: string }>("select user_id from public.notification_log"));
    expect(own.rows.map((r) => r.user_id)).toEqual([USER_A]);
    const other = await asB(() => db.query<{ user_id: string }>("select user_id from public.notification_log"));
    expect(other.rows.map((r) => r.user_id)).toEqual([USER_B]);
  });

  it("refuses the owner an insert, an update and a delete: only the server writes", async () => {
    await claim(USER_A, "weekly_summary", WEEK);
    const insert = asA(() =>
      db.query("insert into public.notification_log (user_id, channel, kind, moment_key) values ($1, 'web_push', 'weekly_summary', $2)", [USER_A, NEXT_WEEK]),
    );
    expect(await code(insert)).toBe("42501");
    expect(await code(asA(() => db.query("update public.notification_log set suppressed_reason = null")))).toBe("42501");
    expect(await code(asA(() => db.query("delete from public.notification_log")))).toBe("42501");
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.notification_log");
    expect(rows[0].n).toBe(1);
  });

  it("lets nobody signed out or anonymous read the table", async () => {
    await claim(USER_A, "weekly_summary", WEEK);
    expect(await code(as(db, "anon", null, () => db.query("select * from public.notification_log")))).toBe("42501");
  });

  it("removes the claims when the account is deleted", async () => {
    await claim(USER_B, "weekly_summary", WEEK);
    await db.query("delete from auth.users where id = $1", [USER_B]);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.notification_log where user_id = $1", [USER_B]);
    expect(rows[0].n).toBe(0);
    // Put the second user back for the tests that follow.
    await db.query("insert into auth.users (id, email) values ($1, 'b@example.test')", [USER_B]);
  });
});

describe("the migration over a database that already has rows", () => {
  it("runs on rows written with the old schema, which stay intact and readable", async () => {
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
      await old.query(
        "insert into public.notification_log (user_id, channel, suppressed_reason) values ($1, 'web_push', null), ($1, 'home_card', 'quiet_hours')",
        [USER_A],
      );
      await expect(old.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8"))).resolves.toBeDefined();
      const { rows } = await old.query<Record<string, unknown>>(
        "select channel, suppressed_reason, kind, moment_key from public.notification_log order by channel",
      );
      expect(rows).toEqual([
        { channel: "home_card", suppressed_reason: "quiet_hours", kind: null, moment_key: null },
        { channel: "web_push", suppressed_reason: null, kind: null, moment_key: null },
      ]);
    } finally {
      await old.close();
    }
  }, OLD_DATABASE_TIMEOUT_MS);
});
