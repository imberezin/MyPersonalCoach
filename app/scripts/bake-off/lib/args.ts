/**
 * Flags of `npm run bakeoff -- <flags>`. The vitest CLI rejects unknown options, so `cli.mjs` packs the
 * flags into one JSON environment variable (BAKEOFF_ARGS) and this module validates it BEFORE any call.
 */

export type BakeOffProvider = "gemini" | "groq";

export interface BakeOffOptions {
  provider: BakeOffProvider | null;
  model: string | null;
  set: "text" | "photo" | "all";
  prompt: "he" | "en";
  format: "json_object" | "json_schema" | null;
  /** Per modality: the first N cases. */
  limit: number | null;
  delayMs: number | null;
  /** The fake provider; never touches the network. */
  dryRun: boolean;
}

export type ParsedArgs = { ok: true; value: BakeOffOptions } | { ok: false; error: string };

const KNOWN = new Set(["provider", "model", "set", "prompt", "format", "limit", "delay-ms", "dry-run"]);
const MODEL = /^[A-Za-z0-9._/:-]{1,100}$/;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function wholeNumber(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function parseBakeOffArgs(json: string | undefined): ParsedArgs {
  let raw: unknown = {};
  if (json !== undefined && json !== "") {
    try {
      raw = JSON.parse(json);
    } catch {
      return { ok: false, error: "BAKEOFF_ARGS is not valid JSON" };
    }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "BAKEOFF_ARGS must be an object" };
  const flags = raw as Record<string, unknown>;

  for (const key of Object.keys(flags)) {
    if (!KNOWN.has(key)) return { ok: false, error: `Unknown flag --${key}` };
  }

  const dryRun = flags["dry-run"] === true || flags["dry-run"] === "true";
  if (flags["dry-run"] !== undefined && !dryRun && flags["dry-run"] !== false && flags["dry-run"] !== "false") {
    return { ok: false, error: "--dry-run takes no value" };
  }

  let provider: BakeOffProvider | null = null;
  if (flags.provider !== undefined) {
    provider = oneOf(flags.provider, ["gemini", "groq"] as const);
    if (!provider) return { ok: false, error: "--provider must be gemini or groq" };
  } else if (!dryRun) {
    return { ok: false, error: "--provider gemini|groq is required (or use --dry-run)" };
  }

  let model: string | null = null;
  if (flags.model !== undefined) {
    if (typeof flags.model !== "string" || !MODEL.test(flags.model)) return { ok: false, error: "--model is not a valid model id" };
    model = flags.model;
  }

  const set = flags.set === undefined ? "all" : oneOf(flags.set, ["text", "photo", "all"] as const);
  if (!set) return { ok: false, error: "--set must be text, photo or all" };

  const prompt = flags.prompt === undefined ? "he" : oneOf(flags.prompt, ["he", "en"] as const);
  if (!prompt) return { ok: false, error: "--prompt must be he or en" };

  let format: BakeOffOptions["format"] = null;
  if (flags.format !== undefined) {
    format = oneOf(flags.format, ["json_object", "json_schema"] as const);
    if (!format) return { ok: false, error: "--format must be json_object or json_schema" };
    if (provider === "gemini") return { ok: false, error: "--format applies to Groq only" };
  }

  let limit: number | null = null;
  if (flags.limit !== undefined) {
    limit = wholeNumber(flags.limit, 1, 1000);
    if (limit === null) return { ok: false, error: "--limit must be a whole number from 1 to 1000" };
  }

  let delayMs: number | null = null;
  if (flags["delay-ms"] !== undefined) {
    delayMs = wholeNumber(flags["delay-ms"], 0, 600_000);
    if (delayMs === null) return { ok: false, error: "--delay-ms must be a whole number from 0 to 600000" };
  }

  return { ok: true, value: { provider, model, set, prompt, format, limit, delayMs, dryRun } };
}
