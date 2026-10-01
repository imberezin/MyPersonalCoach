import type { Metadata } from "next";
import { RedirectType, notFound, redirect } from "next/navigation";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { ConfirmScreen } from "@/components/food/ConfirmScreen";
import { FlowUnavailable } from "@/components/food/FlowUnavailable";
import { FOOD_QUERY, FOOD_ROUTES, buildConfirmView, isStaleReport, isUuid } from "@/domain/food";
import { getTranslations } from "@/i18n/server";
import { loadUnderstanding } from "@/lib/food/repo";
import { confirmMealAction, discardAction } from "../actions";
import { openReportGate } from "../_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("food");
  return { title: t("meta.title") };
}

// D6: what was understood, on one screen. The report is a row in the database, so a reload, the Back
// button and the phone killing the app all land here again.
export default async function FoodConfirmPage(props: PageProps<"/report/food/[id]">) {
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
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

  // Saved already: the meal exists, and this screen would only offer to save it again.
  if (understanding.status === "accepted" || understanding.status === "edited") redirect(FOOD_ROUTES.saved(id), RedirectType.replace);
  if (understanding.status !== "pending") notFound();
  // Older than the resume window: a delete elsewhere removes such a report, so it is not offered any more.
  if (isStaleReport(understanding.createdAt, gate.now)) notFound();

  const refreshed = [query[FOOD_QUERY.refreshed]].flat()[0] === "1";
  const failed = [query[FOOD_QUERY.failed]].flat()[0] === "1";
  const view = buildConfirmView(understanding, { now: gate.now, timeZone: gate.timeZone });
  return <ConfirmScreen view={view} refreshed={refreshed} failed={failed} confirmAction={confirmMealAction} discardAction={discardAction} />;
}
