// What the First Week Server Actions do, with every outside piece mocked: the session, the loaders, the writers, the
// event sink and the clock. The real redirect() and revalidatePath() are replaced; the rules (decideEarlySignal,
// effectivePatternStatus, activeSnoozes, the closed lists) run for real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSnoozes, experimentCardSnoozed, FIRST_WEEK_SNOOZE } from "@/domain/firstWeekFlow";
import { toDbStatus, type Occurrence, type PatternRow, type PatternView } from "@/domain/patterns";
import { classifyPattern } from "@/domain/patternLifecycle";
import { answerEarlySignalAction, finishFirstWeekAction, snoozeFirstWeekCardAction } from "./actions";

const mocks = vi.hoisted(() => ({
  context: { current: null as unknown },
  configured: { current: true },
  loadSummary: vi.fn(),
  completeFirstWeek: vi.fn(),
  skipExperiment: vi.fn(),
  track: vi.fn(),
  revalidatePath: vi.fn(),
  currentInstant: vi.fn(),
  loadSignal: vi.fn(),
  sync: vi.fn(),
  record: vi.fn(),
  flow: { summaryEnabled: true, welcomeBackEnabled: true, acknowledgementEnabled: true },
  home: { firstReportInvitation: true, activeExperimentCard: false },
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
vi.mock("@/lib/firstWeek/complete", () => ({ completeFirstWeek: mocks.completeFirstWeek }));
vi.mock("@/lib/experiments/repo", () => ({ skipExperiment: mocks.skipExperiment }));
vi.mock("@/lib/analytics/track", () => ({ track: mocks.track, SupabaseEventsSink: class {} }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
vi.mock("@/lib/patterns/load", () => ({ loadLateEveningSignal: mocks.loadSignal }));
vi.mock("@/lib/patterns/sync", () => ({ syncPatternEvidence: mocks.sync }));
vi.mock("@/lib/patterns/feedback", () => ({ recordPatternFeedback: mocks.record }));
vi.mock("@/domain/firstWeekFlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/firstWeekFlow")>()),
  FIRST_WEEK_FLOW: mocks.flow,
}));
vi.mock("@/domain/home", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/home")>()),
  HOME_FEATURES: mocks.home,
}));
vi.mock("@/domain/patterns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/patterns")>()),
  PATTERN_FLOW: mocks.pattern,
}));

// A development clock: a fixed instant in the past, so every event must carry THIS and not the real time.
const NOW = new Date("2026-09-17T06:00:00Z");
const USER = "user-1";
const supabase = { tag: "user-client" };
const ready = (lifecycle_state = "FIRST_WEEK") => ({
  kind: "ready",
  userId: USER,
  row: { lifecycle_state, timezone: "Asia/Jerusalem" },
  supabase,
});

const READY_SUMMARY = {
  kind: "ready",
  reason: "enough_data",
  hadEnoughData: true,
  progress: { availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 0 },
  summary: {},
  experiment: { selection: { kind: "NONE", reason: "no_pattern" }, open: null },
  signal: null,
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

/** A FormData whose every access is recorded; anything but a named get is recorded as the whole form. */
function watched(data: FormData): { form: FormData; read: string[] } {
  const read: string[] = [];
  const form = new Proxy(data, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        read.push(prop === "get" || prop === "getAll" || prop === "has" ? String(args[0]) : `<${String(prop)}>`);
        return value.apply(target, args);
      };
    },
  });
  return { form, read };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const writes = () => [mocks.completeFirstWeek, mocks.skipExperiment, mocks.track, mocks.sync, mocks.record, mocks.revalidatePath];

beforeEach(() => {
  mocks.configured.current = true;
  mocks.context.current = ready();
  for (const fn of [
    mocks.loadSummary,
    mocks.completeFirstWeek,
    mocks.skipExperiment,
    mocks.track,
    mocks.revalidatePath,
    mocks.currentInstant,
    mocks.loadSignal,
    mocks.sync,
    mocks.record,
  ]) {
    fn.mockReset();
  }
  Object.assign(mocks.flow, { summaryEnabled: true, welcomeBackEnabled: true, acknowledgementEnabled: true });
  Object.assign(mocks.pattern, { detectionEnabled: true, earlySignalEnabled: true, experimentEnabled: true, syncOnMealChange: true });
  mocks.currentInstant.mockReturnValue(NOW);
  mocks.loadSummary.mockResolvedValue(READY_SUMMARY);
  mocks.completeFirstWeek.mockResolvedValue({ ok: true, transitioned: true });
  mocks.skipExperiment.mockResolvedValue({ ok: true, value: { changed: false } });
  mocks.track.mockResolvedValue(undefined);
  mocks.sync.mockResolvedValue({ ok: true, patternId: "pattern-1" });
  mocks.record.mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("finishFirstWeekAction", () => {
  it("takes no argument at all, so nothing can be forged", () => {
    expect(finishFirstWeekAction.length).toBe(0);
  });

  describe("the transition", () => {
    it("writes once, as the verified user, at the app's instant, then goes Home", async () => {
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/");

      expect(mocks.loadSummary).toHaveBeenCalledTimes(1);
      expect(mocks.loadSummary).toHaveBeenCalledWith(mocks.context.current, NOW);
      expect(mocks.completeFirstWeek).toHaveBeenCalledTimes(1);
      expect(mocks.completeFirstWeek).toHaveBeenCalledWith(supabase, USER, NOW);
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("tells the world once: the enums and the capped counts, stamped with the app's instant as the fourth argument", async () => {
      await outcome(() => finishFirstWeekAction());

      expect(mocks.track).toHaveBeenCalledTimes(1);
      const [, name, payload, at] = mocks.track.mock.calls[0] ?? [];
      expect(name).toBe("first_week_completed");
      expect(payload).toEqual({ reason: "enough_data", had_enough_data: true, available_days: 5, confirmed_meals: 10 });
      expect(at).toBe(NOW);
    });

    it("closes an unanswered offer in the same press (the app's instant, the verified user), without an event for it", async () => {
      await outcome(() => finishFirstWeekAction());

      expect(mocks.skipExperiment).toHaveBeenCalledTimes(1);
      expect(mocks.skipExperiment).toHaveBeenCalledWith(supabase, USER, NOW);
      expect(mocks.track.mock.calls.map((call) => call[1])).toEqual(["first_week_completed"]);
      expect(mocks.completeFirstWeek.mock.invocationCallOrder[0]).toBeLessThan(mocks.skipExperiment.mock.invocationCallOrder[0]);
    });

    it.each([
      ["rejects", () => mocks.skipExperiment.mockRejectedValue(new Error("boom"))],
      ["answers { ok: false }", () => mocks.skipExperiment.mockResolvedValue({ ok: false, code: "unavailable" })],
    ])("changes neither the redirect nor the event when closing the offer %s", async (_name, arrange) => {
      arrange();
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/");
      expect(mocks.track.mock.calls.map((call) => call[1])).toEqual(["first_week_completed"]);
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("tells the world only when THIS call changed the row (a second tab or tap is harmless), and still closes the offer", async () => {
      mocks.completeFirstWeek.mockResolvedValue({ ok: true, transitioned: false });

      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/");

      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.skipExperiment).toHaveBeenCalledTimes(1);
    });

    it("lands on the summary with the failed flag, with no event and no closing of the offer, when the write did not go through", async () => {
      mocks.completeFirstWeek.mockResolvedValue({ ok: false });

      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/first-week?failed=1");

      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.skipExperiment).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    it("does not let a rejecting event sink change where the person lands", async () => {
      mocks.track.mockRejectedValue(new Error("sink down"));
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/");
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });
  });

  describe("every check is made again, because a page guard does not protect a direct POST", () => {
    it("sends Home when Supabase is not set up", async () => {
      mocks.configured.current = false;
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/");
    });

    it("sends a signed-out visitor to sign in", async () => {
      mocks.context.current = { kind: "signed_out" };
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/login");
    });

    it.each(["NEW", "ONBOARDING"])("sends a user in %s to onboarding", async (state) => {
      mocks.context.current = ready(state);
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/onboarding");
    });

    it("sends a user in the weekly cycle Home with ZERO reads and writes", async () => {
      mocks.context.current = ready("WEEKLY_CYCLE");
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/");
      expect(mocks.loadSummary).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it("sends Home with ZERO writes when the rules do not say ready right now", async () => {
      mocks.loadSummary.mockResolvedValue({ kind: "not_ready" });
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/");
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it("sends Home with ZERO writes when the lifecycle is not the First Week by the loader's reading", async () => {
      mocks.loadSummary.mockResolvedValue({ kind: "not_first_week" });
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/");
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it("sends Home with ZERO writes, reading nothing, when the summary is switched off", async () => {
      mocks.flow.summaryEnabled = false;
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/");
      expect(mocks.loadSummary).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it("goes to the summary page (which shows its calm card) when a read failed, with ZERO writes", async () => {
      mocks.loadSummary.mockResolvedValue({ kind: "unavailable" });
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/first-week");
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it.each([{ kind: "unavailable" }, { kind: "profile_missing" }])("goes to the summary page when the context is $kind", async (context) => {
      mocks.context.current = context;
      await expect(outcome(() => finishFirstWeekAction())).resolves.toBe("REDIRECT:/first-week");
      expect(mocks.loadSummary).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });
  });
});

describe("snoozeFirstWeekCardAction", () => {
  it.each(FIRST_WEEK_SNOOZE.cards)("writes one content-free event for %s, at the app's instant, then goes Home", async (card) => {
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card })))).resolves.toBe("REDIRECT:/");

    expect(mocks.track).toHaveBeenCalledTimes(1);
    const [, name, payload, at] = mocks.track.mock.calls[0] ?? [];
    expect(name).toBe(FIRST_WEEK_SNOOZE.event);
    expect(payload).toEqual({ card });
    expect(at).toBe(NOW);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    // Hiding a card is not the transition, and nothing is re-evaluated.
    expect(mocks.completeFirstWeek).not.toHaveBeenCalled();
    expect(mocks.skipExperiment).not.toHaveBeenCalled();
    expect(mocks.loadSummary).not.toHaveBeenCalled();
  });

  it("round-trips under a past clock: the event it writes hides the card for a day when the reader reads it", async () => {
    mocks.currentInstant.mockReturnValue(new Date(NOW.getTime() - 3_600_000));
    await outcome(() => snoozeFirstWeekCardAction(form({ card: "summary" })));
    const [, name, payload, at] = mocks.track.mock.calls[0] ?? [];
    expect(name).toBe("first_week_card_snoozed");

    const events = [{ card: (payload as { card: unknown }).card, occurredAt: at as Date }];
    expect(activeSnoozes({ events, now: NOW })).toEqual({ summary: true, welcomeBack: false });
    // Stamped with the real time instead, the same event would be "in the future" and the card would never hide.
    expect(activeSnoozes({ events: [{ ...events[0], occurredAt: new Date(Date.now() + 3_600_000) }], now: NOW })).toEqual({ summary: false, welcomeBack: false });
  });

  it.each([["", "empty"], ["Summary", "wrong case"], ["both", "unknown"], ["summary ", "padded"], ["__proto__", "special"], ["<script>", "markup"]])(
    "goes Home with ZERO writes and ZERO events for the forged card %j (%s)",
    async (card) => {
      await expect(outcome(() => snoozeFirstWeekCardAction(form({ card })))).resolves.toBe("REDIRECT:/");
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    },
  );

  it("goes Home with ZERO writes when there is no card at all, or only another field", async () => {
    await expect(outcome(() => snoozeFirstWeekCardAction(new FormData()))).resolves.toBe("REDIRECT:/");
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ other: "summary" })))).resolves.toBe("REDIRECT:/");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it("reads the card field and no other, and takes the user from the session", async () => {
    const { form: watchedForm, read } = watched(form({ card: "welcome_back", userId: "someone-else", user_id: "someone-else", status: "x" }));
    await outcome(() => snoozeFirstWeekCardAction(watchedForm));
    expect([...new Set(read)]).toEqual(["card"]);
    expect(mocks.track.mock.calls[0]?.[2]).toEqual({ card: "welcome_back" });
  });

  it("sends a signed-out visitor to sign in with ZERO writes", async () => {
    mocks.context.current = { kind: "signed_out" };
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "summary" })))).resolves.toBe("REDIRECT:/login");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it.each(["NEW", "ONBOARDING"])("sends a user in %s to onboarding with ZERO writes", async (state) => {
    mocks.context.current = ready(state);
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "summary" })))).resolves.toBe("REDIRECT:/onboarding");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it("goes Home with ZERO writes for a user in the weekly cycle", async () => {
    mocks.context.current = ready("WEEKLY_CYCLE");
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "summary" })))).resolves.toBe("REDIRECT:/");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it("goes Home with ZERO writes when Supabase is not set up or the context cannot be read", async () => {
    mocks.configured.current = false;
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "summary" })))).resolves.toBe("REDIRECT:/");
    mocks.configured.current = true;
    mocks.context.current = { kind: "unavailable" };
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "summary" })))).resolves.toBe("REDIRECT:/");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it("never stops the redirect when the event sink fails", async () => {
    mocks.track.mockRejectedValue(new Error("sink down"));
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "summary" })))).resolves.toBe("REDIRECT:/");
  });
});

// ---- B4: the Early Signal answer ----------------------------------------------------------------------------------

/** `n` evenings with a 21:30 local meal, one per day, from 12 September on. */
function evenings(n: number): Occurrence[] {
  return Array.from({ length: n }, (_unused, i) => {
    const day = 12 + i;
    return { mealId: `meal-${i}`, occurredAt: new Date(Date.UTC(2026, 8, day, 18, 30)), localDay: `2026-09-${day}` };
  });
}

function signal(n: number, row: PatternRow | null = null, view?: PatternView) {
  const occurrences = evenings(n);
  const live = view ?? (row?.status === "REJECTED" ? "REJECTED" : classifyPattern(occurrences.map((o) => o.occurredAt), "Asia/Jerusalem", false));
  return { occurrences, row, view: live };
}

const answered = (feedback: PatternRow["feedback"], status: PatternRow["status"] = "OBSERVATION", feedbackAt: Date | null = new Date(NOW.getTime() - 86_400_000)): PatternRow => ({
  id: "pattern-1",
  status,
  feedback,
  feedbackAt: feedback === null ? null : feedbackAt,
});

describe("answerEarlySignalAction", () => {
  const answer = (value: string) => form({ answer: value });

  describe("a due card", () => {
    it("syncs the live evenings with the level the pattern WILL have, records the answer, tells the world, goes Home", async () => {
      mocks.loadSignal.mockResolvedValue(signal(2));

      await expect(outcome(() => answerEarlySignalAction(answer("unsure")))).resolves.toBe("REDIRECT:/");

      expect(mocks.loadSignal).toHaveBeenCalledWith(supabase, USER, "Asia/Jerusalem", NOW);
      expect(mocks.sync).toHaveBeenCalledTimes(1);
      expect(mocks.sync).toHaveBeenCalledWith(supabase, { occurrences: evenings(2), view: "EARLY_SIGNAL" });
      expect(mocks.record).toHaveBeenCalledTimes(1);
      expect(mocks.record).toHaveBeenCalledWith(supabase, { patternId: "pattern-1", feedback: "unsure", now: NOW });
      expect(mocks.track).toHaveBeenCalledTimes(1);
      const [, name, payload, at] = mocks.track.mock.calls[0] ?? [];
      expect([name, payload]).toEqual(["early_signal_answered", { answer: "unsure" }]);
      expect(at).toBe(NOW);
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("writes in order: the evidence, then the answer, then the event", async () => {
      mocks.loadSignal.mockResolvedValue(signal(3));
      await outcome(() => answerEarlySignalAction(answer("confirm")));
      const order = [mocks.sync, mocks.record, mocks.track].map((fn) => fn.mock.invocationCallOrder[0]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(order.every((n) => typeof n === "number")).toBe(true);
    });

    it("stores a 'Sounds right' given at the Candidate level as VALIDATED at once", async () => {
      mocks.loadSignal.mockResolvedValue(signal(3));
      await outcome(() => answerEarlySignalAction(answer("confirm")));
      expect(mocks.sync).toHaveBeenCalledWith(supabase, { occurrences: evenings(3), view: "VALIDATED" });
      expect(toDbStatus("VALIDATED")).toBe("VALIDATED");
    });

    it("stores a 'Sounds right' given at two evenings as OBSERVATION: a yes to a signal never promotes by itself", async () => {
      mocks.loadSignal.mockResolvedValue(signal(2));
      await outcome(() => answerEarlySignalAction(answer("confirm")));
      expect(mocks.sync).toHaveBeenCalledWith(supabase, { occurrences: evenings(2), view: "EARLY_SIGNAL" });
      expect(toDbStatus("EARLY_SIGNAL")).toBe("OBSERVATION");
    });

    it("stores 'Not sure' at the Candidate level as CANDIDATE", async () => {
      mocks.loadSignal.mockResolvedValue(signal(3));
      await outcome(() => answerEarlySignalAction(answer("unsure")));
      expect(mocks.sync).toHaveBeenCalledWith(supabase, { occurrences: evenings(3), view: "CANDIDATE" });
    });

    it("comes back for 'Not sure' after the cooldown at the Candidate level", async () => {
      const longAgo = new Date(NOW.getTime() - 15 * 86_400_000);
      mocks.loadSignal.mockResolvedValue(signal(3, answered("unsure", "CANDIDATE", longAgo)));
      await expect(outcome(() => answerEarlySignalAction(answer("confirm")))).resolves.toBe("REDIRECT:/");
      expect(mocks.record).toHaveBeenCalledWith(supabase, { patternId: "pattern-1", feedback: "confirm", now: NOW });
    });

    it("syncs an EMPTY evidence set for 'Not related to me', then records the rejection: the person leaves no evidence behind", async () => {
      mocks.loadSignal.mockResolvedValue(signal(3));

      await expect(outcome(() => answerEarlySignalAction(answer("reject")))).resolves.toBe("REDIRECT:/");

      expect(mocks.sync).toHaveBeenCalledTimes(1);
      expect(mocks.sync).toHaveBeenCalledWith(supabase, { occurrences: [], view: "NONE" });
      expect(toDbStatus("NONE")).toBe("OBSERVATION");
      expect(mocks.record).toHaveBeenCalledWith(supabase, { patternId: "pattern-1", feedback: "reject", now: NOW });
      expect(mocks.track.mock.calls[0]?.[2]).toEqual({ answer: "reject" });
    });
  });

  describe("what the form may say", () => {
    it("reads the answer field and no other, and the user and the pattern come from the session and the live data", async () => {
      mocks.loadSignal.mockResolvedValue(signal(2));
      const { form: watchedForm, read } = watched(form({ answer: "unsure", kind: "late_evening_meals", status: "REJECTED", patternId: "forged", userId: "someone-else" }));

      await outcome(() => answerEarlySignalAction(watchedForm));

      expect([...new Set(read)]).toEqual(["answer"]);
      expect(mocks.record).toHaveBeenCalledWith(supabase, { patternId: "pattern-1", feedback: "unsure", now: NOW });
    });

    it.each([["", "empty"], ["CONFIRM", "wrong case"], ["yes", "unknown"], [" confirm", "padded"], ["confirm,reject", "list"], ["<b>", "markup"]])(
      "goes Home with ZERO writes and ZERO reads for the forged answer %j (%s)",
      async (value) => {
        mocks.loadSignal.mockResolvedValue(signal(2));
        await expect(outcome(() => answerEarlySignalAction(answer(value)))).resolves.toBe("REDIRECT:/");
        expect(mocks.loadSignal).not.toHaveBeenCalled();
        for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
      },
    );

    it("goes Home with ZERO writes when there is no answer, or a file in its place", async () => {
      mocks.loadSignal.mockResolvedValue(signal(2));
      await expect(outcome(() => answerEarlySignalAction(new FormData()))).resolves.toBe("REDIRECT:/");
      const withFile = new FormData();
      withFile.set("answer", new File(["confirm"], "confirm"));
      await expect(outcome(() => answerEarlySignalAction(withFile))).resolves.toBe("REDIRECT:/");
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("a stale card is re-checked against the live signal, and writes nothing", () => {
    it.each([
      ["the signal could not be read", () => null],
      ["there are fewer than two evenings now", () => signal(1)],
      ["the evidence was deleted", () => signal(0)],
      ["the person already said 'Sounds right'", () => signal(2, answered("confirm"))],
      ["the person already said 'Not related to me'", () => signal(2, answered("reject", "REJECTED"))],
      ["the pattern is rejected", () => signal(3, { id: "pattern-1", status: "REJECTED", feedback: null, feedbackAt: null })],
      ["'Not sure' was said at two evenings", () => signal(2, answered("unsure"))],
      ["'Not sure' was said at the Candidate level less than the cooldown ago", () => signal(3, answered("unsure", "CANDIDATE"))],
      ["the pattern is already validated", () => signal(5, null, "VALIDATED")],
    ])("goes Home with ZERO writes when %s", async (_name, arrange) => {
      mocks.loadSignal.mockResolvedValue(arrange());
      await expect(outcome(() => answerEarlySignalAction(answer("confirm")))).resolves.toBe("REDIRECT:/");
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("failures leave nothing half-recorded", () => {
    it("goes Home with no answer and no event when syncing the evidence failed", async () => {
      mocks.loadSignal.mockResolvedValue(signal(2));
      mocks.sync.mockResolvedValue({ ok: false });
      await expect(outcome(() => answerEarlySignalAction(answer("unsure")))).resolves.toBe("REDIRECT:/");
      expect(mocks.record).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    it("goes Home with no event when recording the answer failed (the card is still there for another try)", async () => {
      mocks.loadSignal.mockResolvedValue(signal(2));
      mocks.record.mockResolvedValue({ ok: false });
      await expect(outcome(() => answerEarlySignalAction(answer("unsure")))).resolves.toBe("REDIRECT:/");
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it("never stops the redirect when the event sink fails", async () => {
      mocks.loadSignal.mockResolvedValue(signal(2));
      mocks.track.mockRejectedValue(new Error("sink down"));
      await expect(outcome(() => answerEarlySignalAction(answer("unsure")))).resolves.toBe("REDIRECT:/");
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });
  });

  describe("the gates", () => {
    it("sends Home when Supabase is not set up", async () => {
      mocks.configured.current = false;
      await expect(outcome(() => answerEarlySignalAction(answer("unsure")))).resolves.toBe("REDIRECT:/");
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it("sends a signed-out visitor to sign in", async () => {
      mocks.context.current = { kind: "signed_out" };
      await expect(outcome(() => answerEarlySignalAction(answer("unsure")))).resolves.toBe("REDIRECT:/login");
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it.each(["NEW", "ONBOARDING"])("sends a user in %s to onboarding", async (state) => {
      mocks.context.current = ready(state);
      await expect(outcome(() => answerEarlySignalAction(answer("unsure")))).resolves.toBe("REDIRECT:/onboarding");
      expect(mocks.loadSignal).not.toHaveBeenCalled();
    });

    it("sends a user in the weekly cycle Home with ZERO reads and writes", async () => {
      mocks.context.current = ready("WEEKLY_CYCLE");
      mocks.loadSignal.mockResolvedValue(signal(2));
      await expect(outcome(() => answerEarlySignalAction(answer("unsure")))).resolves.toBe("REDIRECT:/");
      expect(mocks.loadSignal).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it("sends Home with ZERO reads and writes when the card is switched off", async () => {
      mocks.pattern.earlySignalEnabled = false;
      mocks.loadSignal.mockResolvedValue(signal(2));
      await expect(outcome(() => answerEarlySignalAction(answer("unsure")))).resolves.toBe("REDIRECT:/");
      expect(mocks.loadSignal).not.toHaveBeenCalled();
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });

    it.each([{ kind: "unavailable" }, { kind: "profile_missing" }])("sends Home with ZERO writes when the context is $kind", async (context) => {
      mocks.context.current = context;
      await expect(outcome(() => answerEarlySignalAction(answer("unsure")))).resolves.toBe("REDIRECT:/");
      for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
    });
  });
});

describe("snoozeFirstWeekCardAction: the active-experiment card's Thanks", () => {
  beforeEach(() => {
    mocks.home.activeExperimentCard = true;
    mocks.context.current = ready("WEEKLY_CYCLE");
  });
  afterEach(() => {
    mocks.home.activeExperimentCard = false;
  });

  it("writes one content-free event of the shared snooze kind, at the app's instant, then goes Home", async () => {
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "experiment" })))).resolves.toBe("REDIRECT:/");

    expect(mocks.track).toHaveBeenCalledTimes(1);
    const [, name, payload, at] = mocks.track.mock.calls[0] ?? [];
    expect(name).toBe(FIRST_WEEK_SNOOZE.event);
    expect(payload).toEqual({ card: "experiment" });
    expect(at).toBe(NOW);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    // Hiding a card is not the transition: no summary, no experiment write, no pattern work.
    expect(mocks.completeFirstWeek).not.toHaveBeenCalled();
    expect(mocks.skipExperiment).not.toHaveBeenCalled();
    expect(mocks.loadSummary).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("round-trips: the event it writes hides the card for the rest of the local day when the reader reads it", async () => {
    mocks.currentInstant.mockReturnValue(new Date("2026-09-17T06:00:00Z"));
    await outcome(() => snoozeFirstWeekCardAction(form({ card: "experiment" })));
    const [, , payload, at] = mocks.track.mock.calls[0] ?? [];
    const events = [{ card: (payload as { card: unknown }).card, occurredAt: at as Date }];
    const later = new Date("2026-09-17T15:00:00Z"); // 18:00 the same day in Jerusalem
    expect(experimentCardSnoozed({ events, now: later, timeZone: "Asia/Jerusalem" })).toBe(true);
    expect(experimentCardSnoozed({ events, now: new Date("2026-09-18T06:00:00Z"), timeZone: "Asia/Jerusalem" })).toBe(false);
    // It never hides a First Week card.
    expect(activeSnoozes({ events, now: later })).toEqual({ summary: false, welcomeBack: false });
  });

  it("reads the card field and no other, and writes nothing about the experiment itself", async () => {
    const { form: watchedForm, read } = watched(form({ card: "experiment", id: "x", wording: "a sentence", tried: "YES" }));
    await outcome(() => snoozeFirstWeekCardAction(watchedForm));
    expect([...new Set(read)]).toEqual(["card"]);
    expect(mocks.track.mock.calls[0]?.[2]).toEqual({ card: "experiment" });
  });

  it("with the switch OFF (as shipped) goes Home with ZERO writes", async () => {
    mocks.home.activeExperimentCard = false;
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "experiment" })))).resolves.toBe("REDIRECT:/");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it("goes Home with ZERO writes for a person still in the First Week (the card exists only in the weekly cycle)", async () => {
    mocks.context.current = ready("FIRST_WEEK");
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "experiment" })))).resolves.toBe("REDIRECT:/");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it.each(["NEW", "ONBOARDING"])("sends a user in %s to onboarding with ZERO writes", async (state) => {
    mocks.context.current = ready(state);
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "experiment" })))).resolves.toBe("REDIRECT:/onboarding");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign in, and goes Home when the context cannot be read, with ZERO writes", async () => {
    mocks.context.current = { kind: "signed_out" };
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "experiment" })))).resolves.toBe("REDIRECT:/login");
    mocks.context.current = { kind: "unavailable" };
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "experiment" })))).resolves.toBe("REDIRECT:/");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it.each([["Experiment"], ["experiment "], ["experiments"], ["EXPERIMENT"]])("goes Home with ZERO writes for the forged card %j", async (card) => {
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card })))).resolves.toBe("REDIRECT:/");
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it("the First Week's two cards still need FIRST_WEEK (the weekly cycle does not widen them)", async () => {
    for (const card of FIRST_WEEK_SNOOZE.cards) {
      await expect(outcome(() => snoozeFirstWeekCardAction(form({ card })))).resolves.toBe("REDIRECT:/");
    }
    for (const fn of writes()) expect(fn).not.toHaveBeenCalled();
  });

  it("never stops the redirect when the event sink fails", async () => {
    mocks.track.mockRejectedValue(new Error("sink down"));
    await expect(outcome(() => snoozeFirstWeekCardAction(form({ card: "experiment" })))).resolves.toBe("REDIRECT:/");
  });
});
