import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { openAppGate } from "@/app/(app)/_lib/gate";
import { ExperimentView, experimentTextFor } from "@/components/firstWeek/ExperimentView";
import { FirstWeekUnavailable } from "@/components/firstWeek/FirstWeekUnavailable";
import { FIRST_WEEK_FLOW, FIRST_WEEK_QUERY, FIRST_WEEK_ROUTES } from "@/domain/firstWeekFlow";
import { PATTERN_FLOW } from "@/domain/patterns";
import { getLocale, getTranslations } from "@/i18n/server";
import { currentInstant } from "@/lib/clock/now";
import { loadExperiments } from "@/lib/experiments/repo";
import { selectLiveExperiment } from "../_lib/gate";
import { skipFirstExperimentAction, startFirstExperimentAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("firstWeek");
  return { title: t("experiment.meta.title") };
}

/**
 * B5, the small experiment: the offered or the started one. A pure READ (no write, no AI). An OFFERED row is shown
 * only while the very same selection the summary makes (selectFirstExperiment over the live meals) still says
 * PENDING for it, so B6 and B5 always agree and nobody is sent to a link that bounces back; an idea whose evidence
 * was deleted meanwhile is left untouched and waits. A STARTED one is shown whatever happens to the meals.
 */
export default async function FirstWeekExperimentPage(props: PageProps<"/first-week/experiment">) {
  const gate = await openAppGate();
  if (gate.kind === "not_configured") return <SetupNotice />;
  if (!FIRST_WEEK_FLOW.summaryEnabled || !PATTERN_FLOW.experimentEnabled) redirect("/");

  const { context } = gate;
  if (context.kind === "signed_out") redirect("/login");
  if (context.kind !== "ready") return <FirstWeekUnavailable />;
  if (context.row.lifecycle_state !== "FIRST_WEEK") redirect("/");

  const experiments = await loadExperiments(context.supabase, context.userId);
  if (experiments === null) return <FirstWeekUnavailable />;
  const { open } = experiments;
  if (open === null) redirect(FIRST_WEEK_ROUTES.summary);

  if (open.status === "OFFERED") {
    const { selection } = await selectLiveExperiment(context, experiments.facts, currentInstant());
    if (selection.kind !== "PENDING" || selection.experimentId !== open.id) redirect(FIRST_WEEK_ROUTES.summary);
  }

  const [locale, tLibrary, query] = await Promise.all([getLocale(), getTranslations("interventions"), props.searchParams]);
  return (
    <ExperimentView
      experiment={open}
      text={experimentTextFor(open, locale, tLibrary)}
      failed={query[FIRST_WEEK_QUERY.failed] === "1"}
      startAction={startFirstExperimentAction}
      skipAction={skipFirstExperimentAction}
    />
  );
}
