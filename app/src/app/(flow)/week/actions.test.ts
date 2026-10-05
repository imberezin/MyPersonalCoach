// What the "your week" Server Actions do, with every outside piece mocked: the session, the loaders, the writers, the AI
// orchestrators, the event sink and the clock. The real redirect() and revalidatePath() are replaced; the rules (the gate, the
// card window, effectivePatternStatus, the closed lists) run for real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectivePatternStatus, type Occurrence, type PatternRow } from "@/domain/patterns";
import { weekWindowOf, type ExperimentResult, type WeeklyExperimentDecision, type WeeklyStory } from "@/domain/weekly";
import he from "@/i18n/messages/he.json";
import {
  answerExperimentResultAction,
  answerWeeklyPatternAction,
  openWeeklyStoryAction,
  proposeWeeklyExperimentAction,
  skipWeeklyExperimentAction,
  snoozeWeeklyCardAction,
  startWeeklyExperimentAction,
} from "./actions";

const mocks = vi.hoisted(() => ({
  context: { current: null as unknown },
  configured: { current: true },
  calls: [] as string[],
  locale: { current: "he" as "he" | "en" },
  loadStory: vi.fn(),
  loadPeriods: vi.fn(),
  openStory: vi.fn(),
  upgradeLine: vi.fn(),
  produceLine: vi.fn(),
  recordResult: vi.fn(),
  insertOffered: vi.fn(),
  upgradeOffered: vi.fn(),
  startExperiment: vi.fn(),
  skipExperiment: vi.fn(),
  produceExperiment: vi.fn(),
  sync: vi.fn(),
  record: vi.fn(),
  track: vi.fn(),
  revalidatePath: vi.fn(),
  currentInstant: vi.fn(),
  createRuntime: vi.fn(),
  flow: { enabled: true, patternQuestionEnabled: true, starterExperimentsEnabled: false, aiLineEnabled: true, weightLineEnabled: true },
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => mocks.configured.current }));
vi.mock("@/lib/onboarding/context", () => ({ loadOnboardingContext: async () => mocks.context.current }));
vi.mock("@/lib/home/load", () => ({ loadOfflinePeriods: mocks.loadPeriods }));
vi.mock("@/lib/weekly/load", () => ({ loadWeeklyStory: mocks.loadStory }));
vi.mock("@/lib/weekly/open", () => ({ openWeeklyStory: mocks.openStory, upgradeWeeklyLine: mocks.upgradeLine }));
vi.mock("@/lib/weekly/result", () => ({ recordExperimentResult: mocks.recordResult }));
vi.mock("@/lib/weekly/word", () => ({ produceWeeklyLineWording: mocks.produceLine }));
vi.mock("@/lib/experiments/repo", () => ({
  insertOfferedExperiment: mocks.insertOffered,
  upgradeOfferedWording: mocks.upgradeOffered,
  startExperiment: mocks.startExperiment,
  skipExperiment: mocks.skipExperiment,
}));
vi.mock("@/lib/experiments/word", () => ({ produceExperimentWording: mocks.produceExperiment }));
vi.mock("@/lib/patterns/sync", () => ({ syncPatternEvidence: mocks.sync }));
vi.mock("@/lib/patterns/feedback", () => ({ recordPatternFeedback: mocks.record }));
vi.mock("@/lib/analytics/track", () => ({ track: mocks.track, SupabaseEventsSink: class {} }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
vi.mock("@/lib/ai/factory", () => ({ createAiRuntime: mocks.createRuntime }));
vi.mock("@/lib/ai/ledger", () => ({ createSupabaseRecorder: (a: unknown) => ({ recorder: a }), logAppError: () => {} }));
vi.mock("@/lib/ai/allowance", () => ({ checkAiAllowance: () => {} }));
vi.mock("@/domain/weekly", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/weekly")>()),
  WEEKLY_FLOW: mocks.flow,
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

// A development clock: Sunday 10:00 in Jerusalem, inside the card window of the week of 2026-10-11, and a fixed instant, so
// every event must carry THIS and not the real time.
const NOW = new Date("2026-10-18T07:00:00Z");
const USER = "user-1";
const supabase = { tag: "user-client" };
const WEEK = weekWindowOf(new Date("2026-10-13T09:00:00Z"), "Asia/Jerusalem");
const ready = (lifecycle_state = "WEEKLY_CYCLE") => ({
  kind: "ready",
  userId: USER,
  row: { lifecycle_state, timezone: "Asia/Jerusalem" },
  supabase,
});

const STORY: WeeklyStory = {
  mode: "LEARN",
  reason: "data",
  lineKey: "learn",
  happened: [{ kind: "MEALS" }],
  learned: [{ kind: "NOT_YET" }],
  weight: { kind: "NONE" },
  patternQuestion: { kind: "NONE" },
  invite: { weighIn: false },
};
const ASK: WeeklyStory = { ...STORY, patternQuestion: { kind: "ASK", patternKind: "late_evening_meals" } };

const NONE: WeeklyExperimentDecision = { kind: "NONE", reason: "none_eligible" };
const PENDING: WeeklyExperimentDecision = { kind: "PENDING", experimentId: "exp-1" };
const ACTIVE: WeeklyExperimentDecision = { kind: "ACTIVE", experimentId: "exp-1" };
const RESULT_DUE: WeeklyExperimentDecision = { kind: "RESULT_DUE", experimentId: "exp-1", key: "eat_intentionally", variantId: "default" };
const OFFER_PATTERN: WeeklyExperimentDecision = {
  kind: "OFFER",
  origin: "pattern",
  patternKind: "late_evening_meals",
  patternId: "pattern-1",
  key: "eat_intentionally",
  variantId: "default",
  scope: "next_meal",
  params: {},
  constraints: [],
  rationale: { kind: "PATTERN", patternKind: "late_evening_meals" },
};
const OFFER_STARTER: WeeklyExperimentDecision = {
  ...OFFER_PATTERN,
  origin: "starter",
  patternKind: null,
  patternId: null,
  rationale: { kind: "GOAL", goal: "improve_eating" },
};

const OPEN_OFFERED = { id: "exp-1", status: "OFFERED", key: "eat_intentionally", variantId: "default", origin: "starter", wording: "w", source: "library", locale: "he", startedAt: null };

const evening = (day: number): Occurrence => ({
  mealId: `meal-${day}`,
  occurredAt: new Date(`2026-10-0${day}T19:30:00Z`),
  localDay: `2026-10-0${day}`,
});
const OCCURRENCES = [evening(1), evening(2), evening(3), evening(4)];
const ROW: PatternRow = { id: "pattern-1", status: "CANDIDATE", feedback: null, feedbackAt: null };
const SIGNAL = { occurrences: OCCURRENCES, row: ROW, view: "CANDIDATE" } as const;

const loaded = (over: Record<string, unknown> = {}) => ({
  kind: "ready",
  moment: { kind: "READY", week: WEEK, availableDays: 6 },
  story: STORY,
  experiment: { decision: NONE, open: null },
  row: null,
  signal: null,
  patterns: [],
  goalFocus: ["improve_eating"],
  availableDays: 6,
  ...over,
});

/** Both thrown kinds, as the text a test can match. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "RETURNED";
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN";
  }
}

/** A FormData whose every access is recorded. */
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

/** Every mock that writes or tells the world something. */
const writers = () => [
  mocks.openStory,
  mocks.upgradeLine,
  mocks.recordResult,
  mocks.insertOffered,
  mocks.upgradeOffered,
  mocks.startExperiment,
  mocks.skipExperiment,
  mocks.sync,
  mocks.record,
  mocks.track,
  mocks.revalidatePath,
];
const aiCalls = () => [mocks.produceLine, mocks.produceExperiment, mocks.createRuntime];
const eventNames = () => mocks.track.mock.calls.map((call) => call[1]);
const order = (mock: ReturnType<typeof vi.fn>) => mock.mock.invocationCallOrder[0];

function expectNothingWritten(): void {
  for (const mock of writers()) expect(mock).not.toHaveBeenCalled();
  for (const mock of aiCalls()) expect(mock).not.toHaveBeenCalled();
}

beforeEach(() => {
  mocks.configured.current = true;
  mocks.context.current = ready();
  mocks.locale.current = "he";
  mocks.calls.length = 0;
  for (const fn of [
    mocks.loadStory,
    mocks.loadPeriods,
    mocks.openStory,
    mocks.upgradeLine,
    mocks.produceLine,
    mocks.recordResult,
    mocks.insertOffered,
    mocks.upgradeOffered,
    mocks.startExperiment,
    mocks.skipExperiment,
    mocks.produceExperiment,
    mocks.sync,
    mocks.record,
    mocks.track,
    mocks.revalidatePath,
    mocks.currentInstant,
    mocks.createRuntime,
  ]) {
    fn.mockReset();
  }
  Object.assign(mocks.flow, { enabled: true, patternQuestionEnabled: true, starterExperimentsEnabled: false, aiLineEnabled: true, weightLineEnabled: true });
  mocks.currentInstant.mockReturnValue(NOW);
  mocks.loadPeriods.mockResolvedValue([]);
  mocks.loadStory.mockResolvedValue(loaded());
  mocks.openStory.mockResolvedValue({ ok: true, value: { created: true } });
  mocks.upgradeLine.mockResolvedValue({ ok: true, value: { changed: true } });
  mocks.produceLine.mockResolvedValue({ source: "ai", text: "a warmer sentence", provider: "p", model: "m" });
  mocks.recordResult.mockResolvedValue({ ok: true, value: { changed: true, key: "eat_intentionally", source: "library" } });
  mocks.insertOffered.mockResolvedValue({ ok: true, value: { id: "exp-1", created: true } });
  mocks.upgradeOffered.mockResolvedValue({ ok: true, value: { changed: true } });
  mocks.startExperiment.mockResolvedValue({ ok: true, value: { changed: true } });
  mocks.skipExperiment.mockResolvedValue({ ok: true, value: { changed: true } });
  mocks.produceExperiment.mockResolvedValue({ source: "ai", text: "a reworded sentence", provider: "p", model: "m" });
  mocks.sync.mockResolvedValue({ ok: true, patternId: "pattern-1" });
  mocks.record.mockResolvedValue({ ok: true });
  mocks.track.mockResolvedValue(undefined);
  mocks.createRuntime.mockReturnValue({ tag: "runtime" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---- The seven actions, as the contract of a Server Action file ----

describe("the seven actions", () => {
  it("takes nothing from the form unless it needs an answer: the five without an answer take no argument at all", () => {
    for (const action of [openWeeklyStoryAction, snoozeWeeklyCardAction, proposeWeeklyExperimentAction, startWeeklyExperimentAction, skipWeeklyExperimentAction]) {
      expect(action.length).toBe(0);
    }
    expect(answerExperimentResultAction.length).toBe(1);
    expect(answerWeeklyPatternAction.length).toBe(1);
  });
});

// ---- The gates and the prologue, shared by six actions ----

type Run = () => Promise<void>;
const WITH_PROLOGUE: Array<[string, Run, () => void]> = [
  ["openWeeklyStoryAction", () => openWeeklyStoryAction(), () => {}],
  [
    "answerWeeklyPatternAction",
    () => answerWeeklyPatternAction(form({ answer: "confirm" })),
    () => mocks.loadStory.mockResolvedValue(loaded({ story: ASK, signal: SIGNAL })),
  ],
  [
    "answerExperimentResultAction",
    () => answerExperimentResultAction(form({ result: "helpful" })),
    () => mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision: RESULT_DUE, open: null } })),
  ],
  [
    "proposeWeeklyExperimentAction",
    () => proposeWeeklyExperimentAction(),
    () => mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision: OFFER_STARTER, open: null } })),
  ],
  [
    "startWeeklyExperimentAction",
    () => startWeeklyExperimentAction(),
    () => mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision: PENDING, open: OPEN_OFFERED } })),
  ],
  [
    "skipWeeklyExperimentAction",
    () => skipWeeklyExperimentAction(),
    () => mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision: PENDING, open: OPEN_OFFERED } })),
  ],
];

describe.each(WITH_PROLOGUE)("%s: the gates and the prologue", (_name, run, arrange) => {
  beforeEach(arrange);

  it("works when everything is in order (the rest of this block would prove nothing otherwise)", async () => {
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week");
  });

  it("goes Home with nothing read and nothing written when Supabase is not set up", async () => {
    mocks.configured.current = false;
    await expect(outcome(run)).resolves.toBe("REDIRECT:/");
    expect(mocks.loadStory).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("sends a visitor whose session ended to sign in, writing nothing", async () => {
    mocks.context.current = { kind: "signed_out" };
    await expect(outcome(run)).resolves.toBe("REDIRECT:/login");
    expectNothingWritten();
  });

  it("goes to the page's note when the database cannot be reached, writing nothing", async () => {
    mocks.context.current = { kind: "unavailable" };
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week?failed=1");
    expect(mocks.loadStory).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it.each(["FIRST_WEEK", "NEW"])("goes Home for lifecycle %s, writing nothing", async (lifecycle) => {
    mocks.context.current = ready(lifecycle);
    await expect(outcome(run)).resolves.toMatch(/^REDIRECT:\/(onboarding.*)?$/);
    expect(mocks.loadStory).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("goes Home when the feature is switched off, writing nothing", async () => {
    mocks.flow.enabled = false;
    await expect(outcome(run)).resolves.toBe("REDIRECT:/");
    expect(mocks.loadStory).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("refuses while the app is quiet (Shabbat, a holiday): Home, before the story is even read, with nothing written", async () => {
    mocks.loadPeriods.mockResolvedValue([{ type: "SHABBAT", start: new Date("2026-10-18T04:00:00Z"), end: new Date("2026-10-18T09:00:00Z") }]);
    await expect(outcome(run)).resolves.toBe("REDIRECT:/");
    expect(mocks.loadStory).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("fails closed when the periods cannot be read: the page's note, nothing written", async () => {
    mocks.loadPeriods.mockResolvedValue(null);
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week?failed=1");
    expect(mocks.loadStory).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it.each(["not_ready", "not_weekly_cycle"])("goes Home when the live story says %s, writing nothing", async (kind) => {
    mocks.loadStory.mockResolvedValue({ kind });
    await expect(outcome(run)).resolves.toBe("REDIRECT:/");
    expectNothingWritten();
  });

  it("goes to the page (which shows its calm card) when the story cannot be read, writing nothing", async () => {
    mocks.loadStory.mockResolvedValue({ kind: "unavailable" });
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week");
    expectNothingWritten();
  });

  it("reads the clock once, then the periods, then the live story, all at that instant, in that order", async () => {
    await outcome(run);
    expect(mocks.currentInstant).toHaveBeenCalledTimes(1);
    expect(mocks.loadPeriods).toHaveBeenCalledWith(supabase, USER, NOW);
    expect(mocks.loadStory).toHaveBeenCalledWith(mocks.context.current, NOW);
    expect(order(mocks.currentInstant)).toBeLessThan(order(mocks.loadPeriods));
    expect(order(mocks.loadPeriods)).toBeLessThan(order(mocks.loadStory));
  });

  it("stamps every event with the app's instant as the fourth argument, never the real clock", async () => {
    await outcome(run);
    for (const call of mocks.track.mock.calls) expect(call[3]).toBe(NOW);
  });

  it("does not let a rejecting event sink change where the person lands", async () => {
    mocks.track.mockRejectedValue(new Error("sink down"));
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week");
  });
});

// ---- openWeeklyStoryAction ----

describe("openWeeklyStoryAction", () => {
  const withMode = (mode: WeeklyStory["mode"], lineKey: WeeklyStory["lineKey"]) =>
    mocks.loadStory.mockResolvedValue(loaded({ story: { ...STORY, mode, lineKey } }));

  it("opens a LEARN week: the row first, then the event, then the AI line, then its upgrade, then the page", async () => {
    mocks.openStory.mockImplementation(async () => (mocks.calls.push("open"), { ok: true, value: { created: true } }));
    mocks.track.mockImplementation(async (_sink, name) => void mocks.calls.push(`event:${name}`));
    mocks.produceLine.mockImplementation(async () => (mocks.calls.push("ai"), { source: "ai", text: "a warmer sentence", provider: "p", model: "m" }));
    mocks.upgradeLine.mockImplementation(async () => (mocks.calls.push("upgrade"), { ok: true, value: { changed: true } }));

    await expect(outcome(() => openWeeklyStoryAction())).resolves.toBe("REDIRECT:/week");

    expect(mocks.calls).toEqual(["open", "event:weekly_summary_viewed", "ai", "upgrade"]);
    expect(mocks.openStory).toHaveBeenCalledWith(supabase, { userId: USER, weekStart: WEEK.weekStart, mode: "LEARN", now: NOW });
    expect(mocks.track.mock.calls[0]?.[2]).toEqual({ mode: "LEARN" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("asks the AI to reword the ONE catalog sentence of the week's line and nothing else, in the page's language", async () => {
    await outcome(() => openWeeklyStoryAction());

    expect(mocks.produceLine).toHaveBeenCalledTimes(1);
    const [deps, input] = mocks.produceLine.mock.calls[0] ?? [];
    expect(input).toEqual({ mode: "LEARN", lineKey: "learn", approvedText: he.weekly.line.learn, locale: "he", availableDays: 6 });
    expect(Object.keys(input).sort()).toEqual(["approvedText", "availableDays", "lineKey", "locale", "mode"]);
    expect(deps).toMatchObject({ supabase, userId: USER, now: NOW, timeZone: "Asia/Jerusalem" });
    expect(deps.runtime).toEqual({ tag: "runtime" });
    expect(mocks.createRuntime).toHaveBeenCalledWith({ recorder: { recorder: { userId: USER } } });
  });

  it("stores the reworded line as a LEARN line of the page's language", async () => {
    await outcome(() => openWeeklyStoryAction());
    expect(mocks.upgradeLine).toHaveBeenCalledWith(supabase, {
      userId: USER,
      weekStart: WEEK.weekStart,
      line: { text: "a warmer sentence", locale: "he", mode: "LEARN", key: "learn" },
    });
  });

  it.each([
    ["CELEBRATE", "celebrateMilestone"],
    ["CELEBRATE", "celebrateGoal"],
    ["CELEBRATE", "celebrateExperiment"],
    ["RECOVER", "recover"],
    ["RESET", "quiet"],
  ] as const)("a %s week (%s) records the event but makes NO AI call and stores no line", async (mode, lineKey) => {
    withMode(mode, lineKey);

    await expect(outcome(() => openWeeklyStoryAction())).resolves.toBe("REDIRECT:/week");

    expect(eventNames()).toEqual(["weekly_summary_viewed"]);
    expect(mocks.track.mock.calls[0]?.[2]).toEqual({ mode });
    expect(mocks.openStory).toHaveBeenCalledTimes(1);
    for (const mock of aiCalls()) expect(mock).not.toHaveBeenCalled();
    expect(mocks.upgradeLine).not.toHaveBeenCalled();
  });

  it("makes no AI call when the AI line is switched off", async () => {
    mocks.flow.aiLineEnabled = false;
    await expect(outcome(() => openWeeklyStoryAction())).resolves.toBe("REDIRECT:/week");
    expect(eventNames()).toEqual(["weekly_summary_viewed"]);
    for (const mock of aiCalls()) expect(mock).not.toHaveBeenCalled();
  });

  it("a week that was already opened (a second press, a stale card, a second tab): the page, with NO AI call and NO event", async () => {
    mocks.openStory.mockResolvedValue({ ok: true, value: { created: false } });

    await expect(outcome(() => openWeeklyStoryAction())).resolves.toBe("REDIRECT:/week");

    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.upgradeLine).not.toHaveBeenCalled();
    for (const mock of aiCalls()) expect(mock).not.toHaveBeenCalled();
  });

  it("a write that did not go through lands on the page's note, with no event and no AI call", async () => {
    mocks.openStory.mockResolvedValue({ ok: false });
    await expect(outcome(() => openWeeklyStoryAction())).resolves.toBe("REDIRECT:/week?failed=1");
    expect(mocks.track).not.toHaveBeenCalled();
    for (const mock of aiCalls()) expect(mock).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("a failing upgrade keeps the catalog line and the landing", async () => {
    mocks.upgradeLine.mockResolvedValue({ ok: false });
    await expect(outcome(() => openWeeklyStoryAction())).resolves.toBe("REDIRECT:/week");
    expect(eventNames()).toEqual(["weekly_summary_viewed"]);
  });

  it("an AI that throws changes nothing about the landing, and is reported as a failed attempt", async () => {
    mocks.produceLine.mockRejectedValue(new Error("boom"));
    await expect(outcome(() => openWeeklyStoryAction())).resolves.toBe("REDIRECT:/week");
    expect(mocks.upgradeLine).not.toHaveBeenCalled();
    expect(eventNames()).toEqual(["weekly_summary_viewed", "weekly_line_wording_fallback"]);
    expect(mocks.track.mock.calls[1]?.[2]).toEqual({ reason: "provider_failed" });
  });

  it("reports an attempted-and-failed AI path, with its reason, but not a closed gate", async () => {
    mocks.produceLine.mockResolvedValue({ source: "catalog", text: he.weekly.line.learn, reason: "rejected_digits" });
    await outcome(() => openWeeklyStoryAction());
    expect(eventNames()).toEqual(["weekly_summary_viewed", "weekly_line_wording_fallback"]);
    expect(mocks.track.mock.calls[1]?.[2]).toEqual({ reason: "rejected_digits" });
    expect(mocks.upgradeLine).not.toHaveBeenCalled();

    mocks.track.mockClear();
    mocks.produceLine.mockResolvedValue({ source: "catalog", text: he.weekly.line.learn, reason: "ai_unconfigured" });
    await outcome(() => openWeeklyStoryAction());
    expect(eventNames()).toEqual(["weekly_summary_viewed"]);
  });

  it("uses the person's language for the sentence and for the stored line", async () => {
    mocks.locale.current = "en";
    await outcome(() => openWeeklyStoryAction());
    const input = mocks.produceLine.mock.calls[0]?.[1];
    expect(input.locale).toBe("en");
    expect(input.approvedText).toBe("One more small piece fell into the picture of what suits you.");
    expect(mocks.upgradeLine.mock.calls[0]?.[1].line.locale).toBe("en");
  });
});

// ---- snoozeWeeklyCardAction ----

describe("snoozeWeeklyCardAction", () => {
  it("records one content-free event for the week, at the app's instant, then goes Home", async () => {
    await expect(outcome(() => snoozeWeeklyCardAction())).resolves.toBe("REDIRECT:/");

    expect(mocks.track).toHaveBeenCalledTimes(1);
    const [, name, payload, at] = mocks.track.mock.calls[0] ?? [];
    expect(name).toBe("weekly_card_snoozed");
    expect(payload).toEqual({ week: WEEK.weekStart });
    expect(at).toBe(NOW);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("reads no data at all: hiding a card is harmless, so only the pure card window is checked", async () => {
    await outcome(() => snoozeWeeklyCardAction());
    expect(mocks.loadStory).not.toHaveBeenCalled();
    expect(mocks.loadPeriods).not.toHaveBeenCalled();
    for (const mock of [mocks.openStory, mocks.upgradeLine, mocks.recordResult, mocks.insertOffered, mocks.sync, mocks.record, ...aiCalls()]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it("does nothing once the card window has closed (Wednesday 05:00 local)", async () => {
    mocks.currentInstant.mockReturnValue(new Date("2026-10-21T02:00:00Z"));
    await expect(outcome(() => snoozeWeeklyCardAction())).resolves.toBe("REDIRECT:/");
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does nothing before the week is ready (Sunday 04:59 local)", async () => {
    mocks.currentInstant.mockReturnValue(new Date("2026-10-18T01:59:00Z"));
    await expect(outcome(() => snoozeWeeklyCardAction())).resolves.toBe("REDIRECT:/");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it.each([
    ["not set up", () => (mocks.configured.current = false), "REDIRECT:/"],
    ["signed out", () => (mocks.context.current = { kind: "signed_out" }), "REDIRECT:/login"],
    ["unreachable", () => (mocks.context.current = { kind: "unavailable" }), "REDIRECT:/"],
    ["in the First Week", () => (mocks.context.current = ready("FIRST_WEEK")), "REDIRECT:/"],
  ])("writes nothing when the person is %s", async (_name, arrange, expected) => {
    arrange();
    await expect(outcome(() => snoozeWeeklyCardAction())).resolves.toBe(expected);
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("writes nothing when the feature is switched off", async () => {
    mocks.flow.enabled = false;
    await expect(outcome(() => snoozeWeeklyCardAction())).resolves.toBe("REDIRECT:/");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("does not let a rejecting event sink change where the person lands", async () => {
    mocks.track.mockRejectedValue(new Error("sink down"));
    await expect(outcome(() => snoozeWeeklyCardAction())).resolves.toBe("REDIRECT:/");
  });
});

// ---- answerWeeklyPatternAction ----

describe("answerWeeklyPatternAction", () => {
  beforeEach(() => mocks.loadStory.mockResolvedValue(loaded({ story: ASK, signal: SIGNAL })));

  const rowAfter = (feedback: "confirm" | "unsure"): PatternRow => ({ id: "pattern-1", status: "CANDIDATE", feedback, feedbackAt: NOW });
  const viewAfter = (feedback: "confirm" | "unsure") =>
    effectivePatternStatus({ occurrences: OCCURRENCES.map((o) => o.occurredAt), timeZone: "Asia/Jerusalem", row: rowAfter(feedback) });

  it.each(["", "yes", "CONFIRM", "confirm ", "reject;", "1"])("changes nothing and reads nothing for an answer outside the closed list (%j)", async (answer) => {
    await expect(outcome(() => answerWeeklyPatternAction(form({ answer })))).resolves.toBe("REDIRECT:/week");
    expect(mocks.loadStory).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("changes nothing when the field is missing, and reads only the field `answer`", async () => {
    await expect(outcome(() => answerWeeklyPatternAction(new FormData()))).resolves.toBe("REDIRECT:/week");
    expectNothingWritten();

    const { form: spy, read } = watched(form({ answer: "confirm", pattern: "other-pattern", user: "someone", week: "2020-01-05" }));
    await outcome(() => answerWeeklyPatternAction(spy));
    expect(read).toEqual(["answer"]);
    expect(mocks.record).toHaveBeenCalledWith(supabase, expect.objectContaining({ patternId: "pattern-1" }));
  });

  it("syncs the evidence with the level the pattern WILL have, then records the answer, then tells the world, in that order", async () => {
    mocks.sync.mockImplementation(async () => (mocks.calls.push("sync"), { ok: true, patternId: "pattern-1" }));
    mocks.record.mockImplementation(async () => (mocks.calls.push("record"), { ok: true }));
    mocks.track.mockImplementation(async (_sink, name) => void mocks.calls.push(`event:${name}`));

    await expect(outcome(() => answerWeeklyPatternAction(form({ answer: "confirm" })))).resolves.toBe("REDIRECT:/week");

    expect(mocks.calls).toEqual(["sync", "record", "event:pattern_question_answered"]);
    expect(mocks.sync).toHaveBeenCalledWith(supabase, { occurrences: OCCURRENCES, view: viewAfter("confirm") });
    expect(mocks.record).toHaveBeenCalledWith(supabase, { patternId: "pattern-1", feedback: "confirm", now: NOW });
    expect(mocks.track.mock.calls[0]?.[2]).toEqual({ answer: "confirm", level: "CANDIDATE" });
    expect(mocks.track.mock.calls[0]?.[3]).toBe(NOW);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("applies the answer before the level is computed: a Sounds-right at a Candidate becomes Validated, 'not sure' stays Candidate", async () => {
    expect(viewAfter("confirm")).toBe("VALIDATED");
    expect(viewAfter("unsure")).toBe("CANDIDATE");

    await outcome(() => answerWeeklyPatternAction(form({ answer: "unsure" })));
    expect(mocks.sync).toHaveBeenCalledWith(supabase, { occurrences: OCCURRENCES, view: "CANDIDATE" });
    expect(mocks.record).toHaveBeenCalledWith(supabase, { patternId: "pattern-1", feedback: "unsure", now: NOW });
  });

  it("'not related' syncs an EMPTY set, so no evidence about the evening is left behind, then marks the row rejected", async () => {
    await expect(outcome(() => answerWeeklyPatternAction(form({ answer: "reject" })))).resolves.toBe("REDIRECT:/week");
    expect(mocks.sync).toHaveBeenCalledWith(supabase, { occurrences: [], view: "NONE" });
    expect(mocks.record).toHaveBeenCalledWith(supabase, { patternId: "pattern-1", feedback: "reject", now: NOW });
    expect(mocks.track.mock.calls[0]?.[2]).toEqual({ answer: "reject", level: "CANDIDATE" });
  });

  it("writes nothing when the live story does not ask the question (a stale tab, a double press, a typed address)", async () => {
    mocks.loadStory.mockResolvedValue(loaded({ story: STORY, signal: SIGNAL }));
    await expect(outcome(() => answerWeeklyPatternAction(form({ answer: "confirm" })))).resolves.toBe("REDIRECT:/week");
    expectNothingWritten();
  });

  it("writes nothing when the question is switched off", async () => {
    mocks.flow.patternQuestionEnabled = false;
    await expect(outcome(() => answerWeeklyPatternAction(form({ answer: "confirm" })))).resolves.toBe("REDIRECT:/week");
    expectNothingWritten();
  });

  it("writes nothing when the evening signal could not be read", async () => {
    mocks.loadStory.mockResolvedValue(loaded({ story: ASK, signal: null }));
    await expect(outcome(() => answerWeeklyPatternAction(form({ answer: "confirm" })))).resolves.toBe("REDIRECT:/week");
    expectNothingWritten();
  });

  it("writes nothing when the pattern was already rejected, whatever the answer", async () => {
    mocks.loadStory.mockResolvedValue(loaded({ story: ASK, signal: { ...SIGNAL, row: { ...ROW, status: "REJECTED", feedback: "reject" }, view: "REJECTED" } }));
    await expect(outcome(() => answerWeeklyPatternAction(form({ answer: "confirm" })))).resolves.toBe("REDIRECT:/week");
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("lands on the page's note, writing nothing more, when the evidence sync fails", async () => {
    mocks.sync.mockResolvedValue({ ok: false });
    await expect(outcome(() => answerWeeklyPatternAction(form({ answer: "confirm" })))).resolves.toBe("REDIRECT:/week?failed=1");
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("lands on the page's note, with no event, when recording the answer fails", async () => {
    mocks.record.mockResolvedValue({ ok: false });
    await expect(outcome(() => answerWeeklyPatternAction(form({ answer: "confirm" })))).resolves.toBe("REDIRECT:/week?failed=1");
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("never calls the AI", async () => {
    await outcome(() => answerWeeklyPatternAction(form({ answer: "confirm" })));
    for (const mock of aiCalls()) expect(mock).not.toHaveBeenCalled();
  });
});

// ---- answerExperimentResultAction ----

describe("answerExperimentResultAction", () => {
  beforeEach(() => mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision: RESULT_DUE, open: null } })));

  const ANSWERS: ExperimentResult[] = ["helpful", "somewhat", "not_really", "unknown", "not_tried"];

  it.each(ANSWERS)("stores %s with one conditional write at the app's instant, then tells the world once", async (result) => {
    mocks.recordResult.mockResolvedValue({ ok: true, value: { changed: true, key: "eat_intentionally", source: "ai" } });

    await expect(outcome(() => answerExperimentResultAction(form({ result })))).resolves.toBe("REDIRECT:/week");

    expect(mocks.recordResult).toHaveBeenCalledTimes(1);
    expect(mocks.recordResult).toHaveBeenCalledWith(supabase, USER, { result, now: NOW });
    expect(mocks.track).toHaveBeenCalledTimes(1);
    const [, name, payload, at] = mocks.track.mock.calls[0] ?? [];
    expect(name).toBe("experiment_completed");
    expect(payload).toEqual({ result, source: "ai" });
    expect(at).toBe(NOW);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each(["", "great", "HELPFUL", "not-really", "helpful,somewhat", "0"])("changes nothing and reads nothing for a result outside the closed five (%j)", async (result) => {
    await expect(outcome(() => answerExperimentResultAction(form({ result })))).resolves.toBe("REDIRECT:/week");
    expect(mocks.loadStory).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("reads only the field `result`: no id, no week, no user", async () => {
    const { form: spy, read } = watched(form({ result: "helpful", id: "exp-9", user_id: "someone-else", week: "2020-01-05" }));
    await outcome(() => answerExperimentResultAction(spy));
    expect(read).toEqual(["result"]);
    expect(mocks.recordResult).toHaveBeenCalledWith(supabase, USER, { result: "helpful", now: NOW });
  });

  it.each([
    ["nothing to offer", NONE],
    ["an offer", OFFER_STARTER],
    ["an idea waiting", PENDING],
    ["a young experiment", ACTIVE],
  ])("writes nothing when the live decision is %s (a stale tab, a replayed post)", async (_name, decision) => {
    mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision, open: null } }));
    await expect(outcome(() => answerExperimentResultAction(form({ result: "helpful" })))).resolves.toBe("REDIRECT:/week");
    expectNothingWritten();
  });

  it("emits nothing when the answer changed no row (already answered, or gone), and still lands on the page", async () => {
    mocks.recordResult.mockResolvedValue({ ok: true, value: { changed: false, key: null, source: null } });
    await expect(outcome(() => answerExperimentResultAction(form({ result: "helpful" })))).resolves.toBe("REDIRECT:/week");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("passes an unknown source of the wording through as null, never as a guess", async () => {
    mocks.recordResult.mockResolvedValue({ ok: true, value: { changed: true, key: null, source: null } });
    await outcome(() => answerExperimentResultAction(form({ result: "not_tried" })));
    expect(mocks.track.mock.calls[0]?.[2]).toEqual({ result: "not_tried", source: null });
  });

  it("lands on the page's note, with no event, when the write fails", async () => {
    mocks.recordResult.mockResolvedValue({ ok: false });
    await expect(outcome(() => answerExperimentResultAction(form({ result: "helpful" })))).resolves.toBe("REDIRECT:/week?failed=1");
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("never calls the AI", async () => {
    await outcome(() => answerExperimentResultAction(form({ result: "helpful" })));
    for (const mock of aiCalls()) expect(mock).not.toHaveBeenCalled();
  });
});

// ---- proposeWeeklyExperimentAction ----

describe("proposeWeeklyExperimentAction", () => {
  const withOffer = (decision: WeeklyExperimentDecision, signal: unknown = SIGNAL) =>
    mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision, open: null }, signal }));

  const trace = () => {
    mocks.sync.mockImplementation(async () => (mocks.calls.push("sync"), { ok: true, patternId: "pattern-1" }));
    mocks.insertOffered.mockImplementation(async () => (mocks.calls.push("insertOffered"), { ok: true, value: { id: "exp-1", created: true } }));
    mocks.produceExperiment.mockImplementation(async () => (mocks.calls.push("ai"), { source: "ai", text: "a reworded sentence", provider: "p", model: "m" }));
    mocks.upgradeOffered.mockImplementation(async () => (mocks.calls.push("upgrade"), { ok: true, value: { changed: true } }));
    mocks.track.mockImplementation(async (_sink, name) => void mocks.calls.push(`event:${name}`));
  };

  describe("a pattern-led offer", () => {
    beforeEach(() => withOffer(OFFER_PATTERN));

    it("syncs the evidence, then inserts the OFFERED row, THEN calls the AI, then upgrades, then tells the world", async () => {
      trace();
      await expect(outcome(() => proposeWeeklyExperimentAction())).resolves.toBe("REDIRECT:/week");
      expect(mocks.calls).toEqual(["sync", "insertOffered", "ai", "upgrade", "event:experiment_offered"]);
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("syncs the live evidence with the live level and inserts the LIBRARY sentence of the engine's key, tied to the pattern", async () => {
      await outcome(() => proposeWeeklyExperimentAction());
      expect(mocks.sync).toHaveBeenCalledWith(supabase, { occurrences: OCCURRENCES, view: "CANDIDATE" });
      expect(mocks.insertOffered).toHaveBeenCalledWith(supabase, {
        patternId: "pattern-1",
        key: "eat_intentionally",
        variantId: "default",
        libraryText: he.interventions.eat_intentionally.default,
        locale: "he",
      });
    });

    it("asks the AI to reword that sentence, with the pattern's level and the evenings it was built on", async () => {
      await outcome(() => proposeWeeklyExperimentAction());
      const [deps, input] = mocks.produceExperiment.mock.calls[0] ?? [];
      expect(deps).toMatchObject({ supabase, userId: USER, now: NOW, timeZone: "Asia/Jerusalem" });
      expect(input).toEqual({
        offer: { key: "eat_intentionally", variantId: "default", scope: "next_meal" },
        approvedText: he.interventions.eat_intentionally.default,
        locale: "he",
        signal: { view: "CANDIDATE", occurrences: 4, distinctDays: 4 },
        availableDays: 6,
      });
    });

    it("upgrades the offer's wording with the validated sentence, and reports it as AI only if the row really changed", async () => {
      await outcome(() => proposeWeeklyExperimentAction());
      expect(mocks.upgradeOffered).toHaveBeenCalledWith(supabase, USER, { text: "a reworded sentence", locale: "he" });
      expect(mocks.track.mock.calls[0]?.[1]).toBe("experiment_offered");
      expect(mocks.track.mock.calls[0]?.[2]).toEqual({ source: "ai", gate: "open", origin: "pattern" });
      expect(mocks.track.mock.calls[0]?.[3]).toBe(NOW);

      mocks.track.mockClear();
      mocks.upgradeOffered.mockResolvedValue({ ok: true, value: { changed: false } });
      await outcome(() => proposeWeeklyExperimentAction());
      expect(mocks.track.mock.calls[0]?.[2]).toEqual({ source: "library", gate: "open", origin: "pattern" });
    });

    it("keeps the approved sentence and reports the gate when the AI path is closed (not a failure: no fallback event)", async () => {
      mocks.produceExperiment.mockResolvedValue({ source: "library", text: "x", reason: "ai_unconfigured" });
      await expect(outcome(() => proposeWeeklyExperimentAction())).resolves.toBe("REDIRECT:/week");
      expect(mocks.upgradeOffered).not.toHaveBeenCalled();
      expect(eventNames()).toEqual(["experiment_offered"]);
      expect(mocks.track.mock.calls[0]?.[2]).toEqual({ source: "library", gate: "ai_unconfigured", origin: "pattern" });
    });

    it("keeps the approved sentence and reports a fallback when the AI path was attempted and failed", async () => {
      mocks.produceExperiment.mockResolvedValue({ source: "library", text: "x", reason: "rejected_digits" });
      await outcome(() => proposeWeeklyExperimentAction());
      expect(mocks.upgradeOffered).not.toHaveBeenCalled();
      expect(eventNames()).toEqual(["experiment_offered", "experiment_wording_fallback"]);
      expect(mocks.track.mock.calls[0]?.[2]).toEqual({ source: "library", gate: "open", origin: "pattern" });
      expect(mocks.track.mock.calls[1]?.[2]).toEqual({ reason: "rejected_digits" });
    });

    it("an AI that throws changes nothing about the offer: it stands with the approved sentence", async () => {
      mocks.produceExperiment.mockRejectedValue(new Error("boom"));
      await expect(outcome(() => proposeWeeklyExperimentAction())).resolves.toBe("REDIRECT:/week");
      expect(mocks.insertOffered).toHaveBeenCalledTimes(1);
      expect(mocks.upgradeOffered).not.toHaveBeenCalled();
      expect(eventNames()).toEqual(["experiment_offered", "experiment_wording_fallback"]);
    });

    it("a double tap or a second tab (the row already exists): the page, with NO AI call, NO upgrade and NO event", async () => {
      mocks.insertOffered.mockResolvedValue({ ok: true, value: { id: "exp-1", created: false } });
      await expect(outcome(() => proposeWeeklyExperimentAction())).resolves.toBe("REDIRECT:/week");
      for (const mock of aiCalls()) expect(mock).not.toHaveBeenCalled();
      expect(mocks.upgradeOffered).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it("lands on the page's note, before any row or AI call, when the evidence sync fails", async () => {
      mocks.sync.mockResolvedValue({ ok: false });
      await expect(outcome(() => proposeWeeklyExperimentAction())).resolves.toBe("REDIRECT:/week?failed=1");
      expect(mocks.insertOffered).not.toHaveBeenCalled();
      for (const mock of aiCalls()) expect(mock).not.toHaveBeenCalled();
    });

    it("lands on the page's note, with no AI call and no event, when the row cannot be inserted", async () => {
      mocks.insertOffered.mockResolvedValue({ ok: false, code: "unavailable" });
      await expect(outcome(() => proposeWeeklyExperimentAction())).resolves.toBe("REDIRECT:/week?failed=1");
      for (const mock of aiCalls()) expect(mock).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it.each([
      ["unreadable", null],
      ["rejected", { ...SIGNAL, view: "REJECTED", row: { ...ROW, status: "REJECTED", feedback: "reject" } }],
    ])("writes nothing when the evening signal is %s: the idea was about a pattern that is not there", async (_name, signal) => {
      withOffer(OFFER_PATTERN, signal);
      await expect(outcome(() => proposeWeeklyExperimentAction())).resolves.toBe("REDIRECT:/week");
      expectNothingWritten();
    });

    it("uses the person's language for the sentence it stores and asks about", async () => {
      mocks.locale.current = "en";
      await outcome(() => proposeWeeklyExperimentAction());
      expect(mocks.insertOffered.mock.calls[0]?.[1]).toMatchObject({ locale: "en" });
      expect(mocks.insertOffered.mock.calls[0]?.[1].libraryText).not.toBe(he.interventions.eat_intentionally.default);
      expect(mocks.produceExperiment.mock.calls[0]?.[1].locale).toBe("en");
    });
  });

  describe("a goal-led starter", () => {
    beforeEach(() => withOffer(OFFER_STARTER, null));

    it("creates NO pattern row: no sync at all, the offer is inserted with no pattern, and the order is insert, AI call, upgrade, event", async () => {
      trace();
      await expect(outcome(() => proposeWeeklyExperimentAction())).resolves.toBe("REDIRECT:/week");
      expect(mocks.calls).toEqual(["insertOffered", "ai", "upgrade", "event:experiment_offered"]);
      expect(mocks.sync).not.toHaveBeenCalled();
      expect(mocks.insertOffered.mock.calls[0]?.[1].patternId).toBeNull();
    });

    it("creates no pattern row even when a real Candidate exists beside it: the offer is not about the pattern", async () => {
      withOffer(OFFER_STARTER, SIGNAL);
      await outcome(() => proposeWeeklyExperimentAction());
      expect(mocks.sync).not.toHaveBeenCalled();
      expect(mocks.insertOffered.mock.calls[0]?.[1].patternId).toBeNull();
      expect(mocks.produceExperiment.mock.calls[0]?.[1].signal).toEqual({ view: "NONE", occurrences: 0, distinctDays: 0 });
    });

    it("calls the orchestrator with the NONE signal, so its own gate closes and a starter never reaches the AI", async () => {
      await outcome(() => proposeWeeklyExperimentAction());
      expect(mocks.produceExperiment.mock.calls[0]?.[1].signal).toEqual({ view: "NONE", occurrences: 0, distinctDays: 0 });
    });

    it("reports the origin as a starter, and a closed gate as the gate", async () => {
      mocks.produceExperiment.mockResolvedValue({ source: "library", text: "x", reason: "pattern_not_established" });
      await outcome(() => proposeWeeklyExperimentAction());
      expect(eventNames()).toEqual(["experiment_offered"]);
      expect(mocks.track.mock.calls[0]?.[2]).toEqual({ source: "library", gate: "pattern_not_established", origin: "starter" });
    });

    it("is not blocked by an unreadable or rejected evening signal: it is not about a pattern", async () => {
      withOffer(OFFER_STARTER, { ...SIGNAL, view: "REJECTED", row: { ...ROW, status: "REJECTED", feedback: "reject" } });
      await expect(outcome(() => proposeWeeklyExperimentAction())).resolves.toBe("REDIRECT:/week");
      expect(mocks.insertOffered).toHaveBeenCalledTimes(1);
      expect(mocks.sync).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["nothing to offer", NONE],
    ["an idea waiting", PENDING],
    ["a running experiment", ACTIVE],
    ["a result that is due", RESULT_DUE],
  ])("writes nothing and asks nothing of the AI when the live decision is %s (a stale tab, a replayed post)", async (_name, decision) => {
    withOffer(decision);
    await expect(outcome(() => proposeWeeklyExperimentAction())).resolves.toBe("REDIRECT:/week");
    expectNothingWritten();
  });
});

// ---- startWeeklyExperimentAction and skipWeeklyExperimentAction ----

describe.each([
  ["startWeeklyExperimentAction", () => startWeeklyExperimentAction(), () => mocks.startExperiment, "experiment_started"],
  ["skipWeeklyExperimentAction", () => skipWeeklyExperimentAction(), () => mocks.skipExperiment, "experiment_skipped"],
] as const)("%s", (_name, run, writer, event) => {
  beforeEach(() => mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision: PENDING, open: { ...OPEN_OFFERED, source: "ai", origin: "pattern" } } })));

  it("changes the person's single open row once, at the app's instant, then tells the world with the stored source and origin", async () => {
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week");

    expect(writer()).toHaveBeenCalledTimes(1);
    expect(writer()).toHaveBeenCalledWith(supabase, USER, NOW);
    expect(mocks.track).toHaveBeenCalledTimes(1);
    const [, name, payload, at] = mocks.track.mock.calls[0] ?? [];
    expect(name).toBe(event);
    expect(payload).toEqual({ source: "ai", origin: "pattern" });
    expect(at).toBe(NOW);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("emits nothing when no row changed (already started, skipped or gone: a double tap, another tab)", async () => {
    writer().mockResolvedValue({ ok: true, value: { changed: false } });
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it.each([
    ["nothing to offer", NONE],
    ["an offer", OFFER_STARTER],
    ["a running experiment", ACTIVE],
    ["a result that is due", RESULT_DUE],
  ])("writes nothing when the live decision is %s", async (_name2, decision) => {
    mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision, open: OPEN_OFFERED } }));
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week");
    expectNothingWritten();
  });

  it("writes nothing when the waiting idea's row could not be read, or is not the one the decision names", async () => {
    mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision: PENDING, open: null } }));
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week");
    expectNothingWritten();

    mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision: PENDING, open: { ...OPEN_OFFERED, id: "exp-other" } } }));
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week");
    expectNothingWritten();

    mocks.loadStory.mockResolvedValue(loaded({ experiment: { decision: PENDING, open: { ...OPEN_OFFERED, status: "ACTIVE" } } }));
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week");
    expectNothingWritten();
  });

  it("lands on the page's note, with no event, when the write fails", async () => {
    writer().mockResolvedValue({ ok: false, code: "unavailable" });
    await expect(outcome(run)).resolves.toBe("REDIRECT:/week?failed=1");
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("never calls the AI", async () => {
    await outcome(run);
    for (const mock of aiCalls()) expect(mock).not.toHaveBeenCalled();
  });
});
