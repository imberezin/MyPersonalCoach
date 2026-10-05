import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { openAppGate } from "@/app/(app)/_lib/gate";
import { experimentTextFor } from "@/components/firstWeek/ExperimentView";
import { WeeklyUnavailable } from "@/components/weekly/WeeklyUnavailable";
import { WeeklyView } from "@/components/weekly/WeeklyView";
import { resolveTimeZone } from "@/domain/time";
import { WEEKLY_FLOW, WEEKLY_QUERY, resolveOpeningLine } from "@/domain/weekly";
import { getLocale, getTranslations } from "@/i18n/server";
import { currentInstant } from "@/lib/clock/now";
import { loadWeeklyStory } from "@/lib/weekly/load";
import {
  answerExperimentResultAction,
  answerWeeklyPatternAction,
  proposeWeeklyExperimentAction,
  skipWeeklyExperimentAction,
  startWeeklyExperimentAction,
} from "./actions";

// The route that posts proposeWeeklyExperimentAction, which may wait up to 13 seconds for the AI after several database
// calls. A Server Action takes the timeout of the page that uses it. The same value and the same reason as /first-week and
// /api/food/analyze; app/vercel.json has no function config.
export const maxDuration = 40;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("weekly");
  return { title: t("meta.title") };
}

/**
 * "Your week" (/week). A pure READ: it recomputes everything from the live data on every render, writes nothing and never
 * calls the AI. Who may see it is decided here (a page guard), and again by each Server Action it posts to. Only a person in
 * the weekly cycle whose week is ready sees a story; every other case goes Home, and a database that cannot be read shows one
 * calm card instead of an error. The page takes no query parameter that selects a week: it is always the latest completed
 * eligible week for the instant it is rendered at.
 */
export default async function WeekPage(props: PageProps<"/week">) {
  const gate = await openAppGate();
  if (gate.kind === "not_configured") return <SetupNotice />;
  if (!WEEKLY_FLOW.enabled) redirect("/");

  const { context } = gate;
  if (context.kind === "signed_out") redirect("/login");
  if (context.kind !== "ready") return <WeeklyUnavailable />;

  // The page's one clock read.
  const now = currentInstant();
  const loaded = await loadWeeklyStory(context, now);
  if (loaded.kind === "not_weekly_cycle" || loaded.kind === "not_ready") redirect("/");
  if (loaded.kind === "unavailable") return <WeeklyUnavailable />;

  const [locale, t, tRoot, tLibrary, query] = await Promise.all([
    getLocale(),
    getTranslations("weekly"),
    getTranslations(),
    getTranslations("interventions"),
    props.searchParams,
  ]);
  const { story } = loaded;
  const { decision, open } = loaded.experiment;

  // The dates of the week, in the person's zone: the only digits on the page.
  const timeZone = resolveTimeZone(context.row.timezone);
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone });
  const rangeLabel = t("range", { start: day.format(loaded.moment.week.days[0].start), end: day.format(loaded.moment.week.days[6].start) });

  // The stored AI line only while its mode, key and language still match the live story; otherwise the catalog sentence.
  const resolved = resolveOpeningLine({ story, row: loaded.row, locale });
  const line =
    resolved.source === "ai"
      ? ({ source: "ai", text: resolved.text } as const)
      : ({ source: "catalog", text: tRoot(resolved.messageKey) } as const);

  // The open experiment's sentence: the stored one when it was written in this language, otherwise the library's (the person
  // may have switched language since), and then it is the library's text whatever was stored.
  const experiment =
    open !== null && (decision.kind === "PENDING" || decision.kind === "ACTIVE" || decision.kind === "RESULT_DUE")
      ? {
          text: experimentTextFor(open, locale, tLibrary),
          source: open.locale === locale ? open.source : ("library" as const),
          origin: open.origin,
        }
      : null;

  return (
    <WeeklyView
      story={story}
      decision={decision}
      rangeLabel={rangeLabel}
      line={line}
      experiment={experiment}
      offer={decision.kind === "OFFER" ? { rationale: decision.rationale } : null}
      failed={query[WEEKLY_QUERY.failed] === "1"}
      actions={{
        propose: proposeWeeklyExperimentAction,
        start: startWeeklyExperimentAction,
        skip: skipWeeklyExperimentAction,
        answerResult: answerExperimentResultAction,
        answerPattern: answerWeeklyPatternAction,
      }}
    />
  );
}
