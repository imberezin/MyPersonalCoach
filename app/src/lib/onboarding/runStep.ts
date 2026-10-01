import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnboardingRow, StepError, StepPlan } from "@/domain/onboarding";
import { syncShabbatPeriods } from "./shabbatSync";

export type RunStepResult = { ok: true } | { ok: false; error: StepError } | { ok: false; stale: true };

const SAVE_ERROR: RunStepResult = { ok: false, error: { code: "save_error" } };

/**
 * Executes the write plan of one step. It knows nothing about requests or redirects, so it can
 * be reasoned about on its own.
 *
 * The order matters. The profile write carries the step pointer, so a failure before it leaves
 * the step undone and a retry repeats the same writes. Shabbat periods come last and are best
 * effort: if they cannot be calculated the step still succeeds and the finish step retries.
 */
export async function runStep(a: {
  supabase: SupabaseClient;
  userId: string;
  row: OnboardingRow;
  plan: StepPlan;
  now: Date;
}): Promise<RunStepResult> {
  const { supabase, userId, row, plan, now } = a;

  if (plan.notifications) {
    const { data, error } = await supabase
      .from("user_preferences")
      .update({ notifications: plan.notifications })
      .eq("user_id", userId)
      .select("user_id");
    if (error || data?.length !== 1) return SAVE_ERROR;
  }

  if (Object.keys(plan.profilePatch).length > 0) {
    // The lifecycle state in the filter makes the write apply only if the user is still where the
    // page thought they were; a double submit of the finish step matches no row the second time.
    const { data, error } = await supabase
      .from("profiles")
      .update(plan.profilePatch)
      .eq("user_id", userId)
      .eq("lifecycle_state", row.lifecycle_state)
      .select("user_id");
    if (error) return SAVE_ERROR;
    if (!data || data.length === 0) return { ok: false, stale: true };
  }

  if (plan.shabbat) await syncShabbatPeriods(supabase, plan.shabbat, now);

  return { ok: true };
}
