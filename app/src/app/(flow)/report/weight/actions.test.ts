// What the two weight actions decide, with the gate, the repository, the clock and analytics mocked. The order of the
// calls is asserted on a call log, because the order IS the safety: the offline check comes before any write, and a
// refused form writes nothing. The real domain (validation, day options, the double-check) runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEIGHT_FORM, WEIGHT_ROUTES, type WeightFormState } from "@/domain/weight";
import { editWeightAction, saveWeightAction } from "./actions";

const ID = "0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a10";
const NOW = new Date("2026-10-01T09:30:00Z"); // Thursday 12:30 in Jerusalem
const MARKER = "ZZ_PRIVATE_NOTE_5512";
const WEIGHT = "123.4";

const mocks = vi.hoisted(() => ({
  log: [] as string[],
  actionContext: vi.fn(),
  loadOfflinePeriods: vi.fn(),
  insertWeightEntry: vi.fn(),
  loadReferenceWeight: vi.fn(),
  loadWeightEntry: vi.fn(),
  updateWeightEntry: vi.fn(),
  track: vi.fn(),
  logAppError: vi.fn(),
  revalidatePath: vi.fn(),
  currentInstant: vi.fn(),
  flow: { reportingEnabled: true, progressEnabled: true, milestoneMomentEnabled: true },
}));

// The real redirect() and notFound() throw to stop the render; the stand-ins do the same and say where to.
vi.mock("next/navigation", () => ({
  redirect: (to: string, type?: string) => {
    mocks.log.push("redirect");
    throw new Error(`REDIRECT:${to}:${type ?? "default"}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  RedirectType: { replace: "replace", push: "push" },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => {
    mocks.log.push("revalidate");
    mocks.revalidatePath(...args);
  },
}));
vi.mock("./_lib/gate", () => ({
  openWeightActionContext: () => {
    mocks.log.push("context");
    return mocks.actionContext();
  },
}));
vi.mock("@/lib/home/load", () => ({
  loadOfflinePeriods: (...args: unknown[]) => {
    mocks.log.push("offline");
    return mocks.loadOfflinePeriods(...args);
  },
}));
vi.mock("@/lib/weight/repo", () => ({
  insertWeightEntry: (...args: unknown[]) => {
    mocks.log.push("insert");
    return mocks.insertWeightEntry(...args);
  },
  loadReferenceWeight: (...args: unknown[]) => {
    mocks.log.push("reference");
    return mocks.loadReferenceWeight(...args);
  },
  loadWeightEntry: (...args: unknown[]) => {
    mocks.log.push("load");
    return mocks.loadWeightEntry(...args);
  },
  updateWeightEntry: (...args: unknown[]) => {
    mocks.log.push("update");
    return mocks.updateWeightEntry(...args);
  },
}));
vi.mock("@/lib/analytics/track", () => ({
  SupabaseEventsSink: class {},
  track: (...args: unknown[]) => {
    mocks.log.push("track");
    return mocks.track(...args);
  },
}));
vi.mock("@/lib/ai/ledger", () => ({ logAppError: mocks.logAppError }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
vi.mock("@/domain/weight", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domain/weight")>();
  return { ...original, WEIGHT_FLOW: mocks.flow };
});

const supabase = { tag: "user-client" };
const ready = (startWeight: number | null = 118.7) => ({
  kind: "ready",
  context: { kind: "ready", userId: "user-1", row: { lifecycle_state: "FIRST_WEEK", timezone: "Asia/Jerusalem", start_weight_kg: startWeight }, supabase },
});

function weightForm(fields: Record<string, string> = {}, id = ID): FormData {
  const data = new FormData();
  data.set(WEIGHT_FORM.id, id);
  data.set(WEIGHT_FORM.weight, "118.7");
  data.set(WEIGHT_FORM.day, "now");
  data.set(WEIGHT_FORM.note, "");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** What the action ended in: a thrown redirect or 404 as text, or the state it returned. */
async function outcome(run: () => Promise<unknown>): Promise<string | WeightFormState> {
  try {
    return (await run()) as WeightFormState;
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN";
  }
}

const savedAt = `REDIRECT:${WEIGHT_ROUTES.saved(ID)}:replace`;
const editedAt = `REDIRECT:${WEIGHT_ROUTES.savedEdited(ID)}:replace`;

const entry = (over: Record<string, unknown> = {}) => ({
  ok: true,
  value: { id: ID, weightKg: 118.7, measuredAt: new Date("2026-09-29T09:00:00Z"), note: null, ...over },
});

beforeEach(() => {
  mocks.log.length = 0;
  mocks.flow.reportingEnabled = true;
  mocks.actionContext.mockReset().mockResolvedValue(ready());
  mocks.loadOfflinePeriods.mockReset().mockResolvedValue([]);
  mocks.insertWeightEntry.mockReset().mockResolvedValue({ ok: true, value: { created: true } });
  mocks.loadReferenceWeight.mockReset().mockResolvedValue(118.7);
  mocks.loadWeightEntry.mockReset().mockResolvedValue(entry());
  mocks.updateWeightEntry.mockReset().mockResolvedValue({ ok: true, value: { changed: true } });
  mocks.track.mockReset().mockResolvedValue(undefined);
  mocks.logAppError.mockReset().mockResolvedValue(undefined);
  mocks.revalidatePath.mockReset();
  mocks.currentInstant.mockReset().mockReturnValue(NOW);
  for (const method of ["log", "info", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveWeightAction", () => {
  describe("a weight that was saved", () => {
    it("runs in the safe order: session, offline check, reference, write, event, refresh, redirect", async () => {
      await expect(outcome(() => saveWeightAction(null, weightForm()))).resolves.toBe(savedAt);
      expect(mocks.log).toEqual(["context", "offline", "reference", "insert", "track", "revalidate", "redirect"]);
    });

    it("saves the typed number as the signed-in user, at the app's clock, with the page's id, and no note key content", async () => {
      await outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "118,7" })));
      expect(mocks.insertWeightEntry).toHaveBeenCalledWith(supabase, { id: ID, weightKg: 118.7, measuredAt: NOW, note: null });
    });

    it("reads the offline periods at the app's clock, as the signed-in user", async () => {
      await outcome(() => saveWeightAction(null, weightForm()));
      expect(mocks.loadOfflinePeriods).toHaveBeenCalledWith(supabase, "user-1", NOW);
    });

    it("saves an earlier day at noon of that local day", async () => {
      await outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "2026-09-30" })));
      expect(mocks.insertWeightEntry).toHaveBeenCalledWith(supabase, expect.objectContaining({ measuredAt: new Date("2026-09-30T09:00:00Z") }));
    });

    it("compares the number with the weigh-in before the day it is saved for", async () => {
      await outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "2026-09-30" })));
      expect(mocks.loadReferenceWeight).toHaveBeenCalledWith(supabase, { before: new Date("2026-09-30T09:00:00Z") });
    });

    it("passes the note as typed, trimmed", async () => {
      await outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.note]: `  ${MARKER} 😀  ` })));
      expect(mocks.insertWeightEntry).toHaveBeenCalledWith(supabase, expect.objectContaining({ note: `${MARKER} 😀` }));
    });

    it("tells the world once, with only enums and booleans, and the app's clock as the 4th argument", async () => {
      await outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.note]: MARKER })));
      expect(mocks.track).toHaveBeenCalledTimes(1);
      const [, name, payload, at] = mocks.track.mock.calls[0];
      expect(name).toBe("weight_reported");
      expect(payload).toEqual({ day: "now", checked: false, has_note: true });
      expect(Object.keys(payload).sort()).toEqual(["checked", "day", "has_note"]);
      expect(at).toBe(NOW);
    });

    it("says 'earlier' in the event for an earlier day", async () => {
      await outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "2026-09-30" })));
      expect(mocks.track.mock.calls[0][2]).toEqual({ day: "earlier", checked: false, has_note: false });
    });

    it("refreshes every page the person has seen: Home and Progress read the weight", async () => {
      await outcome(() => saveWeightAction(null, weightForm()));
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("still lands on Saved, by replace, when the id already existed (a double tap or a second tab)", async () => {
      mocks.insertWeightEntry.mockResolvedValue({ ok: true, value: { created: false } });
      await expect(outcome(() => saveWeightAction(null, weightForm()))).resolves.toBe(savedAt);
    });

    it("counts a weigh-in once: a repeat of the same id writes nothing and emits no event, but still refreshes the pages", async () => {
      mocks.insertWeightEntry.mockResolvedValue({ ok: true, value: { created: false } });
      await outcome(() => saveWeightAction(null, weightForm()));
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });
  });

  describe("the guards come first", () => {
    it.each(["", "not-a-uuid", "12345"])("answers 404 for the id %j and does nothing else", async (id) => {
      await expect(outcome(() => saveWeightAction(null, weightForm({}, id)))).resolves.toBe("NOT_FOUND");
      expect(mocks.log).toEqual([]);
    });

    it("answers 404 when the form has no id at all", async () => {
      const data = weightForm();
      data.delete(WEIGHT_FORM.id);
      await expect(outcome(() => saveWeightAction(null, data))).resolves.toBe("NOT_FOUND");
    });

    it("sends the person Home when weight reporting is switched off, before the session is even opened", async () => {
      mocks.flow.reportingEnabled = false;
      await expect(outcome(() => saveWeightAction(null, weightForm()))).resolves.toBe("REDIRECT:/:default");
      expect(mocks.log).toEqual(["redirect"]);
      expect(mocks.insertWeightEntry).not.toHaveBeenCalled();
    });

    it("keeps what was typed and says nothing was saved when the database cannot be reached", async () => {
      mocks.actionContext.mockResolvedValue({ kind: "unavailable" });
      const result = await saveWeightAction(null, weightForm({ [WEIGHT_FORM.note]: "x" }));
      expect(result).toEqual({
        status: "error",
        errors: [{ code: "not_saved" }],
        values: { weight: "118.7", day: "now", note: "x", confirmed: false },
      });
      expect(mocks.insertWeightEntry).not.toHaveBeenCalled();
    });

    it("lets a redirect from the context (signed out, unfinished onboarding) through", async () => {
      mocks.actionContext.mockRejectedValue(new Error("REDIRECT:/login"));
      await expect(outcome(() => saveWeightAction(null, weightForm()))).resolves.toBe("REDIRECT:/login");
      expect(mocks.insertWeightEntry).not.toHaveBeenCalled();
    });
  });

  describe("Shabbat and every other offline period", () => {
    it("redirects to the quiet screen, writes nothing and tells nothing", async () => {
      const period = { type: "SHABBAT", start: new Date("2026-10-01T08:00:00Z"), end: new Date("2026-10-02T18:00:00Z") };
      mocks.loadOfflinePeriods.mockResolvedValue([period]);
      await expect(outcome(() => saveWeightAction(null, weightForm()))).resolves.toBe(`REDIRECT:${WEIGHT_ROUTES.entry}:default`);
      expect(mocks.insertWeightEntry).not.toHaveBeenCalled();
      expect(mocks.loadReferenceWeight).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(mocks.log).toEqual(["context", "offline", "redirect"]);
    });

    it("goes on when the periods cannot be read (fail open, as in the food flow)", async () => {
      mocks.loadOfflinePeriods.mockResolvedValue(null);
      await expect(outcome(() => saveWeightAction(null, weightForm()))).resolves.toBe(savedAt);
    });

    it("is not stopped by a period that has ended or has not started", async () => {
      mocks.loadOfflinePeriods.mockResolvedValue([
        { type: "SHABBAT", start: new Date("2026-09-26T08:00:00Z"), end: new Date("2026-09-27T18:00:00Z") },
        { type: "SHABBAT", start: new Date("2026-10-03T08:00:00Z"), end: new Date("2026-10-04T18:00:00Z") },
      ]);
      await expect(outcome(() => saveWeightAction(null, weightForm()))).resolves.toBe(savedAt);
    });
  });

  describe("a form that is refused", () => {
    it.each([
      ["", "required"],
      ["abc", "invalid_number"],
      ["12", "out_of_range"],
      ["400", "out_of_range"],
    ])("returns the typed values and the error for the weight %j and writes nothing", async (weight, code) => {
      const result = await saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: weight, [WEIGHT_FORM.note]: "keep me" }));
      expect(result).toEqual({
        status: "error",
        errors: [{ code, field: "weight" }],
        values: { weight, day: "now", note: "keep me", confirmed: false },
      });
      expect(mocks.insertWeightEntry).not.toHaveBeenCalled();
      expect(mocks.loadReferenceWeight).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it("refuses a forged day", async () => {
      const result = await saveWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "2026-01-01" }));
      expect(result).toMatchObject({ status: "error", errors: [{ code: "invalid_day", field: "day" }] });
      expect(mocks.insertWeightEntry).not.toHaveBeenCalled();
    });

    it("refuses 'keep' in new mode", async () => {
      const result = await saveWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "keep" }));
      expect(result).toMatchObject({ status: "error", errors: [{ code: "invalid_day" }] });
    });

    it("refuses a note over 200 characters", async () => {
      const result = await saveWeightAction(null, weightForm({ [WEIGHT_FORM.note]: "x".repeat(201) }));
      expect(result).toMatchObject({ status: "error", errors: [{ code: "note_too_long", field: "note" }] });
    });
  });

  describe("the soft double-check", () => {
    it("asks once, and saves nothing, when the number is 15 kg or more from the previous weigh-in", async () => {
      const result = await saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "133.7" }));
      expect(result).toEqual({ status: "check", values: { weight: "133.7", day: "now", note: "", confirmed: false } });
      expect(mocks.insertWeightEntry).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it("does not ask just under 15 kg", async () => {
      await expect(outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "133.6" })))).resolves.toBe(savedAt);
    });

    it("asks for a number far below as well as above", async () => {
      const result = await saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "100" }));
      expect(result).toMatchObject({ status: "check" });
    });

    it("saves after the person confirmed, and says so in the event", async () => {
      await expect(outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "100", [WEIGHT_FORM.confirmed]: "1" })))).resolves.toBe(savedAt);
      expect(mocks.insertWeightEntry).toHaveBeenCalledWith(supabase, expect.objectContaining({ weightKg: 100 }));
      expect(mocks.track.mock.calls[0][2]).toEqual({ day: "now", checked: true, has_note: false });
    });

    it("does not call a forged confirmation 'checked' when nothing was far", async () => {
      await outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.confirmed]: "1" })));
      expect(mocks.track.mock.calls[0][2]).toMatchObject({ checked: false });
    });

    it("falls back to the profile's starting weight when there is no earlier weigh-in", async () => {
      mocks.loadReferenceWeight.mockResolvedValue(null);
      const far = await saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "80" }));
      expect(far).toMatchObject({ status: "check" });
      await expect(outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "110" })))).resolves.toBe(savedAt);
    });

    it("asks nothing when there is no earlier weigh-in and no starting weight", async () => {
      mocks.loadReferenceWeight.mockResolvedValue(null);
      mocks.actionContext.mockResolvedValue(ready(null));
      await expect(outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "40" })))).resolves.toBe(savedAt);
    });

    it("asks nothing when the previous weigh-in could not be read: unknown never asks", async () => {
      mocks.loadReferenceWeight.mockResolvedValue("unknown");
      await expect(outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "40" })))).resolves.toBe(savedAt);
    });
  });

  describe("a save that did not go through", () => {
    it("keeps what was typed, says nothing was saved, and logs a code only", async () => {
      mocks.insertWeightEntry.mockResolvedValue({ ok: false, code: "unavailable" });
      const result = await saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: WEIGHT, [WEIGHT_FORM.note]: MARKER }));
      expect(result).toEqual({
        status: "error",
        errors: [{ code: "not_saved" }],
        values: { weight: WEIGHT, day: "now", note: MARKER, confirmed: false },
      });
      expect(mocks.logAppError).toHaveBeenCalledTimes(1);
      expect(mocks.logAppError).toHaveBeenCalledWith({
        userId: "user-1",
        area: "weight",
        message: "save_error",
        context: { stage: "insert", code: "unavailable" },
      });
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("privacy", () => {
    it("never puts the number or the note in an event, an error row or a console line", async () => {
      await outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: WEIGHT, [WEIGHT_FORM.note]: MARKER, [WEIGHT_FORM.confirmed]: "1" })));
      mocks.insertWeightEntry.mockResolvedValue({ ok: false, code: "unavailable" });
      await outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: WEIGHT, [WEIGHT_FORM.note]: MARKER, [WEIGHT_FORM.confirmed]: "1" })));

      const seen = JSON.stringify([mocks.track.mock.calls, mocks.logAppError.mock.calls]);
      expect(seen).not.toContain(MARKER);
      expect(seen).not.toContain("123");
      const logged = (["log", "info", "warn", "error"] as const).flatMap((method) => vi.mocked(console[method]).mock.calls);
      expect(JSON.stringify(logged)).not.toContain(MARKER);
      expect(JSON.stringify(logged)).not.toContain("123");
    });

    it("sends an event payload that carries no key named weight, kg, note or value", async () => {
      await outcome(() => saveWeightAction(null, weightForm({ [WEIGHT_FORM.note]: MARKER })));
      const keys = Object.keys(mocks.track.mock.calls[0][2]);
      for (const forbidden of ["weight", "weightKg", "kg", "note", "value"]) expect(keys).not.toContain(forbidden);
    });
  });
});

describe("editWeightAction", () => {
  describe("a weight that was changed", () => {
    it("runs in the safe order: session, offline check, load, write, event, refresh, redirect", async () => {
      await expect(outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "117.2", [WEIGHT_FORM.day]: "keep" })))).resolves.toBe(editedAt);
      expect(mocks.log).toEqual(["context", "offline", "load", "reference", "update", "track", "revalidate", "redirect"]);
    });

    it("leaves the time alone for 'keep'", async () => {
      await outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "117.2", [WEIGHT_FORM.day]: "keep", [WEIGHT_FORM.note]: "fixed" })));
      expect(mocks.updateWeightEntry).toHaveBeenCalledWith(supabase, { id: ID, weightKg: 117.2, measuredAt: null, note: "fixed" });
    });

    it("moves the time to noon of a chosen day", async () => {
      await outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "2026-09-30" })));
      expect(mocks.updateWeightEntry).toHaveBeenCalledWith(supabase, expect.objectContaining({ measuredAt: new Date("2026-09-30T09:00:00Z") }));
    });

    it("refuses 'now' in edit mode: it is not one of the options", async () => {
      const result = await editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "now" }));
      expect(result).toMatchObject({ status: "error", errors: [{ code: "invalid_day" }] });
      expect(mocks.updateWeightEntry).not.toHaveBeenCalled();
    });

    it("tells the world with booleans only, against the loaded row, and the app's clock", async () => {
      mocks.loadWeightEntry.mockResolvedValue(entry({ weightKg: 118.7, note: "old" }));
      await outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "117.2", [WEIGHT_FORM.day]: "keep", [WEIGHT_FORM.note]: "new" })));
      const [, name, payload, at] = mocks.track.mock.calls[0];
      expect(name).toBe("weight_edited");
      expect(payload).toEqual({ weight_changed: true, day_changed: false, note_changed: true });
      expect(at).toBe(NOW);
    });

    it("reports nothing changed as three false booleans", async () => {
      mocks.loadWeightEntry.mockResolvedValue(entry({ weightKg: 118.7, note: null }));
      await outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "keep" })));
      expect(mocks.track.mock.calls[0][2]).toEqual({ weight_changed: false, day_changed: false, note_changed: false });
    });

    it("reports a different local day as changed, and the same local day as not", async () => {
      // The entry is 2026-09-29 12:00 in Jerusalem.
      await outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "2026-09-29" })));
      expect(mocks.track.mock.calls[0][2]).toMatchObject({ day_changed: false });
      mocks.track.mockClear();
      await outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "2026-09-30" })));
      expect(mocks.track.mock.calls[0][2]).toMatchObject({ day_changed: true });
    });

    it("refreshes every page the person has seen", async () => {
      await outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "keep" })));
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });
  });

  describe("the guards", () => {
    it("answers 404 for an id that is not a UUID", async () => {
      await expect(outcome(() => editWeightAction(null, weightForm({}, "nope")))).resolves.toBe("NOT_FOUND");
      expect(mocks.log).toEqual([]);
    });

    it("sends the person Home when weight reporting is switched off", async () => {
      mocks.flow.reportingEnabled = false;
      await expect(outcome(() => editWeightAction(null, weightForm()))).resolves.toBe("REDIRECT:/:default");
      expect(mocks.updateWeightEntry).not.toHaveBeenCalled();
    });

    it("answers 404 when the entry is not the person's own (or is gone), and writes nothing", async () => {
      mocks.loadWeightEntry.mockResolvedValue({ ok: false, code: "not_found" });
      await expect(outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "keep" })))).resolves.toBe("NOT_FOUND");
      expect(mocks.updateWeightEntry).not.toHaveBeenCalled();
    });

    it("answers 404 when the write finds no row", async () => {
      mocks.updateWeightEntry.mockResolvedValue({ ok: false, code: "not_found" });
      await expect(outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "keep" })))).resolves.toBe("NOT_FOUND");
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it("keeps what was typed when the database cannot be reached", async () => {
      mocks.actionContext.mockResolvedValue({ kind: "unavailable" });
      const result = await editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "keep" }));
      expect(result).toMatchObject({ status: "error", errors: [{ code: "not_saved" }] });
    });
  });

  describe("Shabbat and every other offline period", () => {
    it("redirects to the edit address (which shows the quiet screen) and writes nothing", async () => {
      mocks.loadOfflinePeriods.mockResolvedValue([{ type: "SHABBAT", start: new Date("2026-10-01T08:00:00Z"), end: new Date("2026-10-02T18:00:00Z") }]);
      await expect(outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "keep" })))).resolves.toBe(`REDIRECT:${WEIGHT_ROUTES.edit(ID)}:default`);
      expect(mocks.loadWeightEntry).not.toHaveBeenCalled();
      expect(mocks.updateWeightEntry).not.toHaveBeenCalled();
      expect(mocks.log).toEqual(["context", "offline", "redirect"]);
    });

    it("goes on when the periods cannot be read", async () => {
      mocks.loadOfflinePeriods.mockResolvedValue(null);
      await expect(outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "keep" })))).resolves.toBe(editedAt);
    });
  });

  describe("a form that is refused", () => {
    it("returns the typed values and writes nothing", async () => {
      const result = await editWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "abc", [WEIGHT_FORM.day]: "keep", [WEIGHT_FORM.note]: "n" }));
      expect(result).toEqual({
        status: "error",
        errors: [{ code: "invalid_number", field: "weight" }],
        values: { weight: "abc", day: "keep", note: "n", confirmed: false },
      });
      expect(mocks.updateWeightEntry).not.toHaveBeenCalled();
    });
  });

  describe("the soft double-check", () => {
    it("asks when the CHANGED number is far from the weigh-in before it, excluding this entry", async () => {
      const result = await editWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "181", [WEIGHT_FORM.day]: "keep" }));
      expect(result).toMatchObject({ status: "check" });
      expect(mocks.loadReferenceWeight).toHaveBeenCalledWith(supabase, { before: new Date("2026-09-29T09:00:00Z"), excludeId: ID });
      expect(mocks.updateWeightEntry).not.toHaveBeenCalled();
    });

    it("saves the changed number after the person confirmed", async () => {
      await expect(outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: "181", [WEIGHT_FORM.day]: "keep", [WEIGHT_FORM.confirmed]: "1" })))).resolves.toBe(editedAt);
    });

    it("never asks again about a number that did not change (fixing a note must not bring the question back)", async () => {
      mocks.loadReferenceWeight.mockResolvedValue(60);
      await expect(outcome(() => editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "keep", [WEIGHT_FORM.note]: "only the note" })))).resolves.toBe(editedAt);
      expect(mocks.loadReferenceWeight).not.toHaveBeenCalled();
    });
  });

  describe("a write that did not go through", () => {
    it("keeps what was typed and logs a code only", async () => {
      mocks.updateWeightEntry.mockResolvedValue({ ok: false, code: "unavailable" });
      const result = await editWeightAction(null, weightForm({ [WEIGHT_FORM.weight]: WEIGHT, [WEIGHT_FORM.day]: "keep", [WEIGHT_FORM.note]: MARKER, [WEIGHT_FORM.confirmed]: "1" }));
      expect(result).toMatchObject({ status: "error", errors: [{ code: "not_saved" }] });
      expect(mocks.logAppError).toHaveBeenCalledWith({
        userId: "user-1",
        area: "weight",
        message: "save_error",
        context: { stage: "edit_write", code: "unavailable" },
      });
      expect(JSON.stringify(mocks.logAppError.mock.calls)).not.toContain(MARKER);
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it("keeps what was typed when the entry could not be loaded", async () => {
      mocks.loadWeightEntry.mockResolvedValue({ ok: false, code: "unavailable" });
      const result = await editWeightAction(null, weightForm({ [WEIGHT_FORM.day]: "keep" }));
      expect(result).toMatchObject({ status: "error", errors: [{ code: "not_saved" }] });
      expect(mocks.logAppError).toHaveBeenCalledWith(expect.objectContaining({ context: { stage: "edit_load", code: "unavailable" } }));
    });
  });
});
