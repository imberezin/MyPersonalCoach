import { checkDemoEmail } from "../seed-demo/guard";
import { isLocalSupabaseUrl } from "@/lib/supabase/config";
import { BEHAVIORS, type Behavior } from "./rehearse";

/**
 * Flags of `npm run rehearse:weekly-push -- <flags>` (the wrapper packs them into REHEARSE_WEEKLY_ARGS as JSON, like seed:demo):
 *   --behavior ok|gone|rejected|retryable   what the dev server's fake provider answers (PUSH_FAKE_BEHAVIOR); default ok
 *   --base-url http://localhost:3010        the dev server; must be this machine
 *   --email demo@eating-coach.test          the throwaway local user; must end in @eating-coach.test
 */

export interface RehearseWeeklyArgs {
  behavior: Behavior;
  baseUrl: string;
  email: string;
}

export const DEFAULT_BASE_URL = "http://localhost:3010";

export type ParsedArgs = { ok: true; value: RehearseWeeklyArgs } | { ok: false; error: string };

const isBehavior = (v: unknown): v is Behavior => typeof v === "string" && (BEHAVIORS as readonly string[]).includes(v);

/** The dev server must be on this machine. A look-alike host (localhost.evil.test) is not. */
export function isLocalBaseUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]");
  } catch {
    return false;
  }
}

export function parseRehearseWeeklyArgs(raw: string | undefined): ParsedArgs {
  let flags: unknown;
  try {
    flags = raw === undefined || raw === "" ? {} : JSON.parse(raw);
  } catch {
    return { ok: false, error: "The flags could not be read." };
  }
  if (typeof flags !== "object" || flags === null || Array.isArray(flags)) return { ok: false, error: "The flags could not be read." };
  const record = flags as Record<string, unknown>;
  for (const name of Object.keys(record)) {
    if (name !== "behavior" && name !== "base-url" && name !== "email") return { ok: false, error: `Unknown flag --${name}. The flags are --behavior, --base-url and --email.` };
  }

  const behavior = "behavior" in record ? record.behavior : "ok";
  if (!isBehavior(behavior)) return { ok: false, error: `--behavior must be one of ${BEHAVIORS.join(", ")}.` };

  const baseUrl = "base-url" in record ? record["base-url"] : DEFAULT_BASE_URL;
  if (typeof baseUrl !== "string" || !isLocalBaseUrl(baseUrl)) return { ok: false, error: "--base-url must be a dev server on this machine (localhost or 127.0.0.1)." };

  const email = checkDemoEmail(typeof record.email === "string" ? record.email : "email" in record ? undefined : "demo@eating-coach.test");
  if (!email.ok) return { ok: false, error: "--email must be a throwaway local user, like demo@eating-coach.test." };

  return { ok: true, value: { behavior, baseUrl: baseUrl.replace(/\/+$/, ""), email: email.email } };
}

/** The rehearsal writes to a database, so it runs only against the local stack, and never in a production environment. */
export function assertLocalStack(a: { apiUrl: string | undefined; nodeEnv: string | undefined }): { ok: true } | { ok: false; reason: "not_local_stack" | "production" } {
  if (a.nodeEnv === "production") return { ok: false, reason: "production" };
  return isLocalSupabaseUrl(a.apiUrl) ? { ok: true } : { ok: false, reason: "not_local_stack" };
}
