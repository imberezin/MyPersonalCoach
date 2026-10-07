import type { LifecycleState } from "../firstWeek";
import { isOffline, type OfflinePeriod } from "../offline";
import { isQuiet, type QuietHours } from "../quietHours";
import { localMinuteOfDay, resolveTimeZone } from "../time";
import type { WeeklyHomeFact } from "../weekly";
import { WEEKLY_PUSH, type WeeklyPushSkipReason } from "./reasons";

/**
 * Everything the weekly summary push needs to decide, already read. Injected: this module never reads the clock, a database or
 * a provider. `null` always means "could not be read", and an unknown fact is silence, never a guess.
 */
export interface WeeklyPushInput {
  now: Date;
  /** profiles.timezone. An invalid name falls back to Asia/Jerusalem (resolveTimeZone), like everywhere else. */
  timeZone: string;
  lifecycle: LifecycleState | null;
  /** user_preferences.notifications.weekly_summary. null = unknown (a failed or malformed read). */
  preferenceOn: boolean | null;
  /**
   * What `loadWeeklyHomeFact` answered: the card the person sees on Home. null = no weekly moment, or unknown (that loader
   * answers null for a failed read too). The push is built on the CARD as the single source of truth, so the push and Home can
   * never disagree about whether the week is ready, opened or snoozed.
   */
  fact: WeeklyHomeFact | null;
  /** Offline periods around `now`. null = unknown. */
  periods: readonly OfflinePeriod[] | null;
  /** user_preferences quiet hours. null = unknown, which is silent (a one-sided or garbled value must not become noise). */
  quietHours: QuietHours | null;
  /** How many valid push subscriptions the person has. */
  subscriptionCount: number;
  /** A notification_log row already exists for this (user, kind, moment): the push was claimed, sent or not. */
  claimExists: boolean;
}

export type WeeklyPushDecision = { kind: "SEND"; momentKey: string } | { kind: "SKIP"; reason: WeeklyPushSkipReason };

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The weekly summary push. Pure and total: it never throws, whatever it is given. It is a SEND only when every gate is open,
 * and the first closed gate names the reason, in this order:
 *   invalid input, lifecycle, the person's preference, the Home card (no moment / opened or snoozed), Offline, an earlier claim,
 *   quiet hours (a DELAY, not a skip: the same decision is asked again at the next tick, and the card stays up until Wednesday
 *   05:00), and finally a subscription. A missing subscription is checked last and is never claimed, so a device that registers
 *   late in the window still gets the push.
 * Whether a person has had a proactive intervention today is NOT asked: the owner exempted this push from that budget (2026-10-07).
 */
export function decideWeeklyPush(input: WeeklyPushInput): WeeklyPushDecision {
  const skip = (reason: WeeklyPushSkipReason): WeeklyPushDecision => ({ kind: "SKIP", reason });

  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) return skip("invalid_input");
  if (input.lifecycle !== "WEEKLY_CYCLE") return skip("not_weekly_cycle");

  if (input.preferenceOn === null) return skip("preference_unknown");
  if (input.preferenceOn !== true) return skip("preference_off");

  const { fact } = input;
  if (fact === null || typeof fact.weekStart !== "string" || !DAY_KEY.test(fact.weekStart)) return skip("no_moment");
  if (fact.card !== true) return skip("card_closed");

  if (input.periods === null) return skip("offline_unknown");
  if (isOffline(input.periods, input.now)) return skip("offline");

  if (input.claimExists) return skip("already_claimed");

  if (input.quietHours === null) return skip("quiet_hours_unknown");
  if (isQuiet(input.quietHours, localMinuteOfDay(input.now, resolveTimeZone(input.timeZone)))) return skip("quiet_hours");

  if (!(input.subscriptionCount > 0)) return skip("no_subscription");

  return { kind: "SEND", momentKey: `${WEEKLY_PUSH.momentPrefix}${fact.weekStart}` };
}
