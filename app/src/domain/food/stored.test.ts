import { describe, expect, it } from "vitest";
import { draftToJson, itemsToJson, parseDraft, parseUnderstandingRow } from "./stored";
import type { ConfirmedItem, MealDraft, UnderstoodItem } from "./types";

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const goodRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ID,
  provider: "gemini",
  model: "gemini-test",
  prompt_version: "meal-v1",
  status: "pending",
  items: [
    { name: "bread", portion: { kind: "amount", amount: 2, unit: "slice", estimated: false }, uncertain: false, confidence: 0.9 },
    { name: "coffee", portion: null, uncertain: true, confidence: 0.5 },
  ],
  unclear: ["something blurry"],
  overall_confidence: 0.85,
  proposed_meal_type: "breakfast",
  proposed_occurred_at: "2027-01-12T05:42:00+00:00",
  draft: null,
  created_at: "2027-01-12T05:43:10.123456+00:00",
  meal_raw_inputs: { kind: "text" },
  ...over,
});

const draftJson = (over: Record<string, unknown> = {}) => ({
  items: [{ name: "tea", portion: { kind: "size", size: "small", estimated: true }, uncertain: false }],
  mealType: "snack",
  occurredAt: "2027-01-12T09:00:00.000Z",
  ...over,
});

describe("parseUnderstandingRow", () => {
  it("parses a good row", () => {
    const u = parseUnderstandingRow(goodRow());
    expect(u).toEqual({
      id: ID,
      kind: "text",
      provider: "gemini",
      model: "gemini-test",
      promptVersion: "meal-v1",
      status: "pending",
      items: [
        { name: "bread", portion: { kind: "amount", amount: 2, unit: "slice", estimated: false }, uncertain: false, confidence: 0.9 },
        { name: "coffee", portion: null, uncertain: true, confidence: 0.5 },
      ],
      unclear: ["something blurry"],
      overallConfidence: 0.85,
      proposed: { mealType: "breakfast", occurredAt: new Date("2027-01-12T05:42:00Z") },
      draft: null,
      createdAt: new Date("2027-01-12T05:43:10.123Z"),
    });
  });

  it("reads the raw input kind from an object or from a one-item array", () => {
    expect(parseUnderstandingRow(goodRow({ meal_raw_inputs: { kind: "photo" } }))?.kind).toBe("photo");
    expect(parseUnderstandingRow(goodRow({ meal_raw_inputs: [{ kind: "photo" }] }))?.kind).toBe("photo");
  });

  it("rejects a raw input kind the flow never writes, and a missing or ambiguous embed", () => {
    expect(parseUnderstandingRow(goodRow({ meal_raw_inputs: { kind: "voice" } }))).toBeNull();
    expect(parseUnderstandingRow(goodRow({ meal_raw_inputs: null }))).toBeNull();
    expect(parseUnderstandingRow(goodRow({ meal_raw_inputs: [] }))).toBeNull();
    expect(parseUnderstandingRow(goodRow({ meal_raw_inputs: [{ kind: "text" }, { kind: "text" }] }))).toBeNull();
    const { meal_raw_inputs: _gone, ...without } = goodRow();
    void _gone;
    expect(parseUnderstandingRow(without)).toBeNull();
  });

  it("accepts a numeric confidence delivered as a string, and null", () => {
    expect(parseUnderstandingRow(goodRow({ overall_confidence: "0.80" }))?.overallConfidence).toBe(0.8);
    expect(parseUnderstandingRow(goodRow({ overall_confidence: null }))?.overallConfidence).toBeNull();
    expect(parseUnderstandingRow(goodRow({ overall_confidence: 1.5 }))).toBeNull();
    expect(parseUnderstandingRow(goodRow({ overall_confidence: "abc" }))).toBeNull();
  });

  it("parses every status and rejects an unknown one", () => {
    for (const status of ["pending", "accepted", "edited", "rejected"]) expect(parseUnderstandingRow(goodRow({ status }))?.status).toBe(status);
    expect(parseUnderstandingRow(goodRow({ status: "done" }))).toBeNull();
  });

  it("parses a draft", () => {
    const u = parseUnderstandingRow(goodRow({ draft: draftJson() }));
    expect(u?.draft).toEqual({
      items: [{ name: "tea", portion: { kind: "size", size: "small", estimated: true }, uncertain: false }],
      mealType: "snack",
      occurredAt: new Date("2027-01-12T09:00:00Z"),
    });
  });

  it("calls the whole row unreadable when the draft is present but broken", () => {
    expect(parseUnderstandingRow(goodRow({ draft: { items: "nope" } }))).toBeNull();
    expect(parseUnderstandingRow(goodRow({ draft: [] }))).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ["no id", { id: undefined }],
    ["an empty id", { id: "" }],
    ["items that are not an array", { items: "bread" }],
    ["items missing", { items: undefined }],
    ["an item without a name", { items: [{ portion: null, uncertain: false, confidence: 1 }] }],
    ["an item with a numeric name", { items: [{ name: 5, portion: null, uncertain: false, confidence: 1 }] }],
    ["an item without confidence", { items: [{ name: "a", portion: null, uncertain: false }] }],
    ["a confidence above 1", { items: [{ name: "a", portion: null, uncertain: false, confidence: 2 }] }],
    ["an unknown portion kind", { items: [{ name: "a", portion: { kind: "pinch", estimated: false }, uncertain: false, confidence: 1 }] }],
    ["an unknown unit", { items: [{ name: "a", portion: { kind: "amount", amount: 1, unit: "barrel", estimated: false }, uncertain: false, confidence: 1 }] }],
    ["an amount of zero", { items: [{ name: "a", portion: { kind: "amount", amount: 0, unit: "cup", estimated: false }, uncertain: false, confidence: 1 }] }],
    ["an amount above the maximum of its unit", { items: [{ name: "a", portion: { kind: "amount", amount: 99, unit: "cup", estimated: false }, uncertain: false, confidence: 1 }] }],
    ["an unknown size", { items: [{ name: "a", portion: { kind: "size", size: "huge", estimated: false }, uncertain: false, confidence: 1 }] }],
    ["a portion without the estimated flag", { items: [{ name: "a", portion: { kind: "size", size: "small" }, uncertain: false, confidence: 1 }] }],
    ["unclear that is not an array", { unclear: "x" }],
    ["a proposed meal type that is unknown", { proposed_meal_type: "brunch" }],
    ["no proposed meal type", { proposed_meal_type: null }],
    ["no proposed time", { proposed_occurred_at: null }],
    ["a proposed time that is not a date", { proposed_occurred_at: "yesterday" }],
    ["a created_at that is not a date", { created_at: "soon" }],
    ["a model that is a number", { model: 7 }],
  ])("returns null for %s", (_name, over) => {
    expect(parseUnderstandingRow(goodRow(over))).toBeNull();
  });

  it("returns null for rows that are not objects", () => {
    for (const row of [null, undefined, 5, "row", [], true]) expect(parseUnderstandingRow(row)).toBeNull();
  });

  it("returns null for more than 30 items, however small", () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ name: `f${i}`, portion: null, uncertain: false, confidence: 1 }));
    expect(parseUnderstandingRow(goodRow({ items: many }))).toBeNull();
    expect(parseUnderstandingRow(goodRow({ items: many.slice(0, 30) }))?.items).toHaveLength(30);
  });

  it("returns null for a huge array and a name of a million characters, and does so quickly", () => {
    const started = Date.now();
    const huge = Array.from({ length: 100_000 }, () => ({ name: "a", portion: null, uncertain: false, confidence: 1 }));
    expect(parseUnderstandingRow(goodRow({ items: huge }))).toBeNull();
    expect(parseUnderstandingRow(goodRow({ items: [{ name: "x".repeat(1_000_000), portion: null, uncertain: false, confidence: 1 }] }))).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("returns null when a stored name is a link or markup, and cleans a name that only needs cleaning", () => {
    const named = (name: string) => goodRow({ items: [{ name, portion: null, uncertain: false, confidence: 1 }] });
    expect(parseUnderstandingRow(named("http://evil.example"))).toBeNull();
    expect(parseUnderstandingRow(named("<script>alert(1)</script>"))).toBeNull();
    expect(parseUnderstandingRow(named("   "))).toBeNull();
    expect(parseUnderstandingRow(named("  fried   egg "))?.items[0].name).toBe("fried egg");
    expect(parseUnderstandingRow(named(`bread${String.fromCodePoint(0x202e)}`))?.items[0].name).toBe("bread");
  });

  it("leaves out unclear parts that cannot be shown, and keeps at most 5", () => {
    const unclear = ["fine", "http://x.example", "  ", "<b>x</b>", "also fine", "c", "d", "e", "f"];
    expect(parseUnderstandingRow(goodRow({ unclear }))?.unclear).toEqual(["fine", "also fine", "c", "d", "e"]);
    expect(parseUnderstandingRow(goodRow({ unclear: Array.from({ length: 11 }, () => "x") }))).toBeNull(); // the database caps it at 10
  });

  it("keeps Hebrew names and niqqud", () => {
    const row = goodRow({ items: [{ name: "שָׁלוֹם שניצל", portion: null, uncertain: false, confidence: 1 }] });
    expect(parseUnderstandingRow(row)?.items[0].name).toBe("שָׁלוֹם שניצל");
  });

  it("strips fields it does not know", () => {
    const u = parseUnderstandingRow(goodRow({ calories: 500, extra: { x: 1 } })) as unknown as Record<string, unknown>;
    expect(u.calories).toBeUndefined();
    expect(u.extra).toBeUndefined();
  });
});

describe("parseDraft", () => {
  it("parses a draft", () => {
    expect(parseDraft(draftJson())).toEqual({
      items: [{ name: "tea", portion: { kind: "size", size: "small", estimated: true }, uncertain: false }],
      mealType: "snack",
      occurredAt: new Date("2027-01-12T09:00:00Z"),
    });
  });

  it("accepts a draft with no items (the database allows it; saving it is refused by the domain)", () => {
    expect(parseDraft(draftJson({ items: [] }))?.items).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["an array", []],
    ["a string", "draft"],
    ["a bad meal type", draftJson({ mealType: "brunch" })],
    ["a bad date", draftJson({ occurredAt: "tomorrow-ish" })],
    ["a date that is a number", draftJson({ occurredAt: 1_700_000_000 })],
    ["items that are not an array", draftJson({ items: {} })],
    ["an item with a bad portion", draftJson({ items: [{ name: "a", portion: { kind: "amount" }, uncertain: false }] })],
    ["an item name that is a link", draftJson({ items: [{ name: "www.x.com", portion: null, uncertain: false }] })],
    ["an item without the uncertain flag", draftJson({ items: [{ name: "a", portion: null }] })],
  ])("returns null for %s", (_name, value) => {
    expect(parseDraft(value)).toBeNull();
  });
});

describe("draftToJson", () => {
  const meal: MealDraft = {
    items: [
      { name: "bread", portion: { kind: "amount", amount: 1.5, unit: "cup", estimated: true }, uncertain: false },
      { name: "tea", portion: { kind: "size", size: "large", estimated: false }, uncertain: true },
      { name: "jam", portion: null, uncertain: false },
    ],
    mealType: "lunch",
    occurredAt: new Date("2027-01-12T09:00:00.000Z"),
  };

  it("writes plain JSON with an ISO date", () => {
    const json = draftToJson(meal);
    expect(JSON.parse(JSON.stringify(json))).toEqual({
      items: [
        { name: "bread", portion: { kind: "amount", amount: 1.5, unit: "cup", estimated: true }, uncertain: false },
        { name: "tea", portion: { kind: "size", size: "large", estimated: false }, uncertain: true },
        { name: "jam", portion: null, uncertain: false },
      ],
      mealType: "lunch",
      occurredAt: "2027-01-12T09:00:00.000Z",
    });
  });

  it("round-trips through parseDraft", () => {
    expect(parseDraft(JSON.parse(JSON.stringify(draftToJson(meal))))).toEqual(meal);
  });

  it("drops properties that are not part of a draft item", () => {
    const sneaky = { ...meal, items: [{ ...meal.items[0], confidence: 0.9, calories: 100 } as never] };
    const out = draftToJson(sneaky) as { items: Array<Record<string, unknown>> };
    expect(Object.keys(out.items[0]).sort()).toEqual(["name", "portion", "uncertain"]);
  });
});

describe("itemsToJson", () => {
  it("keeps uncertain and confidence for an understanding's items", () => {
    const items: UnderstoodItem[] = [{ name: "rice", portion: { kind: "size", size: "medium", estimated: true }, uncertain: true, confidence: 0.4 }];
    expect(itemsToJson(items)).toEqual([{ name: "rice", portion: { kind: "size", size: "medium", estimated: true }, uncertain: true, confidence: 0.4 }]);
  });

  it("writes only name and portion for a confirmed meal", () => {
    const items: ConfirmedItem[] = [{ name: "rice", portion: null }, { name: "tea", portion: { kind: "amount", amount: 2, unit: "cup", estimated: false } }];
    const out = itemsToJson(items) as Array<Record<string, unknown>>;
    expect(out).toEqual([{ name: "rice", portion: null }, { name: "tea", portion: { kind: "amount", amount: 2, unit: "cup", estimated: false } }]);
    for (const o of out) expect(Object.keys(o).sort()).toEqual(["name", "portion"]);
  });

  it("gives an empty array for no items", () => {
    expect(itemsToJson([])).toEqual([]);
  });

  it("round-trips an understanding's items through the row parser", () => {
    const items: UnderstoodItem[] = [{ name: "rice", portion: { kind: "size", size: "medium", estimated: true }, uncertain: true, confidence: 0.4 }];
    const u = parseUnderstandingRow(goodRow({ items: JSON.parse(JSON.stringify(itemsToJson(items))) }));
    expect(u?.items).toEqual(items);
  });
});
