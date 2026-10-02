"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FIRST_WEEK_FLOW, FIRST_WEEK_QUERY, FIRST_WEEK_ROUTES, FIRST_WEEK_SNOOZE, type FirstWeekSnoozeCard } from "@/domain/firstWeekFlow";
import {
  PATTERN_FLOW,
  decideEarlySignal,
  effectivePatternStatus,
  feedbackFromAnswer,
  type PatternRow,
} from "@/domain/patterns";
import { resolveTimeZone } from "@/domain/time";
import type { AnalyticsEventName, EventPayload } from "@/lib/analytics/events";
import { SupabaseEventsSink, track } from "@/lib/analytics/track";
import { currentInstant } from "@/lib/clock/now";
import { skipExperiment } from "@/lib/experiments/repo";
import { completeFirstWeek } from "@/lib/firstWeek/complete";
import { loadFirstWeekSummary } from "@/lib/firstWeek/load";
import { recordPatternFeedback } from "@/lib/patterns/feedback";
import { loadLateEveningSignal } from "@/lib/patterns/load";
import { syncPatternEvidence, type SyncResult } from "@/lib/patterns/sync";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { openFirstWeekActionContext } from "./_lib/gate";

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;

/**
 * Product events never block or break an action, and each carries the action's own instant as the event time (the
 * snooze reader depends on it: a row stamped with the real time under a past clock would be "in the future").
 */
async function emit(context: ReadyContext, name: AnalyticsEventName, payload: EventPayload, now: Date): Promise<void> {
  try {
    await track(new SupabaseEventsSink(context.supabase), name, payload, now);
  } catch {
    // Analytics must never change where the person lands.
  }
}

const isSnoozeCard = (value: unknown): value is FirstWeekSnoozeCard =>
  FIRST_WEEK_SNOOZE.cards.some((card) => card === value);

/**
 * "Let's continue" on the summary: the one irreversible step of the item (FIRST_WEEK to WEEKLY_CYCLE). It takes
 * nothing from the form, so nothing can be forged; the user id is the verified session's. Everything is checked
 * again here (a page guard does not protect a direct POST), the rules are recomputed from the live data, and only
 * then is the one conditional update made. The ending is always a redirect.
 */
export async function finishFirstWeekAction(): Promise<void> {
  const opened = await openFirstWeekActionContext();
  // The database cannot be reached: the summary page shows its own calm card.
  if (opened.kind === "unavailable") redirect(FIRST_WEEK_ROUTES.summary);
  const { context } = opened;

  if (context.row.lifecycle_state !== "FIRST_WEEK") redirect("/");
  if (!FIRST_WEEK_FLOW.summaryEnabled) redirect("/");

  const now = currentInstant();
  const loaded = await loadFirstWeekSummary(context, now);
  // The rules do not say ready (meals deleted meanwhile, a typed URL): nothing is written.
  if (loaded.kind === "not_first_week" || loaded.kind === "not_ready") redirect("/");
  if (loaded.kind === "unavailable") redirect(FIRST_WEEK_ROUTES.summary);

  const done = await completeFirstWeek(context.supabase, context.userId, now);
  if (!done.ok) redirect(`${FIRST_WEEK_ROUTES.summary}?${FIRST_WEEK_QUERY.failed}=1`);

  // This call or another one won: either way an offer nobody answered can no longer be answered from the app, and the
  // one-open-experiment index must stay free. A failure changes nothing (the transition already happened).
  try {
    await skipExperiment(context.supabase, context.userId, now);
  } catch {
    // Best effort.
  }

  // Only the call that changed the row tells the world, so the event exists once.
  if (done.transitioned) {
    await emit(
      context,
      "first_week_completed",
      {
        reason: loaded.reason,
        had_enough_data: loaded.hadEnoughData,
        available_days: loaded.progress.availableDays,
        confirmed_meals: loaded.progress.confirmedMeals,
      },
      now,
    );
  }

  // Home is now the plain clock Home of the weekly cycle.
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * "Not now" on the summary or on a Home card: one append-only, content-free event, and the card stays away for 24
 * hours. The only field read is the card name, checked against the closed list; the rules are not re-evaluated
 * (hiding a card is harmless). A failed write simply leaves the card visible.
 */
export async function snoozeFirstWeekCardAction(formData: FormData): Promise<void> {
  const card = formData.get(FIRST_WEEK_SNOOZE.field);
  if (!isSnoozeCard(card)) redirect("/");

  const opened = await openFirstWeekActionContext();
  if (opened.kind === "unavailable") redirect("/");
  const { context } = opened;
  if (context.row.lifecycle_state !== "FIRST_WEEK") redirect("/");

  await emit(context, FIRST_WEEK_SNOOZE.event, { card }, currentInstant());

  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * One of the three answers on the Early Signal card. It reads ONLY the field `answer`; the pattern, its status and
 * the user come from the live data and the session. The card is re-checked against the live signal (a stale card, a
 * double press or an unknown read ends at Home with nothing written). The evidence is synced first, with the level
 * the pattern WILL have once this answer is stored, so the stored mirror is right at once; "not related" syncs an
 * EMPTY set (the person who said no leaves no evidence about the evening behind) and then marks the row rejected.
 */
export async function answerEarlySignalAction(formData: FormData): Promise<void> {
  const answer = feedbackFromAnswer(formData.get("answer"));
  if (answer === null) redirect("/");

  const opened = await openFirstWeekActionContext();
  if (opened.kind === "unavailable") redirect("/");
  const { context } = opened;
  if (context.row.lifecycle_state !== "FIRST_WEEK" || !PATTERN_FLOW.earlySignalEnabled) redirect("/");

  const now = currentInstant();
  const timeZone = resolveTimeZone(context.row.timezone);
  const signal = await loadLateEveningSignal(context.supabase, context.userId, timeZone, now);
  if (signal === null || !decideEarlySignal({ view: signal.view, row: signal.row, now }).due) redirect("/");

  let synced: SyncResult;
  if (answer === "reject") {
    synced = await syncPatternEvidence(context.supabase, { occurrences: [], view: "NONE" });
  } else {
    // The row as it will be after this press: the answer and its time decide whether a "Sounds right" counts.
    const after: PatternRow = {
      id: signal.row?.id ?? "",
      status: signal.row?.status ?? "OBSERVATION",
      feedback: answer,
      feedbackAt: now,
    };
    const view = effectivePatternStatus({ occurrences: signal.occurrences.map((o) => o.occurredAt), timeZone, row: after });
    if (view === "REJECTED") redirect("/");
    synced = await syncPatternEvidence(context.supabase, { occurrences: signal.occurrences, view });
  }
  if (!synced.ok) redirect("/");

  const recorded = await recordPatternFeedback(context.supabase, { patternId: synced.patternId, feedback: answer, now });
  if (!recorded.ok) redirect("/");

  await emit(context, "early_signal_answered", { answer }, now);

  revalidatePath("/", "layout");
  redirect("/");
}
