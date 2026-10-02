// What deleting a weight decides, with the gate, the repository, the clock and analytics mocked. Deleting is not
// reporting: if any code path asks about offline periods, the mock throws.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEIGHT_DELETE_FIELDS, WEIGHT_ROUTES } from "@/domain/weight";
import { deleteWeightAction } from "./actions";

const ID = "0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a10";
const TOKEN = "5f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const CURSOR = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const NOW = new Date("2026-09-16T06:00:00Z");

const mocks = vi.hoisted(() => ({
  actionContext: vi.fn(),
  deleteWeightEntry: vi.fn(),
  track: vi.fn(),
  logAppError: vi.fn(),
  revalidatePath: vi.fn(),
  currentInstant: vi.fn(),
  flow: { reportingEnabled: true, progressEnabled: true, milestoneMomentEnabled: true },
  // Deleting is not reporting: if any code path of the action ever asks about offline periods, this throws.
  loadOfflinePeriods: vi.fn(() => {
    throw new Error("OFFLINE_PERIODS_READ");
  }),
}));

// The real redirect() and notFound() throw to stop the render; the stand-ins do the same and say where to.
vi.mock("next/navigation", () => ({
  redirect: (to: string, type?: string) => {
    throw new Error(`REDIRECT:${to}:${type ?? "default"}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  RedirectType: { replace: "replace", push: "push" },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/app/(flow)/report/weight/_lib/gate", () => ({ openWeightActionContext: mocks.actionContext }));
vi.mock("@/lib/weight/repo", () => ({ deleteWeightEntry: mocks.deleteWeightEntry }));
vi.mock("@/lib/ai/ledger", () => ({ logAppError: mocks.logAppError }));
vi.mock("@/lib/analytics/track", () => ({ track: mocks.track, SupabaseEventsSink: class {} }));
vi.mock("@/lib/home/load", () => ({ loadOfflinePeriods: mocks.loadOfflinePeriods }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
vi.mock("@/domain/weight", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domain/weight")>();
  return { ...original, WEIGHT_FLOW: mocks.flow };
});

const supabase = { tag: "user-client" };
const ready = () => ({ kind: "ready", context: { kind: "ready", userId: "user-1", row: { lifecycle_state: "FIRST_WEEK", timezone: "Asia/Jerusalem" }, supabase } });

function deleteForm(fields: Record<string, string> = {}, id = ID): FormData {
  const data = new FormData();
  data.set(WEIGHT_DELETE_FIELDS.entryId, id);
  data.set(WEIGHT_DELETE_FIELDS.from, "list");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Both thrown kinds, as the text a test can match. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "RETURNED";
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN";
  }
}

const landing = (notice: "deleted" | "gone" | "error", after?: string) => `REDIRECT:${WEIGHT_ROUTES.withNotice(notice, { token: TOKEN, after })}:replace`;

beforeEach(() => {
  mocks.actionContext.mockReset().mockResolvedValue(ready());
  mocks.deleteWeightEntry.mockReset().mockResolvedValue({ ok: true, value: { deleted: true } });
  mocks.track.mockReset().mockResolvedValue(undefined);
  mocks.logAppError.mockReset().mockResolvedValue(undefined);
  mocks.revalidatePath.mockReset();
  mocks.flow.reportingEnabled = true;
  mocks.loadOfflinePeriods.mockClear();
  mocks.currentInstant.mockReset().mockReturnValue(NOW);
  vi.stubGlobal("crypto", { randomUUID: () => TOKEN });
  for (const method of ["log", "info", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deleteWeightAction", () => {
  describe("a weight that was deleted", () => {
    it("deletes it as the signed-in user, tells the world once with only where it started, and lands on the list by replace", async () => {
      await expect(outcome(() => deleteWeightAction(deleteForm()))).resolves.toBe(`REDIRECT:/me/weights?notice=deleted&n=${TOKEN}:replace`);
      expect(mocks.deleteWeightEntry).toHaveBeenCalledTimes(1);
      expect(mocks.deleteWeightEntry).toHaveBeenCalledWith(supabase, ID);
      expect(mocks.track).toHaveBeenCalledTimes(1);
    });

    it("stamps the event with the app's clock and carries only { from }", async () => {
      await outcome(() => deleteWeightAction(deleteForm({ [WEIGHT_DELETE_FIELDS.from]: "saved" })));
      expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "weight_deleted", { from: "saved" }, NOW);
      expect(mocks.logAppError).not.toHaveBeenCalled();
    });

    it("refreshes every page the person has seen: Home and Progress are derived from the weights", async () => {
      await outcome(() => deleteWeightAction(deleteForm()));
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it.each(["", "SAVED", "elsewhere", "<script>"])("treats the forged place %j as the list", async (from) => {
      await outcome(() => deleteWeightAction(deleteForm({ [WEIGHT_DELETE_FIELDS.from]: from })));
      expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "weight_deleted", { from: "list" }, NOW);
    });

    it("treats a missing place as the list", async () => {
      const form = new FormData();
      form.set(WEIGHT_DELETE_FIELDS.entryId, ID);
      await outcome(() => deleteWeightAction(form));
      expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "weight_deleted", { from: "list" }, NOW);
    });

    it("returns to the page of the list the person was on", async () => {
      await expect(outcome(() => deleteWeightAction(deleteForm({ [WEIGHT_DELETE_FIELDS.after]: CURSOR })))).resolves.toBe(landing("deleted", CURSOR));
    });

    it.each(["abc", "", "0", "2026-10-01", "../../x", "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6dX"])("drops the cursor %j: only a UUID may ride in the address", async (after) => {
      await expect(outcome(() => deleteWeightAction(deleteForm({ [WEIGHT_DELETE_FIELDS.after]: after })))).resolves.toBe(landing("deleted"));
    });
  });

  describe("a weight that was already gone", () => {
    it("says so, writes no event, and still refreshes", async () => {
      mocks.deleteWeightEntry.mockResolvedValue({ ok: true, value: { deleted: false } });
      await expect(outcome(() => deleteWeightAction(deleteForm()))).resolves.toBe(landing("gone"));
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });
  });

  describe("a delete that could not be confirmed", () => {
    it("lands on the error notice, logs a code only, and never claims what the state is", async () => {
      mocks.deleteWeightEntry.mockResolvedValue({ ok: false, code: "unavailable" });
      await expect(outcome(() => deleteWeightAction(deleteForm()))).resolves.toBe(landing("error"));
      expect(mocks.logAppError).toHaveBeenCalledWith({ userId: "user-1", area: "weight", message: "delete_error", context: { stage: "delete", code: "unavailable" } });
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    it("lands on the error notice, deleting nothing, when the database cannot be reached", async () => {
      mocks.actionContext.mockResolvedValue({ kind: "unavailable" });
      await expect(outcome(() => deleteWeightAction(deleteForm({ [WEIGHT_DELETE_FIELDS.after]: CURSOR })))).resolves.toBe(landing("error", CURSOR));
      expect(mocks.deleteWeightEntry).not.toHaveBeenCalled();
    });

    it("lets a redirect from the context (signed out, unfinished onboarding) through", async () => {
      mocks.actionContext.mockRejectedValue(new Error("REDIRECT:/login"));
      await expect(outcome(() => deleteWeightAction(deleteForm()))).resolves.toBe("REDIRECT:/login");
      expect(mocks.deleteWeightEntry).not.toHaveBeenCalled();
    });
  });

  describe("the guards", () => {
    it.each(["", "nope", "12345", "0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a1"])("answers 404 for the id %j, deleting nothing", async (id) => {
      await expect(outcome(() => deleteWeightAction(deleteForm({}, id)))).resolves.toBe("NOT_FOUND");
      expect(mocks.deleteWeightEntry).not.toHaveBeenCalled();
      expect(mocks.actionContext).not.toHaveBeenCalled();
    });

    it("answers 404 when the form has no entry id", async () => {
      await expect(outcome(() => deleteWeightAction(new FormData()))).resolves.toBe("NOT_FOUND");
    });

    it("never asks about offline periods: deleting your own data works in Shabbat", async () => {
      await outcome(() => deleteWeightAction(deleteForm()));
      mocks.deleteWeightEntry.mockResolvedValue({ ok: false, code: "unavailable" });
      await outcome(() => deleteWeightAction(deleteForm()));
      expect(mocks.loadOfflinePeriods).not.toHaveBeenCalled();
    });

    it("works while weight reporting is switched off: the kill switch closes reporting, not deleting", async () => {
      mocks.flow.reportingEnabled = false;
      await expect(outcome(() => deleteWeightAction(deleteForm()))).resolves.toBe(`REDIRECT:/me/weights?notice=deleted&n=${TOKEN}:replace`);
    });
  });

  describe("privacy", () => {
    it("puts no weight, note or entry id in the address, the event or the error row", async () => {
      const result = await outcome(() => deleteWeightAction(deleteForm()));
      expect(result).not.toContain(ID);
      mocks.deleteWeightEntry.mockResolvedValue({ ok: false, code: "unavailable" });
      await outcome(() => deleteWeightAction(deleteForm()));
      expect(JSON.stringify(mocks.track.mock.calls)).not.toContain(ID);
      expect(JSON.stringify(mocks.logAppError.mock.calls)).not.toContain(ID);
    });
  });
});
