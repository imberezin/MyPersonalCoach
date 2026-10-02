"use server";

import { revalidatePath } from "next/cache";
import { RedirectType, notFound, redirect } from "next/navigation";
import { openWeightActionContext } from "@/app/(flow)/report/weight/_lib/gate";
import { WEIGHT_DELETE_FIELDS, WEIGHT_ROUTES, isUuid, parseDeleteFrom, parseWeightCursor } from "@/domain/weight";
import { logAppError } from "@/lib/ai/ledger";
import { SupabaseEventsSink, track } from "@/lib/analytics/track";
import { currentInstant } from "@/lib/clock/now";
import { deleteWeightEntry } from "@/lib/weight/repo";

/**
 * Deletes one saved weight, from the list or from the Saved screen, and always ends in a redirect to the list with a
 * calm line. The form carries the entry id and nothing else of weight: `from` only picks an analytics enum and `after`
 * the page of the list to come back to (both read closed). The user id comes from the session, the erasure itself (and its
 * guard against someone else's id) is the database function. Deleting is not reporting, so it is allowed in Shabbat and
 * any offline period: no offline period is read here.
 */
export async function deleteWeightAction(formData: FormData): Promise<void> {
  // Random and unrelated to the weight; it makes every attempt a different URL, so the notice is announced each time.
  const token = crypto.randomUUID();

  const entryId = formData.get(WEIGHT_DELETE_FIELDS.entryId);
  if (!isUuid(entryId)) notFound();
  const from = parseDeleteFrom(formData.get(WEIGHT_DELETE_FIELDS.from));
  const after = parseWeightCursor(formData.get(WEIGHT_DELETE_FIELDS.after));

  const opened = await openWeightActionContext();
  if (opened.kind === "unavailable") redirect(WEIGHT_ROUTES.withNotice("error", { token, after }), RedirectType.replace);
  const { context } = opened;

  const deleted = await deleteWeightEntry(context.supabase, entryId);
  if (!deleted.ok) {
    // The call may have committed with the answer lost, so the notice never claims what the state is.
    await logAppError({ userId: context.userId, area: "weight", message: "delete_error", context: { stage: "delete", code: deleted.code } });
    redirect(WEIGHT_ROUTES.withNotice("error", { token, after }), RedirectType.replace);
  }

  const now = currentInstant();
  if (deleted.value.deleted) await track(new SupabaseEventsSink(context.supabase), "weight_deleted", { from }, now);

  // Home may go back to its first-report state or lose its landmark card, and every page the person visited shows the
  // weight: refresh them all.
  revalidatePath("/", "layout");
  redirect(WEIGHT_ROUTES.withNotice(deleted.value.deleted ? "deleted" : "gone", { token, after }), RedirectType.replace);
}
