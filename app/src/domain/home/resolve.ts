import { isOffline, type OfflinePeriod } from "../offline";
import { localMinuteOfDay } from "../time";
import {
  HOME_FALLBACK_TIME_ZONE,
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

/**
 * Returns `tz` when `new Intl.DateTimeFormat("en-US", { timeZone: tz })` accepts it, else
 * HOME_FALLBACK_TIME_ZONE. Never throws. Used by the resolver, the loader and `homeCopyFor`, so a
 * garbage `profiles.timezone` (a `text not null` column with no check constraint) can never reach
 * an Intl call unvalidated.
 */
export function resolveTimeZone(tz: string): string {
  if (typeof tz !== "string") return HOME_FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return HOME_FALLBACK_TIME_ZONE;
  }
}

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

function resolveState(
  now: Date,
  timeZone: string,
  periods: readonly OfflinePeriod[] | null,
  hasAnyReport: boolean | null,
): HomeState {
  // Without the periods Shabbat is unknown: rules 1-3 are skipped and the clock decides alone.
  if (periods) {
    const inProgress = periodInProgress(periods, now);
    if (inProgress) return { key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: inProgress.type };

    const coming = shabbatStartingSoon(periods, now);
    if (coming) return { key: "BEFORE_SHABBAT", candleLighting: coming.start };

    const ended = shabbatJustEnded(periods, now);
    if (ended) return { key: "MOTZEI_SHABBAT", havdalah: ended.end };
  }

  // B1 First Week Start: nothing reported yet. It is content on the screen, not a notification, so it
  // holds at any hour. Only a known "no report" counts (null is unknown), and only while the
  // invitation is switched on, because its one button is that invitation.
  if (HOME_FEATURES.firstReportInvitation && hasAnyReport === false) return { key: "FIRST_WEEK_START" };

  // The windows above use stored instants, so a DST day cannot move them. Only these two cut-offs
  // are wall-clock times.
  const minute = localMinuteOfDay(now, timeZone);
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
    case "SILENCE":
      // Silence is a complete state: it never carries an action.
      return false;
    default:
      return state satisfies never;
  }
}

function resolveAction(state: HomeState, hasAnyReport: boolean | null): HomeAction | null {
  // Unknown (null) means no invitation: better to say nothing than to invite someone who already reported.
  if (!HOME_FEATURES.firstReportInvitation || hasAnyReport !== false) return null;
  return invitesFirstReport(state) ? { kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" } : null;
}

/**
 * Pure, total, never throws. Precedence: offline > before Shabbat > Motzei Shabbat > first week start >
 * evening > morning > silence.
 */
export function resolveHome(facts: HomeFacts): HomeDecision {
  // An invalid instant cannot be formatted at all; say nothing rather than throw.
  if (Number.isNaN(facts.now.getTime())) {
    return { state: { key: "SILENCE", reason: "NOTHING_TO_SAY" }, action: null, degraded: true };
  }

  const state = resolveState(facts.now, resolveTimeZone(facts.timeZone), facts.offlinePeriods, facts.hasAnyReport);
  return {
    state,
    action: resolveAction(state, facts.hasAnyReport),
    degraded: facts.offlinePeriods === null || facts.hasAnyReport === null,
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
