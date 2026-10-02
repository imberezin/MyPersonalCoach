import "server-only";
import { redirect } from "next/navigation";
import {
  selectFirstExperiment,
  type ExperimentFact,
  type ExperimentSelection,
  type PatternFact,
} from "@/domain/experiments";
import { decideRoute } from "@/domain/onboarding";
import { LATE_EVENING } from "@/domain/patterns";
import { resolveTimeZone } from "@/domain/time";
import { loadOnboardingContext, type OnboardingContext } from "@/lib/onboarding/context";
import { loadLateEveningSignal, type LateEveningSignal } from "@/lib/patterns/load";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;

/**
 * What every First Week action needs first, and never trusts a page for: Supabase set up, a verified session, a
 * finished onboarding. Not set up, signed out and unfinished onboarding end here as redirects; a database that
 * cannot be reached comes back as `unavailable`, and each action answers in its own way. The user id is the verified
 * session's, never a field of a form. The lifecycle is NOT decided here: each action checks FIRST_WEEK itself,
 * because what it does for any other state differs.
 */
export async function openFirstWeekActionContext(): Promise<{ kind: "ready"; context: ReadyContext } | { kind: "unavailable" }> {
  if (!isSupabaseConfigured()) redirect("/");

  const context = await loadOnboardingContext();
  if (context.kind === "not_configured") redirect("/");
  if (context.kind === "signed_out") redirect("/login");
  if (context.kind !== "ready") return { kind: "unavailable" };

  const route = decideRoute("home", context.row.lifecycle_state);
  if (route.kind === "redirect") redirect(route.to);
  return { kind: "ready", context };
}

/**
 * The experiment selection over the LIVE meals, the one call the B5 page and the start action make (the summary
 * loader makes the same one, so B6 and B5 always agree: a PENDING idea on B6 is a card on B5, and an offer that is
 * no longer established on the meals is neither). Pure reads; never throws. An unknown signal gives no pattern, and
 * with no pattern an OFFERED row is not PENDING.
 */
export async function selectLiveExperiment(
  context: ReadyContext,
  experiments: readonly ExperimentFact[],
  now: Date,
): Promise<{ selection: ExperimentSelection; signal: LateEveningSignal | null }> {
  const signal = await loadLateEveningSignal(context.supabase, context.userId, resolveTimeZone(context.row.timezone), now);
  const patterns: PatternFact[] =
    signal === null
      ? []
      : [
          {
            patternId: signal.row?.id ?? null,
            kind: LATE_EVENING.kind,
            view: signal.view,
            feedback: signal.row?.feedback ?? null,
            feedbackAt: signal.row?.feedbackAt ?? null,
          },
        ];
  return { selection: selectFirstExperiment({ patterns, experiments, now }), signal };
}
