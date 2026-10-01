import { describe, expect, it } from "vitest";
import { cleanFoodNameText, sanitizeFoodName, sanitizeFreeText, sanitizeUnclear } from "./sanitize";

// Built from code points so the invisible characters under test stay visible in the source.
const ch = (cp: number) => String.fromCodePoint(cp);
const RLO = ch(0x202e);
const PDF = ch(0x202c);
const LRI = ch(0x2066);
const PDI = ch(0x2069);
const LRM = ch(0x200e);
const ZWSP = ch(0x200b);
const NUL = ch(0);
const BEL = ch(7);
const LINE_SEPARATOR = ch(0x2028);

describe("sanitizeFoodName", () => {
  it("returns a plain name unchanged", () => {
    expect(sanitizeFoodName("שניצל")).toBe("שניצל");
    expect(sanitizeFoodName("peanut butter")).toBe("peanut butter");
  });

  it("strips control characters and joins nothing that was separated by a tab or a line break", () => {
    expect(sanitizeFoodName(`rice${NUL}${BEL}`)).toBe("rice");
    expect(sanitizeFoodName("rice\tand\nbeans")).toBe("rice and beans");
    expect(sanitizeFoodName(`a${ch(0x7f)}b${ch(0x85)}c`)).toBe("abc");
  });

  it("strips bidi overrides, embeddings, isolates, direction marks and zero width characters", () => {
    expect(sanitizeFoodName(`${RLO}pasta${PDF}`)).toBe("pasta");
    expect(sanitizeFoodName(`${LRI}pasta${PDI}`)).toBe("pasta");
    expect(sanitizeFoodName(`pa${LRM}sta${ZWSP}`)).toBe("pasta");
  });

  it("normalizes to NFC", () => {
    expect(sanitizeFoodName("café")).toBe("café");
  });

  it("collapses whitespace runs and trims", () => {
    expect(sanitizeFoodName("  fried    egg   ")).toBe("fried egg");
  });

  it("counts the cap in code points, so an emoji is one", () => {
    const eighty = "א".repeat(80);
    expect(sanitizeFoodName(eighty)).toBe(eighty);
    expect(sanitizeFoodName(eighty + "ב")).toBe(eighty);
    const emojis = "🍎".repeat(80);
    expect(Array.from(sanitizeFoodName(emojis + "🍌") ?? "")).toHaveLength(80);
    expect(sanitizeFoodName(emojis + "🍌")).toBe(emojis);
  });

  it("rejects links, markup and templates", () => {
    for (const bad of ["http://evil.example", "see www.example.com", "<b>bold</b>", "a > b", "{{secret}}", "`rm -rf`", "x}", "ftp://x"]) {
      expect(sanitizeFoodName(bad), bad).toBeNull();
    }
  });

  it("rejects a link even when it is hidden behind control characters", () => {
    expect(sanitizeFoodName(`ht${NUL}tp:/${ZWSP}/x`)).toBeNull();
  });

  it("keeps niqqud, gershayim and apostrophes", () => {
    expect(sanitizeFoodName("שָׁלוֹם")).toBe("שָׁלוֹם");
    expect(sanitizeFoodName("מ״ל חלב")).toBe("מ״ל חלב");
    expect(sanitizeFoodName("צ'יפס")).toBe("צ'יפס");
    expect(sanitizeFoodName("ג'חנון")).toBe("ג'חנון");
  });

  it("gives null for empty, whitespace only, or only invisible characters", () => {
    expect(sanitizeFoodName("")).toBeNull();
    expect(sanitizeFoodName("   \n\t ")).toBeNull();
    expect(sanitizeFoodName(`${RLO}${ZWSP}${NUL}`)).toBeNull();
  });

  it("never throws for something that is not a string", () => {
    expect(sanitizeFoodName(undefined as unknown as string)).toBeNull();
    expect(sanitizeFoodName(42 as unknown as string)).toBeNull();
  });

  it("copes with a megabyte of text quickly", () => {
    const started = Date.now();
    const out = sanitizeFoodName("a".repeat(1_000_000));
    expect(out).toBe("a".repeat(80));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("cleanFoodNameText", () => {
  it("cleans without capping, so a caller can tell too long from empty", () => {
    const long = "ב".repeat(100);
    expect(cleanFoodNameText(long)).toBe(long);
    expect(cleanFoodNameText("   ")).toBeNull();
    expect(cleanFoodNameText("<x>")).toBeNull();
  });
});

describe("sanitizeUnclear", () => {
  it("uses the same rules with a 120 code point cap", () => {
    expect(sanitizeUnclear("משהו לא ברור")).toBe("משהו לא ברור");
    expect(Array.from(sanitizeUnclear("x".repeat(500)) ?? "")).toHaveLength(120);
    expect(sanitizeUnclear("see http://x.example")).toBeNull();
    expect(sanitizeUnclear("  ")).toBeNull();
  });
});

describe("sanitizeFreeText", () => {
  it("keeps line breaks and normal text", () => {
    expect(sanitizeFreeText("לחם\nגבינה", 500)).toEqual({ text: "לחם\nגבינה", truncated: false });
  });

  it("strips control characters except the line break; a tab becomes a space", () => {
    expect(sanitizeFreeText(`a${NUL}b${BEL}c\td`, 500).text).toBe("abc d");
  });

  it("normalizes Windows and old Mac line breaks and the Unicode separators", () => {
    expect(sanitizeFreeText("a\r\nb\rc", 500).text).toBe("a\nb\nc");
    expect(sanitizeFreeText(`a${LINE_SEPARATOR}b`, 500).text).toBe("a\nb");
  });

  it("strips bidi overrides and direction marks", () => {
    expect(sanitizeFreeText(`${RLO}toast${PDF} ${LRM}and jam`, 500).text).toBe("toast and jam");
  });

  it("collapses three or more line breaks to two and trims", () => {
    expect(sanitizeFreeText("\n\n  a\n\n\n\n\nb  \n\n", 500).text).toBe("a\n\nb");
  });

  it("normalizes to NFC", () => {
    expect(sanitizeFreeText("café", 500).text).toBe("café");
  });

  it("caps by code points and says so", () => {
    expect(sanitizeFreeText("🍎".repeat(10), 10)).toEqual({ text: "🍎".repeat(10), truncated: false });
    expect(sanitizeFreeText("🍎".repeat(11), 10)).toEqual({ text: "🍎".repeat(10), truncated: true });
    expect(sanitizeFreeText("a".repeat(500), 500).truncated).toBe(false);
    expect(sanitizeFreeText("a".repeat(501), 500).truncated).toBe(true);
  });

  it("does not report a cut for characters that were only stripped", () => {
    expect(sanitizeFreeText(`${ZWSP}`.repeat(100) + "a".repeat(500), 500).truncated).toBe(false);
  });

  it("copes with a huge paste quickly and reports it as cut", () => {
    const started = Date.now();
    const out = sanitizeFreeText("x".repeat(5_000_000), 500);
    expect(out.truncated).toBe(true);
    expect(out.text).toHaveLength(500);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("never throws for something that is not a string", () => {
    expect(sanitizeFreeText(null as unknown as string, 500)).toEqual({ text: "", truncated: false });
  });
});

// Every invisible or control character is its own rule: one table per sanitizer, so a deleted entry fails here.
const HIDDEN = [
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // embeddings and overrides
  0x2066, 0x2067, 0x2068, 0x2069, // isolates
  0x200b, 0x200e, 0x200f, 0x061c, 0xfeff, // zero width space, direction marks, Arabic letter mark, BOM
  0x1f, 0x7f, 0x80, 0x9f, // the edges of the control ranges
];

describe("the hidden characters, one by one", () => {
  it.each(HIDDEN)("sanitizeFreeText strips U+%s", (cp) => {
    expect(sanitizeFreeText(`pa${ch(cp)}sta`, 500).text).toBe("pasta");
  });

  // U+FEFF is white space to the one-line cleaner (it becomes a space first), so it is not in this table.
  const ONE_LINE = HIDDEN.filter((cp) => cp !== 0xfeff);

  it.each(ONE_LINE)("sanitizeFoodName strips U+%s", (cp) => {
    expect(sanitizeFoodName(`pa${ch(cp)}sta`)).toBe("pasta");
  });

  it.each(ONE_LINE)("sanitizeUnclear strips U+%s", (cp) => {
    expect(sanitizeUnclear(`pa${ch(cp)}sta`)).toBe("pasta");
  });
});

describe("markup and links in a name", () => {
  it("rejects a lone angle bracket, either one", () => {
    expect(sanitizeFoodName("a < b")).toBeNull();
    expect(sanitizeFoodName("<script")).toBeNull();
    expect(sanitizeFoodName("a > b")).toBeNull();
  });
});

describe("sanitizeFreeText line and space handling", () => {
  it("turns the paragraph separator into a line break", () => {
    expect(sanitizeFreeText(`a${ch(0x2029)}b`, 500).text).toBe("a\nb");
    expect(sanitizeFreeText(`a${LINE_SEPARATOR}b`, 500).text).toBe("a\nb");
  });

  it("turns tab, vertical tab and form feed into spaces", () => {
    expect(sanitizeFreeText("a\vb\fc\td", 500).text).toBe("a b c d");
  });

  it("collapses the spaces left behind when a hidden character sat between two spaces", () => {
    expect(sanitizeFoodName(`fried ${ZWSP} egg`)).toBe("fried egg");
  });

  it("reports a cut when the paste was so long that only a prefix was looked at", () => {
    // 5000 invisible characters are more than the bounded look at a 500 cap: the rest is dropped silently otherwise.
    expect(sanitizeFreeText(ZWSP.repeat(5000) + "bread", 500)).toEqual({ text: "", truncated: true });
  });

  it("trims a space that the cap leaves at the end", () => {
    expect(sanitizeFreeText("a".repeat(499) + " b", 500).text).toBe("a".repeat(499));
  });
});
