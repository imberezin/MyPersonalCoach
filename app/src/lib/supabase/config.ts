// NEXT_PUBLIC_* variables must be referenced statically so Next.js can inline them
// into the browser bundle. Do not read them through a dynamic key.

export interface SupabasePublicConfig {
  url: string;
  key: string;
}

/** Supabase now calls it a "publishable key"; the older name is "anon key". Either works. */
export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export function isSupabaseConfigured(): boolean {
  return getSupabasePublicConfig() !== null;
}

/**
 * True when the URL points at the Supabase running on this machine (npm run local:start). The
 * development-only tools use it to stay away from a real, hosted project.
 */
export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function isLocalSupabase(): boolean {
  return isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
}
