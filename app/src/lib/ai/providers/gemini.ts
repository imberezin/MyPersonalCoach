import type { Locale } from "@/i18n/config";
import { buildMealRequest, type PromptLanguage } from "../prompts/meal";
import { MEAL_JSON_SCHEMA } from "../prompts/mealSchema";
import {
  ProviderError,
  type AIProvider,
  type CallContext,
  type MealInput,
  type ProviderReply,
} from "../types";
import { asCount, asRecord, imageMime, parseModelJson, postJson, toBase64 } from "./http";

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiOptions {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  /** generationConfig.thinkingConfig.thinkingLevel; null leaves the model default. */
  thinkingLevel?: string | null;
  /** Bake-off only: the English twin of the system prompt. */
  promptLanguage?: PromptLanguage;
  fetch?: typeof fetch;
}

// A finish reason that means "the model refused or was filtered", as opposed to "ran out of room".
const BLOCKED_FINISH = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"]);

// The model id goes into the URL path, so it is held to the characters a model id uses.
const MODEL_ID = /^[A-Za-z0-9._-]{1,80}$/;

/**
 * Gemini through the plain REST `generateContent` method (no SDK). Decision D25: this surface is
 * documented as fully supported, and every request/response detail lives in THIS file, so moving
 * to the Interactions API later is a one-file change. Field names follow the v1beta REST reference
 * (camelCase: systemInstruction, inlineData, generationConfig.responseJsonSchema,
 * thinkingConfig.thinkingLevel, usageMetadata.promptTokenCount). The key travels in the
 * `x-goog-api-key` header, never in the URL, so it cannot end up in a log line.
 */
export class GeminiProvider implements AIProvider {
  readonly id = "gemini";

  constructor(private readonly options: GeminiOptions) {}

  analyzeMeal(input: MealInput, ctx: CallContext): Promise<ProviderReply> {
    return this.generate(input, ctx);
  }

  analyzeText(input: { text: string; locale: Locale }, ctx: CallContext): Promise<ProviderReply> {
    return this.generate({ text: input.text, locale: input.locale }, ctx);
  }

  transcribeVoice(): Promise<ProviderReply> {
    return Promise.reject(new ProviderError("unsupported"));
  }

  generateInsight(): Promise<ProviderReply> {
    return Promise.reject(new ProviderError("unsupported"));
  }

  detectPatternCandidate(): Promise<ProviderReply> {
    return Promise.reject(new ProviderError("unsupported"));
  }

  coach(): Promise<ProviderReply> {
    return Promise.reject(new ProviderError("unsupported"));
  }

  private async generate(input: Pick<MealInput, "image" | "text" | "locale">, ctx: CallContext): Promise<ProviderReply> {
    const { apiKey, model, maxOutputTokens, thinkingLevel } = this.options;
    if (!MODEL_ID.test(model)) throw new ProviderError("bad_request");

    const request = buildMealRequest(input, { language: this.options.promptLanguage });
    // The photo comes first and the text after it, as Google recommends for a single image.
    const parts: Record<string, unknown>[] = [];
    if (input.image) parts.push({ inlineData: { mimeType: imageMime(input.image.mime), data: toBase64(input.image.bytes) } });
    parts.push({ text: request.userText });

    const body = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: "user", parts }],
      // No temperature on purpose: Google recommends the default (1.0) for every Gemini 3 model, and
      // a lower value can degrade output. The JSON schema and the prompt already constrain the reply.
      generationConfig: {
        maxOutputTokens,
        responseMimeType: "application/json",
        responseJsonSchema: MEAL_JSON_SCHEMA,
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
      },
    };

    const json = await postJson(
      `${GEMINI_ENDPOINT}/${model}:generateContent`,
      { headers: { "x-goog-api-key": apiKey }, body },
      { signal: ctx.signal, fetch: this.options.fetch },
    );
    return this.toReply(json, model);
  }

  private toReply(json: unknown, model: string): ProviderReply {
    const root = asRecord(json);
    if (!root) throw new ProviderError("server");

    if (asRecord(root.promptFeedback)?.blockReason) throw new ProviderError("blocked");

    const candidates = Array.isArray(root.candidates) ? root.candidates : [];
    const candidate = asRecord(candidates[0]);
    if (!candidate) throw new ProviderError("server");
    const finish = typeof candidate.finishReason === "string" ? candidate.finishReason : "";
    if (BLOCKED_FINISH.has(finish)) throw new ProviderError("blocked");

    const content = asRecord(candidate.content);
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    let text = "";
    for (const part of parts) {
      const p = asRecord(part);
      if (p && p.thought !== true && typeof p.text === "string") text += p.text;
    }

    const usage = asRecord(root.usageMetadata);
    return {
      output: parseModelJson(text),
      model,
      usage: usage
        ? {
            inputTokens: asCount(usage.promptTokenCount),
            outputTokens: asCount(usage.candidatesTokenCount),
            reasoningTokens: asCount(usage.thoughtsTokenCount),
          }
        : undefined,
    };
  }
}
