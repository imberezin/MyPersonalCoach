"use server";

import { revalidatePath } from "next/cache";
import { RedirectType, notFound, redirect } from "next/navigation";
import { isOffline } from "@/domain/offline";
import { localDayOf, resolveTimeZone } from "@/domain/time";
import {
  WEIGHT_FLOW,
  WEIGHT_FORM,
  WEIGHT_ROUTES,
  isUuid,
  needsDoubleCheck,
  readWeightForm,
  validateWeightForm,
  type WeightFormState,
  type WeightFormValues,
} from "@/domain/weight";
import { logAppError } from "@/lib/ai/ledger";
import type { AnalyticsEventName, EventPayload } from "@/lib/analytics/events";
import { SupabaseEventsSink, track } from "@/lib/analytics/track";
import { currentInstant } from "@/lib/clock/now";
import { loadOfflinePeriods } from "@/lib/home/load";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { insertWeightEntry, loadReferenceWeight, loadWeightEntry, updateWeightEntry } from "@/lib/weight/repo";
import { openWeightActionContext } from "./_lib/gate";

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;

/** Product events never block or break an action. Always stamped with the app's clock, so a weight saved under the development clock carries that time. */
function emit(context: ReadyContext, name: AnalyticsEventName, payload: EventPayload, now: Date): Promise<void> {
  return track(new SupabaseEventsSink(context.supabase), name, payload, now);
}

/** A short code in `app_errors`. Never a weight, the note or a message of the database. */
function logWeightError(context: ReadyContext, message: "save_error", stage: string, code: string): Promise<void> {
  return logAppError({ userId: context.userId, area: "weight", message, context: { stage, code } });
}

function readId(formData: FormData): string {
  const id = formData.get(WEIGHT_FORM.id);
  if (!isUuid(id)) notFound();
  return id;
}

/** The form keeps what was typed, says calmly that nothing was saved, and the person can try again. */
const unsaved = (values: WeightFormValues): WeightFormState => ({ status: "error", errors: [{ code: "not_saved" }], values });

/**
 * The weight to compare a new number with, for the soft "is that right?": the newest weigh-in before this one, else the
 * profile's starting weight, else nothing. A read that failed is unknown, and unknown never asks.
 */
async function referenceFor(context: ReadyContext, a: { before: Date; excludeId?: string }): Promise<number | null> {
  const previous = await loadReferenceWeight(context.supabase, a);
  if (previous === "unknown") return null;
  return previous ?? context.row.start_weight_kg;
}

/**
 * Saves a new weigh-in. Order matters, and a page guard does not protect a direct POST: the id, the kill switch, the
 * session, the offline period (Shabbat: back to the quiet screen with nothing written; an unreadable list of periods goes
 * on, as in the food flow), the form rules, the soft double-check, the write, the event, the redirect. The id is made by
 * the page, so a double tap or a second tab saves once. A refused save comes back as state with what was typed.
 */
export async function saveWeightAction(_previous: WeightFormState, formData: FormData): Promise<WeightFormState> {
  const id = readId(formData);
  const values = readWeightForm(formData);
  if (!WEIGHT_FLOW.reportingEnabled) redirect("/");

  const opened = await openWeightActionContext();
  if (opened.kind === "unavailable") return unsaved(values);
  const { context } = opened;

  const now = currentInstant();
  const periods = await loadOfflinePeriods(context.supabase, context.userId, now);
  if (periods && isOffline(periods, now)) redirect(WEIGHT_ROUTES.entry);

  const timeZone = resolveTimeZone(context.row.timezone);
  const checked = validateWeightForm(values, { now, timeZone, mode: { kind: "new" } });
  if (!checked.ok) return { status: "error", errors: checked.errors, values };
  // "keep" does not exist in new mode, so the instant is always set.
  const measuredAt = checked.measuredAt ?? now;

  const reference = await referenceFor(context, { before: measuredAt });
  const asks = needsDoubleCheck({ weightKg: checked.weightKg, referenceKg: reference });
  if (asks && !values.confirmed) return { status: "check", values };

  const saved = await insertWeightEntry(context.supabase, { id, weightKg: checked.weightKg, measuredAt, note: checked.note });
  if (!saved.ok) {
    await logWeightError(context, "save_error", "insert", saved.code);
    return unsaved(values);
  }

  // A repeat of the same id (a double tap, a second tab) wrote nothing: it is not a second weigh-in, so it is not counted twice.
  if (saved.value.created) {
    await emit(context, "weight_reported", { day: checked.day === "now" ? "now" : "earlier", checked: asks, has_note: checked.note !== null }, now);
  }

  // Home and Progress read the weight: refresh every page the person visited. Back must not return to a stale form.
  revalidatePath("/", "layout");
  redirect(WEIGHT_ROUTES.saved(id), RedirectType.replace);
}

/**
 * Changes an existing weigh-in (the number, the day or the note). The same shape as saving, for an id that must be the
 * person's own: one that is not (or is gone) is a 404. Only a CHANGED number is asked about again, so fixing a note never
 * brings the question back.
 */
export async function editWeightAction(_previous: WeightFormState, formData: FormData): Promise<WeightFormState> {
  const id = readId(formData);
  const values = readWeightForm(formData);
  if (!WEIGHT_FLOW.reportingEnabled) redirect("/");

  const opened = await openWeightActionContext();
  if (opened.kind === "unavailable") return unsaved(values);
  const { context } = opened;

  const now = currentInstant();
  const periods = await loadOfflinePeriods(context.supabase, context.userId, now);
  // The edit page shows the quiet screen during an offline period.
  if (periods && isOffline(periods, now)) redirect(WEIGHT_ROUTES.edit(id));

  const loaded = await loadWeightEntry(context.supabase, id);
  if (!loaded.ok) {
    if (loaded.code === "not_found") notFound();
    await logWeightError(context, "save_error", "edit_load", loaded.code);
    return unsaved(values);
  }
  const before = loaded.value;

  const timeZone = resolveTimeZone(context.row.timezone);
  const checked = validateWeightForm(values, { now, timeZone, mode: { kind: "edit", measuredAt: before.measuredAt } });
  if (!checked.ok) return { status: "error", errors: checked.errors, values };
  const measuredAt = checked.measuredAt ?? before.measuredAt;

  const weightChanged = checked.weightKg !== before.weightKg;
  if (weightChanged && !values.confirmed) {
    const reference = await referenceFor(context, { before: measuredAt, excludeId: id });
    if (needsDoubleCheck({ weightKg: checked.weightKg, referenceKg: reference })) return { status: "check", values };
  }

  const written = await updateWeightEntry(context.supabase, { id, weightKg: checked.weightKg, measuredAt: checked.measuredAt, note: checked.note });
  if (!written.ok) {
    if (written.code === "not_found") notFound();
    await logWeightError(context, "save_error", "edit_write", written.code);
    return unsaved(values);
  }

  await emit(
    context,
    "weight_edited",
    {
      weight_changed: weightChanged,
      day_changed: checked.measuredAt !== null && localDayOf(checked.measuredAt, timeZone).key !== localDayOf(before.measuredAt, timeZone).key,
      note_changed: checked.note !== before.note,
    },
    now,
  );

  revalidatePath("/", "layout");
  redirect(WEIGHT_ROUTES.savedEdited(id), RedirectType.replace);
}
