import { ANALYZE_FIELDS, IMAGE_LIMITS, parseAnalyzeFields, sniffImageType, type AnalyzeFailure, type AnalyzeResponse } from "@/domain/food";
import { resolveTimeZone } from "@/domain/home";
import { SupabaseEventsSink, track } from "@/lib/analytics/track";
import { checkAiAllowance } from "@/lib/ai/allowance";
import { readAiConfig } from "@/lib/ai/config";
import { createAiRuntime, type AiRuntime } from "@/lib/ai/factory";
import { AIGateway } from "@/lib/ai/gateway";
import { createSupabaseRecorder, logAppError } from "@/lib/ai/ledger";
import { MEAL_PROMPT_VERSION } from "@/lib/ai/prompts/meal";
import { runFoodAnalysis, type AnalyzeInput } from "@/lib/food/analyze";
import { createUnderstanding, findByRequestId } from "@/lib/food/repo";
import { loadOfflinePeriods } from "@/lib/home/load";
import { isSameOrigin } from "@/lib/http/sameOrigin";
import { loadOnboardingContext } from "@/lib/onboarding/context";
import { getLocale } from "@/i18n/server";

// The one long call of the food flow. A Route Handler and not a Server Action, on purpose: a real Cancel
// (AbortController), failures the screen can name instead of an error boundary, and no Server Action queue.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Self-imposed ceiling, far below the platform's: 28 s of provider time (see the gateway) and 12 s for the database.
export const maxDuration = 40;

const HEADERS = { "Cache-Control": "no-store" } as const;

function answer(body: AnalyzeResponse, status = 200): Response {
  return Response.json(body, { status, headers: HEADERS });
}

const refuse = (reason: AnalyzeFailure, status: number): Response => answer({ ok: false, reason }, status);

/** A runtime with no providers: AI is off and the manual path still works. */
function offlineRuntime(): AiRuntime {
  return {
    gateway: new AIGateway([]),
    configured: false,
    providers: [],
    config: readAiConfig({}, "production"),
    promptVersion: MEAL_PROMPT_VERSION,
  };
}

/** Building the runtime must never turn a request into a 500: a failure means "AI is not configured". */
function buildRuntime(userId: string): AiRuntime {
  try {
    return createAiRuntime({ recorder: createSupabaseRecorder({ userId }) });
  } catch {
    return offlineRuntime();
  }
}

/**
 * POST /api/food/analyze (multipart): turns a typed description or one compressed photo into a pending
 * report and answers where to go next. Order, all before any AI call: same origin, body size, session,
 * fields, then the picture (size, then the JPEG magic bytes; the declared type is ignored).
 *
 * The photo lives in one Uint8Array for the length of this request and is then dropped: no file system,
 * no storage, no cache, no log. Nothing the user wrote is ever logged; only short codes are. If the
 * client goes away, the result simply becomes a pending report that the first screen offers to resume.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return refuse("invalid_input", 403);

  // Content-Length first: request.formData() buffers the whole body before a file size can be read.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > IMAGE_LIMITS.requestMaxBytes) return refuse("too_large", 413);

  // One Auth round trip: the context calls getUser() once and hands over the client, the user id and the profile.
  // Nothing else on this path may call getUser(), because React's cache() does not dedupe outside a render.
  const context = await loadOnboardingContext();
  if (context.kind === "signed_out") return refuse("not_signed_in", 401);
  if (context.kind !== "ready") return refuse("save_error", 503);
  const { supabase, userId, row } = context;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse("invalid_input", 400);
  }

  const parsed = parseAnalyzeFields((name) => form.get(name));
  if (!parsed.ok) return refuse(parsed.reason, 400);
  const fields = parsed.value;

  let image: AnalyzeInput["image"] = null;
  const file = form.get(ANALYZE_FIELDS.image);
  if (fields.mode === "photo") {
    if (!(file instanceof File)) return refuse("invalid_input", 400);
    if (file.size > IMAGE_LIMITS.serverMaxBytes) return refuse("too_large", 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (sniffImageType(bytes) !== "jpeg") return refuse("unsupported_type", 415);
    image = { bytes, type: "jpeg" };
  } else if (file !== null) {
    return refuse("invalid_input", 400);
  }

  const now = new Date();
  const sink = new SupabaseEventsSink(supabase);
  try {
    const result = await runFoodAnalysis(
      {
        supabase,
        userId,
        timeZone: resolveTimeZone(row.timezone),
        now,
        locale: await getLocale(),
        runtime: buildRuntime(userId),
        loadOfflinePeriods,
        allowance: checkAiAllowance,
        repo: { createUnderstanding, findByRequestId },
        track: (name, payload) => track(sink, name, payload, now),
        logError: logAppError,
      },
      { fields, image },
    );
    return answer(result);
  } catch {
    // A code only: the text, the photo and the provider's words are not in scope here, and must not be.
    console.error("Food: the analysis threw unexpectedly");
    await logAppError({ userId, area: "food", message: "save_error", context: { mode: fields.mode, code: "exception" } });
    return refuse("save_error", 500);
  }
}
