import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { standaloneTranslator } from "@/i18n/standalone";
import { WEEKLY_PUSH_URL, buildWeeklySummaryPush } from "./messages";

describe("buildWeeklySummaryPush", () => {
  it("builds the approved Hebrew push for a Hebrew speaker: right to left, lands on the week", () => {
    expect(buildWeeklySummaryPush({ language: "he", weekStart: "2026-10-11" })).toEqual({
      title: "השבוע שלך",
      body: "יש לי כמה מילים על השבוע שעבר. כשנוח, אפשר להסתכל.",
      url: "/week",
      tag: "weekly_summary-2026-10-11",
      lang: "he",
      dir: "rtl",
    });
  });

  it("speaks English, left to right, to an English speaker", () => {
    expect(buildWeeklySummaryPush({ language: "en", weekStart: "2026-10-11" })).toMatchObject({
      title: "Your week",
      body: "I have a few words about last week. When it suits you, take a look.",
      lang: "en",
      dir: "ltr",
    });
  });

  it.each([[null], [undefined], [""], ["fr"], [42]])("falls back to Hebrew for the language %j", (language) => {
    expect(buildWeeklySummaryPush({ language, weekStart: "2026-10-11" })).toMatchObject({ title: "השבוע שלך", lang: "he", dir: "rtl" });
  });

  it("always sets a title (so the service worker's English fallback title can never show), and a closed landing path", () => {
    for (const language of ["he", "en", "xx"]) {
      const message = buildWeeklySummaryPush({ language, weekStart: "2026-10-11" });
      expect(message.title.trim().length).toBeGreaterThan(0);
      expect(message.url).toBe(WEEKLY_PUSH_URL);
      expect(message.url).toBe("/week");
    }
  });

  it("contains no digit except in the tag, and the tag is the only place the week appears", () => {
    const { tag, ...visible } = buildWeeklySummaryPush({ language: "he", weekStart: "2026-10-11" });
    expect(JSON.stringify(visible)).not.toMatch(/\d/);
    expect(tag).toBe("weekly_summary-2026-10-11");
  });

  it("uses one tag per week, so a second push for the same week replaces the first", () => {
    const a = buildWeeklySummaryPush({ language: "he", weekStart: "2026-10-11" });
    const b = buildWeeklySummaryPush({ language: "he", weekStart: "2026-10-11" });
    const next = buildWeeklySummaryPush({ language: "he", weekStart: "2026-10-18" });
    expect(a.tag).toBe(b.tag);
    expect(a.tag).not.toBe(next.tag);
  });

  it("keeps a malformed week out of the tag", () => {
    expect(buildWeeklySummaryPush({ language: "he", weekStart: "x y z" }).tag).toBe("weekly_summary");
  });

  it("is far below the 4 KB limit of a push payload (the provider refuses 3800 bytes)", () => {
    for (const language of ["he", "en"]) {
      expect(Buffer.byteLength(JSON.stringify(buildWeeklySummaryPush({ language, weekStart: "2026-10-11" })))).toBeLessThan(600);
    }
  });
});

describe("standaloneTranslator", () => {
  it("translates in the given language without a request", () => {
    expect(standaloneTranslator("en", "common").t("save")).toBe("Save");
    expect(standaloneTranslator("he", "common").t("save")).toBe("שמור");
    expect(standaloneTranslator("zz", "common").locale).toBe("he");
  });

  it("does not read cookies or headers: its source never imports next/headers or server.ts values", () => {
    // Comments stripped: the file's own comment explains why it avoids next/headers.
    const source = readFileSync(join(process.cwd(), "src", "i18n", "standalone.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/next\/headers/);
    expect(source).not.toMatch(/import\s+(?!type)[^;]*from\s+["']\.\/server["']/);
  });
});
