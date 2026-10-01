import { describe, expect, it } from "vitest";
import { isMealEdited, mealOf, mealSource, revisionOf, toConfirmedItems, validateMealForSave } from "./draft";
import type { FoodItem, MealDraft, Understanding, UnderstoodItem } from "./types";

const HOUR = 3_600_000;
const NOW = new Date("2027-01-12T10:30:00Z");

const understood = (name: string, over: Partial<UnderstoodItem> = {}): UnderstoodItem => ({
  name,
  portion: null,
  uncertain: false,
  confidence: 0.9,
  ...over,
});

type Source = Pick<Understanding, "provider" | "items" | "proposed" | "draft">;

const source = (over: Partial<Source> = {}): Source => ({
  provider: "gemini",
  items: [understood("bread"), understood("coffee", { uncertain: true, confidence: 0.4 })],
  proposed: { mealType: "breakfast", occurredAt: new Date("2027-01-12T06:30:00Z") },
  draft: null,
  ...over,
});

const draftOf = (items: FoodItem[], over: Partial<MealDraft> = {}): MealDraft => ({
  items,
  mealType: "breakfast",
  occurredAt: new Date("2027-01-12T06:30:00Z"),
  ...over,
});

describe("mealOf", () => {
  it("is the proposal without confidence when there is no draft", () => {
    expect(mealOf(source())).toEqual({
      items: [
        { name: "bread", portion: null, uncertain: false },
        { name: "coffee", portion: null, uncertain: true },
      ],
      mealType: "breakfast",
      occurredAt: new Date("2027-01-12T06:30:00Z"),
    });
  });

  it("is the draft when there is one", () => {
    const draft = draftOf([{ name: "tea", portion: null, uncertain: false }], { mealType: "snack" });
    expect(mealOf(source({ draft }))).toBe(draft);
  });
});

describe("mealSource and isMealEdited", () => {
  it("is user_manual for a manual report, edited or not", () => {
    expect(mealSource(source({ provider: "manual" }))).toBe("user_manual");
    expect(mealSource(source({ provider: "manual", draft: draftOf([{ name: "x", portion: null, uncertain: false }]) }))).toBe("user_manual");
  });

  it("is ai_unedited with no draft", () => {
    expect(mealSource(source())).toBe("ai_unedited");
    expect(isMealEdited(source())).toBe(false);
  });

  it("is ai_unedited when the draft says the same as the proposal, whatever the 'maybe' flags", () => {
    const same = draftOf([
      { name: "bread", portion: null, uncertain: false },
      { name: "coffee", portion: null, uncertain: false },
    ]);
    expect(mealSource(source({ draft: same }))).toBe("ai_unedited");
  });

  it("is ai_edited when a food, a portion, the type or the time changed", () => {
    const base = [
      { name: "bread", portion: null, uncertain: false },
      { name: "coffee", portion: null, uncertain: false },
    ];
    expect(mealSource(source({ draft: draftOf([base[0], { name: "tea", portion: null, uncertain: false }]) }))).toBe("ai_edited");
    expect(
      mealSource(source({ draft: draftOf([{ ...base[0], portion: { kind: "size", size: "small", estimated: false } }, base[1]]) })),
    ).toBe("ai_edited");
    expect(mealSource(source({ draft: draftOf(base, { mealType: "lunch" }) }))).toBe("ai_edited");
    expect(mealSource(source({ draft: draftOf(base, { occurredAt: new Date("2027-01-12T06:31:00Z") }) }))).toBe("ai_edited");
    expect(isMealEdited(source({ draft: draftOf(base, { mealType: "lunch" }) }))).toBe(true);
  });
});

describe("revisionOf", () => {
  const meal = (): MealDraft =>
    draftOf([
      { name: "bread", portion: { kind: "amount", amount: 2, unit: "slice", estimated: false }, uncertain: false },
      { name: "coffee", portion: null, uncertain: true },
    ]);

  it("is 8 hex characters", () => {
    expect(revisionOf(meal())).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is stable for the same meal and under property order", () => {
    const reordered: MealDraft = {
      occurredAt: new Date("2027-01-12T06:30:00Z"),
      mealType: "breakfast",
      items: [
        { uncertain: false, portion: { estimated: false, unit: "slice", amount: 2, kind: "amount" }, name: "bread" },
        { uncertain: true, portion: null, name: "coffee" },
      ],
    };
    expect(revisionOf(reordered)).toBe(revisionOf(meal()));
    expect(revisionOf(meal())).toBe(revisionOf(meal()));
  });

  it("ignores properties that are not part of what is shown", () => {
    const withConfidence = meal();
    (withConfidence.items[0] as UnderstoodItem).confidence = 0.99;
    expect(revisionOf(withConfidence)).toBe(revisionOf(meal()));
  });

  it("changes with any name, portion, 'maybe' flag, type or minute", () => {
    const base = revisionOf(meal());
    const seen = new Set([base]);
    const variants: MealDraft[] = [];

    const renamed = meal();
    renamed.items[0].name = "toast";
    variants.push(renamed);

    const portion = meal();
    portion.items[0].portion = { kind: "amount", amount: 3, unit: "slice", estimated: false };
    variants.push(portion);

    const estimated = meal();
    estimated.items[0].portion = { kind: "amount", amount: 2, unit: "slice", estimated: true };
    variants.push(estimated);

    // The flag of a size matters as much: it decides whether the "amounts are estimates" note shows.
    const sizeEstimated = meal();
    sizeEstimated.items[0].portion = { kind: "size", size: "small", estimated: true };
    variants.push(sizeEstimated);

    const unit = meal();
    unit.items[0].portion = { kind: "amount", amount: 2, unit: "piece", estimated: false };
    variants.push(unit);

    const size = meal();
    size.items[0].portion = { kind: "size", size: "small", estimated: false };
    variants.push(size);

    const maybe = meal();
    maybe.items[1].uncertain = false;
    variants.push(maybe);

    const removed = meal();
    removed.items.pop();
    variants.push(removed);

    variants.push({ ...meal(), mealType: "lunch" });
    variants.push({ ...meal(), occurredAt: new Date("2027-01-12T06:31:00Z") });

    for (const v of variants) {
      const rev = revisionOf(v);
      expect(rev).not.toBe(base);
      seen.add(rev);
    }
    expect(seen.size).toBe(variants.length + 1);
  });

  it("depends on the order of the foods (the screen shows that order)", () => {
    const swapped = meal();
    swapped.items.reverse();
    expect(revisionOf(swapped)).not.toBe(revisionOf(meal()));
  });

  it("handles Hebrew names", () => {
    expect(revisionOf(draftOf([{ name: "שניצל", portion: null, uncertain: false }]))).not.toBe(
      revisionOf(draftOf([{ name: "שניצלל", portion: null, uncertain: false }])),
    );
  });
});

describe("toConfirmedItems", () => {
  it("keeps name and portion only", () => {
    const portion = { kind: "size", size: "large", estimated: true } as const;
    const out = toConfirmedItems([{ name: "pizza", portion, uncertain: true }, { name: "cola", portion: null, uncertain: false }]);
    expect(out).toEqual([{ name: "pizza", portion }, { name: "cola", portion: null }]);
    for (const o of out) expect(Object.keys(o).sort()).toEqual(["name", "portion"]);
  });

  it("drops confidence if an understood item is passed", () => {
    expect(toConfirmedItems([understood("rice")])).toEqual([{ name: "rice", portion: null }]);
  });
});

describe("validateMealForSave", () => {
  const items = (n: number): FoodItem[] => Array.from({ length: n }, (_, i) => ({ name: `f${i}`, portion: null, uncertain: false }));
  const meal = (n: number, at: Date = NOW): MealDraft => draftOf(items(n), { occurredAt: at });

  it("accepts 1 and 20 foods now", () => {
    expect(validateMealForSave(meal(1), NOW)).toEqual({ ok: true });
    expect(validateMealForSave(meal(20), NOW)).toEqual({ ok: true });
  });

  it("rejects no foods and 21 foods", () => {
    expect(validateMealForSave(meal(0), NOW)).toEqual({ ok: false, code: "no_items" });
    expect(validateMealForSave(meal(21), NOW)).toEqual({ ok: false, code: "too_many_items" });
  });

  it("rejects a time more than 5 minutes ahead and accepts 5", () => {
    expect(validateMealForSave(meal(1, new Date(NOW.getTime() + 5 * 60_000)), NOW)).toEqual({ ok: true });
    expect(validateMealForSave(meal(1, new Date(NOW.getTime() + 6 * 60_000)), NOW)).toEqual({ ok: false, code: "time_future" });
  });

  it("rejects a time more than 48 hours back and accepts 48", () => {
    expect(validateMealForSave(meal(1, new Date(NOW.getTime() - 48 * HOUR)), NOW)).toEqual({ ok: true });
    expect(validateMealForSave(meal(1, new Date(NOW.getTime() - 49 * HOUR)), NOW)).toEqual({ ok: false, code: "time_too_old" });
  });

  it("reports the foods before the time", () => {
    expect(validateMealForSave(meal(0, new Date(NOW.getTime() + HOUR)), NOW)).toEqual({ ok: false, code: "no_items" });
  });
});
