import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflinePeriod } from "@/domain/offline";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { openWeightActionContext, openWeightEntryGate, openWeightReadGate } from "./gate";

const APP_NOW = new Date("2026-09-17T06:00:00Z");
const REAL_NOW = new Date("2026-10-01T09:30:00Z");

const mocks = vi.hoisted(() => ({
  reportGate: vi.fn(),
  loadOfflinePeriods: vi.fn(),
  currentInstant: vi.fn(),
  configured: { current: true },
  context: { current: null as unknown },
  flow: { reportingEnabled: true, progressEnabled: true, milestoneMomentEnabled: true },
}));

// The real redirect() throws to stop the render; the stand-in does the same and names the target.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/app/(flow)/report/food/_lib/gate", () => ({ openReportGate: mocks.reportGate }));
vi.mock("@/lib/home/load", () => ({ loadOfflinePeriods: mocks.loadOfflinePeriods }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => mocks.configured.current }));
vi.mock("@/lib/onboarding/context", () => ({ loadOnboardingContext: async () => mocks.context.current }));
vi.mock("@/domain/weight", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domain/weight")>();
  return { ...original, WEIGHT_FLOW: mocks.flow };
});

const supabase = { tag: "client" };
const readyContext = (lifecycle_state = "FIRST_WEEK") => ({ kind: "ready", userId: "user-1", row: { lifecycle_state, timezone: "Asia/Jerusalem" }, supabase });
const readyGate = () => ({ kind: "ready", context: readyContext(), now: REAL_NOW, timeZone: "Asia/Jerusalem" });

const period = (fromHours: number, toHours: number): OfflinePeriod => ({
  type: "SHABBAT",
  start: new Date(APP_NOW.getTime() + fromHours * 3_600_000),
  end: new Date(APP_NOW.getTime() + toHours * 3_600_000),
});

beforeEach(() => {
  mocks.flow.reportingEnabled = true;
  mocks.reportGate.mockReset().mockResolvedValue(readyGate());
  mocks.loadOfflinePeriods.mockReset().mockResolvedValue([]);
  mocks.currentInstant.mockReset().mockReturnValue(APP_NOW);
  mocks.configured.current = true;
  mocks.context.current = readyContext();
});

describe("openWeightReadGate", () => {
  it.each([{ kind: "not_configured" }, { kind: "unavailable" }])("passes %j through", async (gate) => {
    mocks.reportGate.mockResolvedValue(gate);
    await expect(openWeightReadGate()).resolves.toEqual(gate);
  });

  it("replaces the food gate's real-time `now` with the app's clock, and keeps the rest", async () => {
    const gate = await openWeightReadGate();
    expect(gate).toMatchObject({ kind: "ready", timeZone: "Asia/Jerusalem" });
    if (gate.kind !== "ready") throw new Error("not ready");
    expect(gate.now).toEqual(APP_NOW);
    expect(gate.context).toEqual(readyContext());
  });

  it("is never quiet and never reads the offline periods: reading and deleting are not reporting", async () => {
    mocks.loadOfflinePeriods.mockResolvedValue([period(-1, 20)]);
    await expect(openWeightReadGate()).resolves.toMatchObject({ kind: "ready" });
    expect(mocks.loadOfflinePeriods).not.toHaveBeenCalled();
  });

  it("works while weight reporting is switched off", async () => {
    mocks.flow.reportingEnabled = false;
    await expect(openWeightReadGate()).resolves.toMatchObject({ kind: "ready" });
  });
});

describe("openWeightEntryGate", () => {
  it("sends the person Home when weight reporting is switched off, before anything else is read", async () => {
    mocks.flow.reportingEnabled = false;
    await expect(openWeightEntryGate()).rejects.toThrow("REDIRECT:/");
    expect(mocks.reportGate).not.toHaveBeenCalled();
    expect(mocks.loadOfflinePeriods).not.toHaveBeenCalled();
  });

  it.each([{ kind: "not_configured" }, { kind: "unavailable" }])("passes %j through without reading the periods", async (gate) => {
    mocks.reportGate.mockResolvedValue(gate);
    await expect(openWeightEntryGate()).resolves.toEqual(gate);
    expect(mocks.loadOfflinePeriods).not.toHaveBeenCalled();
  });

  it("opens when there is no offline period, asking at the app's clock", async () => {
    const gate = await openWeightEntryGate();
    expect(gate).toMatchObject({ kind: "ready", now: APP_NOW });
    expect(mocks.loadOfflinePeriods).toHaveBeenCalledWith(supabase, "user-1", APP_NOW);
  });

  it("is quiet during an offline period, judged at the app's clock and not at the real one", async () => {
    // Covers APP_NOW only: the food gate's own `now` (a fortnight later) is outside it.
    mocks.loadOfflinePeriods.mockResolvedValue([period(-2, 20)]);
    await expect(openWeightEntryGate()).resolves.toEqual({ kind: "quiet" });
  });

  it("is not quiet before a period has started or after it has ended", async () => {
    mocks.loadOfflinePeriods.mockResolvedValue([period(2, 26), period(-30, -6)]);
    await expect(openWeightEntryGate()).resolves.toMatchObject({ kind: "ready" });
  });

  it("is not quiet when the periods are unknown: the read fails open, the action checks again", async () => {
    mocks.loadOfflinePeriods.mockResolvedValue(null);
    await expect(openWeightEntryGate()).resolves.toMatchObject({ kind: "ready" });
  });
});

describe("openWeightActionContext", () => {
  it("sends the person Home when Supabase is not set up", async () => {
    mocks.configured.current = false;
    await expect(openWeightActionContext()).rejects.toThrow("REDIRECT:/");
  });

  it("sends the person Home when the context says it is not configured", async () => {
    mocks.context.current = { kind: "not_configured" };
    await expect(openWeightActionContext()).rejects.toThrow("REDIRECT:/");
  });

  it("sends a visitor whose session has ended to sign in", async () => {
    mocks.context.current = { kind: "signed_out" };
    await expect(openWeightActionContext()).rejects.toThrow("REDIRECT:/login");
  });

  it.each<OnboardingContext>([{ kind: "unavailable" }, { kind: "profile_missing" }])("is unavailable, without a redirect, for $kind", async (context) => {
    mocks.context.current = context;
    await expect(openWeightActionContext()).resolves.toEqual({ kind: "unavailable" });
  });

  it("sends a person with an unfinished onboarding to it", async () => {
    mocks.context.current = readyContext("ONBOARDING");
    await expect(openWeightActionContext()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("returns the verified session's context", async () => {
    const result = await openWeightActionContext();
    expect(result).toEqual({ kind: "ready", context: readyContext() });
  });
});
