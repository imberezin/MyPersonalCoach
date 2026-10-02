"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { openWeightActionContext } from "@/app/(flow)/report/weight/_lib/gate";
import { MILESTONE_MOMENT, parseDayKey } from "@/domain/weight";
import { SupabaseEventsSink, track } from "@/lib/analytics/track";
import { currentInstant } from "@/lib/clock/now";

/**
 * "Thanks" on the landmark card: the one press that ends it for that landmark. It reads ONLY the field `week` (the date
 * key of the week that confirmed the landmark); the user is the verified session's, never a field. One append-only,
 * content-free event is written, `{ week }`: no weight and no landmark value. A week that is not a real calendar date
 * writes nothing. Everything is checked again here (a page guard does not protect a direct POST), nothing else is
 * re-evaluated (hiding the card is harmless, and a forged week only appends an event that hides nothing real), and a
 * failed write simply leaves the card where it was. The ending is always a redirect to Home.
 */
export async function acknowledgeMilestoneAction(formData: FormData): Promise<void> {
  const week = formData.get("week");
  if (typeof week !== "string" || parseDayKey(week) === null) redirect("/");

  const opened = await openWeightActionContext();
  if (opened.kind === "unavailable") redirect("/");
  const { context } = opened;

  // The event carries the action's own instant, like every other action that stamps one (the dev clock reads the same).
  try {
    await track(new SupabaseEventsSink(context.supabase), MILESTONE_MOMENT.ackEvent, { week }, currentInstant());
  } catch {
    // Analytics must never change where the person lands.
  }

  revalidatePath("/", "layout");
  redirect("/");
}
