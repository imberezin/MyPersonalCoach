import { describe, expect, it } from "vitest";
import { COPY_LINT_WORDS, copyLintHits } from "@/domain/experiments/wording/lint";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : leaves(value, `${prefix}${key}.`),
  );
}

const catalogs = { he: he as Tree, en: en as Tree };

/**
 * Brand voice (Brand document sections 24 and 28), applied to EVERY text of both catalogs: the whole `COPY_LINT_WORDS` list,
 * the one the AI wording validator and the per-screen copy tests already share. An exception names the exact key and word
 * and says why it is not a violation. The second test fails when an exception stops being needed, so the list cannot rot.
 */
const EXCEPTIONS: Record<"he" | "en", Record<string, { words: readonly string[]; reason: string }>> = {
  he: {
    "onboarding.places.rishon_lezion": {
      words: ["ציון"],
      reason: "the city name Rishon LeZion, not the word for a score",
    },
  },
  en: {
    "food.resume.title": {
      words: ["you didn't"],
      reason:
        "a faithful translation of the Hebrew title, which says the same thing in the same neutral way; it names an unfinished draft, not a failure, and its body offers to continue or let it go. Wording left to the owner",
    },
  },
};

describe("copy lint over the whole catalog", () => {
  it.each(["he", "en"] as const)("keeps every %s text free of the forbidden words", (locale) => {
    const all = leaves(catalogs[locale]);
    expect(all.length).toBeGreaterThan(0);
    for (const [path, text] of all) {
      const allowed = EXCEPTIONS[locale][path]?.words ?? [];
      const hits = copyLintHits(text, locale).filter((word) => !allowed.includes(word));
      expect(hits, `${locale}: ${path}`).toEqual([]);
    }
  });

  it("keeps every exception alive: the key exists and still contains the excepted word", () => {
    for (const locale of ["he", "en"] as const) {
      const byPath = new Map(leaves(catalogs[locale]));
      for (const [path, { words, reason }] of Object.entries(EXCEPTIONS[locale])) {
        expect(reason.length, `${locale}: ${path}`).toBeGreaterThan(0);
        const text = byPath.get(path);
        expect(text, `${locale}: ${path} no longer exists`).toBeDefined();
        const hits = copyLintHits(text ?? "", locale);
        for (const word of words) {
          expect(COPY_LINT_WORDS[locale], `${locale}: "${word}" is not a lint word`).toContain(word);
          expect(hits, `${locale}: ${path} no longer contains "${word}", remove the exception`).toContain(word);
        }
      }
    }
  });
});
