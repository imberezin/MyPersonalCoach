import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TopupSummary } from "@/lib/jobs/shabbatTopup";
import * as route from "./route";

const { POST } = route;

const SECRET = "s3cret-for-tests";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const URL_BASE = "https://example.test/api/engine/shabbat-topup";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createSupabaseTopupStore: vi.fn(),
  runShabbatTopup: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/jobs/shabbatTopupStore", () => ({ createSupabaseTopupStore: mocks.createSupabaseTopupStore }));
vi.mock("@/lib/jobs/shabbatTopup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs/shabbatTopup")>();
  return { ...actual, runShabbatTopup: mocks.runShabbatTopup };
});

const clean: TopupSummary = {
  candidates: 1,
  usersAdded: 0,
  rowsPlanned: 0,
  rowsInserted: 0,
  current: 1,
  skipped: 0,
  skippedBy: {},
  failed: 0,
  dryRun: false,
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
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.createAdminClient.mockReset().mockReturnValue({ fake: "admin" });
  mocks.createSupabaseTopupStore.mockReset().mockReturnValue({ fake: "store" });
  mocks.runShabbatTopup.mockReset().mockResolvedValue(clean);
  vi.stubEnv("CRON_SECRET", SECRET);
});

describe("POST /api/engine/shabbat-topup: who may call it", () => {
  it("answers 503 when no secret is configured, before anything else", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const { response, body } = await call(authed());
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "cron_not_configured" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.runShabbatTopup).not.toHaveBeenCalled();
  });

  it.each([
    ["no header", undefined],
    ["a wrong secret", "Bearer nope"],
    ["a wrong secret of the same length", `Bearer ${SECRET.slice(0, -1)}x`],
    ["a different scheme", `Basic ${SECRET}`],
    ["the bare secret", SECRET],
  ])("answers 401 for %s, and never builds the client or runs the job", async (_label, header) => {
    const { response, body } = await call(post(header));
    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "unauthorized" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createSupabaseTopupStore).not.toHaveBeenCalled();
    expect(mocks.runShabbatTopup).not.toHaveBeenCalled();
  });

  it("exports no GET (or any other method): Next answers 405", () => {
    expect(Object.keys(route).filter((key) => /^(GET|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(key))).toEqual([]);
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(30);
  });
});

describe("POST /api/engine/shabbat-topup: a run", () => {
  it("answers 200 ok:true with the counts for a clean run, and passes the real clock", async () => {
    const { response, body } = await call(authed());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ ok: true, ...clean });
    expect(typeof body.ranAt).toBe("string");
    expect(mocks.createSupabaseTopupStore).toHaveBeenCalledWith({ fake: "admin" });
    expect(mocks.runShabbatTopup).toHaveBeenCalledWith({ fake: "store" }, { now: expect.any(Date), dryRun: false });
  });

  it("is a dry run only for ?dryRun=1", async () => {
    await call(authed("?dryRun=1"));
    expect(mocks.runShabbatTopup).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ dryRun: true }));
    for (const query of ["", "?dryRun=0", "?dryRun=true", "?dryrun=1", "?dryRun="]) {
      await call(authed(query));
      expect(mocks.runShabbatTopup).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ dryRun: false }));
    }
  });

  it("answers 200 when the only skips are users who do not observe Shabbat", async () => {
    mocks.runShabbatTopup.mockResolvedValue({ ...clean, skipped: 2, skippedBy: { not_observing: 2 } });
    const { response, body } = await call(authed());
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it.each([
    ["a failed user", { failed: 1 }, 500],
    ["the deadline", { aborted: "deadline" }, 500],
    ["the user cap", { aborted: "user_cap" }, 500],
    ["stale rows", { skipped: 1, skippedBy: { stale_rows: 1 } }, 500],
    ["bad minutes", { skipped: 1, skippedBy: { bad_minutes: 1 } }, 500],
    ["no place", { skipped: 1, skippedBy: { no_place: 1 } }, 500],
    ["an unknown place", { skipped: 1, skippedBy: { unknown_place: 1 } }, 500],
    ["a failed calculation", { skipped: 1, skippedBy: { calc_failed: 1 } }, 500],
    ["a missing function", { aborted: "rpc_missing", failed: 1 }, 503],
    ["unreadable users", { aborted: "candidates_failed" }, 503],
  ] as const)("answers ok:false and never 200 for %s", async (_label, over, status) => {
    mocks.runShabbatTopup.mockResolvedValue({ ...clean, ...over });
    const { response, body } = await call(authed());
    expect(response.status).toBe(status);
    expect(body.ok).toBe(false);
    // The counts are still in the body.
    expect(body).toHaveProperty("candidates", 1);
  });
});

describe("POST /api/engine/shabbat-topup: failures", () => {
  it("answers 503 admin_not_configured when the service client cannot be built, without running", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SECRET_KEY missing for " + USER_ID);
    });
    const { response, body } = await call(authed());
    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "admin_not_configured" });
    expect(mocks.runShabbatTopup).not.toHaveBeenCalled();
  });

  it("answers 500 topup_failed with no details when the runner throws", async () => {
    mocks.runShabbatTopup.mockRejectedValue(new Error(`exploded for ${USER_ID}`));
    const { response, body } = await call(authed());
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "topup_failed" });
    expect(JSON.stringify([body, vi.mocked(console.error).mock.calls])).not.toContain(USER_ID);
  });

  it("never puts a user id or a place in the body", async () => {
    mocks.runShabbatTopup.mockResolvedValue({ ...clean, failed: 1, skipped: 1, skippedBy: { stale_rows: 1 } });
    const { body } = await call(authed());
    const text = JSON.stringify(body);
    expect(text).not.toContain(USER_ID);
    expect(text).not.toMatch(/jerusalem|place_key|latitude|longitude/i);
  });
});
