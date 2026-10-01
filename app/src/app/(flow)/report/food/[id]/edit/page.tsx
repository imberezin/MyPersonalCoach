import type { Metadata } from "next";
import { RedirectType, notFound, redirect } from "next/navigation";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { EditForm } from "@/components/food/EditForm";
import { FlowUnavailable } from "@/components/food/FlowUnavailable";
import { FOOD_ROUTES, editFormDefaults, isStaleReport, isUuid, mealOf } from "@/domain/food";
import { getTranslations } from "@/i18n/server";
import { loadUnderstanding } from "@/lib/food/repo";
import { saveEditAction } from "../../actions";
import { openReportGate } from "../../_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("food");
  return { title: t("meta.title") };
}

// D7: change anything about the meal. Only a report that is still waiting for the person can be edited.
export default async function FoodEditPage(props: PageProps<"/report/food/[id]/edit">) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const gate = await openReportGate();
  if (gate.kind === "not_configured") return <SetupNotice />;
  if (gate.kind === "unavailable") return <FlowUnavailable />;

  const loaded = await loadUnderstanding(gate.context.supabase, id);
  if (!loaded.ok) {
    if (loaded.code === "not_found") notFound();
    return <FlowUnavailable />;
  }
  const understanding = loaded.value;

  // The confirm screen knows where a saved or discarded report belongs.
  if (understanding.status !== "pending") redirect(FOOD_ROUTES.confirm(id), RedirectType.replace);
  // Older than the resume window: a delete elsewhere removes such a report, so it is not offered any more.
  if (isStaleReport(understanding.createdAt, gate.now)) notFound();

  const initial = editFormDefaults(mealOf(understanding), { now: gate.now, timeZone: gate.timeZone });
  return <EditForm id={id} initial={initial} action={saveEditAction} backHref={FOOD_ROUTES.confirm(id)} />;
}
