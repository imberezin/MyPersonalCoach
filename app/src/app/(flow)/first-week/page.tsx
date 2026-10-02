import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { openAppGate } from "@/app/(app)/_lib/gate";
import { experimentTextFor } from "@/components/firstWeek/ExperimentView";
import { FirstWeekSummaryView } from "@/components/firstWeek/FirstWeekSummaryView";
import { FirstWeekUnavailable } from "@/components/firstWeek/FirstWeekUnavailable";
import { FIRST_WEEK_FLOW, FIRST_WEEK_QUERY } from "@/domain/firstWeekFlow";
import { getLocale, getTranslations } from "@/i18n/server";
import { currentInstant } from "@/lib/clock/now";
import { loadFirstWeekSummary } from "@/lib/firstWeek/load";
import { finishFirstWeekAction, snoozeFirstWeekCardAction } from "./actions";
import { proposeFirstExperimentAction } from "./experiment/actions";

// The route that posts proposeFirstExperimentAction, which may wait up to 9 seconds for the AI after several database
// calls. A Server Action takes the timeout of the page that uses it. The same value and the same reason as
// /api/food/analyze; app/vercel.json has no function config.
export const maxDuration = 40;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("firstWeek");
  return { title: t("meta.title") };
}

/**
 * B6, the First Week summary. A pure READ: it recomputes everything from the live data on every render, writes
 * nothing and never calls the AI. Who may see it is decided here (a page guard), and again by each Server Action it
 * posts to: onboarding unfinished goes to /onboarding, a person whose First Week is over or whose rules do not (or no
 * longer) say "ready" goes Home, and a database that cannot be read shows one calm card instead of an error.
 */
export default async function FirstWeekPage(props: PageProps<"/first-week">) {
  const gate = await openAppGate();
  if (gate.kind === "not_configured") return <SetupNotice />;
  if (!FIRST_WEEK_FLOW.summaryEnabled) redirect("/");

  const { context } = gate;
  if (context.kind === "signed_out") redirect("/login");
  if (context.kind !== "ready") return <FirstWeekUnavailable />;

  // The page's one clock read.
  const loaded = await loadFirstWeekSummary(context, currentInstant());
  if (loaded.kind === "not_first_week" || loaded.kind === "not_ready") redirect("/");
  if (loaded.kind === "unavailable") return <FirstWeekUnavailable />;

  const [locale, tLibrary, query] = await Promise.all([getLocale(), getTranslations("interventions"), props.searchParams]);
  const { open } = loaded.experiment;
  return (
    <FirstWeekSummaryView
      summary={loaded.summary}
      failed={query[FIRST_WEEK_QUERY.failed] === "1"}
      finishAction={finishFirstWeekAction}
      snoozeAction={snoozeFirstWeekCardAction}
      proposeAction={proposeFirstExperimentAction}
      experiment={{ open, text: open !== null && open.status === "ACTIVE" ? experimentTextFor(open, locale, tLibrary) : null }}
    />
  );
}
