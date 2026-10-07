import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_RESULTS, FakeNotificationProvider } from "@/lib/notifications/fake";
import { createMemoryWeeklyPushStore } from "@/lib/notify/memoryStore";
import { runWeeklyPush, weeklyPushNeedsAttention } from "@/lib/notify/runWeeklyPush";
import { zonedInstantUtc } from "@/domain/time";
import { addDaysToDayKey, parseDayKey } from "@/domain/weight/trend";
import { DEFAULT_BASE_URL, assertLocalStack, isLocalBaseUrl, parseRehearseWeeklyArgs } from "../../scripts/rehearse-weekly-push/guards";
import { BEHAVIORS, clock, runRehearsal, type Behavior, type LogRow, type RehearsalWorld } from "../../scripts/rehearse-weekly-push/rehearse";

const U1 = "11111111-1111-4111-8111-111111111111";
const TZ = "Asia/Jerusalem";
const SUNDAY = "2026-09-27";
const WEEK = "2026-09-20";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("parseRehearseWeeklyArgs", () => {
  it("defaults to the ok behavior, the dev server on 3010 and the demo user", () => {
    expect(parseRehearseWeeklyArgs(undefined)).toEqual({ ok: true, value: { behavior: "ok", baseUrl: DEFAULT_BASE_URL, email: "demo@eating-coach.test" } });
    expect(parseRehearseWeeklyArgs("{}")).toMatchObject({ ok: true });
  });

  it("reads each behavior, a local base url and a throwaway email", () => {
    for (const behavior of BEHAVIORS) expect(parseRehearseWeeklyArgs(JSON.stringify({ behavior }))).toMatchObject({ ok: true, value: { behavior } });
    expect(parseRehearseWeeklyArgs(JSON.stringify({ "base-url": "http://127.0.0.1:3011/", email: "Other.User@eating-coach.test" }))).toEqual({
      ok: true,
      value: { behavior: "ok", baseUrl: "http://127.0.0.1:3011", email: "other.user@eating-coach.test" },
    });
  });

  it.each([
    ["an unknown flag", { behaviour: "ok" }],
    ["an unknown behavior", { behavior: "explode" }],
    ["a behavior without a value", { behavior: true }],
    ["the hosted site as the base url", { "base-url": "https://my-personal-coach-delta.vercel.app" }],
    ["a look-alike host", { "base-url": "http://localhost.evil.test:3010" }],
    ["a base url without a value", { "base-url": true }],
    ["a real e-mail address", { email: "someone@example.com" }],
    ["an e-mail on a longer test domain", { email: "x@eating-coach.test.evil.com" }],
    ["an e-mail flag without a value", { email: true }],
  ])("refuses %s", (_label, flags) => {
    expect(parseRehearseWeeklyArgs(JSON.stringify(flags))).toMatchObject({ ok: false });
  });

  it("refuses text that is not JSON, and a list", () => {
    expect(parseRehearseWeeklyArgs("{nope")).toMatchObject({ ok: false });
    expect(parseRehearseWeeklyArgs("[]")).toMatchObject({ ok: false });
  });
});

describe("the local-only guards", () => {
  it("accepts a dev server on this machine only", () => {
    for (const url of ["http://localhost:3010", "http://127.0.0.1:3010", "http://[::1]:3010", "https://localhost:3010"]) expect(isLocalBaseUrl(url), url).toBe(true);
    for (const url of ["https://example.com", "http://192.168.1.5:3010", "http://localhost.evil.test", "ftp://localhost", "not a url", ""]) expect(isLocalBaseUrl(url), url).toBe(false);
  });

  it("accepts the local Supabase and nothing else, and never in production", () => {
    expect(assertLocalStack({ apiUrl: "http://127.0.0.1:54321", nodeEnv: "development" })).toEqual({ ok: true });
    expect(assertLocalStack({ apiUrl: "http://localhost:54321", nodeEnv: undefined })).toEqual({ ok: true });
    expect(assertLocalStack({ apiUrl: "https://abcdefgh.supabase.co", nodeEnv: "development" })).toEqual({ ok: false, reason: "not_local_stack" });
    expect(assertLocalStack({ apiUrl: undefined, nodeEnv: "development" })).toEqual({ ok: false, reason: "not_local_stack" });
    expect(assertLocalStack({ apiUrl: "http://127.0.0.1:54321", nodeEnv: "production" })).toEqual({ ok: false, reason: "production" });
  });

  it("the real world checks the stack is local BEFORE it builds a client, writes only for the one user, and prints no key", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "rehearse-weekly-push", "world.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source.indexOf("assertLocalStack(")).toBeGreaterThan(-1);
    expect(source.indexOf("assertLocalStack(")).toBeLessThan(source.indexOf("createClient(apiUrl"));
    // Every write is scoped by the one user: an insert carries user_id, and a delete or an update filters on it.
    const statements = source.split(/;\s*\n/).filter((s) => /\.(insert|update|delete)\(/.test(s));
    expect(statements.length).toBeGreaterThanOrEqual(6);
    for (const statement of statements) {
      const scoped = /\.eq\("user_id", userId\)/.test(statement) || /user_id: userId/.test(statement);
      expect(scoped, statement.trim().slice(0, 90)).toBe(true);
    }
    expect(source).not.toMatch(/\.rpc\(/);
    expect(source).not.toMatch(/(console\.log|write)\([^)]*(key|secret)/i);
  });
});

/**
 * An in-memory stand-in for the local stack and the route: the REAL runner on the in-memory store, with the dev clock the rehearsal sets,
 * and the route's own status rule. It makes the rehearsal's expectations testable without Docker: if they pass here for every behavior,
 * they describe what the runner really does; the live run then checks the same things against the real Postgres.
 */
function memoryWorld(behavior: Behavior, over: { ignoreClock?: boolean; provider?: FakeNotificationProvider } = {}) {
  const make = () => ({ opened: false, offline: [] as Array<[Date, Date]> });
  let state = make();
  let now = zonedInstantUtc(2026, 9, 27, 9, 0, TZ);

  const candidate = { userId: U1, language: "he", timeZone: TZ, lifecycle: "WEEKLY_CYCLE" as const, preferenceOn: true as boolean | null, quietHours: { kind: "WINDOW" as const, startMinute: 0, endMinute: 480 } };
  const sub = (n: number) => ({ endpoint: `https://fake-push.example.test/${n}`, p256dh: "p", auth: "a" });
  let serial = 0;

  const windowStart = () => zonedInstantUtc(2026, 9, 27, 5, 0, TZ);
  const windowEnd = () => zonedInstantUtc(2026, 9, 30, 5, 0, TZ); // Wednesday 05:00

  const mem = createMemoryWeeklyPushStore([
    {
      candidate,
      fact: () => (now >= windowStart() && now < windowEnd() ? { weekStart: WEEK, card: !state.opened } : null),
      get periods() {
        return state.offline.map(([start, end]) => ({ type: "USER_DEFINED" as const, start, end }));
      },
      subscriptions: [sub(0)],
    },
  ]);
  const provider =
    over.provider ??
    new FakeNotificationProvider(() => (behavior === "gone" ? FAKE_RESULTS.gone(410) : behavior === "rejected" ? FAKE_RESULTS.rejected(403) : behavior === "retryable" ? FAKE_RESULTS.retryable(503) : FAKE_RESULTS.ok()));

  const world: RehearsalWorld = {
    timeZone: TZ,
    sunday: SUNDAY,
    setClock(instant) {
      now = instant;
    },
    async callRoute(query = "") {
      const live = !query.includes("dryRun=1");
      const summary = await runWeeklyPush(mem.store, live ? provider : null, { now: over.ignoreClock ? zonedInstantUtc(2026, 9, 27, 8, 5, TZ) : now, live });
      const down = summary.aborted === "candidates_failed" || summary.aborted === "migration_missing";
      const attention = down || weeklyPushNeedsAttention(summary);
      return { status: down ? 503 : attention ? 500 : 200, body: { ok: !attention, mode: summary.dryRun ? "dry" : "live", ...summary } };
    },
    async reset() {
      state = make();
      mem.claims.clear();
      candidate.preferenceOn = true;
      serial += 1;
      mem.subscriptions.set(U1, [sub(serial)]);
    },
    async openCard() {
      state.opened = true;
    },
    async coverWithOffline(from, to) {
      state.offline.push([from, to]);
    },
    async setPreference(on) {
      candidate.preferenceOn = on;
    },
    async readLog(): Promise<LogRow[]> {
      return [...mem.claims.entries()].map(([key, value]) => ({ kind: "weekly_summary", momentKey: key.split("|")[1], reason: value.reason }));
    },
    async subscriptionCount() {
      return (mem.subscriptions.get(U1) ?? []).length;
    },
  };
  return { world, provider };
}

describe("the rehearsal timeline", () => {
  it.each(BEHAVIORS)("passes every check against the real runner when the push service answers %s", async (behavior) => {
    const { world } = memoryWorld(behavior);
    const lines: string[] = [];
    const checks = await runRehearsal(world, behavior, (line) => lines.push(line));
    const failed = checks.filter((c) => !c.ok).map((c) => `${c.step}: ${c.detail}`);
    expect(failed).toEqual([]);
    expect(checks.length).toBe(14);
    expect(lines).toHaveLength(14);
  });

  it("covers the quiet morning, the single send, the ticks after, the closed window, the overlap, the opened card, Offline, the preference and the dry run", async () => {
    const { world } = memoryWorld("ok");
    const steps = (await runRehearsal(world, "ok", () => {})).map((c) => c.step);
    expect(steps).toEqual([
      "06:00, quiet hours",
      "06:00, nothing claimed",
      "08:05, the push service answers ok",
      "08:05, one claim, closed by that answer",
      "08:05, the subscription",
      "08:10, no second push",
      "Monday 09:00, no second push",
      "after the ticks, still one claim",
      "Wednesday 05:01, the window is closed",
      "two overlapping ticks, one push",
      "the card was opened first",
      "an Offline period covers the moment",
      "the preference is off",
      "?dryRun=1 counts and writes nothing",
    ]);
  });

  it("uses the instants of the rehearsal Sunday: 06:00, 08:05, 08:10, Monday 09:00 and Wednesday 05:01 local time", () => {
    const { world } = memoryWorld("ok");
    const local = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    expect([clock.quiet(world), clock.send(world), clock.later(world), clock.monday(world), clock.closed(world)].map(local)).toEqual(["Sun 06:00", "Sun 08:05", "Sun 08:10", "Mon 09:00", "Wed 05:01"]);
    const sunday = parseDayKey(SUNDAY);
    expect(sunday && new Date(Date.UTC(sunday.year, sunday.month - 1, sunday.day)).getUTCDay()).toBe(0);
    expect(addDaysToDayKey(SUNDAY, -7)).toBe(WEEK);
  });

  it("detects a world that is wrong: a route that ignores the clock fails the quiet-hours check", async () => {
    const { world } = memoryWorld("ok", { ignoreClock: true });
    const checks = await runRehearsal(world, "ok", () => {});
    const failed = checks.filter((c) => !c.ok).map((c) => c.step);
    expect(failed).toContain("06:00, quiet hours");
    expect(failed).toContain("06:00, nothing claimed");
  });

  it("detects a push service that answers differently from what the dev server was told to", async () => {
    const { world } = memoryWorld("ok");
    const checks = await runRehearsal(world, "gone", () => {});
    expect(checks.filter((c) => !c.ok).map((c) => c.step)).toEqual(expect.arrayContaining(["08:05, the push service answers gone", "08:05, the subscription"]));
  });

  it("detects a provider that is called more than once for one push", async () => {
    const calls = vi.fn();
    const provider = new FakeNotificationProvider(() => {
      calls();
      return FAKE_RESULTS.ok();
    });
    const { world } = memoryWorld("ok", { provider });
    const checks = await runRehearsal(world, "ok", () => {});
    expect(checks.every((c) => c.ok)).toBe(true);
    // One push per claim: the cases above claim exactly: 08:05, the overlap pair, and nothing else.
    expect(calls).toHaveBeenCalledTimes(2);
  });
});
