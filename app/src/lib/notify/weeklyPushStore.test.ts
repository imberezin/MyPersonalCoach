import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREFERENCE_COLUMNS, PROFILE_COLUMNS, SUBSCRIPTION_COLUMNS, createSupabaseWeeklyPushStore } from "./weeklyPushStore";

const mocks = vi.hoisted(() => ({ loadWeeklyHomeFact: vi.fn(), loadOfflinePeriods: vi.fn() }));
vi.mock("@/lib/weekly/home", () => ({ loadWeeklyHomeFact: mocks.loadWeeklyHomeFact }));
vi.mock("@/lib/home/load", () => ({ loadOfflinePeriods: mocks.loadOfflinePeriods }));

const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-18T05:05:00Z");
const MOMENT = "weekly:2026-10-11";
const SUB = { endpoint: "https://web.push.apple.com/abc", p256dh: "p-key", auth: "a-key" };

type Call = [method: string, ...args: unknown[]];
type Result = { data: unknown; error: { code?: string; message?: string } | null };
type Op = "select" | "insert" | "update" | "delete";

/** A chainable, awaitable stand-in for the PostgREST builder: records every call and answers by table and kind of operation. */
function fakeAdmin(answers: Partial<Record<`${string}:${Op}`, Result | (() => never)>> = {}) {
  const log: Array<{ table: string; op: Op; calls: Call[] }> = [];
  const admin = {
    from(table: string) {
      const entry = { table, op: "select" as Op, calls: [] as Call[] };
      log.push(entry);
      const proxy: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, method: string) {
            if (method === "then") {
              return (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => {
                const answer = answers[`${table}:${entry.op}`] ?? { data: [], error: null };
                if (typeof answer === "function") {
                  try {
                    answer();
                  } catch (error) {
                    return reject(error);
                  }
                }
                return resolve(answer as Result);
              };
            }
            return (...args: unknown[]) => {
              if (method === "insert" || method === "update" || method === "delete") entry.op = method;
              entry.calls.push([method, ...args]);
              return proxy;
            };
          },
        },
      );
      return proxy;
    },
  } as unknown as SupabaseClient;
  return { admin, log };
}

const store = (answers?: Parameters<typeof fakeAdmin>[0]) => {
  const fake = fakeAdmin(answers);
  return { ...fake, store: createSupabaseWeeklyPushStore(fake.admin) };
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.loadWeeklyHomeFact.mockReset().mockResolvedValue({ weekStart: "2026-10-11", card: true });
  mocks.loadOfflinePeriods.mockReset().mockResolvedValue([]);
});

describe("listCandidates", () => {
  it("reads the weekly-cycle profiles in id order, then their preferences in one read, with allow-listed columns", async () => {
    const { store: s, log } = store({
      "profiles:select": { data: [{ user_id: USER, language: "he", timezone: "Asia/Jerusalem", lifecycle_state: "WEEKLY_CYCLE" }], error: null },
      "user_preferences:select": { data: [{ user_id: USER, notifications: { weekly_summary: true, coach: false }, quiet_hours_start: "00:00:00", quiet_hours_end: "08:00:00" }], error: null },
    });
    const rows = await s.listCandidates(null, 50);
    expect(rows).toEqual([
      { userId: USER, language: "he", timeZone: "Asia/Jerusalem", lifecycle: "WEEKLY_CYCLE", preferenceOn: true, quietHours: { kind: "WINDOW", startMinute: 0, endMinute: 480 } },
    ]);
    expect(log.map((l) => l.table)).toEqual(["profiles", "user_preferences"]);
    expect(log[0].calls).toEqual([["select", PROFILE_COLUMNS], ["eq", "lifecycle_state", "WEEKLY_CYCLE"], ["order", "user_id"], ["limit", 50]]);
    expect(log[1].calls).toEqual([["select", PREFERENCE_COLUMNS], ["in", "user_id", [USER]]]);
    expect(PROFILE_COLUMNS).toBe("user_id, language, timezone, lifecycle_state");
  });

  it("pages with a keyset cursor only when it has one", async () => {
    const first = store();
    await first.store.listCandidates(null, 10);
    expect(first.log[0].calls.map((c) => c[0])).not.toContain("gt");
    const next = store();
    await next.store.listCandidates("u7", 10);
    expect(next.log[0].calls).toContainEqual(["gt", "user_id", "u7"]);
  });

  it("reads a missing or malformed preference as unknown, and a missing preferences row as unknown quiet hours", async () => {
    const { store: s } = store({
      "profiles:select": {
        data: [
          { user_id: "a", language: "he", timezone: "x", lifecycle_state: "WEEKLY_CYCLE" },
          { user_id: "b", language: "en", timezone: "x", lifecycle_state: "WEEKLY_CYCLE" },
          { user_id: "c", language: "he", timezone: "x", lifecycle_state: "WEEKLY_CYCLE" },
        ],
        error: null,
      },
      "user_preferences:select": {
        data: [
          { user_id: "a", notifications: { weekly_summary: "yes" }, quiet_hours_start: null, quiet_hours_end: null },
          { user_id: "b", notifications: { weekly_summary: false }, quiet_hours_start: "22:00", quiet_hours_end: null },
        ],
        error: null,
      },
    });
    const rows = await s.listCandidates(null, 50);
    expect(rows.map((r) => [r.userId, r.preferenceOn, r.quietHours])).toEqual([
      ["a", null, { kind: "NONE" }],
      ["b", false, null],
      ["c", null, null],
    ]);
  });

  it("returns nothing, and asks for no preferences, when there are no profiles", async () => {
    const { store: s, log } = store({ "profiles:select": { data: [], error: null } });
    expect(await s.listCandidates(null, 50)).toEqual([]);
    expect(log.map((l) => l.table)).toEqual(["profiles"]);
  });

  it.each([["profiles"], ["user_preferences"]])("throws a fixed phrase when the %s read fails", async (table) => {
    const answers = {
      "profiles:select": { data: [{ user_id: USER, language: "he", timezone: "x", lifecycle_state: "WEEKLY_CYCLE" }], error: null },
      "user_preferences:select": { data: [], error: null },
      [`${table}:select`]: { data: null, error: { code: "XX000", message: "secret detail" } },
    };
    await expect(store(answers).store.listCandidates(null, 10)).rejects.toThrow(/^candidates_failed$/);
  });
});

describe("loadFact and loadSendFacts", () => {
  it("asks the Home loader with the service client, the person, their zone and the instant", async () => {
    const { store: s, admin } = store();
    expect(await s.loadFact(USER, "Asia/Jerusalem", NOW)).toEqual({ weekStart: "2026-10-11", card: true });
    expect(mocks.loadWeeklyHomeFact).toHaveBeenCalledWith(admin, USER, { timeZone: "Asia/Jerusalem", now: NOW });
  });

  it("reads the periods, the subscriptions and the claim for that one person and week", async () => {
    const { store: s, log } = store({
      "push_subscriptions:select": { data: [SUB, { endpoint: "", p256dh: "k", auth: "a" }, { endpoint: "https://x", p256dh: 5, auth: "a" }], error: null },
      "notification_log:select": { data: [{ id: "row" }], error: null },
    });
    const facts = await s.loadSendFacts(USER, { weekStart: "2026-10-11", card: true }, NOW);
    expect(facts).toEqual({ periods: [], subscriptions: [SUB], claim: "exists" });
    expect(mocks.loadOfflinePeriods).toHaveBeenCalledWith(expect.anything(), USER, NOW);
    const subs = log.find((l) => l.table === "push_subscriptions");
    expect(subs?.calls).toEqual([["select", SUBSCRIPTION_COLUMNS], ["eq", "user_id", USER], ["order", "created_at"], ["limit", 20]]);
    const claim = log.find((l) => l.table === "notification_log");
    expect(claim?.calls).toEqual([["select", "id"], ["eq", "user_id", USER], ["eq", "kind", "weekly_summary"], ["eq", "moment_key", MOMENT], ["limit", 1]]);
  });

  it("says none when no claim exists, and unknown when a read fails", async () => {
    const none = await store({ "push_subscriptions:select": { data: [SUB], error: null }, "notification_log:select": { data: [], error: null } }).store.loadSendFacts(USER, { weekStart: "2026-10-11", card: true }, NOW);
    expect(none).toMatchObject({ subscriptions: [SUB], claim: "none" });

    const broken = await store({
      "push_subscriptions:select": { data: null, error: { code: "XX000" } },
      "notification_log:select": { data: null, error: { code: "XX000" } },
    }).store.loadSendFacts(USER, { weekStart: "2026-10-11", card: true }, NOW);
    expect(broken).toMatchObject({ subscriptions: null, claim: "unknown" });
  });

  it.each([["PGRST204"], ["42703"]])("says migration_missing for the missing-column code %s", async (code) => {
    const facts = await store({ "notification_log:select": { data: null, error: { code } } }).store.loadSendFacts(USER, { weekStart: "2026-10-11", card: true }, NOW);
    expect(facts.claim).toBe("migration_missing");
  });

  it("never throws when a read throws", async () => {
    const facts = await store({
      "push_subscriptions:select": () => {
        throw new Error("network");
      },
      "notification_log:select": () => {
        throw new Error("network");
      },
    }).store.loadSendFacts(USER, { weekStart: "2026-10-11", card: true }, NOW);
    expect(facts).toMatchObject({ subscriptions: null, claim: "unknown" });
  });
});

describe("claim", () => {
  it("inserts one pending row for the web push channel with the instant it was given", async () => {
    const { store: s, log } = store({ "notification_log:insert": { data: null, error: null } });
    expect(await s.claim(USER, MOMENT, NOW)).toBe("claimed");
    expect(log[0].calls).toEqual([
      ["insert", { user_id: USER, channel: "web_push", kind: "weekly_summary", moment_key: MOMENT, suppressed_reason: "pending", sent_at: "2026-10-18T05:05:00.000Z" }],
    ]);
  });

  it("says already_claimed on a unique violation (the second of two ticks), not failed", async () => {
    expect(await store({ "notification_log:insert": { data: null, error: { code: "23505" } } }).store.claim(USER, MOMENT, NOW)).toBe("already_claimed");
  });

  it.each([["PGRST204"], ["42703"]])("says migration_missing for %s", async (code) => {
    expect(await store({ "notification_log:insert": { data: null, error: { code } } }).store.claim(USER, MOMENT, NOW)).toBe("migration_missing");
  });

  it("says failed for any other error or a throw, and never throws", async () => {
    expect(await store({ "notification_log:insert": { data: null, error: { code: "XX000" } } }).store.claim(USER, MOMENT, NOW)).toBe("failed");
    expect(
      await store({
        "notification_log:insert": () => {
          throw new Error("network");
        },
      }).store.claim(USER, MOMENT, NOW),
    ).toBe("failed");
  });
});

describe("finish, deleteSubscription, markSubscriptionSuccess", () => {
  it.each([
    ["sent", null],
    ["send_failed", "send_failed"],
    ["subscription_gone", "subscription_gone"],
  ] as const)("ends a claim as %s: the reason column becomes %j, for exactly that user, kind and moment", async (state, reason) => {
    const { store: s, log } = store({ "notification_log:update": { data: [{ id: "row" }], error: null } });
    expect(await s.finish(USER, MOMENT, state, NOW)).toBe(true);
    expect(log[0].calls).toEqual([
      ["update", { suppressed_reason: reason, sent_at: "2026-10-18T05:05:00.000Z" }],
      ["eq", "user_id", USER],
      ["eq", "kind", "weekly_summary"],
      ["eq", "moment_key", MOMENT],
      ["select", "id"],
    ]);
  });

  it("is false when no row, or more than one, was updated, or on an error", async () => {
    expect(await store({ "notification_log:update": { data: [], error: null } }).store.finish(USER, MOMENT, "sent", NOW)).toBe(false);
    expect(await store({ "notification_log:update": { data: [{}, {}], error: null } }).store.finish(USER, MOMENT, "sent", NOW)).toBe(false);
    expect(await store({ "notification_log:update": { data: null, error: { code: "XX000" } } }).store.finish(USER, MOMENT, "sent", NOW)).toBe(false);
  });

  it("deletes by user, endpoint AND both keys, so a subscription the browser just saved again with new keys survives", async () => {
    const { store: s, log } = store({ "push_subscriptions:delete": { data: null, error: null } });
    expect(await s.deleteSubscription(USER, SUB)).toBe(true);
    expect(log[0].calls).toEqual([["delete"], ["eq", "user_id", USER], ["eq", "endpoint", SUB.endpoint], ["eq", "p256dh", SUB.p256dh], ["eq", "auth", SUB.auth]]);
  });

  it("stamps last_success_at on the same four-field match", async () => {
    const { store: s, log } = store({ "push_subscriptions:update": { data: null, error: null } });
    expect(await s.markSubscriptionSuccess(USER, SUB, NOW)).toBe(true);
    expect(log[0].calls).toEqual([
      ["update", { last_success_at: "2026-10-18T05:05:00.000Z" }],
      ["eq", "user_id", USER],
      ["eq", "endpoint", SUB.endpoint],
      ["eq", "p256dh", SUB.p256dh],
      ["eq", "auth", SUB.auth],
    ]);
  });

  it("answers false on an error and never throws, for the three writes", async () => {
    const boom = () => {
      throw new Error("network");
    };
    expect(await store({ "push_subscriptions:delete": { data: null, error: { code: "XX000" } } }).store.deleteSubscription(USER, SUB)).toBe(false);
    expect(await store({ "push_subscriptions:update": { data: null, error: { code: "XX000" } } }).store.markSubscriptionSuccess(USER, SUB, NOW)).toBe(false);
    expect(await store({ "push_subscriptions:delete": boom }).store.deleteSubscription(USER, SUB)).toBe(false);
    expect(await store({ "push_subscriptions:update": boom }).store.markSubscriptionSuccess(USER, SUB, NOW)).toBe(false);
    expect(await store({ "notification_log:update": boom }).store.finish(USER, MOMENT, "sent", NOW)).toBe(false);
  });

  it("logs no user id, endpoint or key when a write fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await store({ "push_subscriptions:delete": { data: null, error: { code: "XX000", message: `bad ${SUB.endpoint} ${SUB.auth}` } } }).store.deleteSubscription(USER, SUB);
    await store({ "notification_log:insert": { data: null, error: { code: "XX000", message: `bad ${USER}` } } }).store.claim(USER, MOMENT, NOW);
    const logged = JSON.stringify(errors.mock.calls);
    for (const secret of [USER, SUB.endpoint, SUB.p256dh, SUB.auth]) expect(logged).not.toContain(secret);
  });
});

describe("what the sender's files may touch (a source scan, like the read paths of Home)", () => {
  const dir = join(process.cwd(), "src", "lib", "notify");
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => [f, readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")] as const);
  const all = sources.map(([, text]) => text).join("\n");

  it("names only the four tables it needs", () => {
    const tables = [...new Set([...all.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]))].sort();
    expect(tables).toEqual(["notification_log", "profiles", "push_subscriptions", "user_preferences"]);
  });

  it("writes to exactly two tables, and only with the calls it needs: one insert, two updates, one delete", () => {
    expect(all).not.toMatch(/\.(upsert|rpc)\s*\(/);
    const writes = [...all.matchAll(/\.from\("([a-z_]+)"\)\s*\.(insert|update|delete)\(/g)].map((m) => `${m[1]}:${m[2]}`).sort();
    expect(writes).toEqual(["notification_log:insert", "notification_log:update", "push_subscriptions:delete", "push_subscriptions:update"]);
    expect((all.match(/\.(insert|update|delete)\s*\(/g) ?? []).length).toBe(4);
  });

  it("calls neither the AI nor the analytics, and never imports the browser's Supabase client", () => {
    expect(all).not.toMatch(/@\/lib\/ai/);
    expect(all).not.toMatch(/\btrack\(/);
    expect(all).not.toMatch(/@\/lib\/supabase\/(server|client)/);
  });
});
