import "server-only";
import { redirect } from "next/navigation";
import { openReportGate, type ReportGate } from "@/app/(flow)/report/food/_lib/gate";
import { isOffline } from "@/domain/offline";
import { decideRoute } from "@/domain/onboarding";
import { WEIGHT_FLOW } from "@/domain/weight";
import { currentInstant } from "@/lib/clock/now";
import { loadOfflinePeriods } from "@/lib/home/load";
import { loadOnboardingContext, type OnboardingContext } from "@/lib/onboarding/context";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;
type ReadyGate = Extract<ReportGate, { kind: "ready" }>;

export type WeightEntryGate = { kind: "not_configured" } | { kind: "unavailable" } | { kind: "quiet" } | ReadyGate;

/**
 * The guard of the read-only weight pages (the Saved screen and "My weights"): the food flow's gate, imported and not
 * copied, so the app's own gate, the session and the profile are decided in one place. It is never quiet: reading and
 * deleting your own data is not reporting. The food gate stamps `now` with the real clock; this one replaces it with the
 * app's clock, so the year rule of the day labels follows the development clock too.
 */
export async function openWeightReadGate(): Promise<ReportGate> {
  const gate = await openReportGate();
  if (gate.kind !== "ready") return gate;
  return { ...gate, now: currentInstant() };
}

/**
 * The guard of the screens that report a weight (the entry and the edit page). The switch off sends the person Home. Then
 * the read gate; then the offline periods: during Shabbat or any other offline period the screen is the quiet one, with no
 * override. When the periods cannot be read they are unknown, which is NOT quiet: the read fails open, and the action
 * checks again before anything is written.
 */
export async function openWeightEntryGate(): Promise<WeightEntryGate> {
  if (!WEIGHT_FLOW.reportingEnabled) redirect("/");

  const gate = await openWeightReadGate();
  if (gate.kind !== "ready") return gate;

  const periods = await loadOfflinePeriods(gate.context.supabase, gate.context.userId, gate.now);
  if (periods && isOffline(periods, gate.now)) return { kind: "quiet" };
  return gate;
}

/**
 * What every weight action needs first, and never trusts a page for: Supabase set up, a verified session, a finished
 * onboarding. Not set up, signed out and unfinished onboarding end here as redirects; a database that cannot be reached
 * comes back as `unavailable`, and the action answers in its own calm way. The user id is the verified session's, never a
 * field of the form. (The third copy of these lines, after the food and the meals actions: a gate redirects, and an
 * action must be able to land on a message, so it cannot reuse one. Merging the three is a later refactor.)
 */
export async function openWeightActionContext(): Promise<{ kind: "ready"; context: ReadyContext } | { kind: "unavailable" }> {
  if (!isSupabaseConfigured()) redirect("/");

  const context = await loadOnboardingContext();
  if (context.kind === "not_configured") redirect("/");
  if (context.kind === "signed_out") redirect("/login");
  if (context.kind !== "ready") return { kind: "unavailable" };

  const route = decideRoute("home", context.row.lifecycle_state);
  if (route.kind === "redirect") redirect(route.to);
  return { kind: "ready", context };
}
