// What the Progress page decides, with the gate and the loader mocked. The page returns an element tree; the async server
// components inside it are not rendered here (static markup cannot), so these tests read the element's type and props:
// which screen, and with what. The screens themselves are tested in components/progress.
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InfoPage } from "@/app/(app)/_components/InfoPage";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { ProgressUnavailable } from "@/components/progress/ProgressUnavailable";
import { ProgressView } from "@/components/progress/ProgressView";
import he from "@/i18n/messages/he.json";
import ProgressPage, { generateMetadata } from "./page";

const mocks = vi.hoisted(() => ({
  appGate: vi.fn(),
  loadProgress: vi.fn(),
  currentInstant: vi.fn(),
  flow: { reportingEnabled: true, progressEnabled: true, milestoneMomentEnabled: true },
}));

vi.mock("../_lib/gate", () => ({ openAppGate: mocks.appGate }));
vi.mock("@/lib/weight/load", () => ({ loadProgress: mocks.loadProgress }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
vi.mock("@/domain/weight", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/weight")>()),
  WEIGHT_FLOW: mocks.flow,
}));
vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("use-intl/core");
  const messages = { he: (await import("@/i18n/messages/he.json")).default };
  return {
    getLocale: async () => "he",
    getTranslations: async (namespace?: string) => {
      const t = createTranslator({ locale: "he", messages: messages.he as never, namespace: namespace as never, timeZone: "UTC" });
      return (key: string, values?: Record<string, unknown>) => t(key as never, values as never);
    },
  };
});

const NOW = new Date("2026-11-04T09:00:00+02:00");
const CONTEXT = { kind: "ready", userId: "user-1", row: { timezone: "Asia/Jerusalem" }, supabase: { tag: "client" } };
const READY = {
  kind: "ready",
  weight: { kind: "unknown" },
  milestones: { kind: "NONE" },
  noticed: { patterns: [], activeExperiment: null },
};

beforeEach(() => {
  mocks.appGate.mockReset().mockResolvedValue({ kind: "open", context: CONTEXT });
  mocks.loadProgress.mockReset().mockResolvedValue(READY);
  mocks.currentInstant.mockReset().mockReturnValue(NOW);
  Object.assign(mocks.flow, { progressEnabled: true });
});

describe("/progress", () => {
  it("is titled from the catalog", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: he.progress.title });
  });

  it("shows the setup notice when Supabase is not configured, reading nothing", async () => {
    mocks.appGate.mockResolvedValue({ kind: "not_configured" });
    expect(((await ProgressPage()) as ReactElement).type).toBe(SetupNotice);
    expect(mocks.loadProgress).not.toHaveBeenCalled();
  });

  it("shows the Progress screen with the loader's answer, read at the app's clock", async () => {
    const page = (await ProgressPage()) as ReactElement<{ load: unknown }>;
    expect(page.type).toBe(ProgressView);
    expect(page.props.load).toBe(READY);
    expect(mocks.loadProgress).toHaveBeenCalledTimes(1);
    // The one clock read of the page, and the profile's context as loaded.
    expect(mocks.loadProgress).toHaveBeenCalledWith(CONTEXT, NOW);
    expect(mocks.currentInstant).toHaveBeenCalledTimes(1);
  });

  it("shows the calm card when the loader cannot say (the database is unreachable)", async () => {
    mocks.loadProgress.mockResolvedValue({ kind: "unavailable" });
    expect(((await ProgressPage()) as ReactElement).type).toBe(ProgressUnavailable);
  });

  it.each([{ kind: "signed_out" }, { kind: "unavailable" }, { kind: "profile_missing" }])(
    "hands a context that is $kind to the loader, which answers unavailable, and shows the calm card",
    async (context) => {
      mocks.appGate.mockResolvedValue({ kind: "open", context });
      mocks.loadProgress.mockResolvedValue({ kind: "unavailable" });
      expect(((await ProgressPage()) as ReactElement).type).toBe(ProgressUnavailable);
      expect(mocks.loadProgress).toHaveBeenCalledWith(context, NOW);
    },
  );

  describe("with the switch off", () => {
    beforeEach(() => {
      mocks.flow.progressEnabled = false;
    });

    it("restores the old honest placeholder, reading nothing", async () => {
      const page = (await ProgressPage()) as ReactElement<{ title: string; lead: string; children: ReactElement<{ children: string }> }>;
      expect(page.type).toBe(InfoPage);
      expect(page.props.title).toBe(he.progress.title);
      expect(page.props.lead).toBe(he.progress.lead);
      expect(page.props.children.props.children).toBe(he.progress.body);
      expect(mocks.loadProgress).not.toHaveBeenCalled();
    });

    it("still shows the setup notice first when Supabase is not configured", async () => {
      mocks.appGate.mockResolvedValue({ kind: "not_configured" });
      expect(((await ProgressPage()) as ReactElement).type).toBe(SetupNotice);
    });
  });
});
