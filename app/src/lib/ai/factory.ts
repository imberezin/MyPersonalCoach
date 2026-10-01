import "server-only";
import { readAiConfig, usableProviders, type AiConfig } from "./config";
import { AIGateway } from "./gateway";
import { isAdminConfigured } from "./ledger";
import { MEAL_PROMPT_VERSION } from "./prompts/meal";
import { FakeAIProvider } from "./providers/fake";
import { GeminiProvider } from "./providers/gemini";
import { GroqProvider } from "./providers/groq";
import type { AIProvider, AIRecorder } from "./types";

export interface AiRuntime {
  gateway: AIGateway;
  /** True only when at least one provider can run AND the quota ledger can work (admin client configured). */
  configured: boolean;
  /** Ids of the providers in call order. */
  providers: readonly string[];
  config: AiConfig;
  promptVersion: string;
}

type Env = Record<string, string | undefined>;

function currentEnv(): { env: Env; nodeEnv: string } {
  return { env: process.env, nodeEnv: process.env.NODE_ENV ?? "production" };
}

/**
 * Builds the gateway from the environment. It never throws: an unexpected error gives a runtime
 * with zero providers and `configured: false`, and the caller takes the manual path. A provider is
 * created only when its key is a non-empty string; `fake` only outside production.
 *
 * `configured` includes `isAdminConfigured`: the quota ledger cannot work without the admin client
 * and the product fails closed, so no screen should offer AI that would then answer "unavailable".
 */
export function createAiRuntime(options: { env?: Env; nodeEnv?: string; recorder?: AIRecorder; fetch?: typeof fetch } = {}): AiRuntime {
  const defaults = currentEnv();
  const env = options.env ?? defaults.env;
  const nodeEnv = options.nodeEnv ?? defaults.nodeEnv;

  try {
    const config = readAiConfig(env, nodeEnv);
    const providers: AIProvider[] = [];
    for (const id of usableProviders(config)) {
      if (id === "gemini" && config.gemini.apiKey) {
        providers.push(
          new GeminiProvider({
            apiKey: config.gemini.apiKey,
            model: config.gemini.model,
            maxOutputTokens: config.maxOutputTokens,
            thinkingLevel: config.gemini.thinkingLevel,
            fetch: options.fetch,
          }),
        );
      } else if (id === "groq" && config.groq.apiKey) {
        providers.push(
          new GroqProvider({
            apiKey: config.groq.apiKey,
            model: config.groq.model,
            responseFormat: config.groq.responseFormat,
            reasoningEffort: config.groq.reasoningEffort,
            reasoningFormat: config.groq.reasoningFormat,
            maxOutputTokens: config.maxOutputTokens,
            fetch: options.fetch,
          }),
        );
      } else if (id === "fake" && nodeEnv !== "production") {
        providers.push(new FakeAIProvider());
      }
    }

    const gateway = new AIGateway(providers, {
      timeoutMs: config.timeoutsMs.text,
      totalBudgetMs: config.timeoutsMs.total,
      recorder: options.recorder,
    });
    return {
      gateway,
      configured: providers.length > 0 && isAdminConfigured(env),
      providers: providers.map((p) => p.id),
      config,
      promptVersion: MEAL_PROMPT_VERSION,
    };
  } catch {
    const config = readAiConfig({}, "production");
    return { gateway: new AIGateway([]), configured: false, providers: [], config, promptVersion: MEAL_PROMPT_VERSION };
  }
}

/** Cheap check the pages use to decide whether to offer AI at all. Builds no provider and no client. */
export function isAiConfigured(env?: Env, nodeEnv?: string): boolean {
  const defaults = currentEnv();
  const e = env ?? defaults.env;
  try {
    const config = readAiConfig(e, nodeEnv ?? defaults.nodeEnv);
    return usableProviders(config).length > 0 && isAdminConfigured(e);
  } catch {
    return false;
  }
}
