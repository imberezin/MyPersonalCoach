import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

// Next.js 16 renamed `middleware` to `proxy`.

const PUBLIC_PATHS = ["/login"];

function redirectKeepingCookies(request: NextRequest, from: NextResponse, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export async function proxy(request: NextRequest) {
  const { response, user, configured } = await updateSession(request);

  // Before Supabase is set up, let the home page explain what is missing.
  if (!configured) return response;

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) return redirectKeepingCookies(request, response, "/login");
  if (user && pathname === "/login") return redirectKeepingCookies(request, response, "/");

  return response;
}

export const config = {
  // Skip static assets, the service worker, the manifest, icons and the cron endpoint
  // (the cron endpoint authenticates with a secret header, not a session).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|api/engine/|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
