import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Privileged client that BYPASSES row level security.
 * Use it only in server code that cannot be reached with another user's identity
 * (the cron route, jobs). Never import it from a Client Component.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin client is not configured (see .env.example)");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
