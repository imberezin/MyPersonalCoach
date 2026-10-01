import type { Metadata } from "next";
import { RedirectType, notFound, redirect } from "next/navigation";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { FlowUnavailable } from "@/components/food/FlowUnavailable";
import { SavedView } from "@/components/food/SavedView";
import { FOOD_ROUTES, isUuid } from "@/domain/food";
import { getTranslations } from "@/i18n/server";
import { decideSavedFollowUp } from "@/lib/food/followUp";
import { loadSavedMeal, loadUnderstanding } from "@/lib/food/repo";
import { openReportGate } from "../../_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("food");
  return { title: t("meta.title") };
}

// D8: the meal was added. Reached by `replace`, so Back skips the confirm screen.
export default async function FoodSavedPage(props: PageProps<"/report/food/[id]/saved">) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const gate = await openReportGate();
  if (gate.kind === "not_configured") return <SetupNotice />;
  if (gate.kind === "unavailable") return <FlowUnavailable />;
  const { supabase, row } = gate.context;

  const loaded = await loadUnderstanding(supabase, id);
  if (!loaded.ok) {
    if (loaded.code === "not_found") notFound();
    return <FlowUnavailable />;
  }
  // Not saved (yet): the confirm screen is where it waits, or where a discarded one ends as a 404.
  if (loaded.value.status !== "accepted" && loaded.value.status !== "edited") redirect(FOOD_ROUTES.confirm(id), RedirectType.replace);

  const saved = await loadSavedMeal(supabase, id);
  if (!saved.ok) return <FlowUnavailable />;

  const followUp = decideSavedFollowUp({ mealId: saved.value.entryId, isFirstMeal: saved.value.isFirstMeal, lifecycle: row.lifecycle_state });
  // The acknowledging line is for the very first meal, and only while the person is still in the First Week.
  const firstReport = saved.value.isFirstMeal && row.lifecycle_state === "FIRST_WEEK";
  return <SavedView firstReport={firstReport} followUp={followUp} />;
}
