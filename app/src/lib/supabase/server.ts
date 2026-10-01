import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "./config";

/** Supabase client for Server Components, Server Actions and Route Handlers. Runs as the signed-in user (RLS applies). */
export async function createClient() {
  const config = getSupabasePublicConfig();
  if (!config) throw new Error("Supabase is not configured (see .env.example)");

  const cookieStore = await cookies();

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which cannot set cookies.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
