"use server";

import { revalidatePath } from "next/cache";
import { RedirectType, notFound, redirect } from "next/navigation";
import { MEALS_FORM, MEALS_ROUTES, clampPages, isUuid, parseDeleteFrom } from "@/domain/food";
import { decideRoute } from "@/domain/onboarding";
import { logAppError } from "@/lib/ai/ledger";
import { SupabaseEventsSink, track } from "@/lib/analytics/track";
import { deleteMealEntry } from "@/lib/food/repo";
import { loadOnboardingContext, type OnboardingContext } from "@/lib/onboarding/context";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;

/**
 * What every action needs first, and never trusts a page for: Supabase set up, a verified session, a
 * finished onboarding. Not set up, signed out and unfinished onboarding end here as redirects; a database
 * that cannot be reached comes back as `unavailable`, and the action answers with its calm notice. The
 * user id is the verified session's, never a field of the form. (The same ten lines as the food actions:
 * a gate redirects, and this action must land on a notice, so it cannot reuse one.)
 */
async function openActionContext(): Promise<{ kind: "ready"; context: ReadyContext } | { kind: "unavailable" }> {
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
 * Deletes one saved meal, from the list or from the Saved screen, and always ends in a redirect to the
 * list with a calm line. The form carries the meal id and nothing else of weight: `from` only picks an
 * analytics enum and `pages` the size of the list to come back to. The user id comes from the session, the
 * erasure itself (and its guard against someone else's id) is the database function. Deleting is not
 * reporting, so it is allowed in Shabbat and any offline period: no offline period is read here.
 */
export async function deleteMealAction(formData: FormData): Promise<void> {
  // Random and unrelated to the meal; it makes every attempt a different URL, so the notice is announced each time.
  const token = crypto.randomUUID();

  const entryId = formData.get(MEALS_FORM.entryId);
  if (!isUuid(entryId)) notFound();
  const from = parseDeleteFrom(formData.get(MEALS_FORM.from));
  const pages = clampPages(formData.get(MEALS_FORM.pages));

  const opened = await openActionContext();
  if (opened.kind === "unavailable") redirect(MEALS_ROUTES.withNotice("error", { token, pages }), RedirectType.replace);
  const { context } = opened;

  const deleted = await deleteMealEntry(context.supabase, entryId);
  if (!deleted.ok) {
    // The call may have committed with the answer lost, so the notice never claims what the state is.
    await logAppError({ userId: context.userId, area: "food", message: "delete_error", context: { stage: "delete", code: deleted.code } });
    redirect(MEALS_ROUTES.withNotice("error", { token, pages }), RedirectType.replace);
  }

  if (deleted.value.deleted) await track(new SupabaseEventsSink(context.supabase), "meal_deleted", { from });

  // Home may go back to its first-report state, and every page the person visited shows the meal: refresh them all.
  revalidatePath("/", "layout");
  redirect(MEALS_ROUTES.withNotice(deleted.value.deleted ? "deleted" : "gone", { token, pages }), RedirectType.replace);
}
