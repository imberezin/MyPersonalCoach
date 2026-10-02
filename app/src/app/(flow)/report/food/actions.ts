"use server";

import { revalidatePath } from "next/cache";
import { RedirectType, notFound, redirect } from "next/navigation";
import {
  FOOD_FORM,
  FOOD_QUERY,
  FOOD_ROUTES,
  diffMeal,
  isUuid,
  mealOf,
  mealSource,
  readEditForm,
  revisionOf,
  validateEdit,
  validateMealForSave,
  type EditFormState,
  type Understanding,
} from "@/domain/food";
import { resolveTimeZone } from "@/domain/home";
import { decideRoute } from "@/domain/onboarding";
import { logAppError } from "@/lib/ai/ledger";
import type { AnalyticsEventName, EventPayload } from "@/lib/analytics/events";
import { SupabaseEventsSink, track } from "@/lib/analytics/track";
import { currentInstant } from "@/lib/clock/now";
import { confirmMeal, discardUnderstanding, loadUnderstanding, saveDraft } from "@/lib/food/repo";
import { loadOnboardingContext, type OnboardingContext } from "@/lib/onboarding/context";
import { refreshPatternsAfterMealChange } from "@/lib/patterns/refresh";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;

/**
 * What every action needs first, and never trusts a page for: Supabase set up, a verified session, a
 * finished onboarding. Not set up and signed out end here as redirects; a database that cannot be
 * reached comes back as `unavailable` and each action answers in its own way. The user id is the
 * verified session's, never a field of the form.
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

/** Product events never block or break an action. */
function emit(context: ReadyContext, name: AnalyticsEventName, payload: EventPayload): Promise<void> {
  return track(new SupabaseEventsSink(context.supabase), name, payload);
}

/** A short code in `app_errors`. Never the text, the foods or a message of the database. */
function logFoodError(context: ReadyContext, message: "save_error" | "confirm_error", stage: string, code?: string): Promise<void> {
  return logAppError({ userId: context.userId, area: "food", message, context: { stage, code: code ?? null } });
}

function readId(formData: FormData): string {
  const id = formData.get(FOOD_FORM.id);
  if (!isUuid(id)) notFound();
  return id;
}

const reportMode = (u: Understanding): "photo" | "text" | "manual" => (u.provider === "manual" ? "manual" : u.kind);

/**
 * Saves the report the user is looking at. The form carries only the id and the revision of what was
 * shown: the foods, the time and the source are rebuilt here from the stored report, so nothing the
 * client says becomes a meal. The ending is always a redirect (a page guard does not protect a direct POST).
 */
export async function confirmMealAction(formData: FormData): Promise<void> {
  const id = readId(formData);
  const revision = String(formData.get(FOOD_FORM.revision) ?? "");

  const opened = await openActionContext();
  // The database cannot be reached: the confirm page shows its own calm state, or the report again.
  if (opened.kind === "unavailable") redirect(FOOD_ROUTES.confirm(id), RedirectType.replace);
  const { context } = opened;

  const loaded = await loadUnderstanding(context.supabase, id);
  if (!loaded.ok) {
    if (loaded.code === "not_found") notFound();
    await logFoodError(context, "confirm_error", "load", loaded.code);
    redirect(`${FOOD_ROUTES.confirm(id)}?${FOOD_QUERY.failed}=1`, RedirectType.replace);
  }
  const understanding = loaded.value;

  // Already saved (a double tap, a second tab): the meal exists, show it.
  if (understanding.status === "accepted" || understanding.status === "edited") redirect(FOOD_ROUTES.saved(id), RedirectType.replace);
  if (understanding.status !== "pending") notFound();

  const now = new Date();
  const meal = mealOf(understanding);

  // The screen the user saw is not what is stored now (another tab edited it): show it again, save nothing.
  if (revisionOf(meal) !== revision) {
    redirect(`${FOOD_ROUTES.confirm(id)}?${FOOD_QUERY.refreshed}=1`, RedirectType.replace);
  }

  if (!validateMealForSave(meal, now).ok) redirect(FOOD_ROUTES.edit(id));

  const source = mealSource(understanding);
  const saved = await confirmMeal(context.supabase, { id, meal, source });
  if (!saved.ok) {
    if (saved.code === "not_found") notFound();
    // The save did not go through: the confirm page says so, and Save is still there to try again.
    if (saved.code === "unavailable") {
      await logFoodError(context, "confirm_error", "confirm", saved.code);
      redirect(`${FOOD_ROUTES.confirm(id)}?${FOOD_QUERY.failed}=1`, RedirectType.replace);
    }
    // Not pending any more: the confirm page decides what to show.
    redirect(FOOD_ROUTES.confirm(id), RedirectType.replace);
  }

  const mode = reportMode(understanding);
  await emit(context, "meal_saved", {
    source,
    mode,
    items: meal.items.length,
    report_ms: Math.max(0, now.getTime() - understanding.createdAt.getTime()),
  });
  if (source === "ai_edited") {
    const diff = diffMeal(mealOf({ items: understanding.items, proposed: understanding.proposed, draft: null }), meal);
    await emit(context, "meal_corrected", {
      food_changed: diff.foodChanged,
      portion_changed: diff.portionChanged,
      type_changed: diff.typeChanged,
      time_changed: diff.timeChanged,
      added: diff.added,
      removed: diff.removed,
    });
  }

  // The person pressed Save, so the stored pattern mirror may follow their meals. It does nothing at all unless the
  // person already has a pattern row, and it takes the app's clock; the save itself and its events above keep the real
  // one (a meal dated in real time must not be judged against a development clock). It never changes the landing.
  try {
    await refreshPatternsAfterMealChange(context, currentInstant());
  } catch {
    // Harmless: no decision reads the mirror, and the next sync converges it.
  }

  // Home no longer shows the first-report invitation, and Back must not return to the confirm screen.
  revalidatePath("/", "layout");
  redirect(FOOD_ROUTES.saved(id), RedirectType.replace);
}

/**
 * Saves the user's edit of a pending report as its `draft` (the AI original is never touched) and
 * goes back to the confirm screen. A refused save comes back as state, with what was typed, so nothing
 * is lost. Success never returns: it redirects.
 */
export async function saveEditAction(_previous: EditFormState, formData: FormData): Promise<EditFormState> {
  const id = readId(formData);
  const values = readEditForm(formData);
  // The form keeps what was typed, says calmly that nothing was saved, and the person can try again.
  const unsaved: EditFormState = { status: "error", errors: [{ code: "not_saved" }], values };

  const opened = await openActionContext();
  if (opened.kind === "unavailable") return unsaved;
  const { context } = opened;

  const loaded = await loadUnderstanding(context.supabase, id);
  if (!loaded.ok) {
    if (loaded.code === "not_found") notFound();
    await logFoodError(context, "save_error", "edit_load", loaded.code);
    return unsaved;
  }
  const understanding = loaded.value;
  // Saved or discarded meanwhile: the confirm page sends the person where the report now belongs.
  if (understanding.status !== "pending") redirect(FOOD_ROUTES.confirm(id), RedirectType.replace);

  const checked = validateEdit(values, mealOf(understanding), { now: new Date(), timeZone: resolveTimeZone(context.row.timezone) });
  if (!checked.ok) return { status: "error", errors: checked.errors, values };

  const written = await saveDraft(context.supabase, id, checked.meal);
  if (!written.ok) {
    if (written.code === "not_pending") redirect(FOOD_ROUTES.confirm(id), RedirectType.replace);
    if (written.code === "not_found") notFound();
    await logFoodError(context, "save_error", "edit_write", written.code);
    return unsaved;
  }

  // Back from the new confirm screen would otherwise show the earlier one from the router cache.
  revalidatePath(FOOD_ROUTES.confirm(id));
  redirect(FOOD_ROUTES.confirm(id), RedirectType.replace);
}

/**
 * "Not now" on the confirm screen and "Let it go" on the resume card. It deletes a PENDING report and
 * its raw text; a report that was saved meanwhile is left alone (the database answers "not pending").
 * From the confirm screen the person goes Home; from the resume card they stay on the first screen.
 */
export async function discardAction(formData: FormData): Promise<void> {
  const id = readId(formData);
  const stage = formData.get(FOOD_FORM.stage);
  // Anything but the two known places is a forged form: nothing is deleted.
  if (stage !== "confirm" && stage !== "resume") redirect("/", RedirectType.replace);

  const opened = await openActionContext();
  if (opened.kind === "ready") {
    const discarded = await discardUnderstanding(opened.context.supabase, id);
    if (discarded.ok) await emit(opened.context, "meal_report_discarded", { stage });
    else if (discarded.code === "unavailable") await logFoodError(opened.context, "save_error", "discard", discarded.code);
  }

  if (stage === "confirm") redirect("/", RedirectType.replace);
  revalidatePath(FOOD_ROUTES.chooser);
}
