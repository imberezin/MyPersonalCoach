import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHABBAT_HORIZON_WEEKS, buildShabbatRows, type ShabbatPeriodRow } from "@/domain/onboarding";
import { getPlace } from "@/domain/places";
import { computeShabbatSeries } from "@/lib/shabbat/series";
import type { ExistingAutoShabbat } from "@/lib/shabbat/topup";
import {
  TOPUP_DEADLINE_MS,
  TOPUP_MAX_USERS,
  TOPUP_PAGE_SIZE,
  runShabbatTopup,
  topupNeedsAttention,
  type TopupCandidate,
  type TopupStore,
  type TopupSummary,
} from "./shabbatTopup";

const NOW = new Date("2026-10-02T09:00:00Z");

function rowsFor(key: string, minutes: number, weeks: number, from = NOW): ShabbatPeriodRow[] {
  const place = getPlace(key);
  if (!place) throw new Error(key);
  const series = computeShabbatSeries(
    { latitude: place.latitude, longitude: place.longitude, timezone: place.timezone, inIsrael: place.inIsrael, candleLightingMinutes: minutes, cityName: place.cityName },
    from,
    weeks,
  );
  return buildShabbatRows(series, { place, candleMinutes: minutes, now: from });
}

interface FakeUser {
  id: string;
  observes: boolean | null;
  placeKey: string | null;
  minutes: number | null;
  rows: ExistingAutoShabbat[];
  readThrows?: boolean;
  insertError?: string;
  insertThrows?: boolean;
}

/** An in-memory store with the semantics of the SQL function: profile match, overlap check, start in the future. */
function memoryStore(users: FakeUser[]) {
  const calls = { listCandidates: [] as (string | null)[], read: [] as string[], insert: [] as string[] };
  const store: TopupStore = {
    async listCandidates(after, limit) {
      calls.listCandidates.push(after);
      return users
        .filter((u) => u.observes === true)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .filter((u) => after === null || u.id > after)
        .slice(0, limit)
        .map((u): TopupCandidate => ({ userId: u.id, observesShabbat: u.observes, placeKey: u.placeKey, candleMinutes: u.minutes }));
    },
    async listFutureAutoShabbat(userId, now) {
      calls.read.push(userId);
      const user = users.find((u) => u.id === userId)!;
      if (user.readThrows) throw new Error("boom with " + userId);
      return user.rows.filter((r) => new Date(r.end_at).getTime() > now.getTime());
    },
    async insertRows(userId, target, rows) {
      calls.insert.push(userId);
      const user = users.find((u) => u.id === userId)!;
      if (user.insertThrows) throw new Error("insert exploded for " + userId);
      if (user.insertError) return { error: user.insertError };
      if (user.observes !== true || user.placeKey !== target.placeKey || user.minutes !== target.candleMinutes) return { inserted: 0 };
      let inserted = 0;
      for (const row of rows) {
        const start = new Date(row.start_at).getTime();
        const end = new Date(row.end_at).getTime();
        if (start <= NOW.getTime()) continue;
        if (user.rows.some((o) => new Date(o.start_at).getTime() < end && new Date(o.end_at).getTime() > start)) continue;
        user.rows.push(row);
        inserted += 1;
      }
      return { inserted };
    },
  };
  return { store, calls };
}

const user = (id: string, over: Partial<FakeUser> = {}): FakeUser => ({
  id,
  observes: true,
  placeKey: "jerusalem",
  minutes: 40,
  rows: rowsFor("jerusalem", 40, 7),
  ...over,
});

let errorSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const blank: TopupSummary = {
  candidates: 0,
  usersAdded: 0,
  rowsPlanned: 0,
  rowsInserted: 0,
  current: 0,
  skipped: 0,
  skippedBy: {},
  failed: 0,
  dryRun: false,
  aborted: null,
};

describe("runShabbatTopup: one user failing never stops the others", () => {
  it("counts every outcome and still serves the user who comes after the failures", async () => {
    // Read in id order: b0 (the read throws), c0 (the write answers an error), then a2 (gets rows), d3, e4, f5.
    const users = [
      user("b0", { readThrows: true }),
      user("c0", { rows: [], insertError: "23505" }),
      user("a2", { rows: rowsFor("jerusalem", 40, 7).slice(1) }),
      user("d3", { rows: rowsFor("jerusalem", 40, 8) }),
      user("e4", { rows: rowsFor("london", 18, 2) }),
      user("f5", { placeKey: "atlantis" }),
    ];
    const { store, calls } = memoryStore(users);
    const summary = await runShabbatTopup(store, { now: NOW });

    expect(calls.read).toEqual(["a2", "b0", "c0", "d3", "e4", "f5"].sort());
    expect(summary).toMatchObject({ candidates: 6, usersAdded: 1, failed: 2, current: 1, skipped: 2, rowsInserted: 2, rowsPlanned: 10, dryRun: false, aborted: null });
    expect(summary.skippedBy).toEqual({ stale_rows: 1, unknown_place: 1 });
    expect(users.find((u) => u.id === "a2")!.rows).toHaveLength(SHABBAT_HORIZON_WEEKS);
    expect(topupNeedsAttention(summary)).toBe(true);
  });

  it("serves a user who sorts AFTER a failing one", async () => {
    const users = [user("b0", { readThrows: true }), user("z9", { rows: [] })];
    const summary = await runShabbatTopup(memoryStore(users).store, { now: NOW });
    expect(summary).toMatchObject({ failed: 1, usersAdded: 1 });
    expect(users[1].rows).toHaveLength(SHABBAT_HORIZON_WEEKS);
  });

  it("survives a store that throws on insert", async () => {
    const { store } = memoryStore([user("u1", { rows: [], insertThrows: true }), user("u2", { rows: [] })]);
    const summary = await runShabbatTopup(store, { now: NOW });
    expect(summary).toMatchObject({ candidates: 2, failed: 1, usersAdded: 1, aborted: null });
  });

  it("survives a planner that throws", async () => {
    const { store } = memoryStore([user("u1"), user("u2")]);
    const plan = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("planner exploded");
      })
      .mockReturnValueOnce({ kind: "current" });
    const summary = await runShabbatTopup(store, { now: NOW, plan });
    expect(summary).toMatchObject({ candidates: 2, failed: 1, current: 1, aborted: null });
  });

  it("never throws, even when listing the users fails", async () => {
    const store: TopupStore = {
      listCandidates: async () => {
        throw new Error("database down");
      },
      listFutureAutoShabbat: async () => [],
      insertRows: async () => ({ inserted: 0 }),
    };
    const summary = await runShabbatTopup(store, { now: NOW });
    expect(summary).toMatchObject({ ...blank, aborted: "candidates_failed" });
    expect(topupNeedsAttention(summary)).toBe(true);
  });
});

describe("runShabbatTopup: idempotent and dry", () => {
  it("a second run over the same store inserts nothing", async () => {
    const users = [user("u1", { rows: [] }), user("u2", { rows: rowsFor("jerusalem", 40, 7).slice(1) }), user("u3", { observes: true, placeKey: "atlantis" })];
    const { store } = memoryStore(users);
    const first = await runShabbatTopup(store, { now: NOW });
    expect(first.rowsInserted).toBeGreaterThan(0);

    const snapshot = JSON.stringify(users);
    const second = await runShabbatTopup(store, { now: NOW });
    expect(second.rowsInserted).toBe(0);
    expect(second.rowsPlanned).toBe(0);
    expect(second.usersAdded).toBe(0);
    expect(second.current + second.skipped).toBe(second.candidates);
    expect(JSON.stringify(users)).toBe(snapshot);
  });

  it("a dry run plans but writes nothing and never calls the write", async () => {
    const users = [user("u1", { rows: [] }), user("u2", { rows: rowsFor("jerusalem", 40, 8) })];
    const { store, calls } = memoryStore(users);
    const insertSpy = vi.spyOn(store, "insertRows");
    const summary = await runShabbatTopup(store, { now: NOW, dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.rowsPlanned).toBeGreaterThan(0);
    expect(summary.usersAdded).toBe(1);
    expect(summary.rowsInserted).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(calls.insert).toEqual([]);
    expect(users[0].rows).toHaveLength(0);
  });

  it("treats 'the function inserted 0' as current, and passes the profile's own place to it", async () => {
    const users = [user("u1", { rows: [] })];
    const { store } = memoryStore(users);
    const insertSpy = vi.spyOn(store, "insertRows").mockResolvedValue({ inserted: 0 });
    const summary = await runShabbatTopup(store, { now: NOW });
    expect(summary).toMatchObject({ current: 1, usersAdded: 0, rowsInserted: 0 });
    expect(insertSpy).toHaveBeenCalledWith("u1", { placeKey: "jerusalem", candleMinutes: 40 }, expect.any(Array));
  });
});

describe("runShabbatTopup: pages, caps and aborts", () => {
  it("visits each user once, in order, advancing the cursor each page", async () => {
    const ids = ["u1", "u2", "u3", "u4", "u5"];
    const { store, calls } = memoryStore(ids.map((id) => user(id, { rows: rowsFor("jerusalem", 40, 8) })));
    const summary = await runShabbatTopup(store, { now: NOW, pageSize: 2 });
    expect(summary).toMatchObject({ candidates: 5, current: 5, aborted: null });
    expect(calls.read).toEqual(ids);
    expect(calls.listCandidates).toEqual([null, "u2", "u4"]);
  });

  it("asks for another page only when the last one was full", async () => {
    const { store, calls } = memoryStore([user("u1"), user("u2")]);
    await runShabbatTopup(store, { now: NOW, pageSize: 2 });
    // A full page of two: one more request, which returns nothing.
    expect(calls.listCandidates).toEqual([null, "u2"]);
  });

  it("stops at the user cap with a partial summary, and only when there is a further user", async () => {
    const users = ["u1", "u2", "u3"].map((id) => user(id));
    const { store, calls } = memoryStore(users);
    const capped = await runShabbatTopup(store, { now: NOW, maxUsers: 2 });
    expect(capped).toMatchObject({ candidates: 2, aborted: "user_cap" });
    expect(calls.read).toEqual(["u1", "u2"]);
    expect(topupNeedsAttention(capped)).toBe(true);

    const exact = await runShabbatTopup(memoryStore(users).store, { now: NOW, maxUsers: 3 });
    expect(exact).toMatchObject({ candidates: 3, aborted: null });
  });

  it("stops at the deadline with a partial summary and no throw", async () => {
    const users = ["u1", "u2", "u3"].map((id) => user(id));
    const { store, calls } = memoryStore(users);
    let t = 0;
    const nowMs = () => {
      t += 10_000;
      return t;
    };
    const summary = await runShabbatTopup(store, { now: NOW, nowMs, deadlineMs: 25_000 });
    expect(summary.aborted).toBe("deadline");
    expect(summary.candidates).toBeGreaterThan(0);
    expect(summary.candidates).toBeLessThan(3);
    expect(calls.read.length).toBe(summary.candidates);
  });

  it("has the documented defaults", () => {
    expect(TOPUP_MAX_USERS).toBe(100);
    expect(TOPUP_DEADLINE_MS).toBe(22_000);
    expect(TOPUP_PAGE_SIZE).toBe(50);
    expect(TOPUP_DEADLINE_MS).toBeLessThan(30_000);
  });

  it("stops after the FIRST attempt when the function is missing", async () => {
    for (const code of ["PGRST202", "42883"]) {
      const users = ["u1", "u2", "u3"].map((id) => user(id, { rows: [], insertError: code }));
      const { store, calls } = memoryStore(users);
      const summary = await runShabbatTopup(store, { now: NOW });
      expect(calls.insert).toEqual(["u1"]);
      expect(summary.aborted).toBe("rpc_missing");
      expect(summary.failed).toBe(1);
      expect(summary.candidates).toBe(1);
      expect(topupNeedsAttention(summary)).toBe(true);
    }
  });

  it("does not abort for any other write error", async () => {
    const users = ["u1", "u2"].map((id) => user(id, { rows: [], insertError: "40001" }));
    const { store, calls } = memoryStore(users);
    const summary = await runShabbatTopup(store, { now: NOW });
    expect(calls.insert).toEqual(["u1", "u2"]);
    expect(summary).toMatchObject({ failed: 2, aborted: null });
  });
});

describe("topupNeedsAttention", () => {
  it("is false for a clean run, and for users who simply do not observe Shabbat", () => {
    expect(topupNeedsAttention(blank)).toBe(false);
    expect(topupNeedsAttention({ ...blank, candidates: 3, usersAdded: 1, current: 2 })).toBe(false);
    expect(topupNeedsAttention({ ...blank, skipped: 2, skippedBy: { not_observing: 2 } })).toBe(false);
    expect(topupNeedsAttention({ ...blank, skippedBy: { stale_rows: 0 } })).toBe(false);
  });

  it("is true for a failure, for every abort and for every problem skip", () => {
    expect(topupNeedsAttention({ ...blank, failed: 1 })).toBe(true);
    for (const aborted of ["candidates_failed", "rpc_missing", "deadline", "user_cap"] as const) {
      expect(topupNeedsAttention({ ...blank, aborted })).toBe(true);
    }
    for (const reason of ["stale_rows", "bad_minutes", "no_place", "unknown_place", "calc_failed"] as const) {
      expect(topupNeedsAttention({ ...blank, skipped: 1, skippedBy: { [reason]: 1 } })).toBe(true);
    }
    expect(topupNeedsAttention({ ...blank, skipped: 2, skippedBy: { not_observing: 1, stale_rows: 1 } })).toBe(true);
  });
});

describe("runShabbatTopup: privacy", () => {
  const ID_A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ID_B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const ID_C = "33333333-cccc-4ccc-8ccc-cccccccccccc";

  it("keeps ids, places and minutes out of the summary and every log line, failures included", async () => {
    const users = [
      user(ID_A, { rows: [], placeKey: "tiberias", minutes: 33 }),
      user(ID_B, { readThrows: true, placeKey: "mitzpe_ramon", minutes: 27 }),
      user(ID_C, { rows: [], insertError: "23505", placeKey: "kiryat_shmona", minutes: 44 }),
    ];
    const { store } = memoryStore(users);
    const summary = await runShabbatTopup(store, { now: NOW });

    const everything = JSON.stringify([summary, errorSpy.mock.calls, infoSpy.mock.calls]);
    for (const secret of [ID_A, ID_B, ID_C, "tiberias", "mitzpe_ramon", "kiryat_shmona", "Tiberias", "35.53", "32.79"]) {
      expect(everything).not.toContain(secret);
    }
    // The throw messages above name the user id; they must not be logged.
    expect(everything).not.toContain("boom");
    expect(everything).not.toContain("exploded");

    expect(Object.keys(summary).sort()).toEqual(
      ["aborted", "candidates", "current", "dryRun", "failed", "rowsInserted", "rowsPlanned", "skipped", "skippedBy", "usersAdded"].sort(),
    );
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("logs fixed phrases, plus at most an error code", async () => {
    const { store } = memoryStore([user("u1", { rows: [], insertError: "23505" })]);
    await runShabbatTopup(store, { now: NOW });
    for (const call of errorSpy.mock.calls) {
      expect(typeof call[0]).toBe("string");
      expect(call.slice(1).every((arg: unknown) => typeof arg === "string" && /^[A-Z0-9_]{1,12}$/.test(arg))).toBe(true);
    }
  });
});
