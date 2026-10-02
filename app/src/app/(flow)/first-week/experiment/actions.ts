"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isWordingGateReason } from "@/domain/experiments/wording";
import { FIRST_WEEK_FLOW, FIRST_WEEK_QUERY, FIRST_WEEK_ROUTES } from "@/domain/firstWeekFlow";
import { isOffline } from "@/domain/offline";
import { PATTERN_FLOW } from "@/domain/patterns";
import { resolveTimeZone } from "@/domain/time";
import { getLocale, getTranslations } from "@/i18n/server";
import { checkAiAllowance } from "@/lib/ai/allowance";
import { createAiRuntime } from "@/lib/ai/factory";
import { createSupabaseRecorder, logAppError } from "@/lib/ai/ledger";
import type { AnalyticsEventName, EventPayload } from "@/lib/analytics/events";
import { SupabaseEventsSink, track } from "@/lib/analytics/track";
import { currentInstant } from "@/lib/clock/now";
import { insertOfferedExperiment, loadExperiments, skipExperiment, startExperiment, upgradeOfferedWording } from "@/lib/experiments/repo";
import { produceExperimentWording } from "@/lib/experiments/word";
import { loadFirstWeekSummary } from "@/lib/firstWeek/load";
import { loadOfflinePeriods } from "@/lib/home/load";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { syncPatternEvidence } from "@/lib/patterns/sync";
import { openFirstWeekActionContext, selectLiveExperiment } from "../_lib/gate";

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;

const EXPERIMENT_ROUTE = `${FIRST_WEEK_ROUTES.summary}/experiment`;
/** Where a refused write lands: the screen the person pressed on, which shows one calm note. */
const failedAt = (route: string) => `${route}?${FIRST_WEEK_QUERY.failed}=1`;

/** Product events never block or break an action; each is stamped with the action's own instant. */
async function emit(context: ReadyContext, name: AnalyticsEventName, payload: EventPayload, now: Date): Promise<void> {
  try {
    await track(new SupabaseEventsSink(context.supabase), name, payload, now);
  } catch {
    // Analytics must never change where the person lands.
  }
}

/**
 * The gates the three actions share. Not configured, signed out and unfinished onboarding redirect inside
 * `openFirstWeekActionContext`; a database that cannot be reached, any other lifecycle and a switched-off piece end
 * at Home or the summary with nothing written. The user id is the session's; no form field is ever read.
 */
async function openExperimentActionContext(): Promise<ReadyContext> {
  const opened = await openFirstWeekActionContext();
  if (opened.kind === "unavailable") redirect(FIRST_WEEK_ROUTES.summary);
  const { context } = opened;
  if (context.row.lifecycle_state !== "FIRST_WEEK") redirect("/");
  if (!FIRST_WEEK_FLOW.summaryEnabled || !PATTERN_FLOW.experimentEnabled) redirect("/");
  return context;
}

/**
 * "Let's choose together" on the summary: the only place the AI can be called, behind an explicit press. The order
 * is the safety: every gate and the offline check first (no AI and no write), the live re-check of the offer, the
 * evidence sync, and the OFFERED row with the LIBRARY sentence inserted BEFORE any AI call. A double tap, a second
 * tab or a press that overlaps a still-running call finds that row (`created: false`) and makes no AI call, no
 * upgrade and no event; a request killed mid-call leaves the approved sentence in place. The AI only rewords that
 * sentence and any failure keeps it (the orchestrator never throws).
 */
export async function proposeFirstExperimentAction(): Promise<void> {
  const context = await openExperimentActionContext();
  const { supabase, userId } = context;

  const now = currentInstant();
  const timeZone = resolveTimeZone(context.row.timezone);

  // Not while the app is quiet (Shabbat, a holiday): the same rule the meal flow uses. Unknown periods are not quiet.
  const periods = await loadOfflinePeriods(supabase, userId, now);
  if (periods && isOffline(periods, now)) redirect("/");

  const loaded = await loadFirstWeekSummary(context, now);
  if (loaded.kind === "not_first_week") redirect("/");
  if (loaded.kind === "unavailable" || loaded.kind === "not_ready") redirect(FIRST_WEEK_ROUTES.summary);

  const { selection } = loaded.experiment;
  // Already offered or started: B5 shows it. Nothing is written and nothing is asked of the AI.
  if (selection.kind === "PENDING" || selection.kind === "ACTIVE") redirect(EXPERIMENT_ROUTE);
  if (selection.kind !== "OFFER") redirect(FIRST_WEEK_ROUTES.summary);

  const signal = loaded.signal;
  if (signal === null || signal.view === "REJECTED") redirect(FIRST_WEEK_ROUTES.summary);

  // The approved sentence: the library text of the engine's key and variant in the current locale.
  const [locale, tLibrary] = await Promise.all([getLocale(), getTranslations("interventions")]);
  const approvedText = tLibrary(`${selection.key}.${selection.variantId}`, { ...selection.params });

  const synced = await syncPatternEvidence(supabase, { occurrences: signal.occurrences, view: signal.view });
  if (!synced.ok) redirect(failedAt(FIRST_WEEK_ROUTES.summary));

  const inserted = await insertOfferedExperiment(supabase, {
    patternId: synced.patternId,
    key: selection.key,
    variantId: selection.variantId,
    libraryText: approvedText,
    locale,
  });
  if (!inserted.ok) redirect(failedAt(FIRST_WEEK_ROUTES.summary));
  // A double tap, a second tab or an earlier press still waiting for the AI: its offer stands, this press does nothing more.
  if (!inserted.value.created) redirect(EXPERIMENT_ROUTE);

  const outcome = await produceExperimentWording(
    {
      runtime: createAiRuntime({ recorder: createSupabaseRecorder({ userId }) }),
      supabase,
      userId,
      now,
      timeZone,
      checkAllowance: checkAiAllowance,
      logError: logAppError,
    },
    {
      offer: { key: selection.key, variantId: selection.variantId, scope: selection.scope },
      approvedText,
      locale,
      signal: {
        view: signal.view,
        occurrences: signal.occurrences.length,
        distinctDays: new Set(signal.occurrences.map((o) => o.localDay)).size,
      },
      availableDays: loaded.progress.availableDays,
    },
  );

  // What is STORED decides what is reported: "ai" only if the upgrade really changed the row.
  let storedSource: "ai" | "library" = "library";
  if (outcome.source === "ai") {
    const upgraded = await upgradeOfferedWording(supabase, userId, { text: outcome.text, locale });
    if (upgraded.ok && upgraded.value.changed) storedSource = "ai";
  }

  const gate = outcome.source === "library" && isWordingGateReason(outcome.reason) ? outcome.reason : "open";
  await emit(context, "experiment_offered", { source: storedSource, gate }, now);
  // A closed gate is not a failure: only an AI attempt that did not produce a usable sentence is reported.
  if (outcome.source === "library" && !isWordingGateReason(outcome.reason)) {
    await emit(context, "experiment_wording_fallback", { reason: outcome.reason }, now);
  }

  revalidatePath("/", "layout");
  redirect(EXPERIMENT_ROUTE);
}

/**
 * "I'll try": OFFERED to ACTIVE, once. The person's single open row comes from the database and is re-checked
 * against the live meals (the same selection the B5 page makes), so an idea whose evidence was deleted meanwhile
 * cannot be started from a stale tab. Nothing is read from the form.
 */
export async function startFirstExperimentAction(): Promise<void> {
  const context = await openExperimentActionContext();
  const { supabase, userId } = context;

  const now = currentInstant();
  const experiments = await loadExperiments(supabase, userId);
  if (experiments === null) redirect(failedAt(EXPERIMENT_ROUTE));
  const open = experiments.open;
  if (open === null || open.status !== "OFFERED") redirect(FIRST_WEEK_ROUTES.summary);

  const live = await selectLiveExperiment(context, experiments.facts, now);
  if (live.selection.kind !== "PENDING" || live.selection.experimentId !== open.id) redirect(FIRST_WEEK_ROUTES.summary);

  const started = await startExperiment(supabase, userId, now);
  if (!started.ok) redirect(failedAt(EXPERIMENT_ROUTE));
  // Already started, skipped or gone (a double tap, another tab): B5 shows how it stands, and no second event.
  if (started.value.changed) await emit(context, "experiment_started", { source: open.source }, now);

  revalidatePath("/", "layout");
  redirect(EXPERIMENT_ROUTE);
}

/** "Not this time": OFFERED to SKIPPED, once. The offer returns only after the library's cooldown. Nothing is read from the form. */
export async function skipFirstExperimentAction(): Promise<void> {
  const context = await openExperimentActionContext();
  const { supabase, userId } = context;

  const now = currentInstant();
  const experiments = await loadExperiments(supabase, userId);
  if (experiments === null) redirect(failedAt(EXPERIMENT_ROUTE));
  const open = experiments.open;
  if (open === null || open.status !== "OFFERED") redirect(FIRST_WEEK_ROUTES.summary);

  const skipped = await skipExperiment(supabase, userId, now);
  if (!skipped.ok) redirect(failedAt(EXPERIMENT_ROUTE));
  if (skipped.value.changed) await emit(context, "experiment_skipped", { source: open.source }, now);

  revalidatePath("/", "layout");
  redirect(FIRST_WEEK_ROUTES.summary);
}
