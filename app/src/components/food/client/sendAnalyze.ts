import {
  ANALYZE_ENDPOINT,
  ANALYZE_FIELDS,
  PROBLEM_REASONS,
  type AnalyzeFailure,
  type AnalyzeFields,
  type AnalyzeResponse,
} from "@/domain/food/analyzeTypes";

export type SendResult = AnalyzeResponse | { ok: false; reason: "network" };

export interface SendOptions {
  signal: AbortSignal;
  /** For tests. */
  fetchImpl?: typeof fetch;
}

// What the server may answer: every problem reason it can produce, plus the quiet screen. "network" is
// a client-side reason only, so a server body that says it is not trusted.
const SERVER_REASONS: ReadonlySet<string> = new Set<string>([
  ...PROBLEM_REASONS.filter((reason) => reason !== "network"),
  "quiet_time",
]);

// The only places the server sends a report to. Anything else in a body is treated as a broken answer.
const REDIRECT_PATTERN = /^\/report\/food\/[A-Za-z0-9-]+$/;

const NETWORK: SendResult = { ok: false, reason: "network" };

function parseBody(body: unknown): AnalyzeResponse | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.ok === true) {
    return typeof record.id === "string" && typeof record.redirectTo === "string" && REDIRECT_PATTERN.test(record.redirectTo)
      ? { ok: true, id: record.id, redirectTo: record.redirectTo }
      : null;
  }
  if (record.ok === false && typeof record.reason === "string" && SERVER_REASONS.has(record.reason)) {
    return { ok: false, reason: record.reason as AnalyzeFailure };
  }
  return null;
}

/** The proxy answers an unauthenticated request with a redirect to /login, which fetch follows. */
function endedAtLogin(response: Response): boolean {
  if (!response.redirected || !response.url) return false;
  try {
    return new URL(response.url, "http://localhost").pathname === "/login";
  } catch {
    return false;
  }
}

/**
 * Sends one report to the analyze endpoint (multipart, same origin). Never throws.
 *
 * An aborted request resolves as "network" as well; the caller owns the signal and must check
 * `signal.aborted` before it acts on the result, so a cancelled or replaced request never moves the screen.
 */
export async function sendAnalyze(
  input: { fields: AnalyzeFields; image: Blob | null },
  options: SendOptions,
): Promise<SendResult> {
  const { fields, image } = input;
  const body = new FormData();
  body.set(ANALYZE_FIELDS.mode, fields.mode);
  body.set(ANALYZE_FIELDS.text, fields.text);
  body.set(ANALYZE_FIELDS.requestId, fields.requestId);
  if (fields.composedMs !== null) body.set(ANALYZE_FIELDS.composedMs, String(fields.composedMs));
  if (image) body.set(ANALYZE_FIELDS.image, new File([image], "meal.jpg", { type: "image/jpeg" }));

  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    // No Content-Type header: the browser must set the multipart boundary itself.
    response = await doFetch(ANALYZE_ENDPOINT, { method: "POST", body, signal: options.signal, credentials: "same-origin" });
  } catch {
    return NETWORK;
  }

  if (endedAtLogin(response)) return { ok: false, reason: "not_signed_in" };

  let parsed: AnalyzeResponse | null = null;
  try {
    parsed = parseBody(await response.json());
  } catch {
    // Not JSON: a platform error page, a timeout, a body that was cut.
  }
  if (parsed) return parsed;

  if (response.status === 413) return { ok: false, reason: "too_large" };
  if (response.status === 401) return { ok: false, reason: "not_signed_in" };
  return NETWORK;
}
