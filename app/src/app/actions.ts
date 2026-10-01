"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { stepPath } from "@/domain/onboarding";
import { isLocalSupabase } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Development helper: shows the onboarding screens again. It only moves the step pointer back to the
 * start; every saved answer stays and is shown again on its screen. The button renders only in
 * development against the local Supabase, and the action checks both again because a server action
 * can be called without the button.
 */
export async function replayOnboardingForDev() {
  if (process.env.NODE_ENV !== "development" || !isLocalSupabase()) redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ lifecycle_state: "ONBOARDING", onboarding_step: null })
    .eq("user_id", user.id);
  if (error) redirect("/");

  revalidatePath("/", "layout");
  redirect(stepPath("welcome"));
}
