// What the experiment page (B5) decides, with the gate and the clock mocked and the REAL loaders over a scripted
// database, so the summary page (B6) and this one can be asked the same question and must give the same answer.
// The pages return an element tree; the async server components inside it are not rendered here (static markup
// cannot), so these tests read the element's type and props: which screen, and with what.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { ExperimentView } from "@/components/firstWeek/ExperimentView";
import { FirstWeekSummaryView } from "@/components/firstWeek/FirstWeekSummaryView";
import { FirstWeekUnavailable } from "@/components/firstWeek/FirstWeekUnavailable";
import { normalizeRow } from "@/domain/onboarding";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { createFakeReadSupabase, type FakeTable } from "@/lib/home/fakeReadSupabase";
import FirstWeekPage from "../page";
import FirstWeekExperimentPage, { generateMetadata } from "./page";

const mocks = vi.hoisted(() => ({
  appGate: vi.fn(),
  currentInstant: vi.fn(),
  flow: { summaryEnabled: true, welcomeBackEnabled: true, acknowledgementEnabled: true },
  pattern: { detectionEnabled: true, earlySignalEnabled: true, experimentEnabled: true, syncOnMealChange: true },
  locale: { current: "he" as "he" | "en" },
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/app/(app)/_lib/gate", () => ({ openAppGate: mocks.appGate }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
// The Server Actions are not under test here; only that the views are handed the very functions.
vi.mock("../actions", () => ({ finishFirstWeekAction: async () => {}, snoozeFirstWeekCardAction: async () => {} }));
vi.mock("./actions", () => ({
  proposeFirstExperimentAction: async () => {},
  startFirstExperimentAction: async () => {},
  skipFirstExperimentAction: async () => {},
}));
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

const USER = "00000000-0000-4000-8000-000000000001";
const ZONE = "Asia/Jerusalem"; // UTC+3 until 2026-10-25
const STARTED_AT = "2026-10-01T09:30:00Z";
const NOW = new Date("2026-10-07T08:00:00Z"); // five available days have ended, so the summary is ready

const EMPTY: FakeTable = { rows: [] };
const at = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 9, day, hh - 3, mm)).toISOString();
const mealRow = (id: string, when: string) => ({ id, confirmed_at: when, occurred_at: when });
const SHABBAT = { type: "SHABBAT", start_at: "2026-10-02T14:20:00Z", end_at: "2026-10-03T15:20:00Z" };

/** Ten daytime meals on 1 to 6 October, none of them late. */
const DAYTIME_TEN = [1, 1, 2, 2, 4, 4, 5, 5, 6, 6].map((day, i) => mealRow(`d${i}`, at(day, 12 + (i % 2))));
const lateOn = (days: number[]) => days.map((day) => mealRow(`late-${day}`, at(day, 21, 30)));
/** Ten meals, `days.length` of them late on different evenings. */
const withLate = (days: number[]) => [...DAYTIME_TEN.slice(0, 10 - days.length), ...lateOn(days)];

const CANDIDATE = withLate([4, 5, 6]);
const EARLY_SIGNAL = withLate([5, 6]);
const NO_SIGNAL = withLate([]);

const PATTERN_ID = "pattern-1";
const patternRow = (over: Record<string, unknown> = {}) => ({ id: PATTERN_ID, status: "CANDIDATE", user_feedback: null, user_feedback_at: null, ...over });
const experimentRow = (over: Record<string, unknown> = {}) => ({
  id: "exp-1",
  status: "OFFERED",
  source_pattern_id: PATTERN_ID,
  intervention_key: "eat_intentionally",
  variant: "default",
  wording: "the stored sentence",
  wording_source: "ai",
  wording_locale: "he",
  ended_at: null,
  ...over,
});

function tables(over: Record<string, FakeTable> = {}): Record<string, FakeTable> {
  return {
    profiles: { rows: [{ first_week_started_at: STARTED_AT }] },
    meal_entries: { rows: CANDIDATE },
    offline_periods: { rows: [SHABBAT] },
    patterns: { rows: [patternRow()] },
    experiments: { rows: [experimentRow()] },
    events: EMPTY,
    ...over,
  };
}

function ready(db: Record<string, FakeTable>, lifecycle = "FIRST_WEEK") {
  const { client } = createFakeReadSupabase(db);
  const row = normalizeRow({ lifecycle_state: lifecycle, timezone: ZONE, goal_focus: ["improve_eating"], goal_type: "numeric", motivation: null }, null);
  if (!row) throw new Error("the fixture row did not normalize");
  return { kind: "ready", userId: USER, row, supabase: client as SupabaseClient };
}

const open = (context: unknown) => ({ kind: "open", context });
const props = (query: Record<string, string | string[] | undefined> = {}) => ({ searchParams: Promise.resolve(query) }) as never;

async function outcome(run: () => Promise<unknown>): Promise<ReactElement | string> {
  try {
    return (await run()) as ReactElement;
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN";
  }
}

const experimentPage = (query: Record<string, string | string[] | undefined> = {}) => outcome(() => FirstWeekExperimentPage(props(query)));
const summaryPage = () => outcome(() => FirstWeekPage(props()));

beforeEach(() => {
  mocks.appGate.mockReset().mockResolvedValue(open(ready(tables())));
  mocks.currentInstant.mockReset().mockReturnValue(NOW);
  Object.assign(mocks.flow, { summaryEnabled: true });
  Object.assign(mocks.pattern, { experimentEnabled: true });
  mocks.locale.current = "he";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/first-week/experiment (B5)", () => {
  it("is titled from the catalog", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: he.firstWeek.experiment.meta.title });
  });

  describe("the gate", () => {
    it("shows the setup notice when Supabase is not configured", async () => {
      mocks.appGate.mockResolvedValue({ kind: "not_configured" });
      expect(((await experimentPage()) as ReactElement).type).toBe(SetupNotice);
    });

    it("sends a visitor whose session ended to sign in", async () => {
      mocks.appGate.mockResolvedValue(open({ kind: "signed_out" }));
      await expect(experimentPage()).resolves.toBe("REDIRECT:/login");
    });

    it.each([{ kind: "unavailable" }, { kind: "profile_missing" }])("shows the calm unavailable card when the context is $kind", async (context) => {
      mocks.appGate.mockResolvedValue(open(context));
      expect(((await experimentPage()) as ReactElement).type).toBe(FirstWeekUnavailable);
    });

    it("sends a user in the weekly cycle Home", async () => {
      mocks.appGate.mockResolvedValue(open(ready(tables(), "WEEKLY_CYCLE")));
      await expect(experimentPage()).resolves.toBe("REDIRECT:/");
    });

    it("sends Home when the summary is switched off", async () => {
      mocks.flow.summaryEnabled = false;
      await expect(experimentPage()).resolves.toBe("REDIRECT:/");
    });

    it("sends Home when the experiment is switched off", async () => {
      mocks.pattern.experimentEnabled = false;
      await expect(experimentPage()).resolves.toBe("REDIRECT:/");
    });
  });

  describe("what is shown", () => {
    type ViewProps = Parameters<typeof ExperimentView>[0];
    const view = async (query: Record<string, string | string[] | undefined> = {}) => (await experimentPage(query)) as ReactElement<ViewProps>;

    it("shows the unavailable card when the experiments cannot be read", async () => {
      mocks.appGate.mockResolvedValue(open(ready(tables({ experiments: { error: { code: "42501" } } }))));
      expect(((await experimentPage()) as ReactElement).type).toBe(FirstWeekUnavailable);
    });

    it("sends the person to the summary when there is nothing open", async () => {
      mocks.appGate.mockResolvedValue(open(ready(tables({ experiments: EMPTY }))));
      await expect(experimentPage()).resolves.toBe("REDIRECT:/first-week");
      mocks.appGate.mockResolvedValue(open(ready(tables({ experiments: { rows: [experimentRow({ status: "SKIPPED", ended_at: "2026-10-05T08:00:00Z" })] } }))));
      await expect(experimentPage()).resolves.toBe("REDIRECT:/first-week");
    });

    it("shows an offered idea whose pattern is still established, with its stored sentence and the two actions", async () => {
      const element = await view();
      expect(element.type).toBe(ExperimentView);
      expect(element.props.experiment.id).toBe("exp-1");
      expect(element.props.experiment.status).toBe("OFFERED");
      expect(element.props.text).toBe("the stored sentence");
      expect(element.props.failed).toBe(false);
      expect(typeof element.props.startAction).toBe("function");
      expect(typeof element.props.skipAction).toBe("function");
    });

    it("shows the library's sentence of the current language when the stored one was written in the other", async () => {
      mocks.locale.current = "en";
      expect((await view()).props.text).toBe(en.interventions.eat_intentionally.default);
      mocks.locale.current = "he";
      mocks.appGate.mockResolvedValue(open(ready(tables({ experiments: { rows: [experimentRow({ wording_locale: "en", wording: "english stored" })] } }))));
      expect((await view()).props.text).toBe(he.interventions.eat_intentionally.default);
    });

    it("passes failed for ?failed=1 and for nothing else", async () => {
      expect((await view({ failed: "1" })).props.failed).toBe(true);
      expect((await view({ failed: "true" })).props.failed).toBe(false);
      expect((await view({})).props.failed).toBe(false);
    });

    it("shows a STARTED experiment whatever happens to the meals", async () => {
      mocks.appGate.mockResolvedValue(
        open(ready(tables({ experiments: { rows: [experimentRow({ status: "ACTIVE" })] }, meal_entries: { rows: NO_SIGNAL }, patterns: EMPTY }))),
      );
      const element = await view();
      expect(element.type).toBe(ExperimentView);
      expect(element.props.experiment.status).toBe("ACTIVE");
    });
  });

  describe("an offer whose pattern is no longer established goes back to the summary and is left as it is", () => {
    it.each([
      ["the evidence was deleted: only two evenings are left", { meal_entries: { rows: EARLY_SIGNAL } }],
      ["every late meal was deleted", { meal_entries: { rows: NO_SIGNAL } }],
      ["the person said 'Not related to me'", { patterns: { rows: [patternRow({ status: "REJECTED", user_feedback: "reject", user_feedback_at: "2026-10-06T08:00:00Z" })] } }],
      ["the pattern row is gone", { patterns: EMPTY }],
      ["the offer points at no pattern", { experiments: { rows: [experimentRow({ source_pattern_id: null })] } }],
      ["the meals cannot be read (unknown is not established)", { meal_entries: { error: { code: "42501" } } }],
    ])("%s", async (_name, over) => {
      mocks.appGate.mockResolvedValue(open(ready(tables(over as Record<string, FakeTable>))));
      await expect(experimentPage()).resolves.toBe("REDIRECT:/first-week");
    });
  });

  describe("B6 and B5 always agree", () => {
    type SummaryProps = Parameters<typeof FirstWeekSummaryView>[0];

    const scenarios: Array<[string, Record<string, FakeTable>, "PENDING" | "ACTIVE" | "NONE"]> = [
      ["a Candidate with an offer waiting", {}, "PENDING"],
      ["two evenings only", { meal_entries: { rows: EARLY_SIGNAL } }, "NONE"],
      ["no late meal at all", { meal_entries: { rows: NO_SIGNAL } }, "NONE"],
      ["a rejected pattern", { patterns: { rows: [patternRow({ status: "REJECTED", user_feedback: "reject", user_feedback_at: "2026-10-06T08:00:00Z" })] } }, "NONE"],
      ["a missing pattern row", { patterns: EMPTY }, "NONE"],
      ["an offer with no pattern", { experiments: { rows: [experimentRow({ source_pattern_id: null })] } }, "NONE"],
      ["a pattern that cannot be read", { patterns: { error: { code: "42501" } } }, "NONE"],
      ["a started experiment with no evidence left", { experiments: { rows: [experimentRow({ status: "ACTIVE" })] }, meal_entries: { rows: NO_SIGNAL }, patterns: EMPTY }, "ACTIVE"],
    ];

    it.each(scenarios)("%s", async (_name, over, expected) => {
      mocks.appGate.mockResolvedValue(open(ready(tables(over))));
      const summary = (await summaryPage()) as ReactElement<SummaryProps>;
      expect(summary.type).toBe(FirstWeekSummaryView);
      expect(summary.props.summary.next.kind).toBe(expected === "NONE" ? "NO_EXPERIMENT" : expected);

      mocks.appGate.mockResolvedValue(open(ready(tables(over))));
      const page = await experimentPage();
      const showsTheCard = typeof page !== "string" && page.type === ExperimentView;
      // "An idea is waiting" on B6 exactly when B5 shows the card; a started one is shown by both.
      expect(showsTheCard).toBe(expected !== "NONE");
      if (!showsTheCard) expect(page).toBe("REDIRECT:/first-week");
    });
  });
});
