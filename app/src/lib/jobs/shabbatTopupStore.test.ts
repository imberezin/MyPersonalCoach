import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { ShabbatPeriodRow } from "@/domain/onboarding";
import { CANDIDATE_COLUMNS, TOPUP_RPC, createSupabaseTopupStore } from "./shabbatTopupStore";

type Call = [method: string, ...args: unknown[]];
type Result = { data: unknown; error: { code?: string; message?: string } | null };

/** A chainable, awaitable stand-in for the PostgREST builder that records every call made on it. */
function fakeAdmin(results: { profiles?: Result; offline_periods?: Result; rpc?: Result } = {}) {
  const log: { from: string[]; calls: Record<string, Call[]>; rpc: [string, Record<string, unknown>][] } = { from: [], calls: {}, rpc: [] };
  const builder = (table: string, result: Result) => {
    const calls: Call[] = (log.calls[table] ??= []);
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, method: string) {
          if (method === "then") return (resolve: (value: Result) => unknown) => resolve(result);
          return (...args: unknown[]) => {
            calls.push([method, ...args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  const admin = {
    from(table: string) {
      log.from.push(table);
      const result = results[table as "profiles" | "offline_periods"] ?? { data: [], error: null };
      return builder(table, result);
    },
    rpc(name: string, args: Record<string, unknown>) {
      log.rpc.push([name, args]);
      return Promise.resolve(results.rpc ?? { data: 0, error: null });
    },
  } as unknown as SupabaseClient;
  return { admin, log };
}

const ROW: ShabbatPeriodRow = { start_at: "2026-10-09T15:00:00.000Z", end_at: "2026-10-10T16:00:00.000Z", metadata: { place_key: "jerusalem" } };

describe("listCandidates", () => {
  it("reads only the allow-listed columns, only observing and finished users, in id order", async () => {
    const { admin, log } = fakeAdmin({
      profiles: { data: [{ user_id: "u1", observes_shabbat: true, place_key: "jerusalem", candle_lighting_minutes: 40 }], error: null },
    });
    const rows = await createSupabaseTopupStore(admin).listCandidates(null, 50);

    expect(rows).toEqual([{ userId: "u1", observesShabbat: true, placeKey: "jerusalem", candleMinutes: 40 }]);
    expect(CANDIDATE_COLUMNS).toBe("user_id, observes_shabbat, place_key, candle_lighting_minutes");
    expect(log.from).toEqual(["profiles"]);
    expect(log.calls.profiles).toEqual([
      ["select", "user_id, observes_shabbat, place_key, candle_lighting_minutes"],
      ["eq", "observes_shabbat", true],
      ["not", "onboarding_completed_at", "is", null],
      ["order", "user_id"],
      ["limit", 50],
    ]);
  });

  it("pages with a keyset cursor only when it has one", async () => {
    const first = fakeAdmin();
    await createSupabaseTopupStore(first.admin).listCandidates(null, 10);
    expect(first.log.calls.profiles.map((c) => c[0])).not.toContain("gt");

    const next = fakeAdmin();
    await createSupabaseTopupStore(next.admin).listCandidates("u7", 10);
    expect(next.log.calls.profiles).toContainEqual(["gt", "user_id", "u7"]);
  });

  it("throws on a read error and treats no data as no users", async () => {
    const broken = fakeAdmin({ profiles: { data: null, error: { code: "XX000", message: "secret detail" } } });
    await expect(createSupabaseTopupStore(broken.admin).listCandidates(null, 10)).rejects.toThrow(/^candidates_failed$/);

    const empty = fakeAdmin({ profiles: { data: null, error: null } });
    await expect(createSupabaseTopupStore(empty.admin).listCandidates(null, 10)).resolves.toEqual([]);
  });
});

describe("listFutureAutoShabbat", () => {
  it("filters to the one user's future automatic Shabbat rows", async () => {
    const stored = [{ start_at: ROW.start_at, end_at: ROW.end_at, metadata: ROW.metadata }];
    const { admin, log } = fakeAdmin({ offline_periods: { data: stored, error: null } });
    const now = new Date("2026-10-02T09:00:00Z");
    const rows = await createSupabaseTopupStore(admin).listFutureAutoShabbat("u1", now);

    expect(rows).toEqual(stored);
    expect(log.from).toEqual(["offline_periods"]);
    expect(log.calls.offline_periods).toEqual([
      ["select", "start_at, end_at, metadata"],
      ["eq", "user_id", "u1"],
      ["eq", "type", "SHABBAT"],
      ["eq", "source", "auto"],
      ["gt", "end_at", "2026-10-02T09:00:00.000Z"],
      ["order", "start_at"],
      ["limit", 100],
    ]);
  });

  it("throws on a read error", async () => {
    const { admin } = fakeAdmin({ offline_periods: { data: null, error: { code: "XX000" } } });
    await expect(createSupabaseTopupStore(admin).listFutureAutoShabbat("u1", new Date())).rejects.toThrow("existing_failed");
  });
});

describe("insertRows", () => {
  const target = { placeKey: "jerusalem", candleMinutes: 40 };

  it("calls the insert-only function, and nothing else, with exactly its four arguments", async () => {
    const { admin, log } = fakeAdmin({ rpc: { data: 3, error: null } });
    const result = await createSupabaseTopupStore(admin).insertRows("u1", target, [ROW]);

    expect(result).toEqual({ inserted: 3 });
    expect(TOPUP_RPC).toBe("top_up_future_auto_shabbat");
    expect(log.rpc).toEqual([["top_up_future_auto_shabbat", { p_user_id: "u1", p_place_key: "jerusalem", p_candle_minutes: 40, p_rows: [ROW] }]]);
    expect(log.rpc[0][0]).not.toBe("replace_future_auto_shabbat");
    expect(log.from).toEqual([]);
  });

  it("answers an error code, never a message", async () => {
    const { admin } = fakeAdmin({ rpc: { data: null, error: { code: "PGRST202", message: "Could not find the function for user u1" } } });
    const result = await createSupabaseTopupStore(admin).insertRows("u1", target, [ROW]);
    expect(result).toEqual({ error: "PGRST202" });
    expect(JSON.stringify(result)).not.toContain("u1");
  });

  it("uses a fixed code when the error has none, and rejects a non-number answer", async () => {
    const noCode = fakeAdmin({ rpc: { data: null, error: { message: "boom" } } });
    expect(await createSupabaseTopupStore(noCode.admin).insertRows("u1", target, [ROW])).toEqual({ error: "rpc_failed" });

    for (const data of ["3", null, { n: 3 }]) {
      const odd = fakeAdmin({ rpc: { data, error: null } });
      expect(await createSupabaseTopupStore(odd.admin).insertRows("u1", target, [ROW])).toEqual({ error: "bad_response" });
    }
  });
});

describe("the store never writes any other way", () => {
  it("exposes no method that updates, deletes or upserts, and the source has no such call", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const file of ["shabbatTopup.ts", "shabbatTopupStore.ts"]) {
      const code = readFileSync(join(__dirname, file), "utf8");
      expect(code).not.toMatch(/\.(update|delete|upsert|insert)\(/);
      expect(code).not.toMatch(/console\.\w+\([^)]*(userId|placeKey|candle)/);
    }
  });
});
