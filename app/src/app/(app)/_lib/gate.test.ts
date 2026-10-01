import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LifecycleState } from "@/domain/firstWeek";
import { loadOnboardingContext, type OnboardingContext } from "@/lib/onboarding/context";
import { openAppGate } from "./gate";

// The real redirect() throws to stop the render; the stand-in does the same and names the target.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/onboarding/context", () => ({ loadOnboardingContext: vi.fn() }));

const mockedLoad = vi.mocked(loadOnboardingContext);

const ready = (lifecycle_state: LifecycleState) =>
  ({ kind: "ready", userId: "user-1", row: { lifecycle_state }, supabase: {} }) as unknown as OnboardingContext;

beforeEach(() => mockedLoad.mockReset());

describe("openAppGate", () => {
  it.each<LifecycleState>(["NEW", "ONBOARDING"])("sends a ready user in %s to onboarding", async (state) => {
    mockedLoad.mockResolvedValue(ready(state));
    await expect(openAppGate()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it.each<LifecycleState>(["FIRST_WEEK", "WEEKLY_CYCLE"])("opens the page for a ready user in %s", async (state) => {
    const context = ready(state);
    mockedLoad.mockResolvedValue(context);
    await expect(openAppGate()).resolves.toEqual({ kind: "open", context });
  });

  // The proxy owns sign-in and a hiccup must not trap anyone in a redirect, so none of these redirects.
  it.each<OnboardingContext>([{ kind: "signed_out" }, { kind: "unavailable" }, { kind: "profile_missing" }])(
    "opens the page, without a redirect, for $kind",
    async (context) => {
      mockedLoad.mockResolvedValue(context);
      await expect(openAppGate()).resolves.toEqual({ kind: "open", context });
    },
  );

  it("reports a Supabase that is not set up", async () => {
    mockedLoad.mockResolvedValue({ kind: "not_configured" });
    await expect(openAppGate()).resolves.toEqual({ kind: "not_configured" });
  });
});
