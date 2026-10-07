import { currentInstant } from "@/lib/clock/now";
import { guardCronRequest } from "@/lib/cron/auth";
import { createNotificationProvider } from "@/lib/notifications/factory";
import { runWeeklyPush, weeklyPushNeedsAttention } from "@/lib/notify/runWeeklyPush";
import { isLiveRequest } from "@/lib/notify/senderMode";
import { createSupabaseWeeklyPushStore } from "@/lib/notify/weeklyPushStore";
import { createAdminClient } from "@/lib/supabase/admin";

// Same setup as the Shabbat top-up route: Node runtime, never cached. The run stops itself well inside 30 s (see WEEKLY_PUSH_DEADLINE_MS).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "no-store" } as const;

/**
 * Called by Supabase pg_cron (via pg_net) every few minutes (see SETUP-CHECKLIST.md 6ד). It sends the weekly summary push to the people
 * it is due for: the week is ready, the Home card is still untouched, they are not Offline, it is outside their quiet hours, the push
 * was not already sent, and a device is subscribed. Idempotent: a second tick, or two overlapping ones, send once.
 *
 * FAILS CLOSED. It is a DRY RUN (reads and counts, writes nothing, sends nothing) unless NOTIFY_SENDER_LIVE=1 is set AND the request has no
 * `?dryRun=1` AND a provider could be built; the query can only lower the mode. It takes no user, text, hour or kind from the request, so
 * it cannot be used to push anything arbitrary. It is a route of its own, not a step of /api/engine/tick, so cron.unschedule('notify')
 * switches it off without touching the tick.
 *
 * The answer carries counts only. 200 means nothing needs a human; 500 is a run with a failure, a stuck claim, a push no device accepted
 * or an abort (the body still has the counts); 503 means it could not run at all (no admin client, the people could not be read, a live run
 * without the migration or without a push provider).
 */
export async function POST(request: Request) {
  const denied = guardCronRequest(request);
  if (denied) return denied;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: "admin_not_configured" }, { status: 503, headers: HEADERS });
  }

  try {
    const live = isLiveRequest(process.env, new URL(request.url));
    // The provider is built only for a live request. A live request that cannot get one is an error, not a silent dry run: the owner
    // switched sending on and must see that it cannot.
    const provider = live ? createNotificationProvider() : null;
    if (live && provider === null) {
      return Response.json({ error: "provider_not_configured" }, { status: 503, headers: HEADERS });
    }

    const summary = await runWeeklyPush(createSupabaseWeeklyPushStore(admin), provider, { now: currentInstant(), live });
    const down = summary.aborted === "candidates_failed" || summary.aborted === "migration_missing";
    const attention = down || weeklyPushNeedsAttention(summary);
    return Response.json(
      { ok: !attention, ranAt: new Date().toISOString(), mode: summary.dryRun ? "dry" : "live", ...summary },
      { status: down ? 503 : attention ? 500 : 200, headers: HEADERS },
    );
  } catch {
    console.error("Weekly push: unexpected error");
    return Response.json({ error: "notify_failed" }, { status: 500, headers: HEADERS });
  }
}
