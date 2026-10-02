import { ProviderError, type AIProvider, type ProviderErrorKind, type ProviderReply } from "../types";

/**
 * What the fake answers to the experiment wording operation. Each behavior is tied to the validator check (or
 * failure) it exercises by `fake.test.ts`. `wording_ok` is the default.
 */
export const WORDING_BEHAVIORS = [
  "wording_ok",
  "wording_fail",
  "wording_invalid",
  "wording_numbers",
  "wording_advice",
  "wording_food",
  "wording_negate",
  "wording_long",
  "wording_slow",
] as const;

export type WordingBehavior = (typeof WORDING_BEHAVIORS)[number];

/** `AI_FAKE_BEHAVIOR`: a known wording behavior, anything else (unset, misspelled) is ignored. */
export function parseWordingBehavior(value: string | undefined): WordingBehavior | undefined {
  const word = value?.trim().toLowerCase();
  return (WORDING_BEHAVIORS as readonly string[]).includes(word ?? "") ? (word as WordingBehavior) : undefined;
}

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
  /** How `generateInsight` answers a wording request (default `wording_ok`). */
  wording?: WordingBehavior;
}

const FAKE_MODEL = "fake-1";

/** The approved sentence without its closing full stop, so a short tail can follow it. */
const withoutFinalStop = (text: string): string => text.replace(/[.\s]+$/u, "");

/** A sentence that is visibly different from the approved one and passes every check of the validator. */
const TAIL = { he: ", אם בא לך.", en: ", if you like." } as const;

/** Repeated and cut to 300 characters: over every length cap, and under the 400-character wire bound. */
const FILLER = { he: " ואפשר לקחת את הזמן בנחת, בלי שום לחץ, בקצב שנוח, ולהתחיל מתי שמתאים לך.", en: " and you can take your time, with no pressure at all, at a pace that suits you, and begin whenever it fits." } as const;

/** The same sentence with its negator dropped (replaced by the opposite), or a negator added where there is none. */
function negate(approved: string, locale: "he" | "en"): string {
  if (locale === "he") return /בלי/u.test(approved) ? approved.replace(/בלי/u, "עם") : `לא ${approved}`;
  return /without/i.test(approved) ? approved.replace(/without/i, "with") : `Do not ${approved.charAt(0).toLowerCase()}${approved.slice(1)}`;
}

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

  /**
   * A wording request (facts carry `approved_text`) is answered from that sentence, by `behavior.wording`. Any other
   * insight context keeps the old fixed sentence. The wording behaviors need the abort signal, so this one takes both arguments.
   */
  generateInsight: AIProvider["generateInsight"] = (context, ctx) => {
    const approved = context?.facts?.approved_text;
    if (typeof approved !== "string") return this.answer({ text: "Something small I noticed." });

    const locale = context.locale === "en" ? "en" : "he";
    const base = withoutFinalStop(approved);
    switch (this.behavior.wording ?? "wording_ok") {
      case "wording_fail":
        return Promise.reject(new Error("provider_down"));
      case "wording_invalid":
        return Promise.resolve({ output: { not: "valid" }, model: FAKE_MODEL });
      case "wording_numbers":
        return this.answer({ text: `${base}, ${locale === "he" ? "עוד 5 דקות." : "for 5 more minutes."}` });
      case "wording_advice":
        return this.answer({ text: `${base}, ${locale === "he" ? "כדאי שתעשה את זה." : "and you should do it."}` });
      case "wording_food":
        return this.answer({ text: `${base}, ${locale === "he" ? "עם שוקולד." : "with chocolate."}` });
      case "wording_negate":
        return this.answer({ text: negate(approved, locale) });
      case "wording_long":
        return this.answer({ text: `${base},${FILLER[locale].repeat(4)}`.slice(0, 300) });
      case "wording_slow":
        // Never answers until the gateway aborts the attempt (the timeout), like a provider that hangs. A real fetch
        // rejects a moment AFTER the abort, so this does too: the gateway has already seen its own timeout by then.
        return new Promise<ProviderReply>((_, reject) => {
          const abort = () => queueMicrotask(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          if (ctx?.signal?.aborted) abort();
          else ctx?.signal?.addEventListener("abort", abort, { once: true });
        });
      default:
        return this.answer({ text: `${base}${TAIL[locale]}` });
    }
  };

  detectPatternCandidate() {
    return this.answer([{ kind: "evening_fatigue_and_hunger", occurrences: 3 }]);
  }

  coach() {
    return this.answer({ text: "I'm here. What's happening?" });
  }
}
