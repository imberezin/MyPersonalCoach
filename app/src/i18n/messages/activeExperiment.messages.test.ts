// The copy of the Home card for an ACTIVE experiment: `home.activeExperiment.{title,body}` and `home.activeExperimentAck`. Both
// catalogs agree, the spec's words are exact, and the voice rules hold: calm, no number, no verdict, no request to report. The
// word list of the First Week's AI validator is the SAME list applied here (src/domain/experiments/wording/lint.ts), so the catalog
// and the validator cannot drift apart. The Home namespace as a whole is also linted by app.messages.test.ts.
import { describe, expect, it } from "vitest";
import { HOME_COPY_KEYS } from "@/domain/home";
import { copyLintHits } from "@/domain/experiments/wording";
import en from "./en.json";
import he from "./he.json";

type Tree = { [key: string]: string | Tree };

const catalogs = { he: he as Tree, en: en as Tree };
const locales = ["he", "en"] as const;

function leaf(tree: Tree, path: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

const PATHS = ["home.activeExperiment.title", "home.activeExperiment.body", "home.activeExperimentAck"];
const text = (locale: (typeof locales)[number], path: string) => leaf(catalogs[locale], path) as string;

const FORBIDDEN = {
  he: ["!", "החמצת", "פספסת", "ציון", "אחוז", "רצף", "חרגת", "נכשל", "מתחילים מחדש", "להתחיל מחדש", "לא דיווחת", "מתוך", "חייב", "צריך"],
  en: ["!", "missed", "score", "percent", "streak", "failed", "overdue", "behind", "start over", "you didn't", "must", "should", "need to"],
} as const;

describe("the active-experiment card copy", () => {
  it("is a copy key with a title and a body, plus one Thanks, in both languages", () => {
    expect(HOME_COPY_KEYS).toContain("activeExperiment");
    for (const locale of locales) {
      for (const path of PATHS) expect(text(locale, path)?.trim(), `${locale}: ${path}`).toBeTruthy();
      expect(Object.keys((catalogs[locale].home as Tree).activeExperiment as Tree).sort(), locale).toEqual(["body", "title"]);
    }
  });

  it("says the spec's words", () => {
    expect(text("he", "home.activeExperiment.title")).toBe("הניסוי הקטן שלך");
    expect(text("he", "home.activeExperiment.body")).toBe("אם בא לך, אפשר לנסות בארוחה הבאה. אין צורך לדווח על כלום.");
    expect(text("he", "home.activeExperimentAck")).toBe("תודה");
    expect(text("en", "home.activeExperiment.title")).toBe("Your small experiment");
    expect(text("en", "home.activeExperiment.body")).toBe("If you feel like it, you can try it at your next meal. There is nothing to report.");
    expect(text("en", "home.activeExperimentAck")).toBe("Thanks");
  });

  it("is plain text: no placeholder, no markup, no digit", () => {
    for (const locale of locales) {
      for (const path of PATHS) {
        const message = text(locale, path);
        expect(message, `${locale}: ${path}`).not.toMatch(/[{}<>]/);
        expect(message, `${locale}: ${path}`).not.toMatch(/\d/);
      }
    }
  });

  it("passes the brief's list and the shared lint list, keys included", () => {
    for (const locale of locales) {
      const whole = JSON.stringify([(catalogs[locale].home as Tree).activeExperiment, (catalogs[locale].home as Tree).activeExperimentAck]);
      const lower = whole.toLowerCase();
      for (const word of FORBIDDEN[locale]) expect(lower, `${locale}: contains "${word}"`).not.toContain(word.toLowerCase());
      expect(copyLintHits(whole, locale), locale).toEqual([]);
    }
  });

  it("is not a reporting surface: nothing asks whether it was tried or whether it helped", () => {
    for (const locale of locales) {
      const whole = PATHS.map((path) => text(locale, path)).join("\n");
      expect(whole, locale).not.toMatch(/tried|helped|helpful|how did|report back|ניסית|עזר|איך היה|תדווח/i);
    }
    // The only thing it says about reporting is that none is needed.
    expect(text("he", "home.activeExperiment.body")).toContain("אין צורך לדווח");
    expect(text("en", "home.activeExperiment.body")).toContain("nothing to report");
  });

  it("keeps the gentle line short enough to glance at, and the button a single word", () => {
    for (const locale of locales) {
      expect(text(locale, "home.activeExperiment.body").length, locale).toBeLessThanOrEqual(120);
      expect(text(locale, "home.activeExperimentAck").split(/\s+/), locale).toHaveLength(1);
    }
  });

  it("uses the same Thanks as the landmark card", () => {
    for (const locale of locales) expect(text(locale, "home.activeExperimentAck"), locale).toBe(text(locale, "home.milestoneAck"));
  });
});
