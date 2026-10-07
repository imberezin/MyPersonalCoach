import type { LifecycleState } from "@/domain/firstWeek";
import type { OfflinePeriod } from "@/domain/offline";
import type { QuietHours } from "@/domain/quietHours";
import type { WeeklyHomeFact } from "@/domain/weekly";
import type { PushSubscriptionRecord } from "@/lib/notifications/types";

/**
 * Everything the weekly summary sender needs from the database, as an interface: the runner imports no Supabase code and is
 * tested against an in-memory store. The real one is ./weeklyPushStore.ts, on the service-role client. Every method that reads
 * says "unknown" (null or a named state), never a guess, and none of them logs a user id, an endpoint or a key.
 */

/** A person the sender looks at: in the weekly cycle, with what is known without another query. */
export interface PushCandidate {
  userId: string;
  /** profiles.language; anything unreadable becomes Hebrew when the message is built. */
  language: unknown;
  timeZone: string;
  lifecycle: LifecycleState | null;
  /** user_preferences.notifications.weekly_summary. null = unknown. */
  preferenceOn: boolean | null;
  /** null = unknown. */
  quietHours: QuietHours | null;
}

/**
 * - exists: a notification_log row for this (user, kind, moment) is there.
 * - none: it is not.
 * - migration_missing: the columns of 20261007120000_notification_moments.sql are not in the database yet. A dry run can still
 *   count; a live run must stop.
 * - unknown: the read failed.
 */
export type ClaimState = "exists" | "none" | "migration_missing" | "unknown";

export interface SendFacts {
  /** null = unknown. */
  periods: OfflinePeriod[] | null;
  /** null = the read failed. */
  subscriptions: PushSubscriptionRecord[] | null;
  claim: ClaimState;
}

export type ClaimResult = "claimed" | "already_claimed" | "migration_missing" | "failed";

/** How a claimed push ended: written to notification_log.suppressed_reason as null, 'send_failed' or 'subscription_gone'. */
export type FinishState = "sent" | "send_failed" | "subscription_gone";

export interface WeeklyPushStore {
  /** Everyone in the weekly cycle, ordered by user id, keyset after `afterUserId`. Throws on a read error (the runner aborts). */
  listCandidates(afterUserId: string | null, limit: number): Promise<PushCandidate[]>;
  /** The Home weekly card fact (loadWeeklyHomeFact): zero queries outside the card window. null = no moment, or unknown. Never throws. */
  loadFact(userId: string, timeZone: string, now: Date): Promise<WeeklyHomeFact | null>;
  /** Offline periods, the person's subscriptions and whether the push was already claimed. Never throws. */
  loadSendFacts(userId: string, fact: WeeklyHomeFact, now: Date): Promise<SendFacts>;
  /** INSERT one 'pending' row. A duplicate is `already_claimed` (the unique key), not an error. Never throws. */
  claim(userId: string, momentKey: string, now: Date): Promise<ClaimResult>;
  /** Ends the claim. true when exactly the claimed row was updated. Never throws. */
  finish(userId: string, momentKey: string, state: FinishState, now: Date): Promise<boolean>;
  /** Deletes the ONE matching row (user, endpoint, p256dh and auth). true on success. Never throws. */
  deleteSubscription(userId: string, subscription: PushSubscriptionRecord): Promise<boolean>;
  /** Stamps last_success_at on the matching row. true on success. Never throws. */
  markSubscriptionSuccess(userId: string, subscription: PushSubscriptionRecord, now: Date): Promise<boolean>;
}
