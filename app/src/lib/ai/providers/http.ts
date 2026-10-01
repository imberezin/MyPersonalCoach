import { ProviderError, type ProviderErrorKind } from "../types";

export interface PostJsonOptions {
  /** Aborted by the gateway on timeout. */
  signal: AbortSignal;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

/** A provider answer larger than this is not an answer to a meal question. */
const MAX_RESPONSE_CHARS = 1_000_000;

/** HTTP status to error kind. Only the status is used: a response body can echo the user's text. */
export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

/**
 * POSTs JSON and returns the parsed JSON body. Every failure is a `ProviderError` whose message is
 * a code, never a piece of the response. An abort is rethrown untouched, so the gateway can tell a
 * timeout from a network failure. The URL must not contain a key: keys go in `init.headers`.
 */
export async function postJson(
  url: string,
  init: { headers: Record<string, string>; body: unknown },
  options: PostJsonOptions,
): Promise<unknown> {
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...init.headers },
      body: JSON.stringify(init.body),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (isAbort(error, options.signal)) throw error;
    throw new ProviderError("network");
  }

  if (!response.ok) {
    // The body is not read; release the connection.
    try {
      await response.body?.cancel();
    } catch {
      // Nothing to do.
    }
    throw new ProviderError(kindForStatus(response.status), response.status);
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (isAbort(error, options.signal)) throw error;
    throw new ProviderError("network", response.status);
  }
  if (text.length > MAX_RESPONSE_CHARS) throw new ProviderError("server", response.status);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError("server", response.status);
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

/**
 * The model's text as a value. Models sometimes wrap JSON in a code fence or a reasoning block even
 * when told not to, so those are removed; anything else that is not JSON gives `null`, which the
 * gateway then treats as invalid output. The text itself is never kept or logged.
 */
export function parseModelJson(text: string | null | undefined): unknown {
  if (typeof text !== "string") return null;
  let body = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fence) body = fence[1];
  try {
    return JSON.parse(body) as unknown;
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(body.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

/** base64 of image bytes (Node runtime only; adapters run on the server). */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** The photo path only ever produces JPEG; anything else declared is treated as JPEG too. */
export function imageMime(mime: string | undefined): string {
  return mime && IMAGE_MIMES.has(mime) ? mime : "image/jpeg";
}
