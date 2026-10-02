import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USER_A, USER_B, as, createTestDb } from "./harness";

/**
 * The weekly Shabbat top-up function on a real Postgres: insert-only, future rows only, and only for a user whose
 * profile still says what the caller says. The function is called by the server job with the service role.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const FN = "public.top_up_future_auto_shabbat(uuid, text, integer, jsonb)";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const asService = <T>(fn: () => Promise<T>) => as(db, "service_role", null, fn);

const OBSERVING = `observes_shabbat = true, place_key = 'jerusalem', city = 'Jerusalem', latitude = 31.78, longitude = 35.22,
  in_israel = true, candle_lighting_minutes = 40`;

beforeEach(async () => {
  await db.exec("delete from public.offline_periods");
  await db.exec(`update public.profiles set ${OBSERVING} where user_id = '${USER_A}'`);
  await db.exec(`update public.profiles set ${OBSERVING} where user_id = '${USER_B}'`);
});

interface Row {
  start_at: string;
  end_at: string;
  metadata?: unknown;
}

/** A period `startH` hours from now lasting `hours`. */
const period = (startH: number, hours = 25, metadata: unknown = { place_key: "jerusalem" }): Row => ({
  start_at: new Date(Date.now() + startH * HOUR).toISOString(),
  end_at: new Date(Date.now() + (startH + hours) * HOUR).toISOString(),
  metadata,
});

/** n consecutive weekly Shabbat-sized periods, the first one starting `firstH` hours from now. */
const weekly = (n: number, firstH = 48): Row[] => Array.from({ length: n }, (_, i) => period(firstH + i * 7 * 24));

async function topUp(rows: unknown, over: { user?: string | null; place?: string | null; minutes?: number | null } = {}): Promise<number> {
  const user = over.user === undefined ? USER_A : over.user;
  const place = over.place === undefined ? "jerusalem" : over.place;
  const minutes = over.minutes === undefined ? 40 : over.minutes;
  const { rows: out } = await asService(() =>
    db.query<{ n: number }>("select public.top_up_future_auto_shabbat($1::uuid, $2::text, $3::integer, $4::jsonb) as n", [user, place, minutes, JSON.stringify(rows)]),
  );
  return out[0].n;
}

const all = async () => (await db.query<Record<string, unknown>>("select * from public.offline_periods order by id")).rows;
const count = async (where = "true") => Number((await db.query<{ n: string }>(`select count(*) as n from public.offline_periods where ${where}`)).rows[0].n);

/** Direct (superuser) setup of rows the function must never touch. */
async function seed(userId: string, type: string, source: string, row: Row): Promise<void> {
  await db.query("insert into public.offline_periods (user_id, type, start_at, end_at, source, metadata) values ($1, $2, $3, $4, $5, $6::jsonb)", [
    userId,
    type,
    row.start_at,
    row.end_at,
    source,
    JSON.stringify(row.metadata ?? {}),
  ]);
}

describe("top_up_future_auto_shabbat: inserting", () => {
  it("inserts the rows for the user as the service role (auth.uid() is null) and returns how many", async () => {
    const rows = weekly(3);
    expect(await topUp(rows)).toBe(3);

    const { rows: stored } = await db.query<{ user_id: string; type: string; source: string; start_at: Date; metadata: unknown }>(
      "select user_id, type, source, start_at, metadata from public.offline_periods order by start_at",
    );
    expect(stored).toHaveLength(3);
    expect(stored.every((r) => r.user_id === USER_A && r.type === "SHABBAT" && r.source === "auto")).toBe(true);
    expect(stored.map((r) => r.start_at.toISOString())).toEqual(rows.map((r) => r.start_at));
    expect(stored[0].metadata).toEqual({ place_key: "jerusalem" });
  });

  it("is idempotent: the same call again returns 0 and changes nothing", async () => {
    const rows = weekly(4);
    expect(await topUp(rows)).toBe(4);
    const before = await all();
    expect(await topUp(rows)).toBe(0);
    expect(await all()).toEqual(before);
  });

  it("inserts only the missing ones when part of the set is stored", async () => {
    const rows = weekly(4);
    expect(await topUp(rows.slice(0, 2))).toBe(2);
    expect(await topUp(rows)).toBe(2);
    expect(await count()).toBe(4);
  });

  it("does not insert a row that overlaps a stored one with a different start_at", async () => {
    expect(await topUp([period(48, 25)])).toBe(1);
    // Two minutes later, and a contained period: neither may be added next to the stored one.
    const drifted = { start_at: new Date(Date.now() + 48 * HOUR + 120_000).toISOString(), end_at: new Date(Date.now() + 73 * HOUR + 120_000).toISOString() };
    expect(await topUp([drifted])).toBe(0);
    expect(await topUp([period(50, 10)])).toBe(0);
    expect(await count()).toBe(1);
  });

  it("stores a metadata that is not an object as an empty object", async () => {
    expect(await topUp([period(48, 25, "just a string"), period(48 + 7 * 24, 25, null), period(48 + 14 * 24, 25, [1, 2])])).toBe(3);
    const { rows } = await db.query<{ metadata: unknown }>("select metadata from public.offline_periods");
    expect(rows.map((r) => r.metadata)).toEqual([{}, {}, {}]);
  });

  it("accepts exactly 12 rows", async () => {
    expect(await topUp(weekly(12))).toBe(12);
  });
});

describe("top_up_future_auto_shabbat: it only ever adds", () => {
  it("leaves every other row byte for byte as it was, and adds only the new ones", async () => {
    await seed(USER_A, "SHABBAT", "auto", period(-24 * 14, 25)); // past auto row
    await seed(USER_A, "SHABBAT", "manual", period(24 * 20, 25)); // future manual Shabbat, away from the candidates
    await seed(USER_A, "HOLIDAY", "auto", period(60, 24)); // overlaps a candidate: other types are not consulted
    await seed(USER_A, "USER_DEFINED", "manual", period(70, 5));
    await seed(USER_A, "VACATION", "manual", period(24 * 40, 48));
    await seed(USER_B, "SHABBAT", "auto", period(48, 25));
    await seed(USER_B, "SHABBAT", "manual", period(24 * 9, 25));

    const before = await all();
    expect(before).toHaveLength(7);
    expect(await topUp(weekly(3))).toBe(3);

    const after = await all();
    expect(after).toHaveLength(10);
    // Every original row is still there, unchanged (including created_at and id).
    for (const row of before) expect(after).toContainEqual(row);
    // The three new ones belong to A, are automatic Shabbat rows, and nothing else changed.
    const originalIds = new Set(before.map((r) => r.id));
    const fresh = after.filter((r) => !originalIds.has(r.id));
    expect(fresh).toHaveLength(3);
    expect(fresh.every((r) => r.user_id === USER_A && r.type === "SHABBAT" && r.source === "auto")).toBe(true);
  });

  it("does not add an automatic row on top of a manual Shabbat row", async () => {
    await seed(USER_A, "SHABBAT", "manual", period(48, 25));
    expect(await topUp([period(49, 24), period(48 + 7 * 24, 25)])).toBe(1);
    expect(await count("source = 'manual'")).toBe(1);
    expect(await count()).toBe(2);
  });

  it("never touches another user's rows, even when the same instants are sent", async () => {
    const rows = weekly(2);
    expect(await topUp(rows, { user: USER_B })).toBe(2);
    expect(await topUp(rows, { user: USER_A })).toBe(2);
    expect(await count(`user_id = '${USER_A}'`)).toBe(2);
    expect(await count(`user_id = '${USER_B}'`)).toBe(2);
  });
});

describe("top_up_future_auto_shabbat: only the future", () => {
  it("does not insert a period that is over, one that is under way, or one that starts right now", async () => {
    expect(await topUp([period(-48, 25)])).toBe(0); // over
    expect(await topUp([period(-2, 25)])).toBe(0); // under way
    expect(await topUp([period(-0.001, 25)])).toBe(0); // began a few seconds ago
    expect(await count()).toBe(0);
    expect(await topUp([period(0.01, 25)])).toBe(1); // starts in a few seconds: still the future
  });

  it("limits the duration to three days, and the horizon to one year", async () => {
    expect(await topUp([period(48, 73)])).toBe(0);
    expect(await topUp([period(48 + 7 * 24, 72)])).toBe(1);
    expect(await topUp([{ start_at: new Date(Date.now() + 366 * DAY).toISOString(), end_at: new Date(Date.now() + 366 * DAY + 25 * HOUR).toISOString() }])).toBe(0);
    expect(await topUp([{ start_at: new Date(Date.now() + 360 * DAY).toISOString(), end_at: new Date(Date.now() + 360 * DAY + 25 * HOUR).toISOString() }])).toBe(1);
  });

  it("skips malformed rows without failing the good ones", async () => {
    const good = period(48);
    const reversed = { start_at: good.end_at, end_at: good.start_at };
    const empty = { start_at: null, end_at: null };
    expect(await topUp([reversed, empty, good])).toBe(1);
  });
});

describe("top_up_future_auto_shabbat: only for a profile that still agrees", () => {
  it("does nothing for a user who does not observe Shabbat", async () => {
    await db.exec(`update public.profiles set observes_shabbat = false where user_id = '${USER_A}'`);
    expect(await topUp(weekly(2))).toBe(0);
    await db.exec(`update public.profiles set observes_shabbat = null, place_key = null, candle_lighting_minutes = null, latitude = null, longitude = null, in_israel = null, city = null where user_id = '${USER_A}'`);
    expect(await topUp(weekly(2))).toBe(0);
    expect(await count()).toBe(0);
  });

  it("does nothing when the place or the minutes differ from the profile, or the user does not exist", async () => {
    expect(await topUp(weekly(2), { place: "tel_aviv" })).toBe(0);
    expect(await topUp(weekly(2), { minutes: 30 })).toBe(0);
    expect(await topUp(weekly(2), { user: "99999999-9999-4999-8999-999999999999" })).toBe(0);
    expect(await count()).toBe(0);
    expect(await topUp(weekly(2))).toBe(2);
  });
});

describe("top_up_future_auto_shabbat: input checks", () => {
  const code = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return "no error";
  };

  it("refuses a null user, place or minutes", async () => {
    expect(await code(() => topUp(weekly(1), { user: null }))).toBe("22023");
    expect(await code(() => topUp(weekly(1), { place: null }))).toBe("22023");
    expect(await code(() => topUp(weekly(1), { minutes: null }))).toBe("22023");
  });

  it("refuses rows that are not a json array, or more than 12", async () => {
    expect(await code(() => topUp({ start_at: "x" }))).toBe("22023");
    expect(await code(() => topUp("text"))).toBe("22023");
    expect(await code(() => topUp(null))).toBe("22023");
    expect(await code(() => topUp(weekly(13)))).toBe("22023");
    expect(await count()).toBe(0);
  });

  it("returns 0 for an empty array and writes nothing", async () => {
    expect(await topUp([])).toBe(0);
    expect(await count()).toBe(0);
  });
});

describe("who may call it", () => {
  const privilege = async (role: string) =>
    (await db.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'execute') as ok", [role, FN])).rows[0].ok;

  it("is executable by the service role only", async () => {
    expect(await privilege("service_role")).toBe(true);
    expect(await privilege("authenticated")).toBe(false);
    expect(await privilege("anon")).toBe(false);
  });

  it("refuses a signed-in user, even for their own id, and a visitor", async () => {
    const args = [USER_A, "jerusalem", 40, JSON.stringify(weekly(1))];
    const sql = "select public.top_up_future_auto_shabbat($1::uuid, $2::text, $3::integer, $4::jsonb)";
    await expect(as(db, "authenticated", USER_A, () => db.query(sql, args))).rejects.toThrow(/permission denied/);
    await expect(as(db, "authenticated", USER_B, () => db.query(sql, args))).rejects.toThrow(/permission denied/);
    await expect(as(db, "anon", null, () => db.query(sql, args))).rejects.toThrow(/permission denied/);
    expect(await count()).toBe(0);
  });
});

describe("how the function is written", () => {
  const definition = async () => {
    const { rows } = await db.query<{ def: string; secdef: boolean; config: string[] | null }>(
      `select pg_get_functiondef(p.oid) as def, p.prosecdef as secdef, p.proconfig as config from pg_proc p where p.oid = '${FN}'::regprocedure`,
    );
    return rows[0];
  };
  /** The function without its comments, lower case. */
  const code = (def: string) =>
    def
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .toLowerCase();

  it("is an invoker function with an empty search_path", async () => {
    const { secdef, config } = await definition();
    expect(secdef).toBe(false);
    expect(config).toEqual(['search_path=""']);
  });

  it("locks the profile row before it inserts, and contains no update or delete", async () => {
    const body = code((await definition()).def);
    const lock = body.indexOf("for share");
    const insert = body.indexOf("insert into public.offline_periods");
    expect(lock).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(lock);
    expect(body).not.toMatch(/\b(delete|update|truncate|merge)\b/);
    expect(body.match(/\binsert into\b/g)).toHaveLength(1);
    // The type and the source are constants, not arguments.
    expect(body).toContain("'shabbat', r.start_at, r.end_at, 'auto'");
    expect(body).toContain("r.start_at > now()");
    expect(body).toContain("observes_shabbat is true");
  });

  it("is the only thing its migration adds", () => {
    const file = join(process.env.MIGRATIONS_DIR ?? join(process.cwd(), "supabase", "migrations"), "20261002120000_shabbat_topup.sql");
    const sql = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .toLowerCase();
    expect(sql.match(/\bcreate\s+function\b/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\bcreate\s+(?!function\b)\w+/);
    expect(sql).not.toMatch(/\b(alter|drop|truncate|delete|update)\b/);
    expect(sql.match(/\binsert\s+into\b/g)).toHaveLength(1);
  });
});
