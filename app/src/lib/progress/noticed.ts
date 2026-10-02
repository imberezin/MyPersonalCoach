import "server-only";
import { LATE_EVENING, type PatternKind, type PatternView } from "@/domain/patterns";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { loadExperiments, type OpenExperiment } from "@/lib/experiments/repo";
import { loadLateEveningSignal } from "@/lib/patterns/load";

/**
 * What the Progress screen may say about the First Week's observation and the experiment the person chose: the
 * answers of the First Week loaders, kept as they are. Read as the signed-in user, never written, no query of its
 * own, no AI. Nothing here is computed again: the pattern level is the LIVE one (the loader recomputes it from the
 * meals) and the experiment is the stored row.
 */
export interface NoticedFacts {
  patterns: readonly { kind: PatternKind; view: PatternView }[];
  activeExperiment: OpenExperiment | null;
}

const NOTHING: NoticedFacts = { patterns: [], activeExperiment: null };

/** The levels worth a sentence on Progress; NONE and REJECTED are silence (the same three the First Week summary names). */
const NOTICEABLE_VIEWS: readonly PatternView[] = ["EARLY_SIGNAL", "CANDIDATE", "VALIDATED"];

/**
 * Never throws. Calls the late-evening signal and the experiments loaders in parallel and keeps what they say: the
 * pattern kind with its live level when that level is noticeable, and the experiment whose status is ACTIVE (an
 * OFFERED one is a question, not something the person chose). A null (unknown, a switch off) is simply nothing.
 */
export async function loadNoticed(context: OnboardingContext, now: Date): Promise<NoticedFacts> {
  if (context.kind !== "ready") return { ...NOTHING };
  try {
    const { supabase, userId } = context;
    const timeZone = context.row.timezone;
    const [signal, experiments] = await Promise.all([
      loadLateEveningSignal(supabase, userId, timeZone, now),
      loadExperiments(supabase, userId),
    ]);

    const patterns = signal !== null && NOTICEABLE_VIEWS.includes(signal.view) ? [{ kind: LATE_EVENING.kind, view: signal.view }] : [];
    const open = experiments?.open ?? null;
    return { patterns, activeExperiment: open !== null && open.status === "ACTIVE" ? open : null };
  } catch {
    // The loaders catch their own failures; this only guards a malformed context.
    console.error("Progress: loading what we noticed threw");
    return { ...NOTHING };
  }
}
