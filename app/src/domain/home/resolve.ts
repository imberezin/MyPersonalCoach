import { decideFirstWeekStep, welcomeBackDue } from "../firstWeekFlow/progress";
import { FIRST_WEEK_FLOW } from "../firstWeekFlow/types";
import { isOffline, type OfflinePeriod } from "../offline";
import { LATE_EVENING, PATTERN_FLOW } from "../patterns/types";
import { isQuiet } from "../quietHours";
import { localMinuteOfDay, resolveTimeZone } from "../time";
import { WEIGHT_FLOW } from "../weight/types";
import {
  HOME_FEATURES,
  HOME_TIMING,
  type HomeAction,
  type HomeCopyKey,
  type HomeDecision,
  type HomeFacts,
  type HomeState,
} from "./types";

/**
 * The window the loader must cover: [now - motzeiShabbatWindowMs, now + beforeShabbatLeadMs].
 * A period is relevant when `end_at > from` AND `start_at <= to` (it overlaps the window), so a
 * multi-day period that began long ago is still found.
 */
export function homePeriodsWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - HOME_TIMING.motzeiShabbatWindowMs),
    to: new Date(now.getTime() + HOME_TIMING.beforeShabbatLeadMs),
  };
}

// `resolveTimeZone` lives in ../time (below home/, firstWeekFlow/ and patterns/, so none of them imports another to
// reach it). It is re-exported here because the loader, `homeCopyFor` and the AI allowance import it from this module.
export { resolveTimeZone } from "../time";

/** True when `now - renderedAt >= staleAfterMs`. Pure; both arguments are epoch ms on the SAME (client) clock. */
export function isHomeStale(renderedAt: number, now: number, staleAfterMs: number): boolean {
  // A clock that went backwards is never stale.
  return now >= renderedAt && now - renderedAt >= staleAfterMs;
}

/** The period that is in progress. A holiday that falls on Shabbat is still Shabbat for the user. */
function periodInProgress(periods: readonly OfflinePeriod[], now: Date): OfflinePeriod | undefined {
  const active = periods.filter((p) => isOffline([p], now));
  return active.find((p) => p.type === "SHABBAT") ?? active[0];
}

/** The SHABBAT period that starts within the lead, [start - lead, start). The earliest start wins. */
function shabbatStartingSoon(periods: readonly OfflinePeriod[], now: Date): OfflinePeriod | undefined {
  const t = now.getTime();
  let found: OfflinePeriod | undefined;
  for (const p of periods) {
    const start = p.start.getTime();
    if (p.type !== "SHABBAT" || t < start - HOME_TIMING.beforeShabbatLeadMs || t >= start) continue;
    if (!found || start < found.start.getTime()) found = p;
  }
  return found;
}

/** The SHABBAT period that ended within the window, [end, end + window). The latest end wins. */
function shabbatJustEnded(periods: readonly OfflinePeriod[], now: Date): OfflinePeriod | undefined {
  const t = now.getTime();
  let found: OfflinePeriod | undefined;
  for (const p of periods) {
    const end = p.end.getTime();
    if (p.type !== "SHABBAT" || t < end || t >= end + HOME_TIMING.motzeiShabbatWindowMs) continue;
    if (!found || end > found.end.getTime()) found = p;
  }
  return found;
}

/**
 * True when the person has not yet made the report the current phase is waiting for. FIRST_WEEK: no confirmed meal (a weight
 * does not end the invitation: the First Week exists to learn eating habits). Otherwise, and when the First Week facts are
 * unknown: no report of any kind; an unknown fact (null) is never "no report yet".
 */
function noFirstReportYet(f: HomeFacts): boolean {
  // confirmedMeals = min(meals read, 10): zero exactly when there is no meal.
  if (f.lifecycle === "FIRST_WEEK" && f.firstWeek !== null) return f.firstWeek.confirmedMeals === 0;
  return f.hasAnyReport === false;
}

function resolveState(facts: HomeFacts, timeZone: string): HomeState {
  const { now, offlinePeriods: periods, lifecycle, firstWeekSnoozed } = facts;
  const inFirstWeek = lifecycle === "FIRST_WEEK";

  // Without the periods Shabbat is unknown: rules 1-3 are skipped and the clock decides alone.
  if (periods) {
    const inProgress = periodInProgress(periods, now);
    if (inProgress) return { key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: inProgress.type };

    const coming = shabbatStartingSoon(periods, now);
    if (coming) return { key: "BEFORE_SHABBAT", candleLighting: coming.start };

    const ended = shabbatJustEnded(periods, now);
    if (ended) return { key: "MOTZEI_SHABBAT", havdalah: ended.end };
  }

  // The First Week cards. Every one needs lifecycle FIRST_WEEK and a loaded fact: an unknown fact is silence, so
  // another lifecycle (or a stale non-null fact) can never create one of them. The step the rules are at is derived
  // from live counts here, never stored.
  const step = inFirstWeek && facts.firstWeek !== null ? decideFirstWeekStep(facts.firstWeek) : null;
  const summaryReady = FIRST_WEEK_FLOW.summaryEnabled && step?.kind === "SUMMARY_READY";

  // The summary and the welcome-back are about the person's week and each carries its own "Not now".
  // The summary beats the welcome-back (decideFirstWeekStep), and both beat B1.
  if (summaryReady && step?.kind === "SUMMARY_READY" && !firstWeekSnoozed.summary) {
    return { key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: step.hadEnoughData };
  }
  // Decided from the counts, not from `step`: with the summary switched off, `step` would still say SUMMARY_READY
  // and hide the welcome-back that its own switch allows. A summary that is ready but snoozed still beats it.
  const summaryDue = step?.kind === "SUMMARY_READY";
  if (
    FIRST_WEEK_FLOW.welcomeBackEnabled &&
    inFirstWeek &&
    facts.firstWeek !== null &&
    !(FIRST_WEEK_FLOW.summaryEnabled && summaryDue) &&
    welcomeBackDue(facts.firstWeek) &&
    !firstWeekSnoozed.welcomeBack
  ) {
    return { key: "FIRST_WEEK_WELCOME_BACK" };
  }

  // A landmark was reached: a rare and welcome moment, so it outranks the optional Early Signal question and the clock
  // sentences. It yields to the Shabbat states above (the quiet principle) and to the two First Week cards, which are
  // time-bound and carry a "Not now", so an unanswered celebration (it lasts up to 14 days) can never starve the summary. It
  // is independent of the lifecycle (a weight can be reported in FIRST_WEEK and in WEEKLY_CYCLE), has no quiet-hours rule
  // (it is not a question or a notification: the person opened the screen) and ends with its own "Thanks".
  // (`?? null`: the resolver is total, so a caller that predates this fact reads it as "no moment" instead of throwing.)
  const moment = facts.milestone ?? null;
  if (WEIGHT_FLOW.milestoneMomentEnabled && moment !== null) {
    return { key: "MILESTONE_REACHED", week: moment.week, isGoal: moment.isGoal };
  }

  const minute = localMinuteOfDay(now, timeZone);

  // B4 Early Signal: a smaller, optional question. It sits below the two cards above (an unanswered B4 must not hide
  // the summary forever) and above the clock states. Shown only when the data says it is due, the quiet hours are
  // KNOWN and the clock is outside them, and before the signal's own hours: pointing at the evening during the
  // evening would read as a remark about what the person is doing now.
  const earlySignalShown =
    PATTERN_FLOW.earlySignalEnabled &&
    inFirstWeek &&
    facts.earlySignal?.due === true &&
    facts.quietHours !== null &&
    !isQuiet(facts.quietHours, minute) &&
    minute < LATE_EVENING.startMinute;
  if (earlySignalShown) return { key: "EARLY_SIGNAL", signal: LATE_EVENING.kind };

  // B1 First Week Start: no meal reported yet. It is content on the screen, not a notification, so it
  // holds at any hour. Only a known "no report" counts (null is unknown; a weight does not count, see noFirstReportYet),
  // only in FIRST_WEEK (a person who deleted every meal after the transition is never sent back to "our first week"),
  // only while the invitation is switched on (its one button is that invitation), and never in place of a summary that
  // is ready but snoozed.
  if (HOME_FEATURES.firstReportInvitation && inFirstWeek && noFirstReportYet(facts) && !summaryReady) {
    return { key: "FIRST_WEEK_START" };
  }

  // The windows above use stored instants, so a DST day cannot move them. Only these two cut-offs
  // are wall-clock times.
  if (minute >= HOME_TIMING.eveningStartMinute) return { key: "EVENING" };
  if (minute >= HOME_TIMING.morningStartMinute && minute < HOME_TIMING.morningEndMinute) return { key: "MORNING" };
  return { key: "SILENCE", reason: "NOTHING_TO_SAY" };
}

/** Only these states may carry the first-report invitation. Exhaustive: a new state must be decided here. */
function invitesFirstReport(state: HomeState): boolean {
  switch (state.key) {
    case "MORNING":
    case "EVENING":
    case "BEFORE_SHABBAT":
    case "MOTZEI_SHABBAT":
    case "FIRST_WEEK_START":
      return true;
    case "FIRST_WEEK_SUMMARY_READY":
    case "FIRST_WEEK_WELCOME_BACK":
    case "EARLY_SIGNAL":
    case "MILESTONE_REACHED":
      // They carry their own action (resolveAction), never the first-report invitation.
      return false;
    case "SILENCE":
      // Silence is a complete state: it never carries an action.
      return false;
    default:
      return state satisfies never;
  }
}

function resolveAction(state: HomeState, facts: HomeFacts): HomeAction | null {
  // The First Week states and the milestone carry their own action, whatever the report fact says.
  switch (state.key) {
    case "FIRST_WEEK_SUMMARY_READY":
      return { kind: "OPEN_FIRST_WEEK_SUMMARY" };
    case "FIRST_WEEK_WELCOME_BACK":
      return { kind: "OPEN_REPORT_SHEET", reason: "WELCOME_BACK" };
    case "EARLY_SIGNAL":
      return { kind: "ANSWER_EARLY_SIGNAL" };
    case "MILESTONE_REACHED":
      return { kind: "OPEN_PROGRESS", week: state.week };
    default:
      break;
  }
  // Unknown (null) means no invitation: better to say nothing than to invite someone who already reported.
  if (!HOME_FEATURES.firstReportInvitation || !noFirstReportYet(facts)) return null;
  return invitesFirstReport(state) ? { kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" } : null;
}

/**
 * Pure, total, never throws. Precedence: offline > before Shabbat > Motzei Shabbat > First Week summary ready >
 * First Week welcome back > milestone reached > Early Signal > first week start > evening > morning > silence.
 */
export function resolveHome(facts: HomeFacts): HomeDecision {
  // An invalid instant cannot be formatted at all; say nothing rather than throw.
  if (Number.isNaN(facts.now.getTime())) {
    return { state: { key: "SILENCE", reason: "NOTHING_TO_SAY" }, action: null, degraded: true };
  }

  const state = resolveState(facts, resolveTimeZone(facts.timeZone));
  return {
    state,
    action: resolveAction(state, facts),
    // An unknown earlySignal or quietHours does NOT degrade Home: the card is a bonus, not a fact Home needs.
    degraded:
      facts.offlinePeriods === null ||
      facts.hasAnyReport === null ||
      (facts.lifecycle === "FIRST_WEEK" && facts.firstWeek === null),
  };
}

/** Exhaustive over HomeState (ends with `satisfies never`): a new state does not compile until it has a key. */
export function homeCopyKey(state: HomeState): HomeCopyKey {
  switch (state.key) {
    case "MORNING":
      return "morning";
    case "EVENING":
      return "evening";
    case "BEFORE_SHABBAT":
      return "beforeShabbat";
    case "MOTZEI_SHABBAT":
      return "motzeiShabbat";
    case "FIRST_WEEK_START":
      return "firstWeekStart";
    case "FIRST_WEEK_SUMMARY_READY":
      // Fewer than the meals the rules ask for, or none: no claim of familiarity.
      return state.hadEnoughData ? "firstWeekSummaryReady" : "firstWeekSummaryReadyLittle";
    case "FIRST_WEEK_WELCOME_BACK":
      return "firstWeekWelcomeBack";
    case "MILESTONE_REACHED":
      return state.isGoal ? "milestoneGoalReached" : "milestoneReached";
    case "EARLY_SIGNAL":
      switch (state.signal) {
        case "late_evening_meals":
          return "earlySignalLateEvening";
        default:
          return state.signal satisfies never;
      }
    case "SILENCE":
      switch (state.reason) {
        case "NOTHING_TO_SAY":
          return "silence";
        case "OFFLINE_PERIOD":
          return state.periodType === "SHABBAT" ? "offlineShabbat" : "offlineOther";
        default:
          return state satisfies never;
      }
    default:
      return state satisfies never;
  }
}
