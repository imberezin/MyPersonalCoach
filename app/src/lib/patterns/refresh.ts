import "server-only";
import { LATE_EVENING, PATTERN_FLOW } from "@/domain/patterns";
import { resolveTimeZone } from "@/domain/time";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { loadLateEveningSignal } from "./load";
import { syncPatternEvidence } from "./sync";

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;

/**
 * The end-of-action refresh, called after an explicit Save or Delete of a meal. It keeps the stored mirror of the
 * person's OWN pattern equal to their meals, and it does NOTHING unless that pattern row already exists (the person
 * already answered B4 or chose an experiment): for a person who never engaged it reads one row and stops, ZERO
 * writes. A REJECTED row is left alone. Never throws, emits no event, returns nothing: a failed refresh is harmless
 * because no decision reads the mirror (the live signal is recomputed from the meals every time) and the next sync
 * converges it.
 */
export async function refreshPatternsAfterMealChange(context: ReadyContext, now: Date = new Date()): Promise<void> {
  try {
    if (!PATTERN_FLOW.syncOnMealChange || !PATTERN_FLOW.detectionEnabled) return;
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("patterns")
      .select("id, status")
      .eq("user_id", userId)
      .eq("kind", LATE_EVENING.kind)
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return;
    const existing = data[0] as { status?: unknown } | null;
    if (existing?.status === "REJECTED") return;

    const signal = await loadLateEveningSignal(supabase, userId, resolveTimeZone(context.row.timezone), now);
    if (signal === null || signal.view === "REJECTED") return;

    await syncPatternEvidence(supabase, { occurrences: signal.occurrences, view: signal.view });
  } catch {
    // Harmless by design (see above).
  }
}
