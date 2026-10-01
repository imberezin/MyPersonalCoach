import { describe, expect, it } from "vitest";
import { parseManualFoods } from "./manual";

const names = (text: string) => parseManualFoods(text).items.map((i) => i.name);

describe("parseManualFoods", () => {
  it("splits on newlines", () => {
    expect(names("לחם\nגבינה\r\nקפה")).toEqual(["לחם", "גבינה", "קפה"]);
  });

  it("splits on commas, Arabic commas and semicolons", () => {
    expect(names("bread, cheese; coffee")).toEqual(["bread", "cheese", "coffee"]);
    expect(names(`bread${String.fromCharCode(0x060c)} cheese`)).toEqual(["bread", "cheese"]);
  });

  it("splits on plus and slash", () => {
    expect(names("rice + beans")).toEqual(["rice", "beans"]);
    expect(names("tea/coffee")).toEqual(["tea", "coffee"]);
  });

  it("splits on ' and ' and ' & ', in any case, but not inside a word", () => {
    expect(names("bread and cheese")).toEqual(["bread", "cheese"]);
    expect(names("bread AND cheese")).toEqual(["bread", "cheese"]);
    expect(names("salt & pepper")).toEqual(["salt", "pepper"]);
    expect(names("sandwich")).toEqual(["sandwich"]);
    expect(names("candy bar")).toEqual(["candy bar"]);
    expect(names("brandy")).toEqual(["brandy"]);
  });

  it("does not split a Hebrew vav prefix: it belongs to the next word", () => {
    expect(names("ולחם")).toEqual(["ולחם"]);
    expect(names("חביתה ולחם")).toEqual(["חביתה ולחם"]);
    expect(names("חביתה, ולחם")).toEqual(["חביתה", "ולחם"]);
  });

  it("gives every item no portion, no doubt and full confidence", () => {
    expect(parseManualFoods("bread").items).toEqual([{ name: "bread", portion: null, uncertain: false, confidence: 1 }]);
  });

  it("drops duplicates, case-folded, keeping the first spelling", () => {
    expect(names("Bread, bread, BREAD, cheese")).toEqual(["Bread", "cheese"]);
  });

  it("drops empty and whitespace-only pieces", () => {
    expect(names(",, bread ,  ;\n\n, ,cheese,")).toEqual(["bread", "cheese"]);
    expect(parseManualFoods("").items).toEqual([]);
    expect(parseManualFoods("  \n ,; ").items).toEqual([]);
  });

  it("sanitizes the names and drops the ones that are links or markup", () => {
    expect(names("<b>bread</b>, http://x.example, toast")).toEqual(["toast"]);
    expect(names("  fried   egg  ")).toEqual(["fried egg"]);
  });

  it("keeps at most 20 foods and says it left some out", () => {
    const text = Array.from({ length: 25 }, (_, i) => `food${i}`).join(", ");
    const result = parseManualFoods(text);
    expect(result.items).toHaveLength(20);
    expect(result.items[19].name).toBe("food19");
    expect(result.truncated).toBe(true);
  });

  it("is not truncated for exactly 20 foods", () => {
    const text = Array.from({ length: 20 }, (_, i) => `food${i}`).join(", ");
    expect(parseManualFoods(text).truncated).toBe(false);
  });

  it("caps each name at 80 code points", () => {
    expect(Array.from(names("א".repeat(200))[0])).toHaveLength(80);
  });

  it("terminates quickly on a 5,000 character paste, and flags it", () => {
    const started = Date.now();
    const result = parseManualFoods("pizza, ".repeat(715));
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.truncated).toBe(true);
    expect(result.items.length).toBeLessThanOrEqual(20);
  });

  it("terminates quickly on separators only and on a megabyte", () => {
    const started = Date.now();
    expect(parseManualFoods(",".repeat(1_000_000)).items).toEqual([]);
    expect(parseManualFoods("a ".repeat(500_000)).items.length).toBeLessThanOrEqual(20);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("never throws for something that is not a string", () => {
    expect(parseManualFoods(undefined as unknown as string)).toEqual({ items: [], truncated: false });
  });
});
