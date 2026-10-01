/**
 * CSRF guard for Route Handlers. Server Actions carry Next's own Origin check; a Route Handler does
 * not, so it asks this on top of the SameSite cookies Supabase already sets.
 *
 * The request is same-origin only when it names an Origin whose host (with port) equals the host the
 * browser asked for: `x-forwarded-host` when a proxy set it (Vercel does), else `host`. A request with
 * no Origin is refused (browsers always send one on a cross-origin or POST fetch), and so is anything
 * the browser itself marks `Sec-Fetch-Site: cross-site`.
 */
export function isSameOrigin(headers: Pick<Headers, "get">): boolean {
  if (headers.get("sec-fetch-site")?.trim().toLowerCase() === "cross-site") return false;

  const origin = headers.get("origin");
  if (!origin) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // "null" (a sandboxed frame) and anything else that is not a URL
  }

  // A proxy chain can append hosts ("a, b"); the first one is what the browser asked for.
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const expected = forwarded || headers.get("host")?.trim();
  if (!expected) return false;

  return originHost.toLowerCase() === expected.toLowerCase();
}
