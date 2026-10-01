import type { Locale } from "@/i18n/config";
import { buildMealRequest, type PromptLanguage } from "../prompts/meal";
import { MEAL_JSON_SCHEMA, describeMealShape } from "../prompts/mealSchema";
import { ProviderError, type AIProvider, type CallContext, type MealInput, type ProviderReply } from "../types";
import { asCount, asRecord, imageMime, parseModelJson, postJson, toBase64 } from "./http";

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export type GroqResponseFormat = "json_object" | "json_schema";

export interface GroqOptions {
  apiKey: string;
  model: string;
  /** `json_object` is documented to work together with an image; `json_schema` is strict and not documented for images. */
  responseFormat: GroqResponseFormat;
  /** Sent on EVERY request: the model reasons by default, which would eat the free token budget and the time limit. */
  reasoningEffort: string;
  /** `hidden` or `parsed`. `raw` is refused by Groq (HTTP 400) together with JSON mode, so it is never sent. */
  reasoningFormat: string;
  maxOutputTokens: number;
  /** Bake-off only: the English twin of the system prompt. */
  promptLanguage?: PromptLanguage;
  fetch?: typeof fetch;
}

/**
 * Groq through the OpenAI-compatible chat completions endpoint (no SDK). A photo is an `image_url`
 * part holding a data URL; the key is a Bearer header, never in the URL. Request fields follow the
 * Groq docs for vision (image_url data URL, response_format json_object), structured outputs
 * (response_format json_schema with strict) and reasoning (reasoning_effort, reasoning_format).
 */
export class GroqProvider implements AIProvider {
  readonly id = "groq";

  constructor(private readonly options: GroqOptions) {}

  analyzeMeal(input: MealInput, ctx: CallContext): Promise<ProviderReply> {
    return this.complete(input, ctx);
  }

  analyzeText(input: { text: string; locale: Locale }, ctx: CallContext): Promise<ProviderReply> {
    return this.complete({ text: input.text, locale: input.locale }, ctx);
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

  private async complete(input: Pick<MealInput, "image" | "text" | "locale">, ctx: CallContext): Promise<ProviderReply> {
    const { apiKey, model, responseFormat, reasoningEffort, reasoningFormat, maxOutputTokens } = this.options;
    const request = buildMealRequest(input, { language: this.options.promptLanguage });

    // JSON mode has no schema, so the shape and the allowed words are spelled out in the system text.
    const system = responseFormat === "json_object" ? `${request.system}\n\n${describeMealShape()}` : request.system;

    const userContent = input.image
      ? [
          { type: "text", text: request.userText },
          { type: "image_url", image_url: { url: `data:${imageMime(input.image.mime)};base64,${toBase64(input.image.bytes)}` } },
        ]
      : request.userText;

    const body = {
      model,
      temperature: 0.2,
      max_completion_tokens: maxOutputTokens,
      reasoning_effort: reasoningEffort,
      reasoning_format: reasoningFormat,
      response_format:
        responseFormat === "json_schema"
          ? { type: "json_schema", json_schema: { name: "meal", strict: true, schema: MEAL_JSON_SCHEMA } }
          : { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    };

    const json = await postJson(GROQ_ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}` }, body }, { signal: ctx.signal, fetch: this.options.fetch });
    return this.toReply(json, model);
  }

  private toReply(json: unknown, model: string): ProviderReply {
    const root = asRecord(json);
    const choice = asRecord(Array.isArray(root?.choices) ? root.choices[0] : undefined);
    if (!root || !choice) throw new ProviderError("server");
    if (choice.finish_reason === "content_filter") throw new ProviderError("blocked");

    const message = asRecord(choice.message);
    const text = typeof message?.content === "string" ? message.content : null;

    const usage = asRecord(root.usage);
    const details = asRecord(usage?.completion_tokens_details);
    return {
      output: parseModelJson(text),
      model,
      usage: usage
        ? {
            inputTokens: asCount(usage.prompt_tokens),
            outputTokens: asCount(usage.completion_tokens),
            reasoningTokens: asCount(details?.reasoning_tokens) ?? asCount(usage.reasoning_tokens),
          }
        : undefined,
    };
  }
}
