import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./config";

/** Supabase client for Client Components. Uses only the publishable key; RLS protects the data. */
export function createClient() {
  const config = getSupabasePublicConfig();
  if (!config) throw new Error("Supabase is not configured (see .env.example)");
  return createBrowserClient(config.url, config.key);
}
