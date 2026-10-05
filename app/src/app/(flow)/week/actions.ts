"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isWordingGateReason } from "@/domain/experiments/wording";
import { isOffline } from "@/domain/offline";
import {
  effectivePatternStatus,
  feedbackFromAnswer,
  type PatternRow,
} from "@/domain/patterns";
import { resolveTimeZone } from "@/domain/time";
import {
  WEEKLY_FLOW,
  WEEKLY_QUERY,
  WEEKLY_ROUTES,
  WEEKLY_SNOOZE,
  resultFromAnswer,
  weeklyCardPrecheck,
} from "@/domain/weekly";
import { WEEKLY_LINE_GATE_REASONS } from "@/domain/weekly/wording";
import { getLocale, getTranslations } from "@/i18n/server";
import { checkAiAllowance } from "@/lib/ai/allowance";
import { createAiRuntime } from "@/lib/ai/factory";
import { createSupabaseRecorder, logAppError } from "@/lib/ai/ledger";
import type { AnalyticsEventName, EventPayload } from "@/lib/analytics/events";
import { SupabaseEventsSink, track } from "@/lib/analytics/track";
import { currentInstant } from "@/lib/clock/now";
import { insertOfferedExperiment, skipExperiment, startExperiment, upgradeOfferedWording } from "@/lib/experiments/repo";
import { produceExperimentWording, type WordingOutcome } from "@/lib/experiments/word";
import { loadOfflinePeriods } from "@/lib/home/load";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { recordPatternFeedback } from "@/lib/patterns/feedback";
import { syncPatternEvidence, type SyncResult } from "@/lib/patterns/sync";
import { loadWeeklyStory, type WeeklyStoryLoad } from "@/lib/weekly/load";
import { openWeeklyStory, upgradeWeeklyLine } from "@/lib/weekly/open";
import { recordExperimentResult } from "@/lib/weekly/result";
import { produceWeeklyLineWording, type WeeklyLineOutcome } from "@/lib/weekly/word";
import { openWeeklyActionContext } from "./_lib/gate";

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;
type ReadyStory = Extract<WeeklyStoryLoad, { kind: "ready" }>;

const WEEK = WEEKLY_ROUTES.week;
/** Where a refused write lands: the screen the person pressed on, which shows one calm note. */
const FAILED = `${WEEK}?${WEEKLY_QUERY.failed}=1`;

/** Product events never block or break an action; each is stamped with the action's own instant. */
async function emit(context: ReadyContext, name: AnalyticsEventName, payload: EventPayload, now: Date): Promise<void> {
  try {
    await track(new SupabaseEventsSink(context.supabase), name, payload, now);
  } catch {
    // Analytics must never change where the person lands.
  }
}

/**
 * What every action except the snooze starts with, in this order: the gate (not set up, signed out, unfinished onboarding, any
 * other lifecycle and a switched-off feature end as redirects; an unreachable database ends at the page's note), ONE read of the
 * clock, the offline refusal (the app is quiet on Shabbat and holidays: fail closed when the periods cannot be read, zero
 * writes), and the LIVE story. The action then checks its own precondition against that fresh decision, never against what a
 * form carried. Every exit is a redirect, so the caller continues only with a ready story.
 */
async function prologue(): Promise<{ context: ReadyContext; now: Date; loaded: ReadyStory }> {
  const opened = await openWeeklyActionContext();
  if (opened.kind === "unavailable") redirect(FAILED);
  const { context } = opened;

  const now = currentInstant();

  const periods = await loadOfflinePeriods(context.supabase, context.userId, now);
  if (periods === null) redirect(FAILED);
  if (isOffline(periods, now)) redirect("/");

  const loaded = await loadWeeklyStory(context, now);
  if (loaded.kind === "not_weekly_cycle" || loaded.kind === "not_ready") redirect("/");
  if (loaded.kind === "unavailable") redirect(WEEK);
  return { context, now, loaded };
}

/**
 * "To my week" on the Home card: the press that opens the week. The row is inserted FIRST (`on conflict do nothing`): the call
 * that created it is the only one that records the event and may ask the AI, so a double tap, a stale card or a second tab
 * finds the row (`created: false`) and does nothing more. The AI path exists for a LEARN week only (its gate also checks that):
 * the one fixed catalog sentence may be reworded, and any failure keeps the catalog sentence.
 */
export async function openWeeklyStoryAction(): Promise<void> {
  const { context, now, loaded } = await prologue();
  const { supabase, userId } = context;
  const { story, moment } = loaded;

  const opened = await openWeeklyStory(supabase, { userId, weekStart: moment.week.weekStart, mode: story.mode, now });
  if (!opened.ok) redirect(FAILED);
  // Already opened (a second press, an old card): the page shows it as it stands. No AI call and no event.
  if (!opened.value.created) redirect(WEEK);

  await emit(context, "weekly_summary_viewed", { mode: story.mode }, now);

  if (WEEKLY_FLOW.aiLineEnabled && story.mode === "LEARN") {
    const [locale, t] = await Promise.all([getLocale(), getTranslations("weekly")]);
    const approvedText = t(`line.${story.lineKey}`);
    let outcome: WeeklyLineOutcome;
    try {
      outcome = await produceWeeklyLineWording(
        {
          runtime: createAiRuntime({ recorder: createSupabaseRecorder({ userId }) }),
          supabase,
          userId,
          now,
          timeZone: resolveTimeZone(context.row.timezone),
          checkAllowance: checkAiAllowance,
          logError: logAppError,
        },
        { mode: story.mode, lineKey: story.lineKey, approvedText, locale, availableDays: loaded.availableDays },
      );
    } catch {
      // The orchestrator never throws; if something around it does, the catalog sentence stands and the press still lands.
      outcome = { source: "catalog", text: approvedText, reason: "provider_failed" };
    }

    if (outcome.source === "ai") {
      // A failed upgrade just keeps the catalog sentence: nothing else depends on it.
      await upgradeWeeklyLine(supabase, {
        userId,
        weekStart: moment.week.weekStart,
        line: { text: outcome.text, locale, mode: "LEARN", key: "learn" },
      });
    } else if (!WEEKLY_LINE_GATE_REASONS.some((reason) => reason === outcome.reason)) {
      // A closed gate is not a failure: only an AI attempt that did not produce a usable sentence is reported.
      await emit(context, "weekly_line_wording_fallback", { reason: outcome.reason }, now);
    }
  }

  revalidatePath("/", "layout");
  redirect(WEEK);
}

/**
 * "Not now" on the Home card: one append-only event, and the card stays away for 24 hours (the quiet link stays). Nothing is
 * read from the form and no data is read at all: hiding a card is harmless, so only the pure card window is checked. A failed
 * write simply leaves the card where it was.
 */
export async function snoozeWeeklyCardAction(): Promise<void> {
  const opened = await openWeeklyActionContext();
  if (opened.kind === "unavailable") redirect("/");
  const { context } = opened;

  const now = currentInstant();
  const precheck = weeklyCardPrecheck({ now, timeZone: resolveTimeZone(context.row.timezone), aggregatedReportConfirmedAt: null });
  if (precheck === null) redirect("/");

  await emit(context, WEEKLY_SNOOZE.event, { week: precheck.week.weekStart }, now);

  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * One of the three answers to "does that sound right". It reads ONLY the field `answer`; the pattern, its level and the user
 * come from the live data and the session. The evidence is synced first, with the level the pattern WILL have once this answer
 * is stored (the First Week's order), and "not related" syncs an EMPTY set before the row is marked rejected. Any failure ends
 * at the page's note with nothing more written.
 */
export async function answerWeeklyPatternAction(formData: FormData): Promise<void> {
  const answer = feedbackFromAnswer(formData.get("answer"));
  if (answer === null) redirect(WEEK);

  const { context, now, loaded } = await prologue();
  if (!WEEKLY_FLOW.patternQuestionEnabled || loaded.story.patternQuestion.kind !== "ASK") redirect(WEEK);
  // The question was about the live signal; without it (an unreadable evening read) there is nothing to answer.
  const signal = loaded.signal;
  if (signal === null) redirect(WEEK);
  const { supabase } = context;

  let synced: SyncResult;
  if (answer === "reject") {
    synced = await syncPatternEvidence(supabase, { occurrences: [], view: "NONE" });
  } else {
    // The row as it will be after this press: the answer and its time decide whether a "Sounds right" counts.
    const after: PatternRow = {
      id: signal.row?.id ?? "",
      status: signal.row?.status ?? "OBSERVATION",
      feedback: answer,
      feedbackAt: now,
    };
    const view = effectivePatternStatus({
      occurrences: signal.occurrences.map((o) => o.occurredAt),
      timeZone: resolveTimeZone(context.row.timezone),
      row: after,
    });
    if (view === "REJECTED") redirect(WEEK);
    synced = await syncPatternEvidence(supabase, { occurrences: signal.occurrences, view });
  }
  if (!synced.ok) redirect(FAILED);

  const recorded = await recordPatternFeedback(supabase, { patternId: synced.patternId, feedback: answer, now });
  if (!recorded.ok) redirect(FAILED);

  await emit(context, "pattern_question_answered", { answer, level: "CANDIDATE" }, now);

  revalidatePath("/", "layout");
  redirect(WEEK);
}

/**
 * One of the five answers to "how was the small experiment". It reads ONLY the field `result`. Asked only while the live
 * decision says the result is due; the single ACTIVE row is addressed by the database (no id from the form), so a stale tab or
 * a double press changes nothing the second time and emits nothing. "I did not get to try" is an answer like the others.
 */
export async function answerExperimentResultAction(formData: FormData): Promise<void> {
  const result = resultFromAnswer(formData.get("result"));
  if (result === null) redirect(WEEK);

  const { context, now, loaded } = await prologue();
  if (loaded.experiment.decision.kind !== "RESULT_DUE") redirect(WEEK);

  const recorded = await recordExperimentResult(context.supabase, context.userId, { result, now });
  if (!recorded.ok) redirect(FAILED);
  if (recorded.value.changed) await emit(context, "experiment_completed", { result, source: recorded.value.source }, now);

  revalidatePath("/", "layout");
  redirect(WEEK);
}

/**
 * "Let's choose together": the only place the AI can be called for an experiment, behind an explicit press. The order is the
 * safety (the First Week's): the live re-check of the offer, the evidence sync (a pattern-led offer only), then the OFFERED row
 * with the LIBRARY sentence inserted BEFORE any AI call. A double tap, a second tab or a press that overlaps a still-running
 * call finds that row and makes no AI call, no upgrade and no event; a request killed mid-call leaves the approved sentence
 * in place. The AI only rewords a pattern-led sentence, and a goal-led starter is called with the NONE signal so its own gate
 * answers `pattern_not_established`: starters never reach the AI. A starter creates no pattern row.
 */
export async function proposeWeeklyExperimentAction(): Promise<void> {
  const { context, now, loaded } = await prologue();
  const { supabase, userId } = context;

  const decision = loaded.experiment.decision;
  // Pending, active, due or nothing to offer: the page shows how it stands. Nothing is written and nothing is asked of the AI.
  if (decision.kind !== "OFFER") redirect(WEEK);

  const signal = loaded.signal;
  if (decision.origin === "pattern" && (signal === null || signal.view === "REJECTED")) redirect(WEEK);

  // The approved sentence: the library text of the engine's key and variant in the current locale.
  const [locale, tLibrary] = await Promise.all([getLocale(), getTranslations("interventions")]);
  const approvedText = tLibrary(`${decision.key}.${decision.variantId}`, { ...decision.params });

  let patternId: string | null = null;
  if (decision.origin === "pattern" && signal !== null && signal.view !== "REJECTED") {
    const synced = await syncPatternEvidence(supabase, { occurrences: signal.occurrences, view: signal.view });
    if (!synced.ok) redirect(FAILED);
    patternId = synced.patternId;
  }

  const inserted = await insertOfferedExperiment(supabase, {
    patternId,
    key: decision.key,
    variantId: decision.variantId,
    libraryText: approvedText,
    locale,
  });
  if (!inserted.ok) redirect(FAILED);
  // A double tap, a second tab or an earlier press still waiting for the AI: its offer stands, this press does nothing more.
  if (!inserted.value.created) redirect(WEEK);

  const patternLed = decision.origin === "pattern" && signal !== null;
  let outcome: WordingOutcome;
  try {
    outcome = await produceExperimentWording(
      {
        runtime: createAiRuntime({ recorder: createSupabaseRecorder({ userId }) }),
        supabase,
        userId,
        now,
        timeZone: resolveTimeZone(context.row.timezone),
        checkAllowance: checkAiAllowance,
        logError: logAppError,
      },
      {
        offer: { key: decision.key, variantId: decision.variantId, scope: decision.scope },
        approvedText,
        locale,
        signal: patternLed
          ? {
              view: signal.view,
              occurrences: signal.occurrences.length,
              distinctDays: new Set(signal.occurrences.map((o) => o.localDay)).size,
            }
          : { view: "NONE", occurrences: 0, distinctDays: 0 },
        availableDays: loaded.availableDays,
      },
    );
  } catch {
    // The orchestrator never throws; if something around it does, the offer stays with the approved sentence.
    outcome = { source: "library", text: approvedText, reason: "provider_failed" };
  }

  // What is STORED decides what is reported: "ai" only if the upgrade really changed the row.
  let storedSource: "ai" | "library" = "library";
  if (outcome.source === "ai") {
    const upgraded = await upgradeOfferedWording(supabase, userId, { text: outcome.text, locale });
    if (upgraded.ok && upgraded.value.changed) storedSource = "ai";
  }

  const gate = outcome.source === "library" && isWordingGateReason(outcome.reason) ? outcome.reason : "open";
  await emit(context, "experiment_offered", { source: storedSource, gate, origin: decision.origin }, now);
  // A closed gate is not a failure: only an AI attempt that did not produce a usable sentence is reported.
  if (outcome.source === "library" && !isWordingGateReason(outcome.reason)) {
    await emit(context, "experiment_wording_fallback", { reason: outcome.reason }, now);
  }

  revalidatePath("/", "layout");
  redirect(WEEK);
}

/**
 * "I'll try": OFFERED to ACTIVE, once. Only while the live decision says an idea is waiting, and only for the very row the
 * page shows. Nothing is read from the form: the person's single open row comes from the database.
 */
export async function startWeeklyExperimentAction(): Promise<void> {
  const { context, now, loaded } = await prologue();
  const { decision, open } = loaded.experiment;
  if (decision.kind !== "PENDING" || open === null || open.status !== "OFFERED" || open.id !== decision.experimentId) redirect(WEEK);

  const started = await startExperiment(context.supabase, context.userId, now);
  if (!started.ok) redirect(FAILED);
  // Already started, skipped or gone (a double tap, another tab): the page shows how it stands, and no second event.
  if (started.value.changed) await emit(context, "experiment_started", { source: open.source, origin: open.origin }, now);

  revalidatePath("/", "layout");
  redirect(WEEK);
}

/** "Not this time": OFFERED to SKIPPED, once. The offer returns only after the library's cooldown. Nothing is read from the form. */
export async function skipWeeklyExperimentAction(): Promise<void> {
  const { context, now, loaded } = await prologue();
  const { decision, open } = loaded.experiment;
  if (decision.kind !== "PENDING" || open === null || open.status !== "OFFERED" || open.id !== decision.experimentId) redirect(WEEK);

  const skipped = await skipExperiment(context.supabase, context.userId, now);
  if (!skipped.ok) redirect(FAILED);
  if (skipped.value.changed) await emit(context, "experiment_skipped", { source: open.source, origin: open.origin }, now);

  revalidatePath("/", "layout");
  redirect(WEEK);
}
