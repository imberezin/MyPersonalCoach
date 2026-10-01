import { describe, expect, it, vi } from "vitest";
import type { OnboardingRow, StepPlan } from "@/domain/onboarding";
import { createFakeSupabase } from "./fakeSupabase";
import { runStep } from "./runStep";

const USER = "user-1";
const NOW = new Date("2026-10-01T09:00:00Z");
const row = { lifecycle_state: "ONBOARDING" } as OnboardingRow;
const NOTIFICATIONS = { coach: false, meal_reporting: true, activity: false, weekly_weigh_in: false, weekly_summary: true };

const plan = (overrides: Partial<StepPlan>): StepPlan => ({ profilePatch: {}, redirectTo: "/onboarding/next", ...overrides });

describe("runStep", () => {
  it("writes notifications, then the profile, then the Shabbat periods", async () => {
    const { client, calls } = createFakeSupabase({});
    const result = await runStep({
      supabase: client,
      userId: USER,
      row,
      now: NOW,
      plan: plan({
        notifications: NOTIFICATIONS,
        profilePatch: { onboarding_step: "offline" },
        shabbat: { placeKey: "jerusalem", candleMinutes: 40 },
      }),
    });

    expect(result).toEqual({ ok: true });
    expect(calls.map((c) => (c.kind === "update" ? `update:${c.table}` : `rpc:${c.name}`))).toEqual([
      "update:user_preferences",
      "update:profiles",
      "rpc:replace_future_auto_shabbat",
    ]);
  });

  it("limits the profile write to the user's own row and to the lifecycle state the page saw", async () => {
    const { client, calls } = createFakeSupabase({});
    await runStep({ supabase: client, userId: USER, row, now: NOW, plan: plan({ profilePatch: { onboarding_step: "goals" } }) });

    const write = calls[0];
    expect(write).toMatchObject({ kind: "update", table: "profiles", patch: { onboarding_step: "goals" } });
    expect(write.kind === "update" && write.filters).toEqual([
      ["user_id", USER],
      ["lifecycle_state", "ONBOARDING"],
    ]);
  });

  it("does not touch the profile when the plan has nothing to write", async () => {
    const { client, calls } = createFakeSupabase({});
    expect(await runStep({ supabase: client, userId: USER, row, now: NOW, plan: plan({}) })).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  it("stops at a failed notifications write, before the profile and the Shabbat periods", async () => {
    const { client, calls } = createFakeSupabase({ respond: () => ({ data: [], error: null }) });
    const result = await runStep({
      supabase: client,
      userId: USER,
      row,
      now: NOW,
      plan: plan({ notifications: NOTIFICATIONS, profilePatch: { onboarding_step: "notifications" }, shabbat: "clear" }),
    });

    expect(result).toEqual({ ok: false, error: { code: "save_error" } });
    expect(calls).toHaveLength(1);
  });

  it("reports a stale step when no profile row matched, and does not touch Shabbat", async () => {
    const { client, calls } = createFakeSupabase({ respond: () => ({ data: [], error: null }) });
    const result = await runStep({
      supabase: client,
      userId: USER,
      row,
      now: NOW,
      plan: plan({ profilePatch: { onboarding_step: "ready" }, shabbat: "clear" }),
    });

    expect(result).toEqual({ ok: false, stale: true });
    expect(calls.some((c) => c.kind === "rpc")).toBe(false);
  });

  it("reports a save error when the profile write fails", async () => {
    const { client, calls } = createFakeSupabase({ respond: () => ({ data: null, error: { code: "23514" } }) });
    const result = await runStep({
      supabase: client,
      userId: USER,
      row,
      now: NOW,
      plan: plan({ profilePatch: { onboarding_step: "weight" }, shabbat: "clear" }),
    });

    expect(result).toEqual({ ok: false, error: { code: "save_error" } });
    expect(calls.some((c) => c.kind === "rpc")).toBe(false);
  });

  it("succeeds even when the Shabbat sync fails: the profile is already saved", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createFakeSupabase({ rpcError: { code: "XX000" } });
    const result = await runStep({
      supabase: client,
      userId: USER,
      row,
      now: NOW,
      plan: plan({ profilePatch: { onboarding_step: "offline" }, shabbat: { placeKey: "jerusalem", candleMinutes: 40 } }),
    });

    expect(result).toEqual({ ok: true });
    error.mockRestore();
  });
});
