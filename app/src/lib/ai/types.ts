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

/**
 * A provider adapter (Gemini, Groq, ...). Methods return `unknown` on purpose: the gateway
 * is the only place that turns a provider answer into a typed value, by validating it.
 * Not every provider implements every method; unsupported ones should throw.
 */
export interface AIProvider {
  readonly id: string;
  analyzeMeal(input: MealInput): Promise<unknown>;
  analyzeText(input: { text: string; locale: Locale }): Promise<unknown>;
  transcribeVoice(input: VoiceInput): Promise<unknown>;
  generateInsight(context: InsightContext): Promise<unknown>;
  detectPatternCandidate(events: ReadonlyArray<Record<string, string | number | boolean | null>>): Promise<unknown>;
  coach(messages: readonly CoachMessage[], context: InsightContext): Promise<unknown>;
}
