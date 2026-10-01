import "server-only";
import { redirect } from "next/navigation";
import { decideRoute } from "@/domain/onboarding";
import { loadOnboardingContext, type OnboardingContext } from "@/lib/onboarding/context";

export type AppGate = { kind: "not_configured" } | { kind: "open"; context: OnboardingContext };

/**
 * The guard every page of the app shell runs first: Home's old behaviour, written once. Only a user
 * whose profile loaded and who has not finished onboarding is sent away. Every other outcome (signed
 * out, a failed page-level load, no profile) opens the page as before: the proxy owns sign-in (and with
 * the whole Supabase stack down it already sends a signed-in user to /login), and a hiccup must
 * not trap the user in a redirect. It runs in the pages, never in the layout, because a layout does
 * not re-render on navigation.
 *
 * `loadOnboardingContext` already answers `not_configured` when Supabase is not set up, so the gate
 * does not check the environment a second time.
 */
export async function openAppGate(): Promise<AppGate> {
  const context = await loadOnboardingContext();
  if (context.kind === "not_configured") return { kind: "not_configured" };

  if (context.kind === "ready") {
    const route = decideRoute("home", context.row.lifecycle_state);
    if (route.kind === "redirect") redirect(route.to);
  }
  return { kind: "open", context };
}
