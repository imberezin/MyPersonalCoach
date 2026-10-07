import type { OfflinePeriod } from "@/domain/offline";
import type { WeeklyHomeFact } from "@/domain/weekly";
import type { PushSubscriptionRecord } from "@/lib/notifications/types";
import { STUCK_AFTER_MS, type ClaimResult, type FinishState, type PushCandidate, type SendFacts, type WeeklyPushStore } from "./store";

/**
 * An in-memory WeeklyPushStore, for the tests of the runner and the route (test support: nothing in the app imports it). It keeps
 * the same promises as the real one: a claim is atomic (the second claim of a (user, moment) is `already_claimed`), a finished claim
 * stays, a subscription is deleted only on a four-field match, and it records every call, so a test can prove what was and was not
 * touched. `stuck` is decided exactly like the real store (pending for longer than STUCK_AFTER_MS).
 */

export interface MemoryPerson {
  candidate: PushCandidate;
  /** The Home card fact. A function is asked on every read, so a test can change the answer between two reads (the owner opens the card). */
  fact: WeeklyHomeFact | null | (() => WeeklyHomeFact | null);
  periods?: OfflinePeriod[] | null;
  subscriptions?: PushSubscriptionRecord[] | null;
}

export type MemoryCall =
  | { method: "listCandidates" }
  | { method: "loadFact"; userId: string; now: Date }
  | { method: "loadSendFacts"; userId: string }
  | { method: "claim"; userId: string; momentKey: string }
  | { method: "finish"; userId: string; momentKey: string; state: FinishState }
  | { method: "deleteSubscription"; userId: string; endpoint: string }
  | { method: "markSubscriptionSuccess"; userId: string; endpoint: string };

export interface MemoryStoreOptions {
  /** Pretend the migration is not applied. */
  migrationMissing?: boolean;
  /** The next calls to these methods fail (claim returns "failed", finish and delete return false, listCandidates throws). */
  fail?: Partial<Record<"claim" | "finish" | "deleteSubscription" | "markSubscriptionSuccess" | "listCandidates" | "loadSendFacts", boolean>>;
  /** Existing claims at the start: key `${userId}|${momentKey}`. */
  claims?: Record<string, { reason: string | null; at: Date }>;
}

const key = (userId: string, momentKey: string) => `${userId}|${momentKey}`;

const WRITES = new Set<MemoryCall["method"]>(["claim", "finish", "deleteSubscription", "markSubscriptionSuccess"]);

export function createMemoryWeeklyPushStore(people: MemoryPerson[], options: MemoryStoreOptions = {}) {
  const calls: MemoryCall[] = [];
  const claims = new Map<string, { reason: string | null; at: Date }>(Object.entries(options.claims ?? {}));
  const subscriptions = new Map<string, PushSubscriptionRecord[]>(people.map((p) => [p.candidate.userId, [...(p.subscriptions ?? [])]]));
  const stamped: string[] = [];
  const person = (userId: string) => people.find((p) => p.candidate.userId === userId);

  const store: WeeklyPushStore = {
    async listCandidates(afterUserId, limit) {
      calls.push({ method: "listCandidates" });
      if (options.fail?.listCandidates) throw new Error("candidates_failed");
      return people
        .map((p) => p.candidate)
        .filter((c) => afterUserId === null || c.userId > afterUserId)
        .sort((a, b) => (a.userId < b.userId ? -1 : 1))
        .slice(0, limit);
    },

    async loadFact(userId, _timeZone, now) {
      calls.push({ method: "loadFact", userId, now });
      const fact = person(userId)?.fact ?? null;
      return typeof fact === "function" ? fact() : fact;
    },

    async loadSendFacts(userId, fact, now): Promise<SendFacts> {
      calls.push({ method: "loadSendFacts", userId });
      const p = person(userId);
      const held = claims.get(key(userId, `weekly:${fact.weekStart}`));
      let claim: SendFacts["claim"] = "none";
      if (options.migrationMissing) claim = "migration_missing";
      else if (options.fail?.loadSendFacts) claim = "unknown";
      else if (held) claim = held.reason === "pending" && now.getTime() - held.at.getTime() > STUCK_AFTER_MS ? "stuck" : "exists";
      return {
        periods: p?.periods === undefined ? [] : p.periods,
        subscriptions: p?.subscriptions === null ? null : [...(subscriptions.get(userId) ?? [])],
        claim,
      };
    },

    async claim(userId, momentKey, now): Promise<ClaimResult> {
      calls.push({ method: "claim", userId, momentKey });
      if (options.migrationMissing) return "migration_missing";
      if (options.fail?.claim) return "failed";
      if (claims.has(key(userId, momentKey))) return "already_claimed";
      claims.set(key(userId, momentKey), { reason: "pending", at: now });
      return "claimed";
    },

    async finish(userId, momentKey, state, now) {
      calls.push({ method: "finish", userId, momentKey, state });
      if (options.fail?.finish) return false;
      const held = claims.get(key(userId, momentKey));
      if (!held) return false;
      claims.set(key(userId, momentKey), { reason: state === "sent" ? null : state, at: now });
      return true;
    },

    async deleteSubscription(userId, subscription) {
      calls.push({ method: "deleteSubscription", userId, endpoint: subscription.endpoint });
      if (options.fail?.deleteSubscription) return false;
      const list = subscriptions.get(userId) ?? [];
      subscriptions.set(
        userId,
        list.filter((s) => !(s.endpoint === subscription.endpoint && s.p256dh === subscription.p256dh && s.auth === subscription.auth)),
      );
      return true;
    },

    async markSubscriptionSuccess(userId, subscription) {
      calls.push({ method: "markSubscriptionSuccess", userId, endpoint: subscription.endpoint });
      if (options.fail?.markSubscriptionSuccess) return false;
      stamped.push(subscription.endpoint);
      return true;
    },
  };

  return {
    store,
    calls,
    claims,
    subscriptions,
    stamped,
    /** Every write call made so far (claim, finish, delete, stamp). Empty after a dry run. */
    writes: () => calls.filter((c) => WRITES.has(c.method)),
    called: (method: MemoryCall["method"]) => calls.filter((c) => c.method === method).length,
  };
}
