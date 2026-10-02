import { FIRST_WEEK_LIMITS } from "@/domain/firstWeekFlow/types";
import { GOAL_FOCUS_KEYS } from "@/domain/onboarding/model";

const leaves = (prefix: string, names: readonly string[]) => names.map((name) => `${prefix}.${name}`);

/** The rotating lines of the Saved screen: `firstWeek.ack.rotating.0` up to the last one. */
const ROTATING = Array.from({ length: FIRST_WEEK_LIMITS.acknowledgementRotation }, (_unused, index) => String(index));

/**
 * The copy the First Week screens and the new Home cards read, as dotted keys from the catalog root. This is the
 * contract with whoever renders them: firstWeek.messages.test.ts demands every key in he.json and en.json, and that
 * the `firstWeek` namespace holds nothing else. The Home keys of the four new states are ALSO demanded by
 * app.messages.test.ts through HOME_COPY_KEYS; the extra Home keys (snooze, the lead and the answers) are only here.
 */
export const FIRST_WEEK_MESSAGE_KEYS: readonly string[] = [
  "firstWeek.meta.title",
  ...leaves("firstWeek.summary.title", ["enough", "neutral"]),
  ...leaves("firstWeek.summary.lead", ["enough", "little"]),
  ...leaves("firstWeek.summary.why", ["title", "goalsLead", "notSure", "goalSet", "motivationLead", "link", "linkNotSure"]),
  ...GOAL_FOCUS_KEYS.filter((key) => key !== "not_sure").map((key) => `firstWeek.summary.why.focus.${key}`),
  ...leaves("firstWeek.summary.did", ["title", "meals", "none", "experiment"]),
  ...leaves("firstWeek.summary.noticed", ["title", "notEnough", "lateEvening"]),
  ...leaves("firstWeek.summary.moment", ["title", "returned", "firstReport"]),
  ...leaves("firstWeek.summary.next", ["title", "none", "offer", "choose", "pending", "see", "active"]),
  ...leaves("firstWeek.summary", ["continue", "continueNote", "notNow"]),
  "firstWeek.problem.save",
  ...leaves("firstWeek.unavailable", ["title", "body", "home"]),
  ...leaves("firstWeek.ack.rotating", ROTATING),
  "firstWeek.experiment.meta.title",
  ...leaves("firstWeek.experiment", ["title", "lead", "try", "notThisTime", "note", "activeTitle", "activeBody", "back"]),
  ...leaves("home.firstWeekSummaryReady", ["title", "body", "cta"]),
  ...leaves("home.firstWeekSummaryReadyLittle", ["title", "body", "cta"]),
  ...leaves("home.firstWeekWelcomeBack", ["title", "body", "lead", "cta"]),
  "home.firstWeekSnooze",
  ...leaves("home.earlySignalLateEvening", ["title", "body", "confirm", "unsure", "reject"]),
  "dev.clockOverride",
  // Reused, not owned: the pending label of the continue button and the B2 line.
  "common.loading",
  "food.saved.first",
];
