import "server-only";
import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { ONBOARDING_ROW_COLUMNS, normalizeRow, type OnboardingRow } from "@/domain/onboarding";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type OnboardingContext =
  | { kind: "not_configured" }
  | { kind: "signed_out" }
  /** Supabase could not be reached or answered with an error. Nothing is known about the user. */
  | { kind: "unavailable" }
  | { kind: "profile_missing" }
  | { kind: "ready"; userId: string; row: OnboardingRow; supabase: SupabaseClient };

/**
 * Who the visitor is and where they stand in onboarding. Cached per request, so Home, the
 * onboarding pages and the Server Action share one lookup.
 *
 * It runs as the signed-in user (never the admin client), so row level security applies, and it
 * asks the Auth server (`getUser`) rather than trusting the cookie (`getSession`). Any failure
 * is reported as `unavailable`; the pages show a calm retry state instead of guessing.
 */
export const loadOnboardingContext = cache(async (): Promise<OnboardingContext> => {
  if (!isSupabaseConfigured()) return { kind: "not_configured" };

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (!user) {
      // No session is the normal signed-out case. Only a network or server fault is "unavailable".
      return authError && (isAuthRetryableFetchError(authError) || (authError.status ?? 0) >= 500)
        ? { kind: "unavailable" }
        : { kind: "signed_out" };
    }

    const [profile, prefs] = await Promise.all([
      supabase.from("profiles").select(ONBOARDING_ROW_COLUMNS).eq("user_id", user.id).maybeSingle(),
      supabase.from("user_preferences").select("notifications").eq("user_id", user.id).maybeSingle(),
    ]);
    if (profile.error || prefs.error) return { kind: "unavailable" };

    const row = normalizeRow(profile.data, prefs.data);
    return row ? { kind: "ready", userId: user.id, row, supabase } : { kind: "profile_missing" };
  } catch {
    return { kind: "unavailable" };
  }
});
