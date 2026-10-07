import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeNotificationProvider } from "@/lib/notifications/fake";
import type { WeeklyPushSummary } from "@/lib/notify/runWeeklyPush";
import * as route from "./route";

const { POST } = route;

const SECRET = "s3cret-for-tests";
const URL_BASE = "https://example.test/api/engine/notify";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createSupabaseWeeklyPushStore: vi.fn(),
  runWeeklyPush: vi.fn(),
  createNotificationProvider: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notify/weeklyPushStore", () => ({ createSupabaseWeeklyPushStore: mocks.createSupabaseWeeklyPushStore }));
vi.mock("@/lib/notify/runWeeklyPush", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notify/runWeeklyPush")>();
  return { ...actual, runWeeklyPush: mocks.runWeeklyPush };
});
vi.mock("@/lib/notifications/factory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/factory")>();
  return { ...actual, createNotificationProvider: mocks.createNotificationProvider };
});

const clean: WeeklyPushSummary = {
  candidates: 1,
  due: 0,
  sent: 0,
  notSent: 0,
  subscriptionsDeleted: 0,
  results: { ok: 0, gone: 0, rejected: 0, retryable: 0, providerThrew: 0 },
  skipped: 1,
  skippedBy: { no_moment: 1 },
  failed: 0,
  stuck: 0,
  migrationPending: 0,
  dryRun: true,
  aborted: null,
};

const post = (authorization?: string, query = "") =>
  new Request(`${URL_BASE}${query}`, { method: "POST", headers: authorization ? { authorization } : {} });

const authed = (query = "") => post(`Bearer ${SECRET}`, query);

async function call(request: Request) {
  const response = await POST(request);
  return { response, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.createAdminClient.mockReset().mockReturnValue({ fake: "admin" });
  mocks.createSupabaseWeeklyPushStore.mockReset().mockReturnValue({ fake: "store" });
  mocks.runWeeklyPush.mockReset().mockImplementation(async (_store, provider) => ({ ...clean, dryRun: provider === null }));
  mocks.createNotificationProvider.mockReset().mockReturnValue(new FakeNotificationProvider());
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("NOTIFY_SENDER_LIVE", "");
});

describe("POST /api/engine/notify: who may call it", () => {
  it("answers 503 when no secret is configured, before anything else", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const { response, body } = await call(authed());
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "cron_not_configured" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.runWeeklyPush).not.toHaveBeenCalled();
  });

  it.each([
    ["no header", undefined],
    ["a wrong secret", "Bearer nope"],
    ["a wrong secret of the same length", `Bearer ${SECRET.slice(0, -1)}x`],
    ["a different scheme", `Basic ${SECRET}`],
    ["the bare secret", SECRET],
  ])("answers 401 for %s, and never builds a client, a provider or runs", async (_label, header) => {
    const { response, body } = await call(post(header));
    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "unauthorized" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createSupabaseWeeklyPushStore).not.toHaveBeenCalled();
    expect(mocks.createNotificationProvider).not.toHaveBeenCalled();
    expect(mocks.runWeeklyPush).not.toHaveBeenCalled();
  });

  it("exports POST only, with the Node runtime, no caching and a 30 s limit", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "dynamic", "maxDuration", "runtime"]);
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(30);
  });
});

describe("POST /api/engine/notify: it fails closed", () => {
  it("is a dry run by default: no provider is even built, and the runner is told not to send", async () => {
    const { response, body } = await call(authed());
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, mode: "dry", dryRun: true });
    expect(mocks.createNotificationProvider).not.toHaveBeenCalled();
    expect(mocks.runWeeklyPush).toHaveBeenCalledTimes(1);
    const [store, provider, options] = mocks.runWeeklyPush.mock.calls[0];
    expect(store).toEqual({ fake: "store" });
    expect(provider).toBeNull();
    expect(options.live).toBe(false);
  });

  it.each([["true"], ["yes"], ["0"], [" 1"], ["1 "], ["on"], [""]])("is still a dry run when NOTIFY_SENDER_LIVE is %j (only exactly 1 turns sending on)", async (value) => {
    vi.stubEnv("NOTIFY_SENDER_LIVE", value);
    const { body } = await call(authed());
    expect(body).toMatchObject({ mode: "dry" });
    expect(mocks.createNotificationProvider).not.toHaveBeenCalled();
    expect(mocks.runWeeklyPush.mock.calls[0][2].live).toBe(false);
  });

  it("sends only with NOTIFY_SENDER_LIVE=1 and a provider", async () => {
    vi.stubEnv("NOTIFY_SENDER_LIVE", "1");
    const provider = new FakeNotificationProvider();
    mocks.createNotificationProvider.mockReturnValue(provider);
    const { response, body } = await call(authed());
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ mode: "live", dryRun: false });
    expect(mocks.runWeeklyPush.mock.calls[0][1]).toBe(provider);
    expect(mocks.runWeeklyPush.mock.calls[0][2].live).toBe(true);
  });

  it("lets ?dryRun=1 lower a live setting to a dry run, and builds no provider", async () => {
    vi.stubEnv("NOTIFY_SENDER_LIVE", "1");
    const { body } = await call(authed("?dryRun=1"));
    expect(body).toMatchObject({ mode: "dry" });
    expect(mocks.createNotificationProvider).not.toHaveBeenCalled();
    expect(mocks.runWeeklyPush.mock.calls[0][2].live).toBe(false);
  });

  it("never lets the query raise the mode: ?dryRun=0 and ?live=1 do not turn sending on", async () => {
    for (const query of ["?dryRun=0", "?live=1", "?dryRun=false&live=true"]) {
      mocks.runWeeklyPush.mockClear();
      const { body } = await call(authed(query));
      expect(body, query).toMatchObject({ mode: "dry" });
      expect(mocks.runWeeklyPush.mock.calls[0][2].live, query).toBe(false);
    }
  });

  it("answers 503 and runs nothing when sending is switched on but no provider can be built", async () => {
    vi.stubEnv("NOTIFY_SENDER_LIVE", "1");
    mocks.createNotificationProvider.mockReturnValue(null);
    const { response, body } = await call(authed());
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "provider_not_configured" });
    expect(mocks.runWeeklyPush).not.toHaveBeenCalled();
  });

  it("refuses the fake provider in production: PUSH_PROVIDER=fake there is no provider at all, so a live request is a 503", async () => {
    const actual = await vi.importActual<typeof import("@/lib/notifications/factory")>("@/lib/notifications/factory");
    mocks.createNotificationProvider.mockImplementation(actual.createNotificationProvider);
    vi.stubEnv("NOTIFY_SENDER_LIVE", "1");
    vi.stubEnv("PUSH_PROVIDER", "fake");
    vi.stubEnv("NODE_ENV", "production");
    const { response, body } = await call(authed());
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "provider_not_configured" });
    expect(mocks.runWeeklyPush).not.toHaveBeenCalled();
  });

  it("takes nothing but the clock from the request: no user, text, hour or kind", async () => {
    await call(authed("?userId=00000000-0000-4000-8000-000000000000&text=hello&kind=coach&now=2020-01-01T00:00:00Z&week=2026-10-11"));
    const options = mocks.runWeeklyPush.mock.calls[0][2];
    expect(Object.keys(options).sort()).toEqual(["live", "now"]);
    expect(options.now).toBeInstanceOf(Date);
    expect(Math.abs(options.now.getTime() - Date.now())).toBeLessThan(60_000);
  });
});

describe("POST /api/engine/notify: what it answers", () => {
  it("answers 503 when the admin client cannot be built, and runs nothing", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("no key");
    });
    const { response, body } = await call(authed());
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "admin_not_configured" });
    expect(mocks.runWeeklyPush).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<WeeklyPushSummary>, number, boolean]>([
    ["a quiet, ordinary run", {}, 200, true],
    ["a person whose facts could not be read", { failed: 1 }, 500, false],
    ["a stuck claim", { stuck: 1 }, 500, false],
    ["a push no device accepted", { notSent: 1 }, 500, false],
    ["a run that hit its deadline", { aborted: "deadline" }, 500, false],
    ["a run that could not read the people", { aborted: "candidates_failed" }, 503, false],
    ["a live run before the migration is applied", { aborted: "migration_missing" }, 503, false],
    ["a dry run that counted the missing migration", { migrationPending: 1 }, 200, true],
  ])("answers for %s", async (_label, over, status, ok) => {
    mocks.runWeeklyPush.mockResolvedValue({ ...clean, ...over });
    const { response, body } = await call(authed());
    expect(response.status).toBe(status);
    expect(body.ok).toBe(ok);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("carries counts only: the summary and three fixed fields, and nothing else", async () => {
    const { body } = await call(authed());
    expect(Object.keys(body).sort()).toEqual(["ok", "ranAt", "mode", ...Object.keys(clean)].sort());
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("answers 500 with a fixed phrase, and logs nothing identifying, when the runner throws", async () => {
    mocks.runWeeklyPush.mockRejectedValue(new Error("secret detail with user 11111111-1111-4111-8111-111111111111"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { response, body } = await call(authed());
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "notify_failed" });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("11111111");
  });
});
