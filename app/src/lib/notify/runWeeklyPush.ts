import { decideWeeklyPush, type WeeklyPushSkipReason } from "@/domain/notifications";
import type { WeeklyHomeFact } from "@/domain/weekly";
import { buildWeeklySummaryPush } from "@/lib/notifications/messages";
import type { NotificationProvider, PushSubscriptionRecord, SendResult } from "@/lib/notifications/types";
import type { FinishState, PushCandidate, WeeklyPushStore } from "./store";

export const WEEKLY_PUSH_PAGE_SIZE = 50;
export const WEEKLY_PUSH_MAX_USERS = 100;
/** A small run-level brake: this app has one person, and a bug must not become a flood. */
export const WEEKLY_PUSH_MAX_SENDS = 5;
/** Inside the route's maxDuration of 30 s: the run starts no new person after this, and leaves 8 s for the response. */
export const WEEKLY_PUSH_DEADLINE_MS = 22_000;
/**
 * What one person's push may take once it is claimed: the card re-read, the claim, every subscription at once (each is bounded to 10 s by the
 * provider, so the slowest bounds them all) and closing the claim. A person is started only while this much of the run's deadline is left, so
 * a claim is never begun that the platform could cut off before it is closed (22 s - 12 s = 10 s into the run at the latest).
 */
export const WEEKLY_PUSH_PERSON_BUDGET_MS = 12_000;

export type WeeklyPushAbort = "candidates_failed" | "migration_missing" | "deadline" | "user_cap" | "send_cap";

/** Counts and fixed phrases only: never a user id, an endpoint, a key or the text of a notification. */
export interface WeeklyPushSummary {
  /** People examined. */
  candidates: number;
  /** Decisions to send. In a dry run: the pushes that WOULD go out. */
  due: number;
  /** Live: claimed pushes that at least one subscription accepted. */
  sent: number;
  /** Live: claimed pushes that no subscription accepted (the claim is closed as send_failed or subscription_gone). */
  notSent: number;
  /** Subscriptions deleted because the push service said 404 or 410. */
  subscriptionsDeleted: number;
  /**
   * One count per subscription a push was attempted on: ok, gone, rejected and retryable sum to the attempts. `providerThrew` is a part of
   * `retryable` (a provider that breaks its contract by throwing is counted as a temporary failure), not a fifth kind.
   */
  results: { ok: number; gone: number; rejected: number; retryable: number; providerThrew: number };
  /** The sum of skippedBy. */
  skipped: number;
  skippedBy: Partial<Record<WeeklyPushSkipReason, number>>;
  /** A read or write failure for that person. */
  failed: number;
  /** Claims still pending after longer than a send takes (a crash), plus claims that could not be closed. */
  stuck: number;
  /** Dry run only: people whose claim could not be checked because the migration is not applied yet (counted as not claimed). */
  migrationPending: number;
  dryRun: boolean;
  aborted: WeeklyPushAbort | null;
}

/** True when something needs a human: a failure, an abort, a stuck claim, or a push that no device accepted. Skips are normal. */
export function weeklyPushNeedsAttention(summary: WeeklyPushSummary): boolean {
  return summary.failed > 0 || summary.stuck > 0 || summary.notSent > 0 || summary.aborted !== null;
}

// The decision's gates are checked in a FIXED order (pinned by its tests), and a later input cannot change the answer while an earlier
// gate is closed. So the cheap gates are asked first with placeholders for what is not read yet, and the rest is read only when they
// are open. The placeholders: an open card for the first stage, and unread Offline periods (which can only ever answer
// "offline_unknown", the sign that every earlier gate was open).
const OPEN_CARD: WeeklyHomeFact = { weekStart: "1970-01-04", card: true };
const UNREAD = { periods: null, subscriptionCount: 0, claimExists: false } as const;
const CHEAP_GATES = new Set<WeeklyPushSkipReason>(["invalid_input", "not_weekly_cycle", "preference_unknown", "preference_off"]);
const CARD_GATES = new Set<WeeklyPushSkipReason>(["no_moment", "card_closed"]);

const THREW: SendResult = { ok: false, outcome: "retryable", gone: false };

/**
 * Sends the weekly summary push to everyone it is due for. Never throws. One person failing never stops the others.
 *
 * DRY (the default: `live` false, or no provider): reads and decides, counts what would go out and why not, and makes NO write and NO
 * provider call. A missing migration is only counted (the claim is then treated as not made), so a dry run works on a database that
 * does not have it yet. LIVE: for every decision to send, (1) the card is read again (the person may have opened it, or put it away
 * for a day, since the decision), (2) the push is CLAIMED, an atomic insert that fails for a duplicate, and without a claim nothing
 * is ever sent, (3) one push per subscription, (4) the claim is closed as sent, send_failed or subscription_gone. A subscription is
 * deleted only for 404 or 410, never for any other answer. There is NO automatic retry (at-most-once, the owner's decision of
 * 2026-10-07): a push that failed is not tried again, and the Home card is complete without it.
 */
export async function runWeeklyPush(
  store: WeeklyPushStore,
  provider: NotificationProvider | null,
  options: { now: Date; live: boolean; nowMs?: () => number; pageSize?: number; maxUsers?: number; maxSends?: number; deadlineMs?: number },
): Promise<WeeklyPushSummary> {
  const { now } = options;
  const livePush = options.live === true && provider !== null ? provider : null;
  const clock = options.nowMs ?? Date.now;
  const pageSize = options.pageSize ?? WEEKLY_PUSH_PAGE_SIZE;
  const maxUsers = options.maxUsers ?? WEEKLY_PUSH_MAX_USERS;
  const maxSends = options.maxSends ?? WEEKLY_PUSH_MAX_SENDS;
  const deadlineMs = options.deadlineMs ?? WEEKLY_PUSH_DEADLINE_MS;
  const startedAt = clock();

  const summary: WeeklyPushSummary = {
    candidates: 0,
    due: 0,
    sent: 0,
    notSent: 0,
    subscriptionsDeleted: 0,
    results: { ok: 0, gone: 0, rejected: 0, retryable: 0, providerThrew: 0 },
    skipped: 0,
    skippedBy: {},
    failed: 0,
    stuck: 0,
    migrationPending: 0,
    dryRun: livePush === null,
    aborted: null,
  };

  const skip = (reason: WeeklyPushSkipReason) => {
    summary.skipped += 1;
    summary.skippedBy[reason] = (summary.skippedBy[reason] ?? 0) + 1;
  };

  async function handle(candidate: PushCandidate): Promise<WeeklyPushAbort | undefined> {
    const base = { now, timeZone: candidate.timeZone, lifecycle: candidate.lifecycle, preferenceOn: candidate.preferenceOn, quietHours: candidate.quietHours };

    // Stage 1, no query: lifecycle and the person's preference.
    const cheap = decideWeeklyPush({ ...base, fact: OPEN_CARD, ...UNREAD });
    if (cheap.kind === "SKIP" && CHEAP_GATES.has(cheap.reason)) return void skip(cheap.reason);

    // Stage 2: the Home card. Zero queries outside its window (Wednesday 05:00 to Sunday 05:00).
    const fact = await store.loadFact(candidate.userId, candidate.timeZone, now);
    const card = decideWeeklyPush({ ...base, fact, ...UNREAD });
    if (card.kind === "SKIP" && CARD_GATES.has(card.reason)) return void skip(card.reason);
    if (fact === null) return void skip("no_moment"); // unreachable: a null fact is always "no_moment" above

    // Stage 3: Offline, the subscriptions and the claim, only for a card that is open.
    const facts = await store.loadSendFacts(candidate.userId, fact, now);
    if (facts.subscriptions === null || facts.claim === "unknown") {
      summary.failed += 1;
      return;
    }
    if (facts.claim === "migration_missing") {
      if (livePush !== null) return "migration_missing";
      summary.migrationPending += 1;
    }
    if (facts.claim === "stuck") summary.stuck += 1;

    const decision = decideWeeklyPush({
      ...base,
      fact,
      periods: facts.periods,
      subscriptionCount: facts.subscriptions.length,
      claimExists: facts.claim === "exists" || facts.claim === "stuck",
    });
    if (decision.kind === "SKIP") return void skip(decision.reason);

    summary.due += 1;
    if (livePush === null) return;
    return deliver(livePush, candidate, fact, decision.momentKey, facts.subscriptions);
  }

  async function deliver(
    push: NotificationProvider,
    candidate: PushCandidate,
    fact: WeeklyHomeFact,
    momentKey: string,
    subscriptions: PushSubscriptionRecord[],
  ): Promise<WeeklyPushAbort | undefined> {
    if (summary.sent + summary.notSent >= maxSends) return "send_cap";
    // Nothing is claimed unless the whole push can finish inside the run's deadline; the next tick picks it up.
    if (clock() - startedAt > deadlineMs - WEEKLY_PUSH_PERSON_BUDGET_MS) return "deadline";

    // The person may have opened the card, or put it away for a day, since the decision. Asked BEFORE the claim, so a push that
    // is held back is not used up: if the card comes back inside its window, a later tick still sends it.
    // At the instant it is NOW, not the instant the run started: a snooze made since then is dated after `now` and would be ignored.
    const rereadAt = new Date(now.getTime() + Math.max(0, clock() - startedAt));
    const again = await store.loadFact(candidate.userId, candidate.timeZone, rereadAt);
    if (again === null || again.weekStart !== fact.weekStart || !again.card) return void skip(again === null ? "no_moment" : "card_closed");

    const claim = await store.claim(candidate.userId, momentKey, now);
    if (claim === "already_claimed") return void skip("already_claimed");
    if (claim === "migration_missing") return "migration_missing";
    if (claim === "failed") {
      summary.failed += 1;
      return;
    }

    // Claimed: from here the push is never sent twice, whatever happens next.
    const message = buildWeeklySummaryPush({ language: candidate.language, weekStart: fact.weekStart });
    // Every device at once: the person's time is the slowest single send (each is bounded to 10 s by the provider), not their sum.
    const outcomes = await Promise.all(
      subscriptions.map(async (subscription): Promise<SendResult["outcome"]> => {
        let result: SendResult;
        try {
          result = await push.send(subscription, message);
        } catch {
          console.error("Weekly push: the provider threw");
          summary.results.providerThrew += 1;
          result = THREW;
        }
        summary.results[result.outcome] += 1;
        if (result.ok) {
          await store.markSubscriptionSuccess(candidate.userId, subscription, now);
        } else if (result.outcome === "gone") {
          if (await store.deleteSubscription(candidate.userId, subscription)) summary.subscriptionsDeleted += 1;
        }
        return result.outcome;
      }),
    );
    const accepted = outcomes.filter((o) => o === "ok").length;
    const gone = outcomes.filter((o) => o === "gone").length;

    const state: FinishState = accepted > 0 ? "sent" : gone === subscriptions.length ? "subscription_gone" : "send_failed";
    // If the claim cannot be closed it stays 'pending': counted as stuck so that it is seen, and still never sent again.
    if (!(await store.finish(candidate.userId, momentKey, state, now))) summary.stuck += 1;
    if (accepted > 0) summary.sent += 1;
    else summary.notSent += 1;
    return;
  }

  try {
    let cursor: string | null = null;
    pages: for (;;) {
      let page: PushCandidate[];
      try {
        page = await store.listCandidates(cursor, pageSize);
      } catch {
        console.error("Weekly push: reading the people failed");
        summary.aborted = "candidates_failed";
        break;
      }
      if (page.length === 0) break;

      for (const candidate of page) {
        if (summary.candidates >= maxUsers) {
          summary.aborted = "user_cap";
          break pages;
        }
        if (clock() - startedAt > deadlineMs) {
          summary.aborted = "deadline";
          break pages;
        }
        summary.candidates += 1;
        cursor = candidate.userId;
        try {
          const stop = await handle(candidate);
          if (stop) {
            summary.aborted = stop;
            break pages;
          }
        } catch {
          console.error("Weekly push: unexpected error for one person");
          summary.failed += 1;
        }
      }
      if (page.length < pageSize) break;
    }
  } catch {
    // Defensive: nothing above should throw out of the loop, but the job must never throw.
    console.error("Weekly push: unexpected error");
    summary.failed += 1;
  }

  console.info("Weekly push: done", summary);
  return summary;
}
