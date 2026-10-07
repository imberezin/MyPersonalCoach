import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WEEKLY_PUSH, weeklyMomentKey } from "@/domain/notifications";
import { parseQuietHours } from "@/domain/quietHours";
import { loadOfflinePeriods } from "@/lib/home/load";
import type { PushSubscriptionRecord } from "@/lib/notifications/types";
import { loadWeeklyHomeFact } from "@/lib/weekly/home";
import { STUCK_AFTER_MS, type ClaimResult, type ClaimState, type FinishState, type PushCandidate, type SendFacts, type WeeklyPushStore } from "./store";

/** An explicit allow-list per table: nothing else about the person (goals, weight, motivation, name) is read. */
export const PROFILE_COLUMNS = "user_id, language, timezone, lifecycle_state";
export const PREFERENCE_COLUMNS = "user_id, notifications, quiet_hours_start, quiet_hours_end";
export const SUBSCRIPTION_COLUMNS = "endpoint, p256dh, auth";

/** More than this many subscriptions for one person is not a phone and a second device; the cap keeps a read bounded. */
const SUBSCRIPTION_LIMIT = 20;

/** The migration's columns are missing: PostgREST says PGRST204 (schema cache), Postgres itself says 42703. */
const COLUMN_MISSING = new Set(["PGRST204", "42703"]);
const UNIQUE_VIOLATION = "23505";

const END_REASON: Record<FinishState, string | null> = { sent: null, send_failed: "send_failed", subscription_gone: "subscription_gone" };

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/**
 * The Supabase side of the weekly summary sender, on the service-role client (it runs from cron, with no signed-in person). The ONLY
 * writes are to two tables: notification_log (the claim, and its end) and push_subscriptions (one matching row deleted when the push
 * service says it is gone, and last_success_at stamped). Every read is filtered by one user id. Nothing here calls the AI or the
 * analytics, and no method throws or logs a user id, an endpoint or a key.
 */
export function createSupabaseWeeklyPushStore(admin: SupabaseClient): WeeklyPushStore {
  return {
    async listCandidates(afterUserId, limit) {
      let profiles = admin.from("profiles").select(PROFILE_COLUMNS).eq("lifecycle_state", "WEEKLY_CYCLE").order("user_id").limit(limit);
      if (afterUserId !== null) profiles = profiles.gt("user_id", afterUserId);
      const profileResult = await profiles;
      if (profileResult.error) throw new Error("candidates_failed");
      const rows = (profileResult.data ?? []) as Array<Record<string, unknown>>;
      if (rows.length === 0) return [];

      // No foreign key between the two tables, so the preferences come from a second read for the same page.
      const ids = rows.map((row) => row.user_id as string);
      const prefResult = await admin.from("user_preferences").select(PREFERENCE_COLUMNS).in("user_id", ids);
      if (prefResult.error) throw new Error("candidates_failed");
      const prefs = new Map<string, Record<string, unknown>>();
      for (const row of (prefResult.data ?? []) as Array<Record<string, unknown>>) prefs.set(row.user_id as string, row);

      return rows.map((row): PushCandidate => {
        const pref = prefs.get(row.user_id as string);
        const notifications = pref?.notifications;
        const flag = typeof notifications === "object" && notifications !== null ? (notifications as Record<string, unknown>)[WEEKLY_PUSH.kind] : undefined;
        return {
          userId: row.user_id as string,
          language: row.language,
          timeZone: typeof row.timezone === "string" ? row.timezone : "",
          lifecycle: row.lifecycle_state === "WEEKLY_CYCLE" ? "WEEKLY_CYCLE" : null,
          preferenceOn: typeof flag === "boolean" ? flag : null,
          quietHours: pref ? parseQuietHours(pref.quiet_hours_start, pref.quiet_hours_end) : null,
        };
      });
    },

    loadFact(userId, timeZone, now) {
      return loadWeeklyHomeFact(admin, userId, { timeZone, now });
    },

    async loadSendFacts(userId, fact, now): Promise<SendFacts> {
      const momentKey = weeklyMomentKey(fact.weekStart);
      const [periods, subscriptions, claim] = await Promise.all([
        loadOfflinePeriods(admin, userId, now),
        readSubscriptions(admin, userId),
        readClaim(admin, userId, momentKey, now),
      ]);
      return { periods, subscriptions, claim };
    },

    async claim(userId, momentKey, now): Promise<ClaimResult> {
      try {
        const { error } = await admin
          .from("notification_log")
          .insert({ user_id: userId, channel: "web_push", kind: WEEKLY_PUSH.kind, moment_key: momentKey, suppressed_reason: "pending", sent_at: now.toISOString() });
        if (!error) return "claimed";
        if (error.code === UNIQUE_VIOLATION) return "already_claimed";
        if (error.code && COLUMN_MISSING.has(error.code)) return "migration_missing";
        console.error("Weekly push: the claim failed", error.code ?? "no_code");
        return "failed";
      } catch {
        console.error("Weekly push: the claim threw");
        return "failed";
      }
    },

    async finish(userId, momentKey, state, now) {
      try {
        const { data, error } = await admin
          .from("notification_log")
          .update({ suppressed_reason: END_REASON[state], sent_at: now.toISOString() })
          .eq("user_id", userId)
          .eq("kind", WEEKLY_PUSH.kind)
          .eq("moment_key", momentKey)
          .select("id");
        if (error) {
          console.error("Weekly push: closing the claim failed", error.code ?? "no_code");
          return false;
        }
        return Array.isArray(data) && data.length === 1;
      } catch {
        console.error("Weekly push: closing the claim threw");
        return false;
      }
    },

    async deleteSubscription(userId, subscription) {
      try {
        // All of user, endpoint and BOTH keys: the browser may have just saved the same endpoint again with new keys (an upsert on
        // the endpoint), and that fresh row must survive a delete that was decided on the old one.
        const { error } = await admin
          .from("push_subscriptions")
          .delete()
          .eq("user_id", userId)
          .eq("endpoint", subscription.endpoint)
          .eq("p256dh", subscription.p256dh)
          .eq("auth", subscription.auth);
        if (error) {
          console.error("Weekly push: deleting a dead subscription failed", error.code ?? "no_code");
          return false;
        }
        return true;
      } catch {
        console.error("Weekly push: deleting a dead subscription threw");
        return false;
      }
    },

    async markSubscriptionSuccess(userId, subscription, now) {
      try {
        const { error } = await admin
          .from("push_subscriptions")
          .update({ last_success_at: now.toISOString() })
          .eq("user_id", userId)
          .eq("endpoint", subscription.endpoint)
          .eq("p256dh", subscription.p256dh)
          .eq("auth", subscription.auth);
        if (error) {
          console.error("Weekly push: stamping a subscription failed", error.code ?? "no_code");
          return false;
        }
        return true;
      } catch {
        console.error("Weekly push: stamping a subscription threw");
        return false;
      }
    },
  };
}

async function readSubscriptions(admin: SupabaseClient, userId: string): Promise<PushSubscriptionRecord[] | null> {
  try {
    const { data, error } = await admin.from("push_subscriptions").select(SUBSCRIPTION_COLUMNS).eq("user_id", userId).order("created_at").limit(SUBSCRIPTION_LIMIT);
    if (error) {
      console.error("Weekly push: reading the subscriptions failed", error.code ?? "no_code");
      return null;
    }
    if (!Array.isArray(data)) return null;
    const subscriptions: PushSubscriptionRecord[] = [];
    for (const row of data as Array<Record<string, unknown>>) {
      if (isText(row.endpoint) && isText(row.p256dh) && isText(row.auth)) subscriptions.push({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth });
    }
    return subscriptions;
  } catch {
    console.error("Weekly push: reading the subscriptions threw");
    return null;
  }
}

async function readClaim(admin: SupabaseClient, userId: string, momentKey: string, now: Date): Promise<ClaimState> {
  try {
    const { data, error } = await admin
      .from("notification_log")
      .select("id, suppressed_reason, sent_at")
      .eq("user_id", userId)
      .eq("kind", WEEKLY_PUSH.kind)
      .eq("moment_key", momentKey)
      .limit(1);
    if (error) {
      if (error.code && COLUMN_MISSING.has(error.code)) return "migration_missing";
      console.error("Weekly push: reading the claim failed", error.code ?? "no_code");
      return "unknown";
    }
    if (!Array.isArray(data)) return "unknown";
    if (data.length === 0) return "none";
    const row = data[0] as Record<string, unknown>;
    const sentAt = typeof row.sent_at === "string" ? Date.parse(row.sent_at) : Number.NaN;
    return row.suppressed_reason === "pending" && now.getTime() - sentAt > STUCK_AFTER_MS ? "stuck" : "exists";
  } catch {
    console.error("Weekly push: reading the claim threw");
    return "unknown";
  }
}
