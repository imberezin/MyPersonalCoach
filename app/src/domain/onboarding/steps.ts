/**
 * Onboarding navigation: step order, which steps are visible, where to resume, and which
 * pages a lifecycle state may open. The database holds one pointer (the last step completed or
 * skipped); everything else here is derived from it, so a page reload or a second device lands
 * on the same step.
 */
import type { LifecycleState } from "../firstWeek";
import {
  NOTIFICATION_KEY_FOR,
  NOTIFY_CHOICES,
  STEP_IDS,
  type OnboardingRow,
  type StepId,
} from "./model";

export const ONBOARDING_PATH = "/onboarding";
/** Where the user lands when onboarding is over. The First Week start screen will change only this. */
export const HOME_PATH = "/";

export const stepPath = (id: StepId): string => `${ONBOARDING_PATH}/${id}`;

export function isStepId(v: unknown): v is StepId {
  return typeof v === "string" && (STEP_IDS as readonly string[]).includes(v);
}

export function isOnboardingComplete(s: LifecycleState): boolean {
  return s === "FIRST_WEEK" || s === "WEEKLY_CYCLE";
}

/**
 * The one table that decides who may see Home and who may see onboarding. The two redirect
 * sets are disjoint, so the two pages can never send a user back and forth.
 */
export function decideRoute(
  page: "home" | "onboarding",
  s: LifecycleState,
): { kind: "render" } | { kind: "redirect"; to: string } {
  const complete = isOnboardingComplete(s);
  if (page === "home") return complete ? { kind: "render" } : { kind: "redirect", to: ONBOARDING_PATH };
  return complete ? { kind: "redirect", to: HOME_PATH } : { kind: "render" };
}

type Vis = Pick<OnboardingRow, "start_weight_kg">;
type Resumable = Pick<OnboardingRow, "lifecycle_state" | "onboarding_step" | "start_weight_kg">;

const indexOf = (id: StepId): number => STEP_IDS.indexOf(id);

/** Only the goal weight can be hidden: asking for a goal makes no sense without a starting weight. */
export function isStepVisible(id: StepId, v: Vis): boolean {
  return id !== "goal-weight" || v.start_weight_kg !== null;
}

/** The next visible step. Clamps at the last step. */
export function stepAfter(id: StepId, v: Vis): StepId {
  for (let i = indexOf(id) + 1; i < STEP_IDS.length; i++) {
    if (isStepVisible(STEP_IDS[i], v)) return STEP_IDS[i];
  }
  return STEP_IDS[STEP_IDS.length - 1];
}

/** The previous visible step, or null at the first one. */
export function stepBefore(id: StepId, v: Vis): StepId | null {
  for (let i = indexOf(id) - 1; i >= 0; i--) {
    if (isStepVisible(STEP_IDS[i], v)) return STEP_IDS[i];
  }
  return null;
}

/** The pointer only moves forward: editing an earlier answer never forgets a later one. */
export function maxPointer(a: StepId | null, b: StepId): StepId {
  if (a === null) return b;
  return indexOf(a) >= indexOf(b) ? a : b;
}

/** The step to show when the user arrives without asking for a specific one. */
export function resumeStep(row: Resumable): StepId {
  if (row.lifecycle_state === "NEW" || row.onboarding_step === null) return "welcome";
  return stepAfter(row.onboarding_step, row);
}

export type ResolvedStep = { kind: "ok"; id: StepId } | { kind: "redirect"; id: StepId };

/**
 * Turns the step asked for in the URL into the step to show. Earlier steps are always open
 * (Back keeps every answer); a later step is not, so typing a URL cannot skip ahead.
 */
export function resolveStep(requested: string | null | undefined, row: Resumable): ResolvedStep {
  const resume = resumeStep(row);
  if (!isStepId(requested)) return { kind: "redirect", id: resume };
  if (row.lifecycle_state === "NEW" && requested !== "welcome") return { kind: "redirect", id: "welcome" };

  const target = isStepVisible(requested, row) ? requested : stepAfter(requested, row);
  if (indexOf(target) > indexOf(resume)) return { kind: "redirect", id: resume };
  return target === requested ? { kind: "ok", id: requested } : { kind: "redirect", id: target };
}

/**
 * Which half of the notifications step to show. "device" (the permission and install panel)
 * only makes sense when at least one notification type was chosen. Without an explicit request,
 * the user who chose something and has not finished the step lands on the device panel; this is
 * what brings an iPhone user back to the right place after installing the app.
 */
export function notificationsPhase(
  requested: string | null | undefined,
  row: Pick<OnboardingRow, "notifications" | "onboarding_step">,
): "choices" | "device" {
  const anyChosen = NOTIFY_CHOICES.some((c) => row.notifications[NOTIFICATION_KEY_FOR[c]]);
  if (requested === "choices") return "choices";
  if (requested === "device") return anyChosen ? "device" : "choices";
  const stepNotDone = row.onboarding_step === null || indexOf(row.onboarding_step) < indexOf("notifications");
  return anyChosen && stepNotDone ? "device" : "choices";
}
