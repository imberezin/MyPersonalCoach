import { describe, expect, it } from "vitest";
import { PORTION_UNITS, type Portion, type PortionUnit } from "@/domain/food/types";
import { capitalizeFirst, formatPortion, isolateTime } from "./formatPortion";
import { LOCALES, foodTranslator } from "./foodTestKit";

const amount = (value: number, unit: PortionUnit, estimated = false): Portion => ({
  kind: "amount",
  amount: value,
  unit,
  estimated,
});

describe("formatPortion with the Hebrew catalog", () => {
  const t = foodTranslator("he");

  it.each([
    [amount(1, "slice"), "1 פרוסה"],
    [amount(2, "slice"), "2 פרוסות"],
    [amount(3, "slice", true), "בערך 3 פרוסות"],
    [amount(1, "cup"), "1 כוס"],
    [amount(0.5, "cup"), "חצי כוס"],
    [amount(0.5, "cup", true), "בערך חצי כוס"],
    [amount(1.5, "cup"), "1.5 כוסות"],
    [amount(2, "tablespoon"), "2 כפות"],
    [amount(200, "gram"), "200 גרם"],
    [amount(250, "ml"), "250 מ״ל"],
    [{ kind: "size", size: "small", estimated: false }, "מנה קטנה"],
    [{ kind: "size", size: "medium", estimated: true }, "מנה בינונית"],
    [{ kind: "size", size: "large", estimated: false }, "מנה גדולה"],
  ] satisfies Array<[Portion, string]>)("%j reads %s", (portion, text) => {
    expect(formatPortion(portion, t)).toBe(text);
  });
});

describe("formatPortion with the English catalog", () => {
  const t = foodTranslator("en");

  it.each([
    [amount(1, "slice"), "1 slice"],
    [amount(2, "slice"), "2 slices"],
    [amount(3, "slice", true), "about 3 slices"],
    [amount(1, "cup", true), "about 1 cup"],
    [amount(0.5, "cup"), "half a cup"],
    [amount(1.5, "bowl"), "1.5 bowls"],
    [amount(200, "gram"), "200 grams"],
    [amount(1, "gram"), "1 gram"],
    [amount(250, "ml"), "250 ml"],
    [{ kind: "size", size: "medium", estimated: false }, "medium portion"],
    [{ kind: "size", size: "large", estimated: true }, "large portion"],
  ] satisfies Array<[Portion, string]>)("%j reads %s", (portion, text) => {
    expect(formatPortion(portion, t)).toBe(text);
  });
});

describe("formatPortion in general", () => {
  it("returns null when there is no portion", () => {
    for (const locale of LOCALES) expect(formatPortion(null, foodTranslator(locale))).toBeNull();
  });

  it("never says 'half' for grams or millilitres", () => {
    for (const locale of LOCALES) {
      const t = foodTranslator(locale);
      expect(formatPortion(amount(0.5, "gram"), t)).toBe(t("unit.gram", { count: 0.5 }));
      expect(formatPortion(amount(0.5, "ml"), t)).toBe(t("unit.ml", { count: 0.5 }));
    }
  });

  it.each(LOCALES)("formats every unit, singular and plural, with digits and no leftover placeholder (%s)", (locale) => {
    const t = foodTranslator(locale);
    for (const unit of PORTION_UNITS) {
      for (const value of [1, 2, 5]) {
        const text = formatPortion(amount(value, unit), t) ?? "";
        expect(text, `${locale} ${unit} ${value}`).toContain(String(value));
        expect(text).not.toMatch(/[{}#]/);
        expect(text.trim()).not.toBe(String(value));
      }
      const half = formatPortion(amount(0.5, unit), t) ?? "";
      expect(half).not.toMatch(/[{}#]/);
    }
  });

  it("uses a different word for one and for many wherever the language has one", () => {
    const t = foodTranslator("en");
    for (const unit of PORTION_UNITS.filter((u) => u !== "gram" && u !== "ml")) {
      expect(formatPortion(amount(1, unit), t)).not.toBe((formatPortion(amount(2, unit), t) ?? "").replace("2", "1"));
    }
  });
});

describe("small text helpers", () => {
  it("wraps a time in the isolates that keep 13:30 from being reordered in Hebrew text", () => {
    expect(isolateTime("13:30")).toBe("⁦13:30⁩");
  });

  it("capitalizes the first letter only, and leaves Hebrew alone", () => {
    expect(capitalizeFirst("today")).toBe("Today");
    expect(capitalizeFirst("small portion")).toBe("Small portion");
    expect(capitalizeFirst("היום")).toBe("היום");
    expect(capitalizeFirst("")).toBe("");
  });
});
