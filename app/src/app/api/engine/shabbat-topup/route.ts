import { currentInstant } from "@/lib/clock/now";
import { guardCronRequest } from "@/lib/cron/auth";
import { runShabbatTopup, topupNeedsAttention } from "@/lib/jobs/shabbatTopup";
import { createSupabaseTopupStore } from "@/lib/jobs/shabbatTopupStore";
import { createAdminClient } from "@/lib/supabase/admin";

// Same setup as the food route: Node runtime, never cached. The run stops itself well inside 30 s (see TOPUP_DEADLINE_MS).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "no-store" } as const;

/**
 * Called by Supabase pg_cron (via pg_net) on Sundays and Wednesdays (see SETUP-CHECKLIST.md 6ב). For every user
 * who observes Shabbat it adds the missing upcoming Shabbat periods, so the next eight are always stored.
 * Insert-only and idempotent: a second run changes nothing. `?dryRun=1` plans without writing.
 *
 * The answer carries counts only. 200 means nothing failed, nothing was aborted and no user was skipped for a
 * problem; 503 means the function is missing or the users cannot be read; 500 is any other run that did not fully
 * succeed (the body still has the counts).
 */
export async function POST(request: Request) {
  const denied = guardCronRequest(request);
  if (denied) return denied;

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: "admin_not_configured" }, { status: 503, headers: HEADERS });
  }

  try {
    const summary = await runShabbatTopup(createSupabaseTopupStore(admin), { now: currentInstant(), dryRun });
    const down = summary.aborted === "rpc_missing" || summary.aborted === "candidates_failed";
    const attention = down || topupNeedsAttention(summary);
    return Response.json(
      { ok: !attention, ranAt: new Date().toISOString(), ...summary },
      { status: down ? 503 : attention ? 500 : 200, headers: HEADERS },
    );
  } catch {
    console.error("Shabbat top-up: unexpected error");
    return Response.json({ error: "topup_failed" }, { status: 500, headers: HEADERS });
  }
}
