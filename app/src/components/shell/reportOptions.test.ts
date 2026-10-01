import { describe, expect, it } from "vitest";
import { SHELL_MESSAGE_KEYS } from "./messageKeys";
import { REPORT_OPTIONS } from "./reportOptions";

describe("REPORT_OPTIONS", () => {
  it("has unique ids", () => {
    const ids = REPORT_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists five categories, then two ways to say it, in the Brand document's order", () => {
    expect(REPORT_OPTIONS.map((option) => [option.id, option.group])).toEqual([
      ["food", "category"],
      ["activity", "category"],
      ["weight", "category"],
      ["sleep", "category"],
      ["feeling", "category"],
      ["photo", "input"],
      ["text", "input"],
    ]);
  });

  it("demands a label for every row (the catalogs themselves are checked by the messages test)", () => {
    for (const option of REPORT_OPTIONS) {
      expect(SHELL_MESSAGE_KEYS, option.id).toContain(`report.sheet.options.${option.id}`);
    }
  });

  it("has an emoji for every row, and no voice entry yet", () => {
    for (const option of REPORT_OPTIONS) expect(option.emoji.trim(), option.id).not.toBe("");
    expect(REPORT_OPTIONS.map((option) => option.id as string)).not.toContain("voice");
    expect(REPORT_OPTIONS.some((option) => option.emoji.includes("🎙"))).toBe(false);
  });

  it("is inactive today, and a row that is a link points at a path inside the app", () => {
    for (const option of REPORT_OPTIONS) {
      expect(option.href === null || option.href.startsWith("/"), option.id).toBe(true);
    }
    expect(REPORT_OPTIONS.every((option) => option.href === null)).toBe(true);
  });
});

describe("SHELL_MESSAGE_KEYS", () => {
  it("has the nav keys, the sheet keys and one label per row, without duplicates", () => {
    expect(new Set(SHELL_MESSAGE_KEYS).size).toBe(SHELL_MESSAGE_KEYS.length);
    for (const key of [
      "nav.ariaLabel",
      "nav.home",
      "nav.progress",
      "nav.report",
      "nav.coach",
      "nav.me",
      "report.sheet.title",
      "report.sheet.close",
      "report.sheet.note",
      "report.sheet.orSimply",
    ]) {
      expect(SHELL_MESSAGE_KEYS).toContain(key);
    }
    expect(SHELL_MESSAGE_KEYS).toHaveLength(10 + REPORT_OPTIONS.length);
  });
});
