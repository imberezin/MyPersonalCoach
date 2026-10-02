// What the three experiment Server Actions do, with every outside piece mocked: the session, the loaders, the
// writers, the wording module, the event sink and the clock. The real redirect() is replaced; the rules
// (selectFirstExperiment, the closed gate reasons) run for real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORDING_GATE_REASONS } from "@/domain/experiments/wording";
import type { Occurrence, PatternRow, PatternView } from "@/domain/patterns";
import { classifyPattern } from "@/domain/patternLifecycle";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { proposeFirstExperimentAction, skipFirstExperimentAction, startFirstExperimentAction } from "./actions";

const mocks = vi.hoisted(() => ({
  context: { current: null as unknown },
  configured: { current: true },
  locale: { current: "he" as "he" | "en" },
  loadSummary: vi.fn(),
  loadOffline: vi.fn(),
  loadSignal: vi.fn(),
  sync: vi.fn(),
  loadExperiments: vi.fn(),
  insertOffered: vi.fn(),
  upgrade: vi.fn(),
  start: vi.fn(),
  skip: vi.fn(),
  produce: vi.fn(),
  createRuntime: vi.fn(),
  createRecorder: vi.fn(),
  logAppError: vi.fn(),
  checkAllowance: vi.fn(),
  track: vi.fn(),
  revalidatePath: vi.fn(),
  currentInstant: vi.fn(),
  flow: { summaryEnabled: true, welcomeBackEnabled: true, acknowledgementEnabled: true },
  pattern: { detectionEnabled: true, earlySignalEnabled: true, experimentEnabled: true, syncOnMealChange: true },
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => mocks.configured.current }));
vi.mock("@/lib/onboarding/context", () => ({ loadOnboardingContext: async () => mocks.context.current }));
vi.mock("@/lib/firstWeek/load", () => ({ loadFirstWeekSummary: mocks.loadSummary }));
vi.mock("@/lib/home/load", () => ({ loadOfflinePeriods: mocks.loadOffline }));
vi.mock("@/lib/patterns/load", () => ({ loadLateEveningSignal: mocks.loadSignal }));
vi.mock("@/lib/patterns/sync", () => ({ syncPatternEvidence: mocks.sync }));
vi.mock("@/lib/experiments/repo", () => ({
  loadExperiments: mocks.loadExperiments,
  insertOfferedExperiment: mocks.insertOffered,
  upgradeOfferedWording: mocks.upgrade,
  startExperiment: mocks.start,
  skipExperiment: mocks.skip,
}));
vi.mock("@/lib/experiments/word", () => ({ produceExperimentWording: mocks.produce }));
vi.mock("@/lib/ai/factory", () => ({ createAiRuntime: mocks.createRuntime }));
vi.mock("@/lib/ai/ledger", () => ({ createSupabaseRecorder: mocks.createRecorder, logAppError: mocks.logAppError }));
vi.mock("@/lib/ai/allowance", () => ({ checkAiAllowance: mocks.checkAllowance }));
vi.mock("@/lib/analytics/track", () => ({ track: mocks.track, SupabaseEventsSink: class {} }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
vi.mock("@/domain/firstWeekFlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/firstWeekFlow")>()),
  FIRST_WEEK_FLOW: mocks.flow,
}));
vi.mock("@/domain/patterns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/patterns")>()),
  PATTERN_FLOW: mocks.pattern,
}));
vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("use-intl/core");
  const messages = {
    he: (await import("@/i18n/messages/he.json")).default,
    en: (await import("@/i18n/messages/en.json")).default,
  };
  return {
    getLocale: async () => mocks.locale.current,
    getTranslations: async (namespace?: string) => {
      const t = createTranslator({ locale: mocks.locale.current, messages: messages[mocks.locale.current] as never, namespace: namespace as never, timeZone: "UTC" });
      return (key: string, values?: Record<string, unknown>) => t(key as never, values as never);
    },
  };
});

// A development clock: a fixed instant in the past, so every event must carry THIS and not the real time.
const NOW = new Date("2026-10-07T08:00:00Z");
const USER = "user-1";
const supabase = { tag: "user-client" };
const RUNTIME = { tag: "runtime", configured: true };
const ready = (lifecycle_state = "FIRST_WEEK", timezone = "Asia/Jerusalem") => ({ kind: "ready", userId: USER, row: { lifecycle_state, timezone }, supabase });

const SENTENCE = { he: he.interventions.eat_intentionally.default, en: en.interventions.eat_intentionally.default };

/** `n` evenings with a 21:30 local meal, one per day, from 4 October on. */
function evenings(n: number): Occurrence[] {
  return Array.from({ length: n }, (_unused, i) => {
    const day = 4 + i;
    return { mealId: `meal-${i}`, occurredAt: new Date(Date.UTC(2026, 9, day, 18, 30)), localDay: `2026-10-0${day}` };
  });
}
function signal(n: number, row: PatternRow | null = { id: "pattern-1", status: "CANDIDATE", feedback: null, feedbackAt: null }, view?: PatternView) {
  const occurrences = evenings(n);
  return { occurrences, row, view: view ?? classifyPattern(occurrences.map((o) => o.occurredAt), "Asia/Jerusalem", false) };
}

const OFFER = { kind: "OFFER", patternKind: "late_evening_meals", key: "eat_intentionally", variantId: "default", scope: "next_meal", params: {}, constraints: [] };
const readySummary = (selection: unknown = OFFER, sig: unknown = signal(3)) => ({
  kind: "ready",
  reason: "enough_data",
  hadEnoughData: true,
  progress: { availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 0 },
  summary: {},
  experiment: { selection, open: null },
  signal: sig,
});

const openRow = (over: Record<string, unknown> = {}) => ({
  id: "exp-1",
  status: "OFFERED",
  key: "eat_intentionally",
  variantId: "default",
  wording: "stored",
  source: "library",
  locale: "he",
  ...over,
});
const offeredExperiments = (over: Record<string, unknown> = {}) => ({
  facts: [{ id: "exp-1", status: over.status ?? "OFFERED", sourcePatternId: "pattern-1", endedAt: null }],
  open: openRow(over),
});

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "RETURNED";
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN";
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const writes = () => [mocks.sync, mocks.insertOffered, mocks.upgrade, mocks.start, mocks.skip, mocks.track, mocks.revalidatePath];
const callOrder = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
const events = () => mocks.track.mock.calls.map((call) => [call[1], call[2]]);

beforeEach(() => {
  mocks.configured.current = true;
  mocks.context.current = ready();
  mocks.locale.current = "he";
  for (const fn of [
    mocks.loadSummary,
    mocks.loadOffline,
    mocks.loadSignal,
    mocks.sync,
    mocks.loadExperiments,
    mocks.insertOffered,
    mocks.upgrade,
    mocks.start,
    mocks.skip,
    mocks.produce,
    mocks.createRuntime,
    mocks.createRecorder,
    mocks.logAppError,
    mocks.checkAllowance,
    mocks.track,
    mocks.revalidatePath,
    mocks.currentInstant,
  ]) {
    fn.mockReset();
  }
  Object.assign(mocks.flow, { summaryEnabled: true });
  Object.assign(mocks.pattern, { experimentEnabled: true });
  mocks.currentInstant.mockReturnValue(NOW);
  mocks.loadOffline.mockResolvedValue([]);
  mocks.loadSummary.mockResolvedValue(readySummary());
  mocks.sync.mockResolvedValue({ ok: true, patternId: "pattern-1" });
  mocks.insertOffered.mockResolvedValue({ ok: true, value: { id: "exp-1", created: true } });
  mocks.createRecorder.mockReturnValue({ tag: "recorder" });
  mocks.createRuntime.mockReturnValue(RUNTIME);
  mocks.produce.mockResolvedValue({ source: "ai", text: "reworded sentence", provider: "fake", model: "m" });
  mocks.upgrade.mockResolvedValue({ ok: true, value: { changed: true } });
  mocks.track.mockResolvedValue(undefined);
  mocks.loadExperiments.mockResolvedValue(offeredExperiments());
  mocks.loadSignal.mockResolvedValue(signal(3));
  mocks.start.mockResolvedValue({ ok: true, value: { changed: true } });
  mocks.skip.mockResolvedValue({ ok: true, value: { changed: true } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("proposeFirstExperimentAction", () => {
  it("reads no form at all", () => {
    expect(proposeFirstExperimentAction.length).toBe(0);
  });

  describe("the order of a real offer (the AI only after the approved sentence is stored)", () => {
    it("checks, syncs the evidence, stores the LIBRARY sentence, THEN asks for the wording, upgrades, tells the world, goes to B5", async () => {
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");

      const order = [mocks.loadOffline, mocks.loadSummary, mocks.sync, mocks.insertOffered, mocks.produce, mocks.upgrade, mocks.track, mocks.revalidatePath].map(callOrder);
      expect(order.every((n) => Number.isFinite(n))).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));

      // The pattern row and its evidence come first, from the LIVE signal.
      expect(mocks.sync).toHaveBeenCalledTimes(1);
      expect(mocks.sync).toHaveBeenCalledWith(supabase, { occurrences: evenings(3), view: "CANDIDATE" });
      // The offer exists with approved text BEFORE any AI call.
      expect(mocks.insertOffered).toHaveBeenCalledTimes(1);
      expect(mocks.insertOffered).toHaveBeenCalledWith(supabase, {
        patternId: "pattern-1",
        key: "eat_intentionally",
        variantId: "default",
        libraryText: SENTENCE.he,
        locale: "he",
      });
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("asks the wording module once, with the library sentence, the live evenings and days, and a runtime built for this press", async () => {
      await outcome(() => proposeFirstExperimentAction());

      expect(mocks.createRecorder).toHaveBeenCalledWith({ userId: USER });
      expect(mocks.createRuntime).toHaveBeenCalledWith({ recorder: { tag: "recorder" } });
      expect(mocks.produce).toHaveBeenCalledTimes(1);
      const [deps, input] = mocks.produce.mock.calls[0] ?? [];
      expect(deps).toEqual({
        runtime: RUNTIME,
        supabase,
        userId: USER,
        now: NOW,
        timeZone: "Asia/Jerusalem",
        checkAllowance: mocks.checkAllowance,
        logError: mocks.logAppError,
      });
      expect(input).toEqual({
        offer: { key: "eat_intentionally", variantId: "default", scope: "next_meal" },
        approvedText: SENTENCE.he,
        locale: "he",
        signal: { view: "CANDIDATE", occurrences: 3, distinctDays: 3 },
        availableDays: 5,
      });
    });

    it("sends nothing the person wrote to the wording module: only the approved sentence and closed values", async () => {
      await outcome(() => proposeFirstExperimentAction());
      const [, input] = mocks.produce.mock.calls[0] ?? [];
      expect(Object.keys(input).sort()).toEqual(["approvedText", "availableDays", "locale", "offer", "signal"]);
      expect(Object.keys(input.signal).sort()).toEqual(["distinctDays", "occurrences", "view"]);
    });

    it("uses the English sentence and locale for an English page", async () => {
      mocks.locale.current = "en";
      await outcome(() => proposeFirstExperimentAction());
      expect(mocks.insertOffered).toHaveBeenCalledWith(supabase, expect.objectContaining({ libraryText: SENTENCE.en, locale: "en" }));
      expect(mocks.produce.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ approvedText: SENTENCE.en, locale: "en" }));
    });
  });

  describe("what is stored and reported", () => {
    it("upgrades the stored sentence with the validated wording and reports source ai with the gate open", async () => {
      await outcome(() => proposeFirstExperimentAction());
      expect(mocks.upgrade).toHaveBeenCalledTimes(1);
      expect(mocks.upgrade).toHaveBeenCalledWith(supabase, USER, { text: "reworded sentence", locale: "he" });
      expect(events()).toEqual([["experiment_offered", { source: "ai", gate: "open" }]]);
    });

    it("reports what is STORED: an upgrade that changed nothing means the library text stays, and the source is library", async () => {
      mocks.upgrade.mockResolvedValue({ ok: true, value: { changed: false } });
      await outcome(() => proposeFirstExperimentAction());
      expect(events()).toEqual([["experiment_offered", { source: "library", gate: "open" }]]);
    });

    it("keeps the library text, and still redirects, when the upgrade fails", async () => {
      mocks.upgrade.mockResolvedValue({ ok: false, code: "unavailable" });
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");
      expect(events()).toEqual([["experiment_offered", { source: "library", gate: "open" }]]);
    });

    it.each(WORDING_GATE_REASONS)("a closed gate (%s) stores nothing more, reports the gate, and is NOT a fallback", async (reason) => {
      mocks.produce.mockResolvedValue({ source: "library", text: SENTENCE.he, reason });
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");
      expect(mocks.upgrade).not.toHaveBeenCalled();
      expect(events()).toEqual([["experiment_offered", { source: "library", gate: reason }]]);
    });

    it.each(["provider_failed", "invalid_output", "no_providers", "budget_exhausted", "rejected_digits", "rejected_negation"])(
      "an AI path that failed (%s) keeps the library text, reports the gate as open, and adds the fallback event with the reason",
      async (reason) => {
        mocks.produce.mockResolvedValue({ source: "library", text: SENTENCE.he, reason });
        await outcome(() => proposeFirstExperimentAction());
        expect(mocks.upgrade).not.toHaveBeenCalled();
        expect(events()).toEqual([
          ["experiment_offered", { source: "library", gate: "open" }],
          ["experiment_wording_fallback", { reason }],
        ]);
      },
    );

    it("stamps EVERY event with the app's instant as the fourth argument", async () => {
      mocks.produce.mockResolvedValue({ source: "library", text: SENTENCE.he, reason: "rejected_foods" });
      await outcome(() => proposeFirstExperimentAction());
      expect(mocks.track).toHaveBeenCalledTimes(2);
      for (const call of mocks.track.mock.calls) expect(call[3]).toBe(NOW);
    });

    it("does not let a rejecting event sink change where the person lands", async () => {
      mocks.track.mockRejectedValue(new Error("sink down"));
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");
    });
  });

  describe("a double tap, a second tab, an overlapping press", () => {
    it("makes NO wording call, NO upgrade and NO event when the offer already exists, and goes to B5", async () => {
      mocks.insertOffered.mockResolvedValue({ ok: true, value: { id: "exp-1", created: false } });

      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");

      expect(mocks.produce).not.toHaveBeenCalled();
      expect(mocks.createRuntime).not.toHaveBeenCalled();
      expect(mocks.upgrade).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it("makes ONE wording call even when a second press runs to completion while the first is still waiting for the AI", async () => {
      let finish: (value: unknown) => void = () => {};
      mocks.produce.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      mocks.insertOffered
        .mockResolvedValueOnce({ ok: true, value: { id: "exp-1", created: true } })
        .mockResolvedValueOnce({ ok: true, value: { id: "exp-1", created: false } });

      const first = outcome(() => proposeFirstExperimentAction());
      while (mocks.produce.mock.calls.length === 0) await tick();

      // The second press finds the stored offer and finishes at once.
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");
      expect(mocks.produce).toHaveBeenCalledTimes(1);
      expect(mocks.track).not.toHaveBeenCalled();

      finish({ source: "ai", text: "reworded sentence", provider: "fake", model: "m" });
      await expect(first).resolves.toBe("REDIRECT:/first-week/experiment");
      expect(mocks.produce).toHaveBeenCalledTimes(1);
      expect(mocks.upgrade).toHaveBeenCalledTimes(1);
      expect(events()).toEqual([["experiment_offered", { source: "ai", gate: "open" }]]);
    });

    it("leaves the approved sentence stored, and nothing else, when the request dies during the AI call", async () => {
      mocks.produce.mockReturnValue(new Promise(() => {}));
      void outcome(() => proposeFirstExperimentAction());
      while (mocks.produce.mock.calls.length === 0) await tick();
      await tick();

      expect(mocks.insertOffered).toHaveBeenCalledTimes(1);
      expect(mocks.insertOffered).toHaveBeenCalledWith(supabase, expect.objectContaining({ libraryText: SENTENCE.he }));
      expect(mocks.upgrade).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("failures leave nothing half-done", () => {
    it("lands on the summary with the failed flag, with no offer and no AI call, when the evidence sync failed", async () => {
      mocks.sync.mockResolvedValue({ ok: false });
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week?failed=1");
      expect(mocks.insertOffered).not.toHaveBeenCalled();
      expect(mocks.produce).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it("lands on the summary with the failed flag, with no AI call, when storing the offer failed", async () => {
      mocks.insertOffered.mockResolvedValue({ ok: false, code: "unavailable" });
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week?failed=1");
      expect(mocks.produce).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });
  });

  describe("what the live data says", () => {
    it("goes straight to B5, with no AI call and no write, when the idea is already waiting", async () => {
      mocks.loadSummary.mockResolvedValue(readySummary({ kind: "PENDING", experimentId: "exp-1" }));
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");
      expect(mocks.produce).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it("goes to B5 when the experiment is already started, with no AI call and no write", async () => {
      mocks.loadSummary.mockResolvedValue(readySummary({ kind: "ACTIVE", experimentId: "exp-1" }));
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");
      expect(mocks.produce).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it.each([
      ["there is nothing to offer", readySummary({ kind: "NONE", reason: "pattern_not_established" })],
      ["the summary is not ready any more", { kind: "not_ready" }],
      ["a read failed", { kind: "unavailable" }],
      ["the live signal is unknown", readySummary(OFFER, null)],
      ["the live signal is rejected", readySummary(OFFER, signal(3, null, "REJECTED"))],
    ])("goes back to the summary with ZERO writes and no AI call when %s", async (_name, loaded) => {
      mocks.loadSummary.mockResolvedValue(loaded);
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week");
      expect(mocks.produce).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it("sends Home with ZERO writes and no AI call when the lifecycle is not the First Week by the loader's reading", async () => {
      mocks.loadSummary.mockResolvedValue({ kind: "not_first_week" });
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/");
      expect(mocks.produce).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("quiet time and the gates", () => {
    it("sends Home with ZERO writes and ZERO AI calls during Shabbat or any offline period, before anything else is read", async () => {
      mocks.loadOffline.mockResolvedValue([{ type: "SHABBAT", start: new Date(NOW.getTime() - 3_600_000), end: new Date(NOW.getTime() + 3_600_000) }]);
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/");
      expect(mocks.loadSummary).not.toHaveBeenCalled();
      expect(mocks.produce).not.toHaveBeenCalled();
      expect(mocks.createRuntime).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it("carries on when the offline periods cannot be read (unknown is not quiet; the rest re-checks)", async () => {
      mocks.loadOffline.mockResolvedValue(null);
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");
    });

    it("reads the offline periods for the verified user at the app's instant", async () => {
      await outcome(() => proposeFirstExperimentAction());
      expect(mocks.loadOffline).toHaveBeenCalledWith(supabase, USER, NOW);
    });

    it("sends Home when Supabase is not set up", async () => {
      mocks.configured.current = false;
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/");
    });

    it("sends a signed-out visitor to sign in", async () => {
      mocks.context.current = { kind: "signed_out" };
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/login");
    });

    it.each(["NEW", "ONBOARDING"])("sends a user in %s to onboarding", async (state) => {
      mocks.context.current = ready(state);
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe("REDIRECT:/onboarding");
    });

    it.each([
      ["a user in the weekly cycle", () => (mocks.context.current = ready("WEEKLY_CYCLE")), "REDIRECT:/"],
      ["the summary switched off", () => (mocks.flow.summaryEnabled = false), "REDIRECT:/"],
      ["the experiment switched off", () => (mocks.pattern.experimentEnabled = false), "REDIRECT:/"],
      ["an unreadable context", () => (mocks.context.current = { kind: "unavailable" }), "REDIRECT:/first-week"],
    ])("sends away, with ZERO reads, writes and AI calls, for %s", async (_name, arrange, to) => {
      arrange();
      await expect(outcome(() => proposeFirstExperimentAction())).resolves.toBe(to);
      expect(mocks.loadOffline).not.toHaveBeenCalled();
      expect(mocks.loadSummary).not.toHaveBeenCalled();
      expect(mocks.produce).not.toHaveBeenCalled();
      expect(mocks.createRuntime).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });
  });
});

describe("startFirstExperimentAction", () => {
  it("reads no form at all", () => {
    expect(startFirstExperimentAction.length).toBe(0);
  });

  it("starts the person's single offered experiment at the app's instant, tells the world once, and goes to B5", async () => {
    await expect(outcome(() => startFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");

    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledWith(supabase, USER, NOW);
    expect(mocks.track).toHaveBeenCalledTimes(1);
    const [, name, payload, at] = mocks.track.mock.calls[0] ?? [];
    expect([name, payload]).toEqual(["experiment_started", { source: "library" }]);
    expect(at).toBe(NOW);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("reports where the stored sentence came from", async () => {
    mocks.loadExperiments.mockResolvedValue(offeredExperiments({ source: "ai" }));
    await outcome(() => startFirstExperimentAction());
    expect(events()).toEqual([["experiment_started", { source: "ai" }]]);
  });

  it("says nothing the second time: an experiment that was already started, skipped or gone changes no row", async () => {
    mocks.start.mockResolvedValue({ ok: true, value: { changed: false } });
    await expect(outcome(() => startFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("lands on B5 with the failed flag, and tells nobody, when the write failed", async () => {
    mocks.start.mockResolvedValue({ ok: false, code: "unavailable" });
    await expect(outcome(() => startFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment?failed=1");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("lands on B5 with the failed flag when the experiments cannot be read, writing nothing", async () => {
    mocks.loadExperiments.mockResolvedValue(null);
    await expect(outcome(() => startFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment?failed=1");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ["nothing is open", { facts: [], open: null }],
    ["the open experiment is already started", offeredExperiments({ status: "ACTIVE" })],
  ])("goes to the summary with ZERO writes and no event when %s", async (_name, experiments) => {
    mocks.loadExperiments.mockResolvedValue(experiments);
    await expect(outcome(() => startFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ["only two evenings are left", signal(2)],
    ["the evidence is gone", signal(0)],
    ["the person said 'Not related to me'", signal(3, { id: "pattern-1", status: "REJECTED", feedback: "reject", feedbackAt: NOW }, "REJECTED")],
    ["the live signal cannot be read", null],
  ])("re-checks the live meals: goes to the summary with ZERO writes when %s", async (_name, live) => {
    mocks.loadSignal.mockResolvedValue(live);
    await expect(outcome(() => startFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it("re-checks with the same selection the pages make, at the app's instant, for the verified user", async () => {
    await outcome(() => startFirstExperimentAction());
    expect(mocks.loadSignal).toHaveBeenCalledWith(supabase, USER, "Asia/Jerusalem", NOW);
    expect(mocks.loadExperiments).toHaveBeenCalledWith(supabase, USER);
  });

  it("never calls the wording module", async () => {
    await outcome(() => startFirstExperimentAction());
    expect(mocks.produce).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
  });

  it("does not let a rejecting event sink change where the person lands", async () => {
    mocks.track.mockRejectedValue(new Error("sink down"));
    await expect(outcome(() => startFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment");
  });

  describe("the gates", () => {
    it("sends Home when Supabase is not set up", async () => {
      mocks.configured.current = false;
      await expect(outcome(() => startFirstExperimentAction())).resolves.toBe("REDIRECT:/");
    });

    it("sends a signed-out visitor to sign in", async () => {
      mocks.context.current = { kind: "signed_out" };
      await expect(outcome(() => startFirstExperimentAction())).resolves.toBe("REDIRECT:/login");
    });

    it.each([
      ["a user in the weekly cycle", () => (mocks.context.current = ready("WEEKLY_CYCLE")), "REDIRECT:/"],
      ["the summary switched off", () => (mocks.flow.summaryEnabled = false), "REDIRECT:/"],
      ["the experiment switched off", () => (mocks.pattern.experimentEnabled = false), "REDIRECT:/"],
      ["an unreadable context", () => (mocks.context.current = { kind: "unavailable" }), "REDIRECT:/first-week"],
    ])("sends away with ZERO reads and writes for %s", async (_name, arrange, to) => {
      arrange();
      await expect(outcome(() => startFirstExperimentAction())).resolves.toBe(to);
      expect(mocks.loadExperiments).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });
  });
});

describe("skipFirstExperimentAction", () => {
  it("reads no form at all", () => {
    expect(skipFirstExperimentAction.length).toBe(0);
  });

  it("skips the person's single offered experiment at the app's instant, tells the world once, and goes to the summary", async () => {
    await expect(outcome(() => skipFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week");

    expect(mocks.skip).toHaveBeenCalledTimes(1);
    expect(mocks.skip).toHaveBeenCalledWith(supabase, USER, NOW);
    expect(mocks.track).toHaveBeenCalledTimes(1);
    const [, name, payload, at] = mocks.track.mock.calls[0] ?? [];
    expect([name, payload]).toEqual(["experiment_skipped", { source: "library" }]);
    expect(at).toBe(NOW);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("lets the person say no even when the evidence behind the idea is gone (no live check is needed to close an offer)", async () => {
    mocks.loadSignal.mockResolvedValue(signal(0));
    await expect(outcome(() => skipFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week");
    expect(mocks.skip).toHaveBeenCalledTimes(1);
  });

  it("says nothing the second time: an experiment that was already started, skipped or gone changes no row", async () => {
    mocks.skip.mockResolvedValue({ ok: true, value: { changed: false } });
    await expect(outcome(() => skipFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("lands on B5 with the failed flag, and tells nobody, when the write failed", async () => {
    mocks.skip.mockResolvedValue({ ok: false, code: "unavailable" });
    await expect(outcome(() => skipFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week/experiment?failed=1");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it.each([
    ["nothing is open", { facts: [], open: null }],
    ["the open experiment is already started", offeredExperiments({ status: "ACTIVE" })],
  ])("goes to the summary with ZERO writes and no event when %s", async (_name, experiments) => {
    mocks.loadExperiments.mockResolvedValue(experiments);
    await expect(outcome(() => skipFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it("never calls the wording module, and does not let a rejecting event sink change where the person lands", async () => {
    mocks.track.mockRejectedValue(new Error("sink down"));
    await expect(outcome(() => skipFirstExperimentAction())).resolves.toBe("REDIRECT:/first-week");
    expect(mocks.produce).not.toHaveBeenCalled();
  });

  it.each([
    ["a user in the weekly cycle", () => (mocks.context.current = ready("WEEKLY_CYCLE")), "REDIRECT:/"],
    ["a signed-out visitor", () => (mocks.context.current = { kind: "signed_out" }), "REDIRECT:/login"],
    ["the experiment switched off", () => (mocks.pattern.experimentEnabled = false), "REDIRECT:/"],
  ])("sends away with ZERO reads and writes for %s", async (_name, arrange, to) => {
    arrange();
    await expect(outcome(() => skipFirstExperimentAction())).resolves.toBe(to);
    expect(mocks.loadExperiments).not.toHaveBeenCalled();
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });
});
