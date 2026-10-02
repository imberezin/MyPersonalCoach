import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isLocalSupabaseUrl } from "@/lib/supabase/config";

/**
 * App root, gitignored: one ISO-8601 instant with an offset, for example 2026-09-17T09:00:00+03:00. Written by
 * whoever controls the checkout (the local seed script), never by a request.
 */
export const DEV_CLOCK_FILE = ".dev-clock";

// An instant with a time and an explicit offset (or Z). A date alone and a time without an offset are refused: they
// would be read in the server's own zone, which is exactly the surprise a test clock must not have.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The pure core `currentInstant` is made of; the tests drive it with a fake environment and a fake reader.
 *
 * The file's instant is used only when ALL of these hold: NODE_ENV is "development", the Supabase URL is the local
 * one (the same `isLocalSupabaseUrl` the development-only replay button uses, so this guard can never be weaker than
 * that one), and the file exists and holds a valid instant with an offset. Anything else, a read error included, is
 * the real clock. The result is always a fresh Date.
 */
export function resolveInstant(a: {
  nodeEnv: string | undefined;
  supabaseUrl: string | undefined;
  readFile: () => string | null;
  real: () => Date;
}): Date {
  if (a.nodeEnv !== "development") return a.real();
  if (!isLocalSupabaseUrl(a.supabaseUrl)) return a.real();

  let text: string | null;
  try {
    text = a.readFile();
  } catch {
    return a.real();
  }
  const trimmed = text?.trim() ?? "";
  if (!ISO_WITH_OFFSET.test(trimmed)) return a.real();

  const instant = new Date(trimmed);
  if (Number.isNaN(instant.getTime()) || !isRealCalendarDay(trimmed)) return a.real();
  return instant;
}

/** Date.parse rolls 2026-02-30 over to March 2; a test clock must not quietly invent a day. */
function isRealCalendarDay(text: string): boolean {
  const [year, month, day] = text.slice(0, 10).split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function readDevClockFile(): string | null {
  try {
    return readFileSync(join(process.cwd(), DEV_CLOCK_FILE), "utf8");
  } catch {
    return null;
  }
}

/**
 * The single place server code asks "what time is it". It takes NO argument, so nothing from a request (a cookie, a
 * header, a query string) can reach it. In production, and in any NODE_ENV other than "development", it is
 * `new Date()`; the check on NODE_ENV is the first statement and returns early, so a production build removes the
 * rest as dead code.
 */
export function currentInstant(): Date {
  if (process.env.NODE_ENV !== "development") return new Date();
  return resolveInstant({
    nodeEnv: process.env.NODE_ENV,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    readFile: readDevClockFile,
    real: () => new Date(),
  });
}
