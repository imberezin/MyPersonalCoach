import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeFoodSupabase } from "@/lib/food/fakeSupabase";
import { completeFirstWeek } from "./complete";

const USER = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-19T00:05:00.000Z");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("completeFirstWeek", () => {
  it("sends exactly the transition patch, filtered by the person AND the expected lifecycle state", async () => {
    const { client, calls } = createFakeFoodSupabase({ tables: { profiles: [{ user_id: USER }] } });
    await completeFirstWeek(client, USER, NOW);

    expect(calls).toEqual([
      {
        kind: "query",
        table: "profiles",
        op: "update",
        patch: { lifecycle_state: "WEEKLY_CYCLE", first_week_ended_at: NOW.toISOString() },
        columns: "user_id",
        filters: [
          ["eq", "user_id", USER],
          ["eq", "lifecycle_state", "FIRST_WEEK"],
        ],
        single: false,
      },
    ]);
  });

  it("one row changed: this call made the transition", async () => {
    const { client } = createFakeFoodSupabase({ tables: { profiles: [{ user_id: USER }] } });
    expect(await completeFirstWeek(client, USER, NOW)).toEqual({ ok: true, transitioned: true });
  });

  it("no row changed (a second tap, a second tab, another winner): done, but not by this call", async () => {
    const { client } = createFakeFoodSupabase({ tables: { profiles: [] } });
    expect(await completeFirstWeek(client, USER, NOW)).toEqual({ ok: true, transitioned: false });
  });

  it("an error from the database is a failure, not a transition", async () => {
    const { client } = createFakeFoodSupabase({ tables: { profiles: { error: { code: "42501" } } } });
    expect(await completeFirstWeek(client, USER, NOW)).toEqual({ ok: false });
  });

  it("a network failure is a failure and never throws", async () => {
    const { client } = createFakeFoodSupabase({ tables: { profiles: "throw" } });
    await expect(completeFirstWeek(client, USER, NOW)).resolves.toEqual({ ok: false });
  });

  it("a client that throws on first use is a failure", async () => {
    const broken = {
      from() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    await expect(completeFirstWeek(broken, USER, NOW)).resolves.toEqual({ ok: false });
  });

  it("an answer that is not a list of rows is a failure, not a transition", async () => {
    const { client } = createFakeFoodSupabase({ tables: { profiles: { not: "rows" } } });
    // The fake returns a non-array object as the data as is.
    expect(await completeFirstWeek(client, USER, NOW)).toEqual({ ok: false });
  });

  it("makes no rpc call and logs only the code, never the person", async () => {
    const { client, calls } = createFakeFoodSupabase({ tables: { profiles: { error: { code: "42501", message: `no access for ${USER}` } } } });
    await completeFirstWeek(client, USER, NOW);
    expect(calls.some((c) => c.kind === "rpc")).toBe(false);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(USER);
  });

  it("does not import the admin client and uses no rpc (a source scan)", () => {
    const text = readFileSync(join(process.cwd(), "src", "lib", "firstWeek", "complete.ts"), "utf8");
    expect(text).not.toMatch(/supabase\/admin|createAdminClient/);
    expect(text).not.toContain(".rpc(");
  });
});
