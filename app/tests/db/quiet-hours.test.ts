import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_QUIET_HOURS } from "@/domain/quietHours";
import { USER_A, USER_B, as, createTestDb } from "./harness";

const MIGRATION = join(process.cwd(), "supabase", "migrations", "20261001130000_quiet_hours_default.sql");

interface Hours {
  start: string | null;
  end: string | null;
}

async function hoursOf(db: PGlite, userId: string): Promise<Hours> {
  const { rows } = await db.query<Hours>(
    "select quiet_hours_start::text as start, quiet_hours_end::text as \"end\" from public.user_preferences where user_id = $1",
    [userId],
  );
  return { start: rows[0].start?.slice(0, 5) ?? null, end: rows[0].end?.slice(0, 5) ?? null };
}

describe("default quiet hours", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it("gives every new user the default through the sign-up trigger", async () => {
    expect(await hoursOf(db, USER_A)).toEqual(DEFAULT_QUIET_HOURS);
    expect(await hoursOf(db, USER_B)).toEqual(DEFAULT_QUIET_HOURS);
  });

  it("lets the owner change or clear them", async () => {
    await as(db, "authenticated", USER_A, () =>
      db.query("update public.user_preferences set quiet_hours_start = '23:00', quiet_hours_end = '07:00' where user_id = $1", [USER_A]),
    );
    expect(await hoursOf(db, USER_A)).toEqual({ start: "23:00", end: "07:00" });

    await as(db, "authenticated", USER_A, () =>
      db.query("update public.user_preferences set quiet_hours_start = null, quiet_hours_end = null where user_id = $1", [USER_A]),
    );
    expect(await hoursOf(db, USER_A)).toEqual({ start: null, end: null });
  });

  it("backfills rows that have no quiet hours and leaves a half-set row alone", async () => {
    // User A has both columns cleared (from the previous test); user B has only the end set.
    await db.query("update public.user_preferences set quiet_hours_start = null, quiet_hours_end = '07:00' where user_id = $1", [USER_B]);

    await db.exec(readFileSync(MIGRATION, "utf8"));

    expect(await hoursOf(db, USER_A)).toEqual(DEFAULT_QUIET_HOURS);
    expect(await hoursOf(db, USER_B)).toEqual({ start: null, end: "07:00" });
  });
});
