// What the First Week summary page (B6) decides, with the gate and the loader mocked. The page returns an element
// tree; the async server components inside it are not rendered here (static markup cannot), so these tests read the
// element's type and props: which screen, and with what.
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { FirstWeekSummaryView } from "@/components/firstWeek/FirstWeekSummaryView";
import { FirstWeekUnavailable } from "@/components/firstWeek/FirstWeekUnavailable";
import type { FirstWeekSummary } from "@/domain/firstWeekFlow";
import he from "@/i18n/messages/he.json";
import FirstWeekPage, { generateMetadata, maxDuration } from "./page";

const mocks = vi.hoisted(() => ({
  appGate: vi.fn(),
  loadSummary: vi.fn(),
  currentInstant: vi.fn(),
  flow: { summaryEnabled: true, welcomeBackEnabled: true, acknowledgementEnabled: true },
  locale: { current: "he" as "he" | "en" },
  finish: vi.fn(async () => {}),
  snooze: vi.fn(async () => {}),
  propose: vi.fn(async () => {}),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/app/(app)/_lib/gate", () => ({ openAppGate: mocks.appGate }));
vi.mock("@/lib/firstWeek/load", () => ({ loadFirstWeekSummary: mocks.loadSummary }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
vi.mock("./actions", () => ({ finishFirstWeekAction: mocks.finish, snoozeFirstWeekCardAction: mocks.snooze }));
vi.mock("./experiment/actions", () => ({ proposeFirstExperimentAction: mocks.propose }));
vi.mock("@/domain/firstWeekFlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/firstWeekFlow")>()),
  FIRST_WEEK_FLOW: mocks.flow,
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

const NOW = new Date("2026-10-07T08:00:00Z");
const SUPABASE = { tag: "client" };
const CONTEXT = { kind: "ready", userId: "user-1", row: { lifecycle_state: "FIRST_WEEK", timezone: "Asia/Jerusalem" }, supabase: SUPABASE };

const SUMMARY: FirstWeekSummary = {
  tone: "ENOUGH",
  why: { kind: "NONE" },
  did: [{ kind: "MEALS" }],
  noticed: { kind: "NOT_ENOUGH_YET" },
  moment: { kind: "FIRST_REPORT" },
  next: { kind: "NO_EXPERIMENT" },
};

const ready = (over: Record<string, unknown> = {}) => ({
  kind: "ready",
  reason: "enough_data",
  hadEnoughData: true,
  progress: { availableDays: 5, confirmedMeals: 10, availableDaysSinceLastMeal: 0 },
  summary: SUMMARY,
  experiment: { selection: { kind: "NONE", reason: "no_pattern" }, open: null },
  signal: null,
  ...over,
});

const openExperiment = (over: Record<string, unknown> = {}) => ({
  id: "exp-1",
  status: "ACTIVE",
  key: "eat_intentionally",
  variantId: "default",
  wording: "the stored sentence",
  source: "ai",
  locale: "he",
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
  mocks.loadSummary.mockReset().mockResolvedValue(ready());
  mocks.currentInstant.mockReset().mockReturnValue(NOW);
  Object.assign(mocks.flow, { summaryEnabled: true });
  mocks.locale.current = "he";
});

describe("/first-week (B6)", () => {
  it("is titled from the catalog", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: he.firstWeek.meta.title });
  });

  it("exports a maxDuration of at least 30 seconds: it is the route that posts the action that may call the AI", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(30);
    const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
    expect(source).toMatch(/export const maxDuration = \d+;/);
  });

  describe("the gate", () => {
    it("shows the setup notice when Supabase is not configured", async () => {
      mocks.appGate.mockResolvedValue({ kind: "not_configured" });
      expect(((await FirstWeekPage(props())) as ReactElement).type).toBe(SetupNotice);
      expect(mocks.loadSummary).not.toHaveBeenCalled();
    });

    it("sends Home when the summary is switched off, reading nothing", async () => {
      mocks.flow.summaryEnabled = false;
      await expect(outcome(() => FirstWeekPage(props()))).resolves.toBe("REDIRECT:/");
      expect(mocks.loadSummary).not.toHaveBeenCalled();
    });

    it("sends a visitor whose session ended to sign in", async () => {
      mocks.appGate.mockResolvedValue({ kind: "open", context: { kind: "signed_out" } });
      await expect(outcome(() => FirstWeekPage(props()))).resolves.toBe("REDIRECT:/login");
    });

    it.each([{ kind: "unavailable" }, { kind: "profile_missing" }])("shows the calm unavailable card when the context is $kind", async (context) => {
      mocks.appGate.mockResolvedValue({ kind: "open", context });
      expect(((await FirstWeekPage(props())) as ReactElement).type).toBe(FirstWeekUnavailable);
      expect(mocks.loadSummary).not.toHaveBeenCalled();
    });
  });

  describe("the redirect matrix", () => {
    it.each([["not_first_week"], ["not_ready"]])("sends Home for %s, showing nothing", async (kind) => {
      mocks.loadSummary.mockResolvedValue({ kind });
      await expect(outcome(() => FirstWeekPage(props()))).resolves.toBe("REDIRECT:/");
    });

    it("shows the calm unavailable card when the database cannot be read", async () => {
      mocks.loadSummary.mockResolvedValue({ kind: "unavailable" });
      expect(((await FirstWeekPage(props())) as ReactElement).type).toBe(FirstWeekUnavailable);
    });

    it("reads the summary for the open context at the app's clock instant, once", async () => {
      await FirstWeekPage(props());
      expect(mocks.currentInstant).toHaveBeenCalledTimes(1);
      expect(mocks.loadSummary).toHaveBeenCalledTimes(1);
      expect(mocks.loadSummary).toHaveBeenCalledWith(CONTEXT, NOW);
    });
  });

  describe("a summary that is ready", () => {
    type ViewProps = Parameters<typeof FirstWeekSummaryView>[0];
    const view = async (query: Record<string, string | string[] | undefined> = {}) => (await FirstWeekPage(props(query))) as ReactElement<ViewProps>;

    it("shows the summary view with the loaded summary and the three Server Actions", async () => {
      const element = await view();
      expect(element.type).toBe(FirstWeekSummaryView);
      expect(element.props.summary).toBe(SUMMARY);
      expect(element.props.finishAction).toBe(mocks.finish);
      expect(element.props.snoozeAction).toBe(mocks.snooze);
      expect(element.props.proposeAction).toBe(mocks.propose);
      expect(element.props.failed).toBe(false);
      expect(element.props.experiment).toEqual({ open: null, text: null });
    });

    it("passes failed for ?failed=1 and for nothing else", async () => {
      expect((await view({ failed: "1" })).props.failed).toBe(true);
      expect((await view({ failed: "0" })).props.failed).toBe(false);
      expect((await view({ failed: ["1", "1"] })).props.failed).toBe(false);
      expect((await view({ other: "1" })).props.failed).toBe(false);
    });

    it("gives the started experiment's stored sentence when it was written in the page's language", async () => {
      mocks.loadSummary.mockResolvedValue(ready({ experiment: { selection: { kind: "ACTIVE", experimentId: "exp-1" }, open: openExperiment() } }));
      const { experiment } = (await view()).props;
      expect(experiment.text).toBe("the stored sentence");
      expect(experiment.open?.id).toBe("exp-1");
    });

    it("gives the library's sentence of the page's language when the person switched language since", async () => {
      mocks.loadSummary.mockResolvedValue(ready({ experiment: { selection: { kind: "ACTIVE", experimentId: "exp-1" }, open: openExperiment({ locale: "en" }) } }));
      expect((await view()).props.experiment.text).toBe(he.interventions.eat_intentionally.default);
    });

    it("gives no sentence for an offer that is not started yet (the summary does not show it)", async () => {
      mocks.loadSummary.mockResolvedValue(
        ready({ experiment: { selection: { kind: "PENDING", experimentId: "exp-1" }, open: openExperiment({ status: "OFFERED" }) } }),
      );
      const { experiment } = (await view()).props;
      expect(experiment.text).toBeNull();
      expect(experiment.open?.status).toBe("OFFERED");
    });
  });

  it("never reaches the AI: the page and its loader import nothing from the wording or gateway code", () => {
    const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
    expect(source).not.toMatch(/lib\/ai\/|produceExperimentWording|wordExperiment|generateInsight/);
  });
});
