import type { Locale } from "@/i18n/config";

export interface MealInput {
  /** A food photo (already compressed on the device). */
  image?: { bytes: Uint8Array; mime: string };
  text?: string;
  locale: Locale;
}

export interface VoiceInput {
  audio: Uint8Array;
  mime: string;
  locale: Locale;
}

export interface CoachMessage {
  role: "user" | "assistant";
  text: string;
}

/** Only the context a call needs (Screen spec, section 30). */
export interface InsightContext {
  locale: Locale;
  /** The intervention variant the engine already selected. The AI may only word it. */
  interventionKey?: string;
  variantId?: string;
  facts: Record<string, string | number | boolean | null>;
}

/** What a provider hands back: the still-untrusted answer, the model that produced it and (if said) the token usage. */
export interface ProviderReply {
  output: unknown;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    /** Only when the provider reports it. The bake-off shows it; it is never stored. */
    reasoningTokens?: number;
  };
}

/** Passed to every provider call. The gateway aborts the signal on timeout or when the total budget runs out. */
export interface CallContext {
  signal: AbortSignal;
}

export type ProviderErrorKind = "rate_limited" | "auth" | "server" | "bad_request" | "blocked" | "network" | "unsupported";

/**
 * The only error an adapter throws on purpose. The message is a code (never a response body, which can
 * echo the user's text), so it is safe to log and to keep in the attempts list.
 */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly status?: number,
  ) {
    super(kind);
    this.name = "ProviderError";
  }
}

/**
 * A provider adapter (Gemini, Groq, ...). `output` is `unknown` on purpose: the gateway is the only
 * place that turns a provider answer into a typed value, by validating it. Not every provider
 * implements every method; unsupported ones throw `ProviderError("unsupported")`.
 */
export interface AIProvider {
  readonly id: string;
  analyzeMeal(input: MealInput, ctx: CallContext): Promise<ProviderReply>;
  analyzeText(input: { text: string; locale: Locale }, ctx: CallContext): Promise<ProviderReply>;
  transcribeVoice(input: VoiceInput, ctx: CallContext): Promise<ProviderReply>;
  generateInsight(context: InsightContext, ctx: CallContext): Promise<ProviderReply>;
  detectPatternCandidate(
    events: ReadonlyArray<Record<string, string | number | boolean | null>>,
    ctx: CallContext,
  ): Promise<ProviderReply>;
  coach(messages: readonly CoachMessage[], context: InsightContext, ctx: CallContext): Promise<ProviderReply>;
}

/** One provider attempt, as the ledger sees it. No prompt, no text, no image, no response body. */
export interface AiCallRecord {
  operation: "analyzeMeal" | "analyzeText";
  provider: string;
  model: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  outcome: "ok" | "invalid_output" | "error" | "timeout";
  errorKind: ProviderErrorKind | null;
}

export interface AIRecorder {
  record(rec: AiCallRecord): Promise<void> | void;
}
