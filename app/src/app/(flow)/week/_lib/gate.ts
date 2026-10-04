import "server-only";
import { redirect } from "next/navigation";
import { decideRoute } from "@/domain/onboarding";
import { WEEKLY_FLOW } from "@/domain/weekly";
import { loadOnboardingContext, type OnboardingContext } from "@/lib/onboarding/context";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;

/**
 * What every "your week" action needs first, and never trusts a page for: Supabase set up, a verified session, a finished
 * onboarding, the weekly cycle and the feature switched on. Not set up, signed out, unfinished onboarding, any other
 * lifecycle and a switched-off feature end here as redirects; a database that cannot be reached comes back as `unavailable`,
 * and each action answers in its own way. The user id is the verified session's, never a field of a form.
 */
export async function openWeeklyActionContext(): Promise<{ kind: "ready"; context: ReadyContext } | { kind: "unavailable" }> {
  if (!isSupabaseConfigured()) redirect("/");

  const context = await loadOnboardingContext();
  if (context.kind === "not_configured") redirect("/");
  if (context.kind === "signed_out") redirect("/login");
  if (context.kind !== "ready") return { kind: "unavailable" };

  const route = decideRoute("home", context.row.lifecycle_state);
  if (route.kind === "redirect") redirect(route.to);

  // Only the weekly cycle has a week to show (a First Week person has the First Week summary), and the switch is one line.
  if (context.row.lifecycle_state !== "WEEKLY_CYCLE" || !WEEKLY_FLOW.enabled) redirect("/");
  return { kind: "ready", context };
}
