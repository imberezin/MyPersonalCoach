import { describe, expect, it, vi } from "vitest";
import { FIRST_WEEK_SNOOZE } from "@/domain/firstWeekFlow";
import { ANALYTICS_EVENTS } from "./events";
import { NoopSink, track, type AnalyticsEvent, type AnalyticsSink } from "./track";

describe("track", () => {
  it("passes a content-free event to the sink", async () => {
    const seen: AnalyticsEvent[] = [];
    const sink: AnalyticsSink = { record: async (e) => void seen.push(e) };
    await track(sink, "meal_saved", { source: "ai_unedited", items: 3 }, new Date("2026-10-01T10:00:00Z"));
    expect(seen).toEqual([
      {
        name: "meal_saved",
        payload: { source: "ai_unedited", items: 3 },
        occurredAt: new Date("2026-10-01T10:00:00Z"),
      },
    ]);
  });

  it("never breaks a user flow when the sink fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: AnalyticsSink = { record: async () => Promise.reject(new Error("db down")) };
    await expect(track(failing, "meal_saved")).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("rejects a payload that looks like user content", async () => {
    const longText = "x".repeat(200);
    await expect(track(new NoopSink(), "meal_saved", { note: longText })).rejects.toThrow(/content/);
  });

  it("knows the 27 agreed events", () => {
    expect(ANALYTICS_EVENTS).toHaveLength(27);
    expect(ANALYTICS_EVENTS).toContain("meal_deleted");
  });

  it("has the six First Week and first-experiment events, and the experiment_started that was already there", () => {
    for (const name of [
      "first_week_completed",
      "first_week_card_snoozed",
      "early_signal_answered",
      "experiment_offered",
      "experiment_skipped",
      "experiment_wording_fallback",
      "experiment_started",
    ]) {
      expect(ANALYTICS_EVENTS, name).toContain(name);
    }
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });

  it("has the three weight events (weight_reported was already there)", () => {
    for (const name of ["weight_reported", "weight_edited", "weight_deleted", "milestone_acknowledged"]) {
      expect(ANALYTICS_EVENTS, name).toContain(name);
    }
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });

  it("lists the event the snooze reader looks for, so the domain constant and the event list cannot drift", () => {
    expect(ANALYTICS_EVENTS).toContain(FIRST_WEEK_SNOOZE.event);
  });
});
