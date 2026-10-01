import "server-only";
import { redirect } from "next/navigation";
import { resolveTimeZone } from "@/domain/home";
import { isOffline } from "@/domain/offline";
import { loadOfflinePeriods } from "@/lib/home/load";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { openAppGate } from "@/app/(app)/_lib/gate";

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;

export type ReportGate =
  | { kind: "not_configured" }
  | { kind: "unavailable" }
  | { kind: "ready"; context: ReadyContext; now: Date; timeZone: string };

export type FoodEntryGate = { kind: "not_configured" } | { kind: "unavailable" } | { kind: "quiet" } | Extract<ReportGate, { kind: "ready" }>;

/**
 * The guard of the screens that open an existing report (D6, D7, D8): the app's own gate (not configured,
 * or onboarding unfinished and the user is sent there), then the session. A page guard does not protect a
 * direct POST, so the Server Actions check the same things again themselves.
 *
 * There is no quiet-time check here on purpose: finishing a report that was started before candle
 * lighting is never blocked. `now` is the one clock read of the page, so what is decided and what is
 * shown cannot drift apart.
 */
export async function openReportGate(): Promise<ReportGate> {
  const gate = await openAppGate();
  if (gate.kind === "not_configured") return gate;

  const { context } = gate;
  // The proxy owns sign-in; this only covers a session that ended between the proxy and the page.
  if (context.kind === "signed_out") redirect("/login");
  if (context.kind !== "ready") return { kind: "unavailable" };

  return { kind: "ready", context, now: new Date(), timeZone: resolveTimeZone(context.row.timezone) };
}

/**
 * The guard of the screens that start a report (D1, D2, D3): the report gate, then the offline periods.
 * During Shabbat or any other offline period the screen is the quiet one, with no override. When the
 * periods cannot be read they are unknown, which is NOT quiet: the read fails open, and the analyze
 * endpoint checks again before anything is created.
 */
export async function openFoodEntryGate(): Promise<FoodEntryGate> {
  const gate = await openReportGate();
  if (gate.kind !== "ready") return gate;

  const periods = await loadOfflinePeriods(gate.context.supabase, gate.context.userId, gate.now);
  if (periods && isOffline(periods, gate.now)) return { kind: "quiet" };
  return gate;
}
