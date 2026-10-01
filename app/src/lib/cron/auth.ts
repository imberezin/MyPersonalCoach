import { timingSafeEqual } from "node:crypto";

/**
 * The cron endpoint is called by Supabase pg_cron (via pg_net) with a shared secret:
 *   Authorization: Bearer <CRON_SECRET>
 * Compared in constant time. If no secret is configured, nothing is authorized.
 */
export function isValidCronRequest(request: Request, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret) return false;

  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);

  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
