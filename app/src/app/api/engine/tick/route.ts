import { isValidCronRequest } from "@/lib/cron/auth";

/**
 * Called by Supabase pg_cron every few minutes (see docs). Runs the Behavior Engine jobs.
 * Every job added here MUST be idempotent: schedulers can fire twice.
 */
export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!isValidCronRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Jobs (added as they are built): evaluate the engine per user, close the week, remove
  // stale temporary photos. The upcoming Shabbat periods have their own route and schedule:
  // /api/engine/shabbat-topup.
  return Response.json({ ok: true, ranAt: new Date().toISOString(), jobs: [] });
}
