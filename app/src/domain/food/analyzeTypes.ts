/**
 * The wire contract of `POST /api/food/analyze`, shared by the browser (which sends) and the server
 * (which answers). The fields are parsed in one place so both sides agree on what is valid.
 */
import { isUuid } from "./routes";
import { sanitizeFreeText } from "./sanitize";
import { FOOD_LIMITS } from "./types";

export const ANALYZE_ENDPOINT = "/api/food/analyze";

export const ANALYZE_FIELDS = { mode: "mode", text: "text", image: "image", requestId: "requestId", composedMs: "composedMs" } as const;

/** `manual` is the user's own words kept as a list; no AI is involved. */
export type AnalyzeMode = "photo" | "text" | "manual";

export const ANALYZE_FAILURES = [
  "quiet_time",
  "rate_limited",
  "daily_cap",
  "ai_unavailable",
  "ai_error",
  "nothing_found",
  "not_signed_in",
  "invalid_input",
  "too_large",
  "unsupported_type",
  "save_error",
] as const;
export type AnalyzeFailure = (typeof ANALYZE_FAILURES)[number];

/** What the browser can also meet that the server never says: the answer did not arrive. */
export type ClientAnalyzeFailure = AnalyzeFailure | "network";

/** The reasons that get a problem panel. `quiet_time` is excluded on purpose: the client navigates to D1, which renders the quiet screen. */
export type ProblemReason = Exclude<ClientAnalyzeFailure, "quiet_time">;

export const PROBLEM_REASONS: readonly ProblemReason[] = [
  ...ANALYZE_FAILURES.filter((reason): reason is Exclude<AnalyzeFailure, "quiet_time"> => reason !== "quiet_time"),
  "network",
];

export type AnalyzeResponse = { ok: true; id: string; redirectTo: string } | { ok: false; reason: AnalyzeFailure };

export interface AnalyzeFields {
  mode: AnalyzeMode;
  text: string;
  requestId: string;
  composedMs: number | null;
}

const MODES: readonly string[] = ["photo", "text", "manual"];
const COMPOSED_MS_MAX = 86_400_000;

function readComposedMs(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= COMPOSED_MS_MAX ? Math.round(n) : null;
}

/**
 * text: sanitizeFreeText, over 500 code points -> invalid_input (never a silent cut); empty text is
 * invalid for text/manual, allowed for photo; requestId must be a UUID; composedMs 0..86_400_000 else null.
 */
export function parseAnalyzeFields(get: (name: string) => unknown): { ok: true; value: AnalyzeFields } | { ok: false; reason: "invalid_input" } {
  const invalid = { ok: false, reason: "invalid_input" } as const;

  const mode = get(ANALYZE_FIELDS.mode);
  if (typeof mode !== "string" || !MODES.includes(mode)) return invalid;

  // A missing text is "", but a file or any other object in the text field is a malformed request.
  const rawText = get(ANALYZE_FIELDS.text);
  if (rawText !== null && rawText !== undefined && typeof rawText !== "string") return invalid;
  const { text, truncated } = sanitizeFreeText(rawText ?? "", FOOD_LIMITS.textMax);
  if (truncated) return invalid;
  if (text === "" && mode !== "photo") return invalid;

  const requestId = get(ANALYZE_FIELDS.requestId);
  if (!isUuid(requestId)) return invalid;

  return {
    ok: true,
    value: { mode: mode as AnalyzeMode, text, requestId, composedMs: readComposedMs(get(ANALYZE_FIELDS.composedMs)) },
  };
}
