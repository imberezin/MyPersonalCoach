"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | {
      error: "missing_fields" | "invalid_credentials" | "not_configured" | "unavailable";
      /** Returned so the form can keep the email after a failed attempt (React resets the form). */
      email: string;
    }
  | null;

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const typedEmail = String(formData.get("email") ?? "");

  if (!isSupabaseConfigured()) return { error: "not_configured", email: typedEmail };

  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "missing_fields", email: typedEmail };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // A wrong password is a 400. Anything else (network, server) is not the user's fault.
    const wrongCredentials = error.status === 400 || error.code === "invalid_credentials";
    return { error: wrongCredentials ? "invalid_credentials" : "unavailable", email: typedEmail };
  }

  redirect("/");
}
