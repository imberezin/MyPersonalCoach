import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEALS_FORM, MEALS_ROUTES } from "@/domain/food";
import { deleteMealAction } from "./actions";

const ID = "0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a10";
const TOKEN = "5f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const OTHER_TOKEN = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const MARKER = "ZZ_PRIVATE_MARKER_5512";

const mocks = vi.hoisted(() => ({
  context: { current: null as unknown },
  configured: { current: true },
  deleteMealEntry: vi.fn(),
  track: vi.fn(),
  logAppError: vi.fn(),
  revalidatePath: vi.fn(),
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
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => mocks.configured.current }));
vi.mock("@/lib/onboarding/context", () => ({ loadOnboardingContext: async () => mocks.context.current }));
vi.mock("@/lib/food/repo", () => ({ deleteMealEntry: mocks.deleteMealEntry }));
vi.mock("@/lib/ai/ledger", () => ({ logAppError: mocks.logAppError }));
vi.mock("@/lib/analytics/track", () => ({ track: mocks.track, SupabaseEventsSink: class {} }));
vi.mock("@/lib/home/load", () => ({ loadOfflinePeriods: mocks.loadOfflinePeriods }));

const supabase = { tag: "user-client" };
const ready = (lifecycle_state = "FIRST_WEEK") => ({
  kind: "ready",
  userId: "user-1",
  row: { lifecycle_state, timezone: "Asia/Jerusalem" },
  supabase,
});

function deleteForm(fields: Record<string, string> = {}, id = ID): FormData {
  const data = new FormData();
  data.set(MEALS_FORM.entryId, id);
  data.set(MEALS_FORM.from, "list");
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

const landing = (notice: "deleted" | "gone" | "error", token = TOKEN, pages?: number) =>
  `REDIRECT:${MEALS_ROUTES.withNotice(notice, { token, pages })}:replace`;

beforeEach(() => {
  mocks.configured.current = true;
  mocks.context.current = ready();
  for (const fn of [mocks.deleteMealEntry, mocks.track, mocks.logAppError, mocks.revalidatePath, mocks.loadOfflinePeriods]) fn.mockClear();
  mocks.deleteMealEntry.mockReset().mockResolvedValue({ ok: true, value: { deleted: true } });
  mocks.track.mockReset().mockResolvedValue(undefined);
  mocks.logAppError.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("crypto", { randomUUID: () => TOKEN });
  for (const method of ["log", "info", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deleteMealAction", () => {
  describe("a meal that was deleted", () => {
    it("deletes it as the signed-in user, tells the world once with only where it started, and lands on the list by replace", async () => {
      await expect(outcome(() => deleteMealAction(deleteForm()))).resolves.toBe(`REDIRECT:/me/meals?notice=deleted&n=${TOKEN}:replace`);

      expect(mocks.deleteMealEntry).toHaveBeenCalledTimes(1);
      expect(mocks.deleteMealEntry).toHaveBeenCalledWith(supabase, ID);
      expect(mocks.track).toHaveBeenCalledTimes(1);
      expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "meal_deleted", { from: "list" });
      expect(mocks.logAppError).not.toHaveBeenCalled();
    });

    it("refreshes every page the person has seen, because Home may go back to the first-report state", async () => {
      await outcome(() => deleteMealAction(deleteForm()));
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("tells the event where the delete started: the Saved screen says saved", async () => {
      await outcome(() => deleteMealAction(deleteForm({ [MEALS_FORM.from]: "saved" })));
      expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "meal_deleted", { from: "saved" });
    });

    it.each(["", "SAVED", "elsewhere", "<script>"])("treats the forged place %j as the list", async (from) => {
      await outcome(() => deleteMealAction(deleteForm({ [MEALS_FORM.from]: from })));
      expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "meal_deleted", { from: "list" });
    });

    it("treats a missing place as the list", async () => {
      const form = new FormData();
      form.set(MEALS_FORM.entryId, ID);
      await outcome(() => deleteMealAction(form));
      expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "meal_deleted", { from: "list" });
    });

    it("keeps the size of the list the person had open", async () => {
      await expect(outcome(() => deleteMealAction(deleteForm({ [MEALS_FORM.pages]: "3" })))).resolves.toBe(
        `REDIRECT:/me/meals?notice=deleted&n=${TOKEN}&pages=3:replace`,
      );
    });

    it("clamps a huge page size to the most the list can show", async () => {
      await expect(outcome(() => deleteMealAction(deleteForm({ [MEALS_FORM.pages]: "99" })))).resolves.toBe(
        `REDIRECT:/me/meals?notice=deleted&n=${TOKEN}&pages=6:replace`,
      );
    });

    it.each(["abc", "0", "-3", "1", ""])("drops the page size %j", async (pages) => {
      await expect(outcome(() => deleteMealAction(deleteForm({ [MEALS_FORM.pages]: pages })))).resolves.toBe(`REDIRECT:/me/meals?notice=deleted&n=${TOKEN}:replace`);
    });

    it("lands on a different address every time, so the notice is announced again", async () => {
      const first = await outcome(() => deleteMealAction(deleteForm()));
      vi.stubGlobal("crypto", { randomUUID: () => OTHER_TOKEN });
      const second = await outcome(() => deleteMealAction(deleteForm()));
      expect(first).toBe(landing("deleted", TOKEN));
      expect(second).toBe(landing("deleted", OTHER_TOKEN));
      expect(first).not.toBe(second);
    });

    it("puts nothing in the address but the notice word, a page count and the random token", async () => {
      const url = (await outcome(() => deleteMealAction(deleteForm({ [MEALS_FORM.pages]: "2" })))).replace(/^REDIRECT:|:replace$/g, "");
      const query = new URL(url, "https://example.test").searchParams;
      expect([...query.keys()].sort()).toEqual(["n", "notice", "pages"]);
      expect(url).not.toContain(ID);
    });
  });

  describe("a meal that was already gone, or is not the person's", () => {
    beforeEach(() => {
      mocks.deleteMealEntry.mockResolvedValue({ ok: true, value: { deleted: false } });
    });

    it("says so calmly, refreshes the page the person came from, and tells nobody", async () => {
      await expect(outcome(() => deleteMealAction(deleteForm({ [MEALS_FORM.pages]: "2" })))).resolves.toBe(landing("gone", TOKEN, 2));
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.logAppError).not.toHaveBeenCalled();
    });
  });

  describe("a delete that could not be confirmed", () => {
    beforeEach(() => {
      mocks.deleteMealEntry.mockResolvedValue({ ok: false, code: "unavailable" });
    });

    it("records a code only, lands on the technical notice, and tells nobody it was deleted", async () => {
      await expect(outcome(() => deleteMealAction(deleteForm({ [MEALS_FORM.pages]: "4" })))).resolves.toBe(landing("error", TOKEN, 4));

      expect(mocks.logAppError).toHaveBeenCalledTimes(1);
      expect(mocks.logAppError).toHaveBeenCalledWith({ userId: "user-1", area: "food", message: "delete_error", context: { stage: "delete", code: "unavailable" } });
      expect(JSON.stringify(mocks.logAppError.mock.calls)).not.toContain(ID);
      expect(mocks.track).not.toHaveBeenCalled();
      // The state is unknown (the call may have committed), so nothing is claimed and nothing is refreshed.
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("the id", () => {
    it.each(["nope", "", "0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a1", "0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a10 "])("is a 404 for %j, with nothing deleted", async (id) => {
      await expect(outcome(() => deleteMealAction(deleteForm({}, id)))).resolves.toBe("NOT_FOUND");
      expect(mocks.deleteMealEntry).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it("is a 404 when the form has no id", async () => {
      await expect(outcome(() => deleteMealAction(new FormData()))).resolves.toBe("NOT_FOUND");
      expect(mocks.deleteMealEntry).not.toHaveBeenCalled();
    });
  });

  describe("the session is checked again, because a page guard does not protect a direct POST", () => {
    it("sends a signed-out visitor to sign in and deletes nothing", async () => {
      mocks.context.current = { kind: "signed_out" };
      await expect(outcome(() => deleteMealAction(deleteForm()))).resolves.toBe("REDIRECT:/login:default");
      expect(mocks.deleteMealEntry).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it.each(["NEW", "ONBOARDING"])("sends a user in %s to onboarding and deletes nothing", async (state) => {
      mocks.context.current = ready(state);
      await expect(outcome(() => deleteMealAction(deleteForm()))).resolves.toBe("REDIRECT:/onboarding:default");
      expect(mocks.deleteMealEntry).not.toHaveBeenCalled();
    });

    it("sends Home when Supabase is not set up", async () => {
      mocks.configured.current = false;
      await expect(outcome(() => deleteMealAction(deleteForm()))).resolves.toBe("REDIRECT:/:default");
      expect(mocks.deleteMealEntry).not.toHaveBeenCalled();
    });

    it("sends Home when the context says Supabase is not configured", async () => {
      mocks.context.current = { kind: "not_configured" };
      await expect(outcome(() => deleteMealAction(deleteForm()))).resolves.toBe("REDIRECT:/:default");
    });

    it.each([{ kind: "unavailable" }, { kind: "profile_missing" }])("lands on the technical notice, by replace, when the context is $kind", async (context) => {
      mocks.context.current = context;
      await expect(outcome(() => deleteMealAction(deleteForm({ [MEALS_FORM.pages]: "2" })))).resolves.toBe(landing("error", TOKEN, 2));
      expect(mocks.deleteMealEntry).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });
  });

  describe("what the form is allowed to say", () => {
    it("reads no key but the meal id, where it started and the page size, and never a user id", async () => {
      const read: string[] = [];
      const data = deleteForm({ [MEALS_FORM.pages]: "2", userId: "someone-else", user_id: "someone-else", token: "forged", notice: "gone", n: OTHER_TOKEN });
      // Every way of reading a FormData is recorded; anything but a named get is recorded as the whole form.
      const watched = new Proxy(data, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            read.push(prop === "get" || prop === "getAll" || prop === "has" ? String(args[0]) : `<${String(prop)}>`);
            return value.apply(target, args);
          };
        },
      });

      await outcome(() => deleteMealAction(watched));

      expect([...new Set(read)].sort()).toEqual([MEALS_FORM.entryId, MEALS_FORM.from, MEALS_FORM.pages].sort());
      expect(mocks.deleteMealEntry).toHaveBeenCalledWith(supabase, ID);
      expect(mocks.logAppError).not.toHaveBeenCalled();
    });

    it("takes the token from nowhere but its own random id", async () => {
      await expect(outcome(() => deleteMealAction(deleteForm({ n: OTHER_TOKEN, token: OTHER_TOKEN })))).resolves.toBe(landing("deleted", TOKEN));
    });

    it("lets nothing from unrelated fields reach a log, a redirect or a record", async () => {
      const form = deleteForm({ note: MARKER, userId: MARKER, [MEALS_FORM.pages]: `2${MARKER}` });
      mocks.deleteMealEntry.mockResolvedValue({ ok: false, code: "unavailable" });

      const result = await outcome(() => deleteMealAction(form));

      expect(result).not.toContain(MARKER);
      expect(JSON.stringify(mocks.logAppError.mock.calls)).not.toContain(MARKER);
      expect(JSON.stringify(mocks.track.mock.calls)).not.toContain(MARKER);
      for (const method of ["log", "info", "warn", "error"] as const) {
        expect(JSON.stringify(vi.mocked(console[method]).mock.calls)).not.toContain(MARKER);
      }
    });
  });

  describe("deleting is not reporting", () => {
    it.each([
      ["deleted", { ok: true, value: { deleted: true } }],
      ["gone", { ok: true, value: { deleted: false } }],
      ["failed", { ok: false, code: "unavailable" }],
    ])("never asks about Shabbat or an offline period when the meal is %s", async (_name, answer) => {
      mocks.deleteMealEntry.mockResolvedValue(answer);
      const result = await outcome(() => deleteMealAction(deleteForm()));
      expect(result).not.toBe("OFFLINE_PERIODS_READ");
      expect(result).toMatch(/^REDIRECT:\/me\/meals\?notice=/);
      expect(mocks.loadOfflinePeriods).not.toHaveBeenCalled();
    });
  });
});
