import { isLocalSupabaseUrl } from "@/lib/supabase/config";

/** The only accounts the seed script will touch: throwaway users of the local stack. */
export const DEMO_EMAIL_SUFFIX = "@eating-coach.test";

const LOCAL_PART = /^[a-z0-9._+-]{1,40}$/;

export type SeedTarget =
  | { ok: true; email: string }
  | { ok: false; reason: "not_local_stack" | "bad_email" | "bad_email_suffix" };

export type DemoEmail = { ok: true; email: string } | { ok: false; reason: "bad_email" | "bad_email_suffix" };

/**
 * The e-mail alone: trimmed, lower-cased, exactly "<1 to 40 of [a-z0-9._+-]>@eating-coach.test". The domain is compared
 * whole (a substring or a longer domain such as eating-coach.test.evil.com is a different suffix). Never throws.
 */
export function checkDemoEmail(email: string | undefined): DemoEmail {
  if (typeof email !== "string") return { ok: false, reason: "bad_email" };
  const value = email.trim().toLowerCase();
  if (value === "" || /\s/.test(value)) return { ok: false, reason: "bad_email" };

  const parts = value.split("@");
  if (parts.length !== 2) return { ok: false, reason: "bad_email" };
  const [local, domain] = parts;
  if (`@${domain}` !== DEMO_EMAIL_SUFFIX) return { ok: false, reason: "bad_email_suffix" };
  if (!LOCAL_PART.test(local)) return { ok: false, reason: "bad_email" };
  return { ok: true, email: value };
}

/**
 * ok iff the API URL is the local stack (the ONE existing `isLocalSupabaseUrl` of @/lib/supabase/config, imported and not
 * copied, so this guard can never be weaker than the one the replay button and the dev clock use) AND the e-mail is a
 * throwaway one. When both are wrong the URL reason is reported first. Never throws.
 */
export function assertSeedTarget(a: { apiUrl: string | undefined; email: string | undefined }): SeedTarget {
  try {
    if (!isLocalSupabaseUrl(a.apiUrl)) return { ok: false, reason: "not_local_stack" };
    return checkDemoEmail(a.email);
  } catch {
    return { ok: false, reason: "not_local_stack" };
  }
}
