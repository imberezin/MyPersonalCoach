import { describe, expect, it } from "vitest";
import { resolveOpeningLine, type StoredWeeklyLine } from "./line";

const stored = (over: Partial<StoredWeeklyLine> = {}): StoredWeeklyLine => ({ text: "עוד חלק קטן נכנס לתמונה.", locale: "he", mode: "LEARN", key: "learn", ...over });
const learn = { mode: "LEARN", lineKey: "learn" } as const;

describe("resolveOpeningLine", () => {
  it("uses the stored line when mode, key and locale all match", () => {
    expect(resolveOpeningLine({ story: learn, row: { line: stored() }, locale: "he" })).toEqual({ source: "ai", text: "עוד חלק קטן נכנס לתמונה." });
  });

  it("falls back to the catalog key of the live line without a row or without a line", () => {
    expect(resolveOpeningLine({ story: learn, row: null, locale: "he" })).toEqual({ source: "catalog", messageKey: "weekly.line.learn" });
    expect(resolveOpeningLine({ story: learn, row: { line: null }, locale: "he" })).toEqual({ source: "catalog", messageKey: "weekly.line.learn" });
  });

  it("ignores the stored line when the mode changed (a deleted meal moved the week to another mode)", () => {
    expect(resolveOpeningLine({ story: { mode: "RESET", lineKey: "quiet" }, row: { line: stored() }, locale: "he" })).toEqual({
      source: "catalog",
      messageKey: "weekly.line.quiet",
    });
    expect(resolveOpeningLine({ story: { mode: "CELEBRATE", lineKey: "celebrateMilestone" }, row: { line: stored() }, locale: "he" })).toEqual({
      source: "catalog",
      messageKey: "weekly.line.celebrateMilestone",
    });
  });

  it("ignores the stored line when the key differs even though the mode matches", () => {
    expect(resolveOpeningLine({ story: { mode: "LEARN", lineKey: "recover" }, row: { line: stored() }, locale: "he" })).toEqual({
      source: "catalog",
      messageKey: "weekly.line.recover",
    });
  });

  it("ignores the stored line when the person switched language", () => {
    expect(resolveOpeningLine({ story: learn, row: { line: stored() }, locale: "en" })).toEqual({ source: "catalog", messageKey: "weekly.line.learn" });
    expect(resolveOpeningLine({ story: learn, row: { line: stored({ locale: "en", text: "One more small piece." }) }, locale: "en" })).toEqual({
      source: "ai",
      text: "One more small piece.",
    });
  });

  it.each([
    ["an empty text", { text: "" }],
    ["a blank text", { text: "   " }],
    ["a non-string text", { text: 5 as unknown as string }],
    ["a wrong mode", { mode: "CELEBRATE" as unknown as "LEARN" }],
    ["a wrong key", { key: "quiet" as unknown as "learn" }],
    ["an unknown locale", { locale: "fr" as unknown as "he" }],
  ])("falls back for a malformed line: %s", (_label, over) => {
    expect(resolveOpeningLine({ story: learn, row: { line: stored(over) }, locale: "he" })).toEqual({ source: "catalog", messageKey: "weekly.line.learn" });
  });

  it("never throws for a garbage row", () => {
    expect(resolveOpeningLine({ story: learn, row: { line: "oops" as unknown as StoredWeeklyLine }, locale: "he" })).toEqual({ source: "catalog", messageKey: "weekly.line.learn" });
  });

  it("names the catalog key after every line key", () => {
    const keys = ["celebrateMilestone", "celebrateGoal", "celebrateExperiment", "recover", "learn", "quiet"] as const;
    for (const lineKey of keys) {
      expect(resolveOpeningLine({ story: { mode: "RESET", lineKey }, row: null, locale: "he" })).toEqual({ source: "catalog", messageKey: `weekly.line.${lineKey}` });
    }
  });
});
