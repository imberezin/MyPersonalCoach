import { ProviderError, type AIProvider, type ProviderErrorKind, type ProviderReply } from "../types";

export interface FakeBehavior {
  /** Throw a plain error, as a provider that is down. */
  fail?: boolean;
  /** Throw a ProviderError of this kind (rate limit, auth, ...). */
  failWith?: ProviderErrorKind;
  /** Answer something that fails validation. */
  invalid?: boolean;
  /** Answer "this is not food". */
  notFood?: boolean;
  /** Answer a valid list with no foods in it. */
  empty?: boolean;
}

const FAKE_MODEL = "fake-1";

/** Deterministic provider for tests and local development. It never calls the network. */
export class FakeAIProvider implements AIProvider {
  constructor(
    readonly id = "fake",
    private readonly behavior: FakeBehavior = {},
  ) {}

  private answer(value: unknown): Promise<ProviderReply> {
    if (this.behavior.failWith) return Promise.reject(new ProviderError(this.behavior.failWith));
    if (this.behavior.fail) return Promise.reject(new Error("provider_down"));
    if (this.behavior.invalid) return Promise.resolve({ output: { not: "valid" }, model: FAKE_MODEL });
    return Promise.resolve({ output: value, model: FAKE_MODEL, usage: { inputTokens: 10, outputTokens: 20 } });
  }

  /** The answer has the wire shape of a real model (see prompts/mealSchema.ts). Properties, so a test can replace one with the full provider signature. */
  analyzeMeal: AIProvider["analyzeMeal"] = () => {
    if (this.behavior.notFood) {
      return this.answer({ items: [], unclear: [], overall_confidence: 0.9, meal_type: null, day: null, local_time: null, not_food: true });
    }
    if (this.behavior.empty) {
      return this.answer({ items: [], unclear: [], overall_confidence: 0.2, meal_type: null, day: null, local_time: null, not_food: false });
    }
    return this.answer({
      items: [
        { name: "schnitzel", portion_size: "medium", portion_amount: null, portion_unit: null, portion_estimated: false, confidence: 0.9, uncertain: false },
        { name: "rice", portion_size: null, portion_amount: 1, portion_unit: "cup", portion_estimated: true, confidence: 0.8, uncertain: false },
      ],
      unclear: [],
      overall_confidence: 0.85,
      meal_type: null,
      day: null,
      local_time: null,
      not_food: false,
    });
  };

  analyzeText: AIProvider["analyzeText"] = (input, ctx) => this.analyzeMeal({ text: input.text, locale: input.locale }, ctx);

  transcribeVoice() {
    return this.answer({ text: "I ate two slices of bread with cheese and coffee", language: "en" });
  }

  generateInsight() {
    return this.answer({ text: "Something small I noticed." });
  }

  detectPatternCandidate() {
    return this.answer([{ kind: "evening_fatigue_and_hunger", occurrences: 3 }]);
  }

  coach() {
    return this.answer({ text: "I'm here. What's happening?" });
  }
}
