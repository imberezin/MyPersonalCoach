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

/**
 * The check every cron route starts with: 503 when no secret is configured, 401 when the bearer is wrong,
 * otherwise null (go ahead). Returns the response to send, so a route cannot forget a status code.
 */
export function guardCronRequest(request: Request, secret: string | undefined = process.env.CRON_SECRET): Response | null {
  if (!secret) return Response.json({ error: "cron_not_configured" }, { status: 503 });
  if (!isValidCronRequest(request, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
