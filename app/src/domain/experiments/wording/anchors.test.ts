import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { INTERVENTIONS, INTERVENTION_KEYS } from "../../interventions/library";
import { MAX_ACTION_ANCHORS, MAX_VERBATIM_ANCHORS, extractWordingAnchors } from "./anchors";
import { validateWording } from "./validate";

const texts = { he: he.interventions, en: en.interventions } as Record<"he" | "en", Record<string, Record<string, string>>>;
const approvedOf = (locale: "he" | "en", key: string, variant: string) => texts[locale][key][variant].replace("{delayMinutes}", "10");

describe("extractWordingAnchors: the first experiment", () => {
  it("keeps the quantity phrase and the negation with its object, and lists the other content words", () => {
    expect(extractWordingAnchors(approvedOf("he", "eat_intentionally", "default"))).toEqual({
      verbatim: ["כמה דקות", "בלי מסך"],
      actions: ["בארוחה", "הבאה", "שים", "בצלחת", "וקח"],
    });
    expect(extractWordingAnchors(approvedOf("en", "eat_intentionally", "default"))).toEqual({
      verbatim: ["few minutes", "without a screen"],
      actions: expect.arrayContaining(["next", "meal", "sit", "down", "plate", "take"]),
    });
  });
});

describe("extractWordingAnchors: quantities", () => {
  it("a digit run and its unit are one phrase", () => {
    expect(extractWordingAnchors(approvedOf("he", "check_hunger", "open")).verbatim).toContain("10 שניות");
    expect(extractWordingAnchors(approvedOf("he", "micro_walk", "default")).verbatim).toEqual(["5 דקות"]);
    expect(extractWordingAnchors("עצור 10 שניות.").verbatim).toEqual(["10 שניות"]);
  });

  it("a unit with its number word after it, and a quantifier with no unit", () => {
    expect(extractWordingAnchors("עצור לשנייה אחת.").verbatim).toEqual(["לשנייה אחת"]);
    expect(extractWordingAnchors("קח קצת זמן.").verbatim).toEqual(["קצת"]);
  });

  it("a unit alone is kept (the validator holds the set of units)", () => {
    expect(extractWordingAnchors("היום, הזז את מה שמפתה.").verbatim).toEqual(["היום"]);
  });

  it("an English phrase quantifier", () => {
    expect(extractWordingAnchors("Take a little time.").verbatim).toEqual(["a little"]);
  });
});

describe("extractWordingAnchors: negation", () => {
  it("the negator and the first content word after it, even with a short word between", () => {
    expect(extractWordingAnchors("שב בלי מסך.").verbatim).toEqual(["בלי מסך"]);
    expect(extractWordingAnchors("אל תמהר.").verbatim).toEqual(["אל תמהר"]);
    expect(extractWordingAnchors("sit without a screen").verbatim).toEqual(["without a screen"]);
  });

  it("a prefixed negator is a negator (ובלי), and keeps its surface form", () => {
    expect(extractWordingAnchors("שב ובלי מסך.").verbatim).toEqual(["ובלי מסך"]);
  });

  it("a negator with nothing after it is kept alone", () => {
    expect(extractWordingAnchors("שב ולא").verbatim).toEqual(["ולא"]);
  });

  it("the object is the first content word within the validator's reach, not a later one", () => {
    // "בלי" + "את" (short, skipped) + "המסך" (content): the anchor ends at the object.
    expect(extractWordingAnchors("עשה זאת בלי את המסך ובלי כלום").verbatim).toEqual(["בלי את המסך", "ובלי כלום"]);
  });
});

describe("extractWordingAnchors: totality and bounds", () => {
  it("is pure, total and never throws on junk", () => {
    for (const junk of ["", "   ", "—", "123", "a", "ש", "<<>>", "\u0000", "x".repeat(10_000)]) {
      expect(() => extractWordingAnchors(junk)).not.toThrow();
    }
    expect(extractWordingAnchors("")).toEqual({ verbatim: [], actions: [] });
    expect(extractWordingAnchors(null as unknown as string)).toEqual({ verbatim: [], actions: [] });
    const input = "שב בלי מסך.";
    expect(extractWordingAnchors(input)).toEqual(extractWordingAnchors(input));
  });

  it("caps both lists", () => {
    const manyNegations = Array.from({ length: 20 }, (_, i) => `בלי דבר${"אבגדהוזחטיכלמנ"[i]}${"אבגדהוזחטיכלמנ"[19 - i]}`).join(" ");
    expect(extractWordingAnchors(manyNegations).verbatim.length).toBeLessThanOrEqual(MAX_VERBATIM_ANCHORS);
    const manyWords = Array.from({ length: 40 }, (_, i) => `מילה${"אבגדהוזחטיכלמנסעפצקרשת"[i % 22]}${"אבגדהוזחטיכלמנסעפצקרשת"[(i * 7) % 22]}${i}x`).join(" ");
    expect(extractWordingAnchors(manyWords).actions.length).toBeLessThanOrEqual(MAX_ACTION_ANCHORS);
  });

  it("anchors are made of words of the approved sentence only: nothing else can enter", () => {
    const approved = "בארוחה הבאה — שב, שים בצלחת, וקח כמה דקות בלי מסך.";
    const words = new Set(approved.match(/[\p{L}\p{N}]+/gu));
    const anchors = extractWordingAnchors(approved);
    for (const phrase of [...anchors.verbatim, ...anchors.actions]) {
      for (const word of phrase.split(" ")) expect(words.has(word), word).toBe(true);
    }
  });

  it("every phrase is a run of tokens of the approved sentence, in order (so the model is asked for words that exist)", () => {
    for (const locale of ["he", "en"] as const) {
      for (const key of INTERVENTION_KEYS) {
        for (const variant of INTERVENTIONS[key].variants) {
          const approved = approvedOf(locale, key, variant.id);
          const tokens = (approved.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).join(" ");
          const anchors = extractWordingAnchors(approved);
          for (const phrase of anchors.verbatim) expect(tokens, `${locale} ${key}.${variant.id}: ${phrase}`).toContain(phrase);
          expect(anchors.verbatim.length).toBeLessThanOrEqual(MAX_VERBATIM_ANCHORS);
        }
      }
    }
  });
});

describe("the anchors are exactly what the validator anchors (a reworded sentence that keeps them passes the quantity and negation checks)", () => {
  const approved = approvedOf("he", "eat_intentionally", "default");

  it("keeping the verbatim phrases and changing the lead-in passes the unchanged validator", () => {
    const { verbatim } = extractWordingAnchors(approved);
    const reworded = `בארוחה הבאה אפשר לשבת, לשים בצלחת, ולקחת ${verbatim[0]} ${verbatim[1]}.`;
    expect(validateWording({ candidate: reworded, approved, locale: "he" })).toEqual({ ok: true, text: reworded });
  });

  it("each way the model broke an anchor in the live runs is rejected by the validator (the anchors are not decoration)", () => {
    const broken: Record<string, string> = {
      "dropped כמה דקות": "בארוחה הבאה אפשר לשבת, לשים בצלחת, ולקחת רגע בלי מסך.",
      "בלי מסכים": "בארוחה הבאה אפשר לשבת, לשים בצלחת, ולקחת כמה דקות בלי מסכים.",
      "ללא מסך": "בארוחה הבאה אפשר לשבת, לשים בצלחת, ולקחת כמה דקות ללא מסך.",
      "להתנתק מהמסך": "בארוחה הבאה אפשר לשבת, לשים בצלחת, ולהתנתק מהמסך כמה דקות.",
      "האוכל": "בארוחה הבאה אפשר לשבת, לשים את האוכל בצלחת, ולקחת כמה דקות בלי מסך.",
    };
    for (const [name, candidate] of Object.entries(broken)) {
      expect(validateWording({ candidate, approved, locale: "he" }).ok, name).toBe(false);
    }
  });
});
