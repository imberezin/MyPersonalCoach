import type { Rationale } from "@/domain/weekly";

const leaves = (prefix: string, names: readonly string[]) => names.map((name) => `${prefix}.${name}`);

/**
 * The copy "your week" and its Home card read, as dotted keys from the catalog root. This is the contract with whoever
 * renders it: weekly.messages.test.ts demands every key in he.json and en.json, and that the `weekly` namespace holds
 * nothing else. The two Home card keys are ALSO demanded by app.messages.test.ts through HOME_COPY_KEYS; the snooze label and
 * the quiet link are only here.
 */
export const WEEKLY_MESSAGE_KEYS: readonly string[] = [
  "weekly.meta.title",
  "weekly.title",
  "weekly.range",
  ...leaves("weekly.line", ["celebrateMilestone", "celebrateGoal", "celebrateExperiment", "recover", "learn", "quiet"]),
  ...leaves("weekly.happened", ["title", "meals", "weighed", "returned", "experimentStarted", "experimentTried"]),
  ...leaves("weekly.learned", [
    "title",
    "lateEveningHedged",
    "lateEveningRepeats",
    "patternQuestion",
    "confirm",
    "unsure",
    "reject",
    "helped",
    "somewhat",
    "notReally",
    "unknown",
    "notTried",
    "notYet",
  ]),
  ...leaves("weekly.changed", ["title", "first", "building", "down", "steady", "up"]),
  ...leaves("weekly.next", [
    "title",
    "none",
    "light",
    "afterResult",
    "choose",
    "pendingLead",
    "frame",
    "try",
    "notThisTime",
    "note",
    "activeLead",
    "activeBody",
    "weighInvite",
  ]),
  ...leaves("weekly.next.offer", ["pattern", "goalEating", "goalFeeling", "keepGoing", "nextStep", "default"]),
  ...leaves("weekly.result", ["title", "reminder", "lead", "helpful", "somewhat", "notReally", "unknown", "notTried"]),
  "weekly.back",
  "weekly.problem.save",
  ...leaves("weekly.unavailable", ["title", "body", "home"]),
  ...leaves("home.weeklyReady", ["title", "body", "cta"]),
  "home.weeklySnooze",
  "home.weeklyLink",
  // Reused, not owned: the pending label of every button.
  "common.loading",
];

/** The one hidden field of each tiny answer form. The actions read these fields and no other. */
export const WEEKLY_FORM_FIELDS = { result: "result", answer: "answer" } as const;

/**
 * The sentence of the offer, a FIXED catalog key chosen by the rationale. Never an interpolation of the person's own goal: no
 * sentence repeats the goal back, mentions weight, or quotes an onboarding label. The two goals that can be named without saying
 * what the person wants to change (eating, feeling good) have a sentence each; every other goal reads like no goal at all.
 */
export function offerMessageKey(rationale: Rationale): string {
  switch (rationale.kind) {
    case "KEEP_GOING":
      return "weekly.next.offer.keepGoing";
    case "NEXT_STEP":
      return "weekly.next.offer.nextStep";
    case "PATTERN":
      return "weekly.next.offer.pattern";
    case "GOAL":
      if (rationale.goal === "improve_eating") return "weekly.next.offer.goalEating";
      if (rationale.goal === "feel_lighter") return "weekly.next.offer.goalFeeling";
      return "weekly.next.offer.default";
    case "DEFAULT":
      return "weekly.next.offer.default";
    default: {
      const unhandled: never = rationale;
      return unhandled;
    }
  }
}
