import { describe, expect, it } from "vitest";
import type { UnderstoodItem, UnderstoodMeal } from "@/domain/food";
import type { BakeCase } from "../../scripts/bake-off/lib/cases";
import { nameMatches, normalizeName, scoreCase } from "../../scripts/bake-off/lib/score";

const item = (name: string, over: Partial<UnderstoodItem> = {}): UnderstoodItem => ({ name, portion: null, uncertain: false, confidence: 0.9, ...over });
const meal = (items: UnderstoodItem[], over: Partial<UnderstoodMeal> = {}): UnderstoodMeal => ({
  items,
  unclear: [],
  overallConfidence: 0.9,
  mealTypeHint: null,
  timeHint: null,
  notFood: false,
  ...over,
});
const ok = (m: UnderstoodMeal) => ({ ok: true as const, meal: m });

const foods = (...expected: BakeCase["expected"]): BakeCase => ({ id: "T01", modality: "text", kind: "foods", expected, text: "x" });

describe("normalizeName", () => {
  it("NFC, case, niqqud, punctuation, spaces and a leading ה", () => {
    expect(normalizeName("  Toast!! ")).toBe("toast");
    expect(normalizeName("לֶחֶם")).toBe("לחם");
    expect(normalizeName("הלחם")).toBe("לחם");
    expect(normalizeName("צ'יפס")).toBe("ציפס");
    expect(normalizeName("ג׳חנון")).toBe("גחנון");
    expect(normalizeName("קפה,  הפוך")).toBe("קפה הפוך");
    expect(normalizeName("הם")).toBe("הם"); // too short to strip
    expect(normalizeName("")).toBe("");
  });
});

describe("nameMatches", () => {
  it("equal, contained, containing", () => {
    expect(nameMatches("שניצל", ["שניצל"])).toBe(true);
    expect(nameMatches("שניצל עוף", ["שניצל"])).toBe(true);
    expect(nameMatches("קפה", ["קפה הפוך"])).toBe(true);
    expect(nameMatches("אורז", ["חביתה", "אורז"])).toBe(true);
  });
  it("different foods do not match, and a single letter only matches by equality", () => {
    expect(nameMatches("אורז", ["שניצל"])).toBe(false);
    expect(nameMatches("א", ["אורז"])).toBe(false);
    expect(nameMatches("", ["אורז"])).toBe(false);
    expect(nameMatches("אורז", [""])).toBe(false);
  });
});

describe("scoreCase: foods", () => {
  const c = foods({ names: ["לחם"] }, { names: ["גבינה"] }, { names: ["קפה"] });

  it("a perfect answer passes with zero edits", () => {
    const s = scoreCase(c, ok(meal([item("לחם"), item("גבינה"), item("קפה")])));
    expect(s).toMatchObject({ valid: true, missing: [], extra: [], portionWrong: [], edits: 0, pass: true });
  });

  it("edits <= 1 passes: one missing, or one invented", () => {
    expect(scoreCase(c, ok(meal([item("לחם"), item("גבינה")])))).toMatchObject({ missing: ["קפה"], edits: 1, pass: true });
    expect(scoreCase(c, ok(meal([item("לחם"), item("גבינה"), item("קפה"), item("זיתים")])))).toMatchObject({ extra: ["זיתים"], edits: 1, pass: true });
  });

  it("edits = 2 fails (the boundary)", () => {
    const s = scoreCase(c, ok(meal([item("לחם"), item("גבינה"), item("זיתים")])));
    expect(s).toMatchObject({ missing: ["קפה"], extra: ["זיתים"], edits: 2, pass: false });
  });

  it("an invalid answer fails and counts every expected food as missing", () => {
    expect(scoreCase(c, { ok: false, reason: "all_providers_failed" })).toMatchObject({ valid: false, pass: false, edits: 3 });
  });

  it("saying 'not food' about a food case is a contradiction and fails even with few edits", () => {
    const one = foods({ names: ["תפוח"] });
    expect(scoreCase(one, ok(meal([item("תפוח")], { notFood: true })))).toMatchObject({ contradiction: true, edits: 0, pass: false });
  });

  it("an alternative name counts, and two items for one expected food are not 'extra'", () => {
    const eggs = foods({ names: ["חביתה", "ביצים"] });
    expect(scoreCase(eggs, ok(meal([item("ביצים"), item("חביתה")])))).toMatchObject({ extra: [], missing: [], pass: true });
  });
});

describe("scoreCase: portions", () => {
  it("compares kind, unit and amount; estimated is ignored", () => {
    const c = foods({ names: ["לחם"], portion: { amount: 2, unit: "slice" } });
    const right = item("לחם", { portion: { kind: "amount", amount: 2, unit: "slice", estimated: true } });
    expect(scoreCase(c, ok(meal([right])))).toMatchObject({ portionWrong: [], edits: 0 });
    for (const portion of [
      { kind: "amount" as const, amount: 3, unit: "slice" as const, estimated: false },
      { kind: "amount" as const, amount: 2, unit: "cup" as const, estimated: false },
      { kind: "size" as const, size: "medium" as const, estimated: false },
      null,
    ]) {
      expect(scoreCase(c, ok(meal([item("לחם", { portion })])))).toMatchObject({ portionWrong: ["לחם"], edits: 1 });
    }
  });

  it("a size is compared as a size", () => {
    const c = foods({ names: ["שניצל"], portion: { size: "medium" } });
    expect(scoreCase(c, ok(meal([item("שניצל", { portion: { kind: "size", size: "medium", estimated: true } })])))).toMatchObject({ portionWrong: [] });
    expect(scoreCase(c, ok(meal([item("שניצל", { portion: { kind: "size", size: "large", estimated: true } })])))).toMatchObject({ portionWrong: ["שניצל"] });
  });

  it("a portion is only checked where the case states one", () => {
    const c = foods({ names: ["גבינה"] });
    expect(scoreCase(c, ok(meal([item("גבינה", { portion: { kind: "size", size: "large", estimated: true } })])))).toMatchObject({ portionWrong: [], edits: 0 });
  });
});

describe("scoreCase: other kinds", () => {
  const notFood: BakeCase = { id: "T16", modality: "text", kind: "not_food", expected: [], text: "x" };
  const nothing: BakeCase = { id: "T09", modality: "text", kind: "nothing_expected", expected: [], text: "x" };

  it("not_food passes when notFood is true or the list is empty, fails when foods were invented", () => {
    expect(scoreCase(notFood, ok(meal([], { notFood: true }))).pass).toBe(true);
    expect(scoreCase(notFood, ok(meal([], { notFood: false }))).pass).toBe(true);
    expect(scoreCase(notFood, ok(meal([item("הליכה")], { notFood: true }))).pass).toBe(true);
    expect(scoreCase(notFood, ok(meal([item("הליכה")], { notFood: false })))).toMatchObject({ pass: false, extra: ["הליכה"] });
    expect(scoreCase(notFood, { ok: false, reason: "x" }).pass).toBe(false);
  });

  it("nothing_expected passes for an empty list or only uncertain items, fails for a confident invented item", () => {
    expect(scoreCase(nothing, ok(meal([]))).pass).toBe(true);
    expect(scoreCase(nothing, ok(meal([item("משהו", { uncertain: true })]))).pass).toBe(true);
    expect(scoreCase(nothing, ok(meal([item("פסטה")])))).toMatchObject({ pass: false, extra: ["פסטה"] });
  });
});

describe("scoreCase: hints are reported, not scored", () => {
  it("lists a wrong meal type, day and time without failing the case", () => {
    const c: BakeCase = { ...foods({ names: ["קורנפלקס"] }), hints: { mealType: "breakfast", day: "today", time: "07:30" } };
    const wrong = scoreCase(c, ok(meal([item("קורנפלקס")], { mealTypeHint: "dinner", timeHint: { day: "yesterday", minuteOfDay: 480 } })));
    expect(wrong.pass).toBe(true);
    expect(wrong.hintsWrong).toEqual(["meal type dinner (expected breakfast)", "day yesterday (expected today)", "time 08:00 (expected 07:30)"]);
    const right = scoreCase(c, ok(meal([item("קורנפלקס")], { mealTypeHint: "breakfast", timeHint: { day: "today", minuteOfDay: 450 } })));
    expect(right.hintsWrong).toEqual([]);
  });
});
