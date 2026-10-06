/**
 * AI configuration. The defaults live ONLY in this file and the environment overrides them: model
 * ids (which providers retire and rename), timeouts and the per-user caps never appear anywhere
 * else. Pure and server-free, so the pages, the factory and the bake-off all read it the same way.
 */

export type AiProviderId = "gemini" | "groq" | "fake";

export interface AiConfig {
  providerOrder: readonly AiProviderId[];
  gemini: { apiKey: string | null; model: string; thinkingLevel: string | null };
  groq: { apiKey: string | null; model: string; responseFormat: "json_object" | "json_schema"; reasoningEffort: string; reasoningFormat: string };
  /** Output budget of one answer. Generous on purpose: a Gemini thinking model spends it on thoughts too. */
  maxOutputTokens: number;
  /** Per attempt for a photo and for text, and the total across attempts of one report. */
  timeoutsMs: { photo: number; text: number; total: number };
  /** Provider ATTEMPTS per user (retries count), read from the ai_requests ledger. */
  caps: { dailyCalls: number; perMinuteCalls: number };
}

export const AI_DEFAULTS = {
  // Chosen by the Hebrew text bake-off of 2026-10-01 (Technology Stack 11.3); the 20-photo run was declared not required on
  // 2026-10-05. Provider model lifecycles are short:
  // gemini-3.1-flash-lite has a published shutdown date (2027-05-07) and the Groq model is a Preview model.
  models: { gemini: "gemini-3.1-flash-lite", groq: "qwen/qwen3.8-27b" },
  providerOrder: ["gemini", "groq"] as readonly AiProviderId[],
  gemini: {
    // The lowest thinking level the REST reference lists as a regular choice. To be confirmed by the first bake-off run.
    thinkingLevel: "LOW",
  },
  groq: {
    // JSON mode is the one documented to work together with an image.
    responseFormat: "json_object" as "json_object" | "json_schema",
    // The model reasons by default; "none" is the lowest effort its docs list, and the reasoning is hidden from the answer.
    // Never "raw": Groq answers HTTP 400 for raw reasoning together with JSON mode.
    reasoningEffort: "none",
    reasoningFormat: "hidden",
  },
  maxOutputTokens: 2048,
  timeoutsMs: { photo: 14_000, text: 10_000, total: 28_000 },
  // Decided default: 40 attempts a day and 3 a minute. Change by environment (AI_DAILY_CAP, AI_PER_MINUTE_CAP), not in code.
  caps: { dailyCalls: 40, perMinuteCalls: 3 },
} as const;

const KNOWN_PROVIDERS: readonly AiProviderId[] = ["gemini", "groq", "fake"];

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A whole number from 0 up to a sane ceiling; anything else (empty, text, negative, huge) is the fallback. */
function wholeNumber(value: string | undefined, fallback: number): number {
  const raw = text(value);
  if (raw === null || !/^\d{1,6}$/.test(raw)) return fallback;
  return Number(raw);
}

function parseOrder(value: string | undefined, nodeEnv: string): AiProviderId[] | null {
  const raw = text(value);
  if (raw === null) return null;
  if (raw.toLowerCase() === "none") return [];
  const order: AiProviderId[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase() as AiProviderId;
    if (!KNOWN_PROVIDERS.includes(id) || order.includes(id)) continue;
    if (id === "fake" && nodeEnv === "production") continue; // the fake provider never runs in production
    order.push(id);
  }
  return order;
}

/**
 * Reads the configuration from an environment. Pure: it never touches `process.env` itself.
 * Env names: GEMINI_API_KEY, GEMINI_MODEL, GROQ_API_KEY, GROQ_MODEL, GROQ_RESPONSE_FORMAT,
 * AI_PROVIDER_ORDER (comma list; "none" = no providers at all), AI_DAILY_CAP, AI_PER_MINUTE_CAP.
 */
export function readAiConfig(env: Record<string, string | undefined>, nodeEnv: string): AiConfig {
  const geminiKey = text(env.GEMINI_API_KEY);
  const groqKey = text(env.GROQ_API_KEY);

  let providerOrder = parseOrder(env.AI_PROVIDER_ORDER, nodeEnv);
  if (providerOrder === null) {
    // No explicit order. In development with no real key the visible "Test result (fake)" provider is used.
    providerOrder = nodeEnv === "development" && !geminiKey && !groqKey ? ["fake"] : [...AI_DEFAULTS.providerOrder];
  }

  const format = text(env.GROQ_RESPONSE_FORMAT);
  return {
    providerOrder,
    gemini: { apiKey: geminiKey, model: text(env.GEMINI_MODEL) ?? AI_DEFAULTS.models.gemini, thinkingLevel: AI_DEFAULTS.gemini.thinkingLevel },
    groq: {
      apiKey: groqKey,
      model: text(env.GROQ_MODEL) ?? AI_DEFAULTS.models.groq,
      responseFormat: format === "json_object" || format === "json_schema" ? format : AI_DEFAULTS.groq.responseFormat,
      reasoningEffort: AI_DEFAULTS.groq.reasoningEffort,
      reasoningFormat: AI_DEFAULTS.groq.reasoningFormat,
    },
    maxOutputTokens: AI_DEFAULTS.maxOutputTokens,
    timeoutsMs: { ...AI_DEFAULTS.timeoutsMs },
    caps: {
      dailyCalls: wholeNumber(env.AI_DAILY_CAP, AI_DEFAULTS.caps.dailyCalls),
      perMinuteCalls: wholeNumber(env.AI_PER_MINUTE_CAP, AI_DEFAULTS.caps.perMinuteCalls),
    },
  };
}

/** The providers that can actually run: listed in the order, and (except the fake) with a key. */
export function usableProviders(config: AiConfig): AiProviderId[] {
  return config.providerOrder.filter((id) => (id === "gemini" ? !!config.gemini.apiKey : id === "groq" ? !!config.groq.apiKey : true));
}
