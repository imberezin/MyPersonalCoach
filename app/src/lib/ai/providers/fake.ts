import type { AIProvider } from "../types";

/** Deterministic provider for tests and local development. It never calls the network. */
export class FakeAIProvider implements AIProvider {
  constructor(
    readonly id = "fake",
    private readonly behavior: { fail?: boolean; invalid?: boolean } = {},
  ) {}

  private answer<T>(value: T): Promise<unknown> {
    if (this.behavior.fail) return Promise.reject(new Error("provider_down"));
    if (this.behavior.invalid) return Promise.resolve({ not: "valid" });
    return Promise.resolve(value);
  }

  analyzeMeal() {
    return this.answer({
      items: [
        { food: "schnitzel", portion: "medium", confidence: 0.9, uncertain: false },
        { food: "rice", portion: "about a cup", confidence: 0.8, uncertain: false },
      ],
      unclear: [],
      overallConfidence: 0.85,
    });
  }

  analyzeText() {
    return this.analyzeMeal();
  }

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
