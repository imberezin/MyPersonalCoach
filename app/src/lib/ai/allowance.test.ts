import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { checkAiAllowance } from "./allowance";

interface Query {
  table: string;
  column: string;
  ops: string[];
  since: string;
}

/** A minimal double of `from(...).select(..., { count, head }).in(...).gte(...)`. Counts rows by their created_at. */
function ledger(rows: { created_at: string; operation: string }[], options: { error?: boolean; throws?: boolean; nullCount?: boolean } = {}) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      return {
        select(column: string, opts: { count: string; head: boolean }) {
          expect(opts).toEqual({ count: "exact", head: true });
          return {
            in(_col: string, ops: string[]) {
              return {
                gte(_c: string, since: string) {
                  queries.push({ table, column, ops, since });
                  if (options.throws) throw new Error("boom");
                  if (options.error) return Promise.resolve({ count: null, error: { message: "db down" } });
                  if (options.nullCount) return Promise.resolve({ count: null, error: null });
                  const count = rows.filter((r) => ops.includes(r.operation) && r.created_at >= since).length;
                  return Promise.resolve({ count, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

const NOW = new Date("2026-10-01T09:00:00.000Z"); // 12:00 in Asia/Jerusalem (UTC+3)
const args = { now: NOW, timeZone: "Asia/Jerusalem", dailyCap: 40, perMinuteCap: 3 };
const row = (iso: string, operation = "analyzeText") => ({ created_at: iso, operation });

describe("checkAiAllowance", () => {
  it("allows a user with no calls and reports usedToday", async () => {
    const { client } = ledger([]);
    expect(await checkAiAllowance(client, args)).toEqual({ allowed: true, usedToday: 0 });
  });

  it("counts the meal operations of today and ignores the rest", async () => {
    const { client, queries } = ledger([row("2026-10-01T06:00:00Z"), row("2026-10-01T07:00:00Z", "analyzeMeal"), row("2026-10-01T07:30:00Z", "coach")]);
    expect(await checkAiAllowance(client, args)).toEqual({ allowed: true, usedToday: 2 });
    expect(queries.every((q) => q.table === "ai_requests" && q.column === "id")).toBe(true);
    expect(queries[0].ops).toEqual(["analyzeMeal", "analyzeText", "wordExperiment"]);
  });

  it("counts the experiment wording like a meal call: attempts of wordExperiment alone reach the daily cap", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`2026-10-01T05:${String(i).padStart(2, "0")}:00Z`, "wordExperiment"));
    expect(await checkAiAllowance(ledger(rows).client, { ...args, dailyCap: 5 })).toEqual({ allowed: false, reason: "daily_cap" });
    expect(await checkAiAllowance(ledger(rows).client, { ...args, dailyCap: 6 })).toEqual({ allowed: true, usedToday: 5 });
  });

  it("counts them toward the per-minute cap too", async () => {
    const recent = [row("2026-10-01T08:59:30Z", "wordExperiment"), row("2026-10-01T08:59:40Z", "analyzeText"), row("2026-10-01T08:59:50Z", "wordExperiment")];
    expect(await checkAiAllowance(ledger(recent).client, args)).toEqual({ allowed: false, reason: "rate_limited" });
  });

  it("daily cap boundary: 39 of 40 is allowed, 40 is not", async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => row(`2026-10-01T05:${String(i).padStart(2, "0")}:00Z`));
    expect(await checkAiAllowance(ledger(rows(39)).client, args)).toMatchObject({ allowed: true, usedToday: 39 });
    expect(await checkAiAllowance(ledger(rows(40)).client, args)).toEqual({ allowed: false, reason: "daily_cap" });
  });

  it("a cap of 0 blocks everything (the manual way to test the cap panel)", async () => {
    expect(await checkAiAllowance(ledger([]).client, { ...args, dailyCap: 0 })).toEqual({ allowed: false, reason: "daily_cap" });
  });

  it("per-minute boundary: 2 calls in the last minute are allowed, 3 are not, 61 s old does not count", async () => {
    const recent = [row("2026-10-01T08:59:30Z"), row("2026-10-01T08:59:50Z")];
    expect(await checkAiAllowance(ledger(recent).client, args)).toMatchObject({ allowed: true });
    expect(await checkAiAllowance(ledger([...recent, row("2026-10-01T08:59:59Z")]).client, args)).toEqual({ allowed: false, reason: "rate_limited" });
    const old = [row("2026-10-01T08:58:59Z"), row("2026-10-01T08:58:30Z"), row("2026-10-01T08:58:00Z")];
    expect(await checkAiAllowance(ledger(old).client, args)).toMatchObject({ allowed: true, usedToday: 3 });
  });

  it("the daily cap wins over the minute cap", async () => {
    const rows = Array.from({ length: 5 }, () => row("2026-10-01T08:59:50Z"));
    expect(await checkAiAllowance(ledger(rows).client, { ...args, dailyCap: 5 })).toEqual({ allowed: false, reason: "daily_cap" });
  });

  it("'today' starts at the user's LOCAL midnight, not at UTC midnight", async () => {
    // 21:30 UTC on 09-30 is 00:30 local on 10-01 (inside today); 20:30 UTC is 23:30 local on 09-30 (yesterday).
    const { client, queries } = ledger([row("2026-09-30T21:30:00Z"), row("2026-09-30T20:30:00Z")]);
    expect(await checkAiAllowance(client, args)).toMatchObject({ allowed: true, usedToday: 1 });
    expect(queries[0].since).toBe("2026-09-30T21:00:00.000Z");
    expect(queries[1].since).toBe("2026-10-01T08:59:00.000Z");
  });

  it("uses the local day on a DST-change day (Israel falls back on 2026-10-25: a 25-hour day)", async () => {
    const now = new Date("2026-10-25T10:00:00Z");
    const { client, queries } = ledger([row("2026-10-24T21:30:00Z"), row("2026-10-24T20:30:00Z")]);
    // Local midnight of 10-25 is still UTC+3: 2026-10-24T21:00:00Z.
    expect(await checkAiAllowance(client, { ...args, now })).toMatchObject({ allowed: true, usedToday: 1 });
    expect(queries[0].since).toBe("2026-10-24T21:00:00.000Z");
  });

  it("an invalid time zone falls back instead of failing", async () => {
    expect(await checkAiAllowance(ledger([]).client, { ...args, timeZone: "Not/AZone" })).toMatchObject({ allowed: true });
  });

  it("fails closed: a query error, a throw or a missing count is 'ledger_unavailable'", async () => {
    for (const options of [{ error: true }, { throws: true }, { nullCount: true }]) {
      expect(await checkAiAllowance(ledger([], options).client, args)).toEqual({ allowed: false, reason: "ledger_unavailable" });
    }
  });
});
