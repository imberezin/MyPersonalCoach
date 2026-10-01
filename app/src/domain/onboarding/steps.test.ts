import { describe, expect, it } from "vitest";
import type { LifecycleState } from "../firstWeek";
import { NOTIFICATION_KEY_FOR, NOTIFY_CHOICES, STEP_IDS, STEP_META, type OnboardingRow, type StepId } from "./model";
import {
  HOME_PATH,
  ONBOARDING_PATH,
  decideRoute,
  isOnboardingComplete,
  isStepId,
  isStepVisible,
  maxPointer,
  notificationsPhase,
  resolveStep,
  resumeStep,
  stepAfter,
  stepBefore,
  stepPath,
} from "./steps";

type Resumable = Pick<OnboardingRow, "lifecycle_state" | "onboarding_step" | "start_weight_kg">;

const row = (over: Partial<Resumable> = {}): Resumable => ({
  lifecycle_state: "ONBOARDING",
  onboarding_step: null,
  start_weight_kg: null,
  ...over,
});

describe("step order and metadata", () => {
  it("follows the product map", () => {
    expect([...STEP_IDS]).toEqual([
      "welcome",
      "goals",
      "weight",
      "goal-weight",
      "about-you",
      "movement",
      "food",
      "kashrut",
      "offline",
      "why",
      "notifications",
      "ready",
    ]);
  });

  it("numbers the screens A1 to A12 in order", () => {
    expect(STEP_IDS.map((id) => STEP_META[id].code)).toEqual(Array.from({ length: 12 }, (_, i) => `A${i + 1}`));
  });

  it("allows skipping only the optional steps", () => {
    const skippable = STEP_IDS.filter((id) => STEP_META[id].skippable);
    expect(new Set(skippable)).toEqual(
      new Set(["weight", "about-you", "movement", "food", "kashrut", "why", "notifications"]),
    );
  });

  it("builds paths and recognises ids", () => {
    expect(stepPath("goal-weight")).toBe("/onboarding/goal-weight");
    expect(isStepId("ready")).toBe(true);
    expect(isStepId("nope")).toBe(false);
    expect(isStepId(undefined)).toBe(false);
  });
});

describe("visibility", () => {
  it("hides only the goal weight, and only without a starting weight", () => {
    expect(isStepVisible("goal-weight", { start_weight_kg: null })).toBe(false);
    expect(isStepVisible("goal-weight", { start_weight_kg: 80 })).toBe(true);
    for (const id of STEP_IDS.filter((s) => s !== "goal-weight")) {
      expect(isStepVisible(id, { start_weight_kg: null })).toBe(true);
    }
  });

  it("steps over the hidden step in both directions", () => {
    expect(stepAfter("weight", { start_weight_kg: null })).toBe("about-you");
    expect(stepAfter("weight", { start_weight_kg: 80 })).toBe("goal-weight");
    expect(stepBefore("about-you", { start_weight_kg: 80 })).toBe("goal-weight");
    expect(stepBefore("about-you", { start_weight_kg: null })).toBe("weight");
  });

  it("clamps at the ends", () => {
    expect(stepAfter("ready", { start_weight_kg: null })).toBe("ready");
    expect(stepBefore("welcome", { start_weight_kg: null })).toBeNull();
  });
});

describe("maxPointer", () => {
  it("only moves forward", () => {
    expect(maxPointer(null, "goals")).toBe("goals");
    expect(maxPointer("kashrut", "weight")).toBe("kashrut");
    expect(maxPointer("weight", "kashrut")).toBe("kashrut");
    expect(maxPointer("goals", "goals")).toBe("goals");
  });
});

describe("resumeStep", () => {
  it("starts at the welcome screen for a new user or an empty pointer", () => {
    expect(resumeStep(row({ lifecycle_state: "NEW" }))).toBe("welcome");
    expect(resumeStep(row({ lifecycle_state: "NEW", onboarding_step: "weight" }))).toBe("welcome");
    expect(resumeStep(row({ onboarding_step: null }))).toBe("welcome");
  });

  it("continues after the last step done", () => {
    expect(resumeStep(row({ onboarding_step: "welcome" }))).toBe("goals");
    expect(resumeStep(row({ onboarding_step: "weight", start_weight_kg: 80 }))).toBe("goal-weight");
    expect(resumeStep(row({ onboarding_step: "weight", start_weight_kg: null }))).toBe("about-you");
    expect(resumeStep(row({ onboarding_step: "notifications" }))).toBe("ready");
    expect(resumeStep(row({ onboarding_step: "ready" }))).toBe("ready");
  });
});

describe("resolveStep", () => {
  it("sends an unknown slug to the resume step", () => {
    expect(resolveStep("nope", row({ onboarding_step: "goals" }))).toEqual({ kind: "redirect", id: "weight" });
    expect(resolveStep(undefined, row())).toEqual({ kind: "redirect", id: "welcome" });
    expect(resolveStep(null, row())).toEqual({ kind: "redirect", id: "welcome" });
  });

  it("keeps a new user on the welcome screen", () => {
    const fresh = row({ lifecycle_state: "NEW" });
    expect(resolveStep("food", fresh)).toEqual({ kind: "redirect", id: "welcome" });
    expect(resolveStep("welcome", fresh)).toEqual({ kind: "ok", id: "welcome" });
  });

  it("does not let a typed URL skip ahead", () => {
    expect(resolveStep("kashrut", row({ onboarding_step: "weight", start_weight_kg: null }))).toEqual({
      kind: "redirect",
      id: "about-you",
    });
    expect(resolveStep("kashrut", row({ onboarding_step: "weight", start_weight_kg: 80 }))).toEqual({
      kind: "redirect",
      id: "goal-weight",
    });
  });

  it("always allows an earlier step and the resume step", () => {
    const r = row({ onboarding_step: "kashrut", start_weight_kg: 80 });
    expect(resolveStep("goals", r)).toEqual({ kind: "ok", id: "goals" });
    expect(resolveStep("kashrut", r)).toEqual({ kind: "ok", id: "kashrut" });
    expect(resolveStep("offline", r)).toEqual({ kind: "ok", id: "offline" });
  });

  it("redirects the hidden goal weight to the step after it", () => {
    expect(resolveStep("goal-weight", row({ onboarding_step: "weight", start_weight_kg: null }))).toEqual({
      kind: "redirect",
      id: "about-you",
    });
    expect(resolveStep("goal-weight", row({ onboarding_step: "ready", start_weight_kg: null }))).toEqual({
      kind: "redirect",
      id: "about-you",
    });
  });
});

describe("decideRoute", () => {
  const table: Array<[LifecycleState, "render" | "redirect", "render" | "redirect"]> = [
    ["NEW", "redirect", "render"],
    ["ONBOARDING", "redirect", "render"],
    ["FIRST_WEEK", "render", "redirect"],
    ["WEEKLY_CYCLE", "render", "redirect"],
  ];

  it.each(table)("%s: home %s, onboarding %s", (state, home, onboarding) => {
    expect(decideRoute("home", state).kind).toBe(home);
    expect(decideRoute("onboarding", state).kind).toBe(onboarding);
  });

  it("never redirects from both pages, so the two cannot loop", () => {
    for (const [state] of table) {
      const both = decideRoute("home", state).kind === "redirect" && decideRoute("onboarding", state).kind === "redirect";
      expect(both).toBe(false);
    }
  });

  it("sends each page's visitors to the other one", () => {
    expect(decideRoute("home", "NEW")).toEqual({ kind: "redirect", to: ONBOARDING_PATH });
    expect(decideRoute("onboarding", "WEEKLY_CYCLE")).toEqual({ kind: "redirect", to: HOME_PATH });
  });

  it("calls FIRST_WEEK and WEEKLY_CYCLE complete", () => {
    expect(isOnboardingComplete("FIRST_WEEK")).toBe(true);
    expect(isOnboardingComplete("WEEKLY_CYCLE")).toBe(true);
    expect(isOnboardingComplete("NEW")).toBe(false);
    expect(isOnboardingComplete("ONBOARDING")).toBe(false);
  });
});

describe("notificationsPhase", () => {
  const prefs = (flags: Partial<Record<keyof OnboardingRow["notifications"], boolean>>, pointer: StepId | null) => ({
    onboarding_step: pointer,
    notifications: { coach: false, meal_reporting: false, activity: false, weekly_weigh_in: false, weekly_summary: false, ...flags },
  });

  it("honours an explicit choices request", () => {
    expect(notificationsPhase("choices", prefs({ coach: true }, "movement"))).toBe("choices");
  });

  it("shows the device panel on request only when something was chosen", () => {
    expect(notificationsPhase("device", prefs({ coach: true }, "movement"))).toBe("device");
    expect(notificationsPhase("device", prefs({}, "movement"))).toBe("choices");
    expect(notificationsPhase("device", prefs({ activity: true }, "movement"))).toBe("choices");
  });

  it("without a request, returns to the device panel while the step is not done", () => {
    expect(notificationsPhase(undefined, prefs({ meal_reporting: true }, "why"))).toBe("device");
    expect(notificationsPhase(undefined, prefs({ meal_reporting: true }, null))).toBe("device");
    expect(notificationsPhase(undefined, prefs({}, "why"))).toBe("choices");
  });

  it("without a request, shows the choices again once the step is done", () => {
    expect(notificationsPhase(undefined, prefs({ coach: true }, "notifications"))).toBe("choices");
    expect(notificationsPhase(undefined, prefs({ coach: true }, "ready"))).toBe("choices");
  });

  it("treats an unknown request like no request", () => {
    expect(notificationsPhase("other", prefs({ coach: true }, "why"))).toBe("device");
  });

  it("looks at every one of the four choices", () => {
    for (const choice of NOTIFY_CHOICES) {
      const flags = { [NOTIFICATION_KEY_FOR[choice]]: true };
      expect(notificationsPhase(undefined, prefs(flags, "why"))).toBe("device");
    }
  });
});
