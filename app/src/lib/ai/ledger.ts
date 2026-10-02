import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AIRecorder, AiCallRecord, ProviderErrorKind } from "./types";

/**
 * The server-side ledger: `ai_requests` (one row per provider attempt, also the quota counter) and
 * `app_errors` (short codes for the owner). Written with the admin client because the owner can
 * only read these tables. Nothing here ever receives a prompt, a text, an image or a response body;
 * the types do not have a place for them. Every write is best effort and never throws.
 */

/** True when the admin client could be built. Pure: it looks at the environment and builds nothing. Mirrors createAdminClient. */
export function isAdminConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  return typeof url === "string" && url.trim() !== "" && typeof key === "string" && key.trim() !== "";
}

type ErrorContext = Record<string, string | number | boolean | null>;

const MAX_TEXT = 64;

/** Small primitives only: long strings are dropped, so a stray piece of user content cannot slip into the table. */
function safeContext(context: ErrorContext | undefined): ErrorContext {
  const clean: ErrorContext = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (typeof value === "string" && value.length > MAX_TEXT) continue;
    clean[key.slice(0, MAX_TEXT)] = value;
  }
  return clean;
}

function adminOrNull(admin: SupabaseClient | undefined): SupabaseClient | null {
  if (admin) return admin;
  try {
    return createAdminClient();
  } catch {
    return null; // not configured: the ledger degrades to a no-op
  }
}

/** One row in `app_errors`. `userId` comes from the verified session, never from a request. */
export async function logAppError(a: {
  userId: string | null;
  area: "ai" | "food" | "ledger" | "weight";
  message: string;
  context?: ErrorContext;
  admin?: SupabaseClient;
}): Promise<void> {
  try {
    const client = adminOrNull(a.admin);
    if (!client) return;
    const { error } = await client
      .from("app_errors")
      .insert({ user_id: a.userId, area: a.area, message: a.message.slice(0, MAX_TEXT), context: safeContext(a.context) });
    if (error) console.error("ledger: app_errors insert failed");
  } catch {
    console.error("ledger: app_errors insert failed");
  }
}

const ERROR_CODE: Partial<Record<ProviderErrorKind, string>> = {
  auth: "provider_auth",
  bad_request: "provider_bad_request",
  blocked: "provider_blocked",
};

const wholeOrNull = (n: number | null): number | null => (n === null || !Number.isFinite(n) ? null : Math.max(0, Math.round(n)));

/**
 * The recorder the gateway calls after every provider attempt. It never throws, including at
 * construction: the admin client is built lazily inside `record` (createAdminClient throws when the
 * key is missing), and without it `record` is a no-op.
 */
export function createSupabaseRecorder(a: { userId: string; admin?: SupabaseClient }): AIRecorder {
  return {
    async record(rec: AiCallRecord): Promise<void> {
      try {
        const client = adminOrNull(a.admin);
        if (!client) return;
        const { error } = await client.from("ai_requests").insert({
          user_id: a.userId,
          operation: rec.operation,
          provider: rec.provider,
          model: rec.model,
          latency_ms: wholeOrNull(rec.latencyMs),
          input_tokens: wholeOrNull(rec.inputTokens),
          output_tokens: wholeOrNull(rec.outputTokens),
          outcome: rec.outcome,
        });
        if (error) console.error("ledger: ai_requests insert failed");

        const code = rec.errorKind ? ERROR_CODE[rec.errorKind] : undefined;
        if (code) {
          await logAppError({
            userId: a.userId,
            area: "ai",
            message: code,
            context: { provider: rec.provider, model: rec.model, operation: rec.operation },
            admin: client,
          });
        }
      } catch {
        console.error("ledger: recording an AI call failed");
      }
    },
  };
}
