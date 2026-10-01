import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflinePeriod } from "@/domain/offline";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { openFoodEntryGate, openReportGate } from "./gate";

const mocks = vi.hoisted(() => ({
  openAppGate: vi.fn(),
  loadOfflinePeriods: vi.fn(),
}));

// The real redirect() throws to stop the render; the stand-in does the same and names the target.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/app/(app)/_lib/gate", () => ({ openAppGate: mocks.openAppGate }));
vi.mock("@/lib/home/load", () => ({ loadOfflinePeriods: mocks.loadOfflinePeriods }));

const ready = (timezone = "Asia/Jerusalem") =>
  ({ kind: "ready", userId: "user-1", row: { timezone, lifecycle_state: "FIRST_WEEK" }, supabase: { tag: "client" } }) as unknown as OnboardingContext;

const open = (context: OnboardingContext) => mocks.openAppGate.mockResolvedValue({ kind: "open", context });

const period = (fromHours: number, toHours: number): OfflinePeriod => ({
  type: "SHABBAT",
  start: new Date(Date.now() + fromHours * 3_600_000),
  end: new Date(Date.now() + toHours * 3_600_000),
});

beforeEach(() => {
  mocks.openAppGate.mockReset();
  mocks.loadOfflinePeriods.mockReset().mockResolvedValue([]);
});

describe("openReportGate", () => {
  it("reports a Supabase that is not set up", async () => {
    mocks.openAppGate.mockResolvedValue({ kind: "not_configured" });
    await expect(openReportGate()).resolves.toEqual({ kind: "not_configured" });
  });

  it("lets the app gate send a user with unfinished onboarding away", async () => {
    mocks.openAppGate.mockRejectedValue(new Error("REDIRECT:/onboarding"));
    await expect(openReportGate()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("sends a visitor whose session has ended to sign in", async () => {
    open({ kind: "signed_out" });
    await expect(openReportGate()).rejects.toThrow("REDIRECT:/login");
  });

  it.each<OnboardingContext>([{ kind: "unavailable" }, { kind: "profile_missing" }])("is unavailable, without a redirect, for $kind", async (context) => {
    open(context);
    await expect(openReportGate()).resolves.toEqual({ kind: "unavailable" });
  });

  it("opens for a ready user with one clock read and a valid zone", async () => {
    const context = ready();
    open(context);
    const before = Date.now();
    const gate = await openReportGate();
    expect(gate).toMatchObject({ kind: "ready", context, timeZone: "Asia/Jerusalem" });
    if (gate.kind !== "ready") throw new Error("not ready");
    expect(gate.now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("falls back to a valid zone when the stored one is not", async () => {
    open(ready("Not/AZone"));
    const gate = await openReportGate();
    expect(gate).toMatchObject({ kind: "ready", timeZone: "Asia/Jerusalem" });
  });

  it("does not look at the offline periods: finishing an earlier report is never blocked", async () => {
    open(ready());
    mocks.loadOfflinePeriods.mockResolvedValue([period(-1, 1)]);
    await expect(openReportGate()).resolves.toMatchObject({ kind: "ready" });
    expect(mocks.loadOfflinePeriods).not.toHaveBeenCalled();
  });
});

describe("openFoodEntryGate", () => {
  it.each([{ kind: "not_configured" }, { kind: "unavailable" }] as const)("passes %j through without reading the periods", async (result) => {
    if (result.kind === "not_configured") mocks.openAppGate.mockResolvedValue({ kind: "not_configured" });
    else open({ kind: "unavailable" });
    await expect(openFoodEntryGate()).resolves.toEqual(result);
    expect(mocks.loadOfflinePeriods).not.toHaveBeenCalled();
  });

  it("opens when there is no offline period", async () => {
    const context = ready();
    open(context);
    await expect(openFoodEntryGate()).resolves.toMatchObject({ kind: "ready", context });
    expect(mocks.loadOfflinePeriods).toHaveBeenCalledWith(context.kind === "ready" ? context.supabase : null, "user-1", expect.any(Date));
  });

  it("is quiet during an offline period", async () => {
    open(ready());
    mocks.loadOfflinePeriods.mockResolvedValue([period(-2, 20)]);
    await expect(openFoodEntryGate()).resolves.toEqual({ kind: "quiet" });
  });

  it("is not quiet before a period has started or after it has ended", async () => {
    open(ready());
    mocks.loadOfflinePeriods.mockResolvedValue([period(2, 26), period(-30, -6)]);
    await expect(openFoodEntryGate()).resolves.toMatchObject({ kind: "ready" });
  });

  it("is not quiet when the periods are unknown: the read fails open, the endpoint checks again", async () => {
    open(ready());
    mocks.loadOfflinePeriods.mockResolvedValue(null);
    await expect(openFoodEntryGate()).resolves.toMatchObject({ kind: "ready" });
  });
});
