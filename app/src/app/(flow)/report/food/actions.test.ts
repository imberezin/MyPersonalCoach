import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDIT_FORM,
  FOOD_FORM,
  FOOD_ROUTES,
  editFormDefaults,
  mealOf,
  revisionOf,
  rowField,
  type EditFormValues,
  type Understanding,
} from "@/domain/food";
import { confirmMealAction, discardAction, saveEditAction } from "./actions";

const ID = "0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a10";
const MARKER = "ZZ_PRIVATE_MARKER_5512";

const mocks = vi.hoisted(() => ({
  context: { current: null as unknown },
  configured: { current: true },
  loadUnderstanding: vi.fn(),
  saveDraft: vi.fn(),
  confirmMeal: vi.fn(),
  discardUnderstanding: vi.fn(),
  track: vi.fn(),
  logAppError: vi.fn(),
  revalidatePath: vi.fn(),
  // The development clock and the end-of-save pattern refresh (First Week, Phase 2).
  currentInstant: vi.fn(),
  refreshPatterns: vi.fn(),
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
vi.mock("@/lib/food/repo", () => ({
  loadUnderstanding: mocks.loadUnderstanding,
  saveDraft: mocks.saveDraft,
  confirmMeal: mocks.confirmMeal,
  discardUnderstanding: mocks.discardUnderstanding,
}));
vi.mock("@/lib/ai/ledger", () => ({ logAppError: mocks.logAppError }));
vi.mock("@/lib/analytics/track", () => ({ track: mocks.track, SupabaseEventsSink: class {} }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
vi.mock("@/lib/patterns/refresh", () => ({ refreshPatternsAfterMealChange: mocks.refreshPatterns }));

const supabase = { tag: "user-client" };
const ready = (lifecycle_state = "FIRST_WEEK") => ({
  kind: "ready",
  userId: "user-1",
  row: { lifecycle_state, timezone: "Asia/Jerusalem" },
  supabase,
});

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

function understanding(over: Partial<Understanding> = {}): Understanding {
  return {
    id: ID,
    kind: "text",
    provider: "gemini",
    model: "m",
    promptVersion: "meal-v1",
    status: "pending",
    items: [
      { name: "schnitzel", portion: { kind: "size", size: "medium", estimated: false }, uncertain: false, confidence: 0.9 },
      { name: "rice", portion: null, uncertain: true, confidence: 0.5 },
    ],
    unclear: [],
    overallConfidence: 0.8,
    proposed: { mealType: "lunch", occurredAt: minutesAgo(30) },
    draft: null,
    createdAt: minutesAgo(5),
    ...over,
  };
}

const confirmForm = (u: Understanding, fields: Record<string, string> = {}) => {
  const data = new FormData();
  data.set(FOOD_FORM.id, ID);
  data.set(FOOD_FORM.revision, revisionOf(mealOf(u)));
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

/** Both thrown kinds, as the text a test can match. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "RETURNED";
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN";
  }
}

beforeEach(() => {
  mocks.configured.current = true;
  mocks.context.current = ready();
  for (const fn of [mocks.loadUnderstanding, mocks.saveDraft, mocks.confirmMeal, mocks.discardUnderstanding, mocks.track, mocks.logAppError, mocks.revalidatePath]) {
    fn.mockReset();
  }
  mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: understanding() });
  mocks.confirmMeal.mockResolvedValue({ ok: true, value: { entryId: "entry-1" } });
  mocks.saveDraft.mockResolvedValue({ ok: true, value: true });
  mocks.discardUnderstanding.mockResolvedValue({ ok: true, value: true });
  mocks.currentInstant.mockReset().mockReturnValue(new Date("2026-09-16T06:00:00Z"));
  mocks.refreshPatterns.mockReset().mockResolvedValue(undefined);
  mocks.track.mockResolvedValue(undefined);
  mocks.logAppError.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("confirmMealAction", () => {
  it("saves an unedited AI report, tells the world once, and goes to the saved screen by replace", async () => {
    const u = understanding();
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });

    await expect(outcome(() => confirmMealAction(confirmForm(u)))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.saved(ID)}:replace`);

    expect(mocks.confirmMeal).toHaveBeenCalledTimes(1);
    expect(mocks.confirmMeal).toHaveBeenCalledWith(supabase, { id: ID, meal: mealOf(u), source: "ai_unedited" });
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "meal_saved", { source: "ai_unedited", mode: "text", items: 2, report_ms: expect.any(Number) });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("measures the report time from when the report was created", async () => {
    const u = understanding({ createdAt: minutesAgo(5) });
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });
    await outcome(() => confirmMealAction(confirmForm(u)));
    const payload = mocks.track.mock.calls[0]?.[2] as { report_ms: number };
    expect(payload.report_ms).toBeGreaterThanOrEqual(5 * 60_000);
    expect(payload.report_ms).toBeLessThan(6 * 60_000);
  });

  it("saves the user's draft as ai_edited and also reports what changed", async () => {
    const base = understanding();
    const draft = { ...mealOf(base), items: [{ name: "chicken", portion: null, uncertain: false }, ...mealOf(base).items.slice(1)], mealType: "dinner" as const };
    const u = understanding({ draft });
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });

    await expect(outcome(() => confirmMealAction(confirmForm(u)))).resolves.toContain(FOOD_ROUTES.saved(ID));

    expect(mocks.confirmMeal).toHaveBeenCalledWith(supabase, { id: ID, meal: draft, source: "ai_edited" });
    expect(mocks.track.mock.calls.map((call) => call[1])).toEqual(["meal_saved", "meal_corrected"]);
    expect(mocks.track).toHaveBeenLastCalledWith(expect.anything(), "meal_corrected", {
      // A rename is a food that left and a food that arrived: diffMeal matches foods by name.
      food_changed: true,
      portion_changed: false,
      type_changed: true,
      time_changed: false,
      added: 1,
      removed: 1,
    });
  });

  it("saves a manual report as user_manual, with the mode manual and no correction event", async () => {
    const u = understanding({ provider: "manual", model: null, promptVersion: null, overallConfidence: null });
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });

    await outcome(() => confirmMealAction(confirmForm(u)));

    expect(mocks.confirmMeal).toHaveBeenCalledWith(supabase, expect.objectContaining({ source: "user_manual" }));
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "meal_saved", expect.objectContaining({ source: "user_manual", mode: "manual" }));
  });

  it("reports the photo mode for a photo report", async () => {
    const u = understanding({ kind: "photo" });
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });
    await outcome(() => confirmMealAction(confirmForm(u)));
    expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "meal_saved", expect.objectContaining({ mode: "photo" }));
  });

  it("rebuilds the meal from the stored report and ignores items and times in the form", async () => {
    const u = understanding();
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });
    const form = confirmForm(u, {
      items: JSON.stringify([{ name: "forged" }]),
      occurredAt: "2020-01-01T00:00:00Z",
      source: "user_manual",
      userId: "someone-else",
    });
    await outcome(() => confirmMealAction(form));
    expect(mocks.confirmMeal).toHaveBeenCalledWith(supabase, { id: ID, meal: mealOf(u), source: "ai_unedited" });
    expect(mocks.loadUnderstanding).toHaveBeenCalledWith(supabase, ID);
  });

  it("sends a stale page back to the confirm screen with the refreshed note, and saves nothing", async () => {
    const u = understanding();
    const form = confirmForm(u);
    form.set(FOOD_FORM.revision, "00000000");
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });

    await expect(outcome(() => confirmMealAction(form))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.confirm(ID)}?refreshed=1:replace`);
    expect(mocks.confirmMeal).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("sends a missing revision the same way", async () => {
    const form = new FormData();
    form.set(FOOD_FORM.id, ID);
    await expect(outcome(() => confirmMealAction(form))).resolves.toContain("?refreshed=1");
    expect(mocks.confirmMeal).not.toHaveBeenCalled();
  });

  it.each(["accepted", "edited"] as const)("goes to the saved screen for a report that is already %s, saving nothing twice", async (status) => {
    const u = understanding({ status });
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });
    await expect(outcome(() => confirmMealAction(confirmForm(u)))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.saved(ID)}:replace`);
    expect(mocks.confirmMeal).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("is a 404 for a rejected report, an unknown report and an id that is not a UUID", async () => {
    const rejected = understanding({ status: "rejected" });
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: rejected });
    await expect(outcome(() => confirmMealAction(confirmForm(rejected)))).resolves.toBe("NOT_FOUND");

    mocks.loadUnderstanding.mockResolvedValue({ ok: false, code: "not_found" });
    await expect(outcome(() => confirmMealAction(confirmForm(understanding())))).resolves.toBe("NOT_FOUND");

    const form = confirmForm(understanding());
    form.set(FOOD_FORM.id, "not-a-uuid");
    await expect(outcome(() => confirmMealAction(form))).resolves.toBe("NOT_FOUND");
    expect(mocks.loadUnderstanding).toHaveBeenCalledTimes(2);
  });

  it("sends the person to the edit screen when the meal cannot be saved as it is", async () => {
    const old = understanding({ proposed: { mealType: "lunch", occurredAt: new Date(Date.now() - 49 * 3_600_000) } });
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: old });
    await expect(outcome(() => confirmMealAction(confirmForm(old)))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.edit(ID)}:default`);
    expect(mocks.confirmMeal).not.toHaveBeenCalled();
  });

  it("goes back to the confirm screen when the report is no longer pending", async () => {
    const u = understanding();
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });
    mocks.confirmMeal.mockResolvedValue({ ok: false, code: "not_pending" });
    await expect(outcome(() => confirmMealAction(confirmForm(u)))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.confirm(ID)}:replace`);
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.logAppError).not.toHaveBeenCalled();
  });

  it("records a code, tells nobody it was saved, and goes back when the database fails", async () => {
    const u = understanding();
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });
    mocks.confirmMeal.mockResolvedValue({ ok: false, code: "unavailable" });
    // The failed flag makes the confirm screen say that nothing was saved.
    await expect(outcome(() => confirmMealAction(confirmForm(u)))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.confirm(ID)}?failed=1:replace`);
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logAppError).toHaveBeenCalledWith({ userId: "user-1", area: "food", message: "confirm_error", context: { stage: "confirm", code: "unavailable" } });
  });

  it("goes back to the confirm screen, with the failed flag, when the report cannot be loaded", async () => {
    mocks.loadUnderstanding.mockResolvedValue({ ok: false, code: "unavailable" });
    await expect(outcome(() => confirmMealAction(confirmForm(understanding())))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.confirm(ID)}?failed=1:replace`);
    expect(mocks.confirmMeal).not.toHaveBeenCalled();
  });

  describe("the pattern refresh at the end of a save (First Week, Phase 2)", () => {
    const DEV_CLOCK = new Date("2026-09-16T06:00:00Z");

    it("runs once, with the ready context and the app's clock, after the save and after the meal_saved event", async () => {
      const u = understanding();
      mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });

      await expect(outcome(() => confirmMealAction(confirmForm(u)))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.saved(ID)}:replace`);

      expect(mocks.refreshPatterns).toHaveBeenCalledTimes(1);
      expect(mocks.refreshPatterns).toHaveBeenCalledWith(mocks.context.current, DEV_CLOCK);
      expect(mocks.confirmMeal.mock.invocationCallOrder[0]).toBeLessThan(mocks.refreshPatterns.mock.invocationCallOrder[0]);
      expect(mocks.track.mock.invocationCallOrder.at(-1) ?? 0).toBeLessThan(mocks.refreshPatterns.mock.invocationCallOrder[0]);
    });

    it("also runs after an edited save, once", async () => {
      const base = understanding();
      const u = understanding({ draft: { ...mealOf(base), mealType: "dinner" as const } });
      mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });
      await outcome(() => confirmMealAction(confirmForm(u)));
      expect(mocks.refreshPatterns).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["a failed save", () => mocks.confirmMeal.mockResolvedValue({ ok: false, code: "unavailable" })],
      ["a report that is no longer pending", () => mocks.confirmMeal.mockResolvedValue({ ok: false, code: "not_pending" })],
      ["a report that cannot be loaded", () => mocks.loadUnderstanding.mockResolvedValue({ ok: false, code: "unavailable" })],
      ["a stale screen", () => mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: understanding({ items: [] }) })],
    ])("never runs after %s", async (_name, arrange) => {
      const u = understanding();
      mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });
      arrange();
      await outcome(() => confirmMealAction(confirmForm(u)));
      expect(mocks.refreshPatterns).not.toHaveBeenCalled();
    });

    it("never runs for a report that was already saved (a double tap)", async () => {
      const u = understanding({ status: "accepted" });
      mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });
      await outcome(() => confirmMealAction(confirmForm(u)));
      expect(mocks.refreshPatterns).not.toHaveBeenCalled();
    });

    it("changes neither the landing nor the events when the refresh rejects", async () => {
      const u = understanding({ draft: { ...mealOf(understanding()), mealType: "dinner" as const } });
      mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });
      mocks.refreshPatterns.mockRejectedValue(new Error("boom"));

      await expect(outcome(() => confirmMealAction(confirmForm(u)))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.saved(ID)}:replace`);
      expect(mocks.track.mock.calls.map((call) => call[1])).toEqual(["meal_saved", "meal_corrected"]);
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("saves with the REAL clock even when the app's clock is a past development instant", async () => {
      // A meal dated 30 minutes ago would be "in the past" for a clock set to September, and a meal stamped by the
      // database is later than it: the save, the report time and the meal_saved event must not follow that clock.
      mocks.currentInstant.mockReturnValue(new Date("2020-01-01T00:00:00Z"));
      const u = understanding();
      mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });

      await expect(outcome(() => confirmMealAction(confirmForm(u)))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.saved(ID)}:replace`);

      expect(mocks.confirmMeal).toHaveBeenCalledTimes(1);
      const saved = mocks.track.mock.calls[0] ?? [];
      expect(saved[1]).toBe("meal_saved");
      expect((saved[2] as { report_ms: number }).report_ms).toBeGreaterThanOrEqual(5 * 60_000);
      // No fourth argument: the event keeps the real time.
      expect(saved).toHaveLength(3);
      expect(mocks.refreshPatterns).toHaveBeenCalledWith(mocks.context.current, new Date("2020-01-01T00:00:00Z"));
    });
  });

  describe("the session is checked again, because a page guard does not protect a direct POST", () => {
    it("sends a signed-out visitor to sign in and touches nothing", async () => {
      mocks.context.current = { kind: "signed_out" };
      await expect(outcome(() => confirmMealAction(confirmForm(understanding())))).resolves.toBe("REDIRECT:/login:default");
      expect(mocks.loadUnderstanding).not.toHaveBeenCalled();
      expect(mocks.confirmMeal).not.toHaveBeenCalled();
    });

    it.each(["NEW", "ONBOARDING"])("sends a user in %s to onboarding", async (state) => {
      mocks.context.current = ready(state);
      await expect(outcome(() => confirmMealAction(confirmForm(understanding())))).resolves.toBe("REDIRECT:/onboarding:default");
      expect(mocks.confirmMeal).not.toHaveBeenCalled();
    });

    it("sends Home when Supabase is not set up", async () => {
      mocks.configured.current = false;
      await expect(outcome(() => confirmMealAction(confirmForm(understanding())))).resolves.toBe("REDIRECT:/:default");
    });

    it("goes back to the confirm screen when the context is unavailable", async () => {
      mocks.context.current = { kind: "unavailable" };
      await expect(outcome(() => confirmMealAction(confirmForm(understanding())))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.confirm(ID)}:replace`);
      expect(mocks.confirmMeal).not.toHaveBeenCalled();
    });
  });
});

const NOW_CTX = () => ({ now: new Date(), timeZone: "Asia/Jerusalem" });

function editForm(values: EditFormValues, id = ID): FormData {
  const data = new FormData();
  data.set(FOOD_FORM.id, id);
  data.set(EDIT_FORM.rowCount, String(values.rows.length));
  values.rows.forEach((row, index) => {
    for (const field of ["name", "portion", "amount", "unit", "orig"] as const) data.set(rowField(index, field), row[field]);
  });
  data.set(EDIT_FORM.mealType, values.mealType);
  data.set(EDIT_FORM.day, values.day);
  data.set(EDIT_FORM.time, values.time);
  return data;
}

describe("saveEditAction", () => {
  const defaults = () => editFormDefaults(mealOf(understanding()), NOW_CTX());

  it("saves the edit as the draft, refreshes the confirm path and goes back to it by replace", async () => {
    const values = defaults();
    values.rows[0] = { ...values.rows[0], name: "chicken" };

    await expect(outcome(() => saveEditAction(null, editForm(values)))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.confirm(ID)}:replace`);

    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
    const [client, id, draft] = mocks.saveDraft.mock.calls[0] ?? [];
    expect(client).toBe(supabase);
    expect(id).toBe(ID);
    expect(draft.items.map((item: { name: string }) => item.name)).toEqual(["chicken", "rice"]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(FOOD_ROUTES.confirm(ID));
  });

  it("answers the errors and the typed values, and writes nothing, when the form is not valid", async () => {
    const values = defaults();
    values.rows = values.rows.map((row) => ({ ...row, name: "" }));

    const result = await saveEditAction(null, editForm(values));

    expect(result).toEqual({ status: "error", errors: [{ code: "no_items" }], values: expect.objectContaining({ time: values.time }) });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps a typed amount in the answer", async () => {
    const values = defaults();
    values.rows[1] = { ...values.rows[1], portion: "amount", amount: "abc", unit: "cup" };
    const result = await saveEditAction(null, editForm(values));
    expect(result?.errors).toEqual([{ code: "amount_invalid", row: 1, field: "amount" }]);
    expect(result?.values.rows[1]).toMatchObject({ amount: "abc", unit: "cup" });
  });

  it("sends a report that is no longer pending to the confirm screen", async () => {
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: understanding({ status: "accepted" }) });
    await expect(outcome(() => saveEditAction(null, editForm(defaults())))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.confirm(ID)}:replace`);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("does the same when the report stops being pending between the read and the write", async () => {
    mocks.saveDraft.mockResolvedValue({ ok: false, code: "not_pending" });
    await expect(outcome(() => saveEditAction(null, editForm(defaults())))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.confirm(ID)}:replace`);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("is a 404 for an id that is not a UUID or not the user's", async () => {
    await expect(outcome(() => saveEditAction(null, editForm(defaults(), "nope")))).resolves.toBe("NOT_FOUND");
    mocks.loadUnderstanding.mockResolvedValue({ ok: false, code: "not_found" });
    await expect(outcome(() => saveEditAction(null, editForm(defaults())))).resolves.toBe("NOT_FOUND");
  });

  it("keeps what was typed, and records a code, when the database fails", async () => {
    mocks.saveDraft.mockResolvedValue({ ok: false, code: "unavailable" });
    const values = defaults();
    values.rows[0] = { ...values.rows[0], name: `chicken ${MARKER}` };

    const result = await saveEditAction(null, editForm(values));

    // A summary with one calm line, so the failed save is never silent.
    expect(result).toMatchObject({ status: "error", errors: [{ code: "not_saved" }] });
    expect(result?.values.rows[0].name).toContain(MARKER);
    expect(mocks.logAppError).toHaveBeenCalledWith({ userId: "user-1", area: "food", message: "save_error", context: { stage: "edit_write", code: "unavailable" } });
    expect(JSON.stringify(mocks.logAppError.mock.calls)).not.toContain(MARKER);
  });

  it("keeps what was typed when the context is unavailable or the report cannot be read", async () => {
    mocks.context.current = { kind: "unavailable" };
    await expect(saveEditAction(null, editForm(defaults()))).resolves.toMatchObject({ status: "error", errors: [{ code: "not_saved" }] });

    mocks.context.current = ready();
    mocks.loadUnderstanding.mockResolvedValue({ ok: false, code: "unavailable" });
    await expect(saveEditAction(null, editForm(defaults()))).resolves.toMatchObject({ status: "error", errors: [{ code: "not_saved" }] });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("checks the session again: signed out goes to sign in, and onboarding unfinished goes to onboarding", async () => {
    mocks.context.current = { kind: "signed_out" };
    await expect(outcome(() => saveEditAction(null, editForm(defaults())))).resolves.toBe("REDIRECT:/login:default");
    mocks.context.current = ready("ONBOARDING");
    await expect(outcome(() => saveEditAction(null, editForm(defaults())))).resolves.toBe("REDIRECT:/onboarding:default");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });
});

describe("discardAction", () => {
  const discardForm = (stage: string | null, id = ID) => {
    const data = new FormData();
    data.set(FOOD_FORM.id, id);
    if (stage !== null) data.set(FOOD_FORM.stage, stage);
    return data;
  };

  it("deletes a pending report from the confirm screen, tells the world, and goes Home", async () => {
    await expect(outcome(() => discardAction(discardForm("confirm")))).resolves.toBe("REDIRECT:/:replace");
    expect(mocks.discardUnderstanding).toHaveBeenCalledWith(supabase, ID);
    expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "meal_report_discarded", { stage: "confirm" });
  });

  it("deletes from the resume card and stays on the first screen, refreshed", async () => {
    await expect(outcome(() => discardAction(discardForm("resume")))).resolves.toBe("RETURNED");
    expect(mocks.discardUnderstanding).toHaveBeenCalledWith(supabase, ID);
    expect(mocks.track).toHaveBeenCalledWith(expect.anything(), "meal_report_discarded", { stage: "resume" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(FOOD_ROUTES.chooser);
  });

  it("leaves a saved report alone and says nothing about it", async () => {
    mocks.discardUnderstanding.mockResolvedValue({ ok: false, code: "not_pending" });
    await expect(outcome(() => discardAction(discardForm("confirm")))).resolves.toBe("REDIRECT:/:replace");
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.logAppError).not.toHaveBeenCalled();
  });

  it("records a code, and still carries on, when the database fails", async () => {
    mocks.discardUnderstanding.mockResolvedValue({ ok: false, code: "unavailable" });
    await expect(outcome(() => discardAction(discardForm("resume")))).resolves.toBe("RETURNED");
    expect(mocks.logAppError).toHaveBeenCalledWith(expect.objectContaining({ area: "food", context: { stage: "discard", code: "unavailable" } }));
  });

  it.each([null, "forged", "CONFIRM", ""])("deletes nothing for the stage %j", async (stage) => {
    await expect(outcome(() => discardAction(discardForm(stage)))).resolves.toBe("REDIRECT:/:replace");
    expect(mocks.discardUnderstanding).not.toHaveBeenCalled();
  });

  it("is a 404 for an id that is not a UUID", async () => {
    await expect(outcome(() => discardAction(discardForm("confirm", "nope")))).resolves.toBe("NOT_FOUND");
    expect(mocks.discardUnderstanding).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign in without deleting anything", async () => {
    mocks.context.current = { kind: "signed_out" };
    await expect(outcome(() => discardAction(discardForm("confirm")))).resolves.toBe("REDIRECT:/login:default");
    expect(mocks.discardUnderstanding).not.toHaveBeenCalled();
  });

  it("still ends the confirm stage at Home when the context is unavailable, deleting nothing", async () => {
    mocks.context.current = { kind: "unavailable" };
    await expect(outcome(() => discardAction(discardForm("confirm")))).resolves.toBe("REDIRECT:/:replace");
    expect(mocks.discardUnderstanding).not.toHaveBeenCalled();
  });
});
