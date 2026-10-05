// What the "your week" page (/week) decides, with the gate and the loader mocked. The page returns an element tree; the async
// server components inside it are not rendered here (static markup cannot), so these tests read the element's type and props:
// which screen, and with what. The rules (resolveOpeningLine, the decision) run for real.
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { WeeklyUnavailable } from "@/components/weekly/WeeklyUnavailable";
import { WeeklyView } from "@/components/weekly/WeeklyView";
import { weekWindowOf, type WeeklyExperimentDecision, type WeeklyStory } from "@/domain/weekly";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import WeekPage, { generateMetadata, maxDuration } from "./page";

const mocks = vi.hoisted(() => ({
  appGate: vi.fn(),
  loadStory: vi.fn(),
  currentInstant: vi.fn(),
  flow: { enabled: true, patternQuestionEnabled: true, starterExperimentsEnabled: false, aiLineEnabled: true, weightLineEnabled: true },
  locale: { current: "he" as "he" | "en" },
  actions: {
    propose: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    skip: vi.fn(async () => {}),
    answerResult: vi.fn(async () => {}),
    answerPattern: vi.fn(async () => {}),
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/app/(app)/_lib/gate", () => ({ openAppGate: mocks.appGate }));
vi.mock("@/lib/weekly/load", () => ({ loadWeeklyStory: mocks.loadStory }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
vi.mock("./actions", () => ({
  proposeWeeklyExperimentAction: mocks.actions.propose,
  startWeeklyExperimentAction: mocks.actions.start,
  skipWeeklyExperimentAction: mocks.actions.skip,
  answerExperimentResultAction: mocks.actions.answerResult,
  answerWeeklyPatternAction: mocks.actions.answerPattern,
}));
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

const NOW = new Date("2026-10-18T07:00:00Z");
const SUPABASE = { tag: "client" };
const CONTEXT = { kind: "ready", userId: "user-1", row: { lifecycle_state: "WEEKLY_CYCLE", timezone: "Asia/Jerusalem" }, supabase: SUPABASE };
const WEEK = weekWindowOf(new Date("2026-10-13T09:00:00Z"), "Asia/Jerusalem"); // Sunday 2026-10-11 to Saturday 2026-10-17

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

const OFFER: WeeklyExperimentDecision = {
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

const ready = (over: Record<string, unknown> = {}) => ({
  kind: "ready",
  moment: { kind: "READY", week: WEEK, availableDays: 6 },
  story: STORY,
  experiment: { decision: { kind: "NONE", reason: "none_eligible" }, open: null },
  row: null,
  signal: null,
  patterns: [],
  goalFocus: [],
  availableDays: 6,
  ...over,
});

const openExperiment = (over: Record<string, unknown> = {}) => ({
  id: "exp-1",
  status: "ACTIVE",
  key: "eat_intentionally",
  variantId: "default",
  origin: "pattern",
  wording: "the stored sentence",
  source: "ai",
  locale: "he",
  startedAt: new Date("2026-10-14T08:00:00Z"),
  ...over,
});

const props = (query: Record<string, string | string[] | undefined> = {}) => ({ searchParams: Promise.resolve(query) }) as never;

async function outcome(run: () => Promise<unknown>): Promise<ReactElement | string> {
  try {
    return (await run()) as ReactElement;
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN";
  }
}

beforeEach(() => {
  mocks.appGate.mockReset().mockResolvedValue({ kind: "open", context: CONTEXT });
  mocks.loadStory.mockReset().mockResolvedValue(ready());
  mocks.currentInstant.mockReset().mockReturnValue(NOW);
  Object.assign(mocks.flow, { enabled: true });
  mocks.locale.current = "he";
});

describe("/week", () => {
  it("is titled from the catalog", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: he.weekly.meta.title });
  });

  it("exports a maxDuration of at least 30 seconds: it is the route that posts the action that may call the AI", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(30);
    const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
    expect(source).toMatch(/export const maxDuration = \d+;/);
  });

  describe("the gate", () => {
    it("shows the setup notice when Supabase is not configured", async () => {
      mocks.appGate.mockResolvedValue({ kind: "not_configured" });
      expect(((await WeekPage(props())) as ReactElement).type).toBe(SetupNotice);
      expect(mocks.loadStory).not.toHaveBeenCalled();
    });

    it("sends Home when the feature is switched off, reading nothing", async () => {
      mocks.flow.enabled = false;
      await expect(outcome(() => WeekPage(props()))).resolves.toBe("REDIRECT:/");
      expect(mocks.loadStory).not.toHaveBeenCalled();
    });

    it("sends a visitor whose session ended to sign in", async () => {
      mocks.appGate.mockResolvedValue({ kind: "open", context: { kind: "signed_out" } });
      await expect(outcome(() => WeekPage(props()))).resolves.toBe("REDIRECT:/login");
      expect(mocks.loadStory).not.toHaveBeenCalled();
    });

    it.each([{ kind: "unavailable" }, { kind: "profile_missing" }])("shows the calm unavailable card when the context is $kind", async (context) => {
      mocks.appGate.mockResolvedValue({ kind: "open", context });
      expect(((await WeekPage(props())) as ReactElement).type).toBe(WeeklyUnavailable);
      expect(mocks.loadStory).not.toHaveBeenCalled();
    });
  });

  describe("the redirect matrix", () => {
    it.each([["not_weekly_cycle"], ["not_ready"]])("sends Home for %s, showing nothing", async (kind) => {
      mocks.loadStory.mockResolvedValue({ kind });
      await expect(outcome(() => WeekPage(props()))).resolves.toBe("REDIRECT:/");
    });

    it("shows the calm unavailable card when the database cannot be read", async () => {
      mocks.loadStory.mockResolvedValue({ kind: "unavailable" });
      expect(((await WeekPage(props())) as ReactElement).type).toBe(WeeklyUnavailable);
    });

    it("reads the story for the open context at the app's clock instant, once", async () => {
      await WeekPage(props());
      expect(mocks.currentInstant).toHaveBeenCalledTimes(1);
      expect(mocks.loadStory).toHaveBeenCalledTimes(1);
      expect(mocks.loadStory).toHaveBeenCalledWith(CONTEXT, NOW);
    });

    it("takes no query parameter that selects a week: any other parameter changes nothing", async () => {
      const plain = (await WeekPage(props())) as ReactElement<{ rangeLabel: string }>;
      const other = (await WeekPage(props({ week: "2026-01-04", weekStart: "2026-01-04" }))) as ReactElement<{ rangeLabel: string }>;
      expect(other.props.rangeLabel).toBe(plain.props.rangeLabel);
      expect(mocks.loadStory).toHaveBeenLastCalledWith(CONTEXT, NOW);
    });
  });

  describe("a story that is ready", () => {
    type ViewProps = Parameters<typeof WeeklyView>[0];
    const view = async (query: Record<string, string | string[] | undefined> = {}) => (await WeekPage(props(query))) as ReactElement<ViewProps>;

    it("shows the weekly view with the loaded story, the decision and the five Server Actions", async () => {
      const element = await view();
      expect(element.type).toBe(WeeklyView);
      expect(element.props.story).toBe(STORY);
      expect(element.props.decision).toEqual({ kind: "NONE", reason: "none_eligible" });
      expect(element.props.failed).toBe(false);
      expect(element.props.experiment).toBeNull();
      expect(element.props.offer).toBeNull();
      expect(element.props.actions).toEqual({
        propose: mocks.actions.propose,
        start: mocks.actions.start,
        skip: mocks.actions.skip,
        answerResult: mocks.actions.answerResult,
        answerPattern: mocks.actions.answerPattern,
      });
    });

    it("passes failed for ?failed=1 and for nothing else", async () => {
      expect((await view({ failed: "1" })).props.failed).toBe(true);
      expect((await view({ failed: "0" })).props.failed).toBe(false);
      expect((await view({ failed: ["1", "1"] })).props.failed).toBe(false);
      expect((await view({ other: "1" })).props.failed).toBe(false);
    });

    it("builds the dates of the week in the person's zone, in the page's language: the only digits", async () => {
      expect((await view()).props.rangeLabel).toBe("11 באוקטובר עד 17 באוקטובר");
      mocks.locale.current = "en";
      expect((await view()).props.rangeLabel).toBe("October 11 to October 17");
    });

    it("builds the dates in the person's own zone, not the server's", async () => {
      // 2026-10-17T21:30Z is Saturday evening in UTC but already Sunday 00:30 in Jerusalem (UTC+3 until the 25th): it is a new week.
      const sunday = weekWindowOf(new Date("2026-10-17T21:30:00Z"), "Asia/Jerusalem");
      mocks.loadStory.mockResolvedValue(ready({ moment: { kind: "READY", week: sunday, availableDays: 6 } }));
      expect((await view()).props.rangeLabel).toBe("18 באוקטובר עד 24 באוקטובר");
    });

    describe("the opening line", () => {
      it("is the catalog sentence of the live line when nothing was stored", async () => {
        expect((await view()).props.line).toEqual({ source: "catalog", text: he.weekly.line.learn });
      });

      it("is the stored AI line while its mode, key and language still match", async () => {
        mocks.loadStory.mockResolvedValue(ready({ row: { openingMode: "LEARN", viewedAt: NOW, line: { text: "a warmer sentence", locale: "he", mode: "LEARN", key: "learn" } } }));
        expect((await view()).props.line).toEqual({ source: "ai", text: "a warmer sentence" });
      });

      it("falls back to the catalog sentence when the person switched language since", async () => {
        mocks.loadStory.mockResolvedValue(ready({ row: { openingMode: "LEARN", viewedAt: NOW, line: { text: "a warmer sentence", locale: "he", mode: "LEARN", key: "learn" } } }));
        mocks.locale.current = "en";
        expect((await view()).props.line).toEqual({ source: "catalog", text: en.weekly.line.learn });
      });

      it("falls back when a deleted meal changed the mode, and says the line of the live mode", async () => {
        const quiet: WeeklyStory = { ...STORY, mode: "RESET", reason: "little_data", lineKey: "quiet" };
        mocks.loadStory.mockResolvedValue(
          ready({ story: quiet, row: { openingMode: "LEARN", viewedAt: NOW, line: { text: "a warmer sentence", locale: "he", mode: "LEARN", key: "learn" } } }),
        );
        expect((await view()).props.line).toEqual({ source: "catalog", text: he.weekly.line.quiet });
      });
    });

    describe("the experiment and the offer", () => {
      it("gives an OFFER's rationale and no experiment text", async () => {
        mocks.loadStory.mockResolvedValue(ready({ experiment: { decision: OFFER, open: null } }));
        const props = (await view()).props;
        expect(props.offer).toEqual({ rationale: OFFER.rationale });
        expect(props.experiment).toBeNull();
      });

      it("gives a PENDING idea's stored sentence when it was written in the page's language", async () => {
        mocks.loadStory.mockResolvedValue(
          ready({ experiment: { decision: { kind: "PENDING", experimentId: "exp-1" }, open: openExperiment({ status: "OFFERED" }) } }),
        );
        const props = (await view()).props;
        expect(props.experiment).toEqual({ text: "the stored sentence", source: "ai", origin: "pattern" });
        expect(props.offer).toBeNull();
      });

      it("gives the library's sentence of the page's language, as a library sentence, when the person switched language since", async () => {
        mocks.loadStory.mockResolvedValue(
          ready({ experiment: { decision: { kind: "ACTIVE", experimentId: "exp-1" }, open: openExperiment({ locale: "en" }) } }),
        );
        expect((await view()).props.experiment).toEqual({ text: he.interventions.eat_intentionally.default, source: "library", origin: "pattern" });
      });

      it("gives the running experiment to the result question as well", async () => {
        mocks.loadStory.mockResolvedValue(
          ready({ experiment: { decision: { kind: "RESULT_DUE", experimentId: "exp-1", key: "eat_intentionally", variantId: "default" }, open: openExperiment() } }),
        );
        expect((await view()).props.experiment?.text).toBe("the stored sentence");
      });

      it("gives no experiment for NONE or an OFFER even when an old row is attached", async () => {
        mocks.loadStory.mockResolvedValue(ready({ experiment: { decision: { kind: "NONE", reason: "cooling_down" }, open: openExperiment() } }));
        expect((await view()).props.experiment).toBeNull();
      });

      it("gives no experiment when the open row could not be read", async () => {
        mocks.loadStory.mockResolvedValue(ready({ experiment: { decision: { kind: "PENDING", experimentId: "exp-1" }, open: null } }));
        expect((await view()).props.experiment).toBeNull();
      });
    });
  });

  it("is a pure read: it imports no writer, no AI code and no admin client, and reads no clock of its own", () => {
    const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
    expect(source).not.toMatch(/lib\/ai\/|lib\/weekly\/(open|result|word)|produce(Weekly|Experiment)|wordWeeklyLine|generateInsight|createAdminClient/);
    expect(source).not.toMatch(/new Date\(|Date\.now/);
  });
});
