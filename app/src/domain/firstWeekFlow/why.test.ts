// "Why we started": the table of cases for the pure builder, plus the guards that keep the person's own words out of
// the AI layer, the logs and the analytics.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GOAL_FOCUS_KEYS } from "../onboarding/model";
import { FIRST_WEEK_LIMITS } from "./types";
import { buildWhy, truncateAtWord } from "./why";

const MAX = FIRST_WEEK_LIMITS.motivationChars;

type Goal = Parameters<typeof buildWhy>[0];
const why = (over: Partial<Goal> = {}) => buildWhy({ focus: [], motivation: null, numericGoal: false, ...over });
const some = (over: Partial<{ focus: string[]; notSure: boolean; motivation: string | null }> = {}) => ({
  kind: "SOME",
  focus: [],
  notSure: false,
  motivation: null,
  ...over,
});
const motivationOf = (over: Partial<Goal>): string | null => {
  const result = why(over);
  return result.kind === "SOME" ? result.motivation : null;
};

describe("buildWhy: the goals", () => {
  it("is NONE with nothing said", () => {
    expect(why()).toEqual({ kind: "NONE" });
    expect(why({ motivation: "" })).toEqual({ kind: "NONE" });
  });

  it.each(GOAL_FOCUS_KEYS.filter((key) => key !== "not_sure"))("%s alone is SOME with that one goal", (key) => {
    expect(why({ focus: [key] })).toEqual(some({ focus: [key] }));
  });

  it("not_sure alone is a valid answer: SOME with notSure and no goal", () => {
    expect(why({ focus: ["not_sure"] })).toEqual(some({ notSure: true }));
  });

  it("not_sure next to a real goal says nothing more (the database forbids the mix; the builder shows the goal)", () => {
    expect(why({ focus: ["lose_weight", "not_sure"] })).toEqual(some({ focus: ["lose_weight"] }));
  });

  it("puts the goals in the closed order, deduplicated, whatever the input order", () => {
    const expected = some({ focus: ["lose_weight", "improve_eating", "be_active"] });
    expect(why({ focus: ["be_active", "lose_weight", "improve_eating"] })).toEqual(expected);
    expect(why({ focus: ["improve_eating", "be_active", "lose_weight", "be_active", "lose_weight"] })).toEqual(expected);
    expect(why({ focus: [...GOAL_FOCUS_KEYS].reverse() })).toEqual(some({ focus: GOAL_FOCUS_KEYS.filter((key) => key !== "not_sure") }));
  });

  it("drops an unknown key, and is NONE when nothing known is left", () => {
    expect(why({ focus: ["lose_weight", "get_ripped", "", "LOSE_WEIGHT"] })).toEqual(some({ focus: ["lose_weight"] }));
    expect(why({ focus: ["get_ripped"] })).toEqual({ kind: "NONE" });
  });

  it("survives a focus that is not an array", () => {
    expect(why({ focus: null as unknown as string[] })).toEqual({ kind: "NONE" });
    expect(why({ focus: "lose_weight" as unknown as string[] })).toEqual({ kind: "NONE" });
  });

  it("does not mutate its input", () => {
    const given: Goal = { focus: ["be_active", "lose_weight"], motivation: "  words  ", numericGoal: true };
    const snapshot = structuredClone(given);
    buildWhy(given);
    expect(given).toEqual(snapshot);
  });
});

describe("buildWhy: a numeric goal", () => {
  it("counts as an answer by itself, as an empty SOME (the view then says only that a change matters)", () => {
    expect(why({ numericGoal: true })).toEqual(some());
  });

  it("adds nothing to an answer that is already there", () => {
    expect(why({ numericGoal: true, focus: ["lose_weight"] })).toEqual(why({ focus: ["lose_weight"] }));
    expect(why({ numericGoal: true, motivation: "my words" })).toEqual(why({ motivation: "my words" }));
    expect(why({ numericGoal: true, focus: ["not_sure"] })).toEqual(why({ focus: ["not_sure"] }));
  });

  it("only a literal true counts", () => {
    expect(why({ numericGoal: "yes" as unknown as boolean })).toEqual({ kind: "NONE" });
    expect(why({ numericGoal: 1 as unknown as boolean })).toEqual({ kind: "NONE" });
  });
});

describe("buildWhy: the person's own words", () => {
  it("returns a short text unchanged", () => {
    expect(motivationOf({ motivation: "I want to feel at ease with food" })).toBe("I want to feel at ease with food");
    expect(motivationOf({ motivation: "רוצה להרגיש בנוח בגוף שלי" })).toBe("רוצה להרגיש בנוח בגוף שלי");
  });

  it("trims, and collapses every run of whitespace (newlines and tabs included) into one space", () => {
    expect(motivationOf({ motivation: "  first line\n\n\n  second\tline \r\n third  " })).toBe("first line second line third");
  });

  it("is null for an empty, whitespace-only, zero-width-only or punctuation-only text", () => {
    for (const text of ["", "   ", " \n\t ", "\u200B\u200B", "\u200F", "...", "?! -", "\u202E\u202C"]) {
      expect(why({ motivation: text }), JSON.stringify(text)).toEqual({ kind: "NONE" });
    }
    expect(why({ focus: ["be_active"], motivation: "   " })).toEqual(some({ focus: ["be_active"] }));
  });

  it("is null for a motivation that is not text", () => {
    for (const value of [null, undefined, 42, {}, ["x"], true]) {
      expect(why({ motivation: value as unknown as string | null }), String(value)).toEqual({ kind: "NONE" });
    }
  });

  it("keeps digits, markup characters, quotes, emoji and both scripts exactly as typed", () => {
    const text = 'Lose 5 kg <b>before</b> the "wedding" & sleep better 🙂 וגם לישון טוב יותר';
    expect(motivationOf({ motivation: text })).toBe(text);
  });

  it("removes control characters and the bidi overrides, embeddings and isolates, and keeps the marks", () => {
    const hostile = "a\u0000b\u0007c\u202Ed\u202Ae\u2066f\u2069g\u202Ch\u007Fi\u0085j\u200Fk\u200El";
    expect(motivationOf({ motivation: hostile })).toBe("abcdefghij\u200Fk\u200El");
  });

  it("keeps hostile markup inert as data: nothing is escaped or rewritten here (the view escapes), nothing is evaluated", () => {
    const text = "<img src=x onerror=alert(1)> {{constructor}} ${process.env.X} javascript:void(0) '; drop table profiles; --";
    expect(motivationOf({ motivation: text })).toBe(text);
  });

  describe("shortening", () => {
    const words = (n: number) => Array.from({ length: n }, (_unused, i) => `word${i}`).join(" ");
    const cutOf = (motivation: string) => motivationOf({ motivation }) as string;

    it("does not touch a text of exactly the limit, and shortens a text one over (the ellipsis is inside the limit)", () => {
      const exact = "a".repeat(MAX);
      expect(cutOf(exact)).toBe(exact);
      const over = `${"ab ".repeat(MAX)}`.trim();
      const cut = cutOf(over);
      expect(cut.endsWith("…")).toBe(true);
      expect(Array.from(cut).length).toBeLessThanOrEqual(MAX);
      expect(cutOf(`${exact}b`).endsWith("…")).toBe(true);
    });

    it("cuts at a word boundary: the last word is whole, and the result is a prefix of the text", () => {
      const text = words(200);
      const cut = cutOf(text);
      const body = cut.slice(0, -1);
      expect(cut.endsWith("…")).toBe(true);
      expect(text.startsWith(body)).toBe(true);
      expect(text.charAt(body.length)).toBe(" ");
      expect(Array.from(cut).length).toBeLessThanOrEqual(MAX);
    });

    it("keeps a word that ends exactly where the room ends", () => {
      expect(cutOf(`${"x".repeat(MAX - 6)} abcd efgh`)).toBe(`${"x".repeat(MAX - 6)} abcd…`);
    });

    it("leaves no dangling comma, colon, dash or space before the ellipsis", () => {
      expect(cutOf(`${"a".repeat(MAX - 5)}, - ; bbbbbb cccc`)).toBe(`${"a".repeat(MAX - 5)}…`);
    });

    it("cuts a Hebrew text at a word boundary too", () => {
      const cut = cutOf(Array.from({ length: 200 }, () => "מילה").join(" "));
      expect(cut.endsWith("מילה…")).toBe(true);
      expect(Array.from(cut).length).toBeLessThanOrEqual(MAX);
    });

    it("hard-cuts one very long word at the limit instead of returning almost nothing", () => {
      const cut = cutOf(`hi ${"z".repeat(5000)}`);
      expect(Array.from(cut)).toHaveLength(MAX);
      expect(cut.endsWith("z…")).toBe(true);
    });

    it("counts code points, so an emoji is never split in half", () => {
      const cut = cutOf("😀".repeat(MAX + 50));
      expect(Array.from(cut)).toHaveLength(MAX);
      expect(cut.slice(0, -1)).toBe("😀".repeat(MAX - 1));
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut)).toBe(false);
    });

    it("does not leave a half-joined emoji sequence at a hard cut", () => {
      const cut = cutOf(`${"a".repeat(MAX - 3)}\u{1F468}\u200D\u{1F469}${"b".repeat(100)}`);
      expect(cut).toBe(`${"a".repeat(MAX - 3)}\u{1F468}…`);
    });

    it("handles the longest value the column allows, and absurd input, without trouble", () => {
      const columnMax = "word ".repeat(400).trim();
      expect(columnMax.length).toBeLessThanOrEqual(2000);
      expect(Array.from(cutOf(columnMax)).length).toBeLessThanOrEqual(MAX);
      expect(Array.from(cutOf("lorem ".repeat(200_000))).length).toBeLessThanOrEqual(MAX);
    });

    it("is idempotent: a shortened text is not shortened again", () => {
      const once = cutOf(words(200));
      expect(cutOf(once)).toBe(once);
    });

    it("truncateAtWord: a short text is the very same string, and the limit includes the ellipsis", () => {
      expect(truncateAtWord("short", 10)).toBe("short");
      expect(truncateAtWord("exactly ten", 11)).toBe("exactly ten");
      expect(truncateAtWord("one two three", 9)).toBe("one two…");
      expect(truncateAtWord("one two three", 8)).toBe("one two…");
      expect(truncateAtWord("one two three", 7)).toBe("one…");
      expect(truncateAtWord("abcdefghijkl", 6)).toBe("abcde…");
    });
  });
});

describe("buildWhy: deterministic and free of numbers", () => {
  it("returns equal results for equal input and holds no number type anywhere", () => {
    const given: Goal = { focus: ["lose_weight", "be_active"], motivation: "42 reasons", numericGoal: true };
    const first = buildWhy(given);
    expect(buildWhy(given)).toEqual(first);
    const numbers = (value: unknown): unknown[] =>
      typeof value === "number" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(numbers) : [];
    expect(numbers(first)).toEqual([]);
  });
});

// The person's own words are display-only: no prompt, no log line and no analytics payload may ever carry them.
describe("the motivation never leaves the display", () => {
  const SRC = fileURLToPath(new URL("../../", import.meta.url));

  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
    });
  }

  it.each(["lib/ai", "domain/experiments", "lib/experiments", "lib/analytics", "lib/patterns"])("%s does not mention the motivation or the goals", (dir) => {
    for (const file of files(join(SRC, dir))) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/motivation|goal_focus|goal_type|goal_weight/);
    }
  });

  it("the First Week actions and pages do not read the answers either", () => {
    for (const file of files(join(SRC, "app/(flow)/first-week"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/motivation|goal_weight/);
    }
  });

  it("the builder and the loader never log, and the builder is the only place that touches the text", () => {
    const builder = readFileSync(join(SRC, "domain/firstWeekFlow/why.ts"), "utf8");
    expect(builder).not.toMatch(/console\./);
    const loader = readFileSync(join(SRC, "lib/firstWeek/load.ts"), "utf8");
    // Every log line of the loader carries a fixed message and at most an error code.
    for (const line of loader.split("\n").filter((l) => l.includes("console."))) expect(line).not.toMatch(/motivation|goal_/);
  });
});
