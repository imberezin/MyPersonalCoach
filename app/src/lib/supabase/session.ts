import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "./config";

export interface SessionResult {
  /** Response that carries any refreshed auth cookies. Return it (or copy its cookies). */
  response: NextResponse;
  user: User | null;
  /** False when Supabase environment variables are missing (local setup in progress). */
  configured: boolean;
}

/**
 * Refreshes the Supabase session on every matched request.
 * `getUser()` asks the Auth server to validate the token, which is slower than
 * checking the JWT locally but is the safe choice for a Phase 1 app.
 */
export async function updateSession(request: NextRequest): Promise<SessionResult> {
  let response = NextResponse.next({ request });
  const config = getSupabasePublicConfig();
  if (!config) return { response, user: null, configured: false };

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user, configured: true };
}
