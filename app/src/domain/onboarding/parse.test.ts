import { describe, expect, it } from "vitest";
import { RANGES, rangeForField } from "./model";
import { parseDecimal, parseIntegerStrict, readIntent, readRawFields, sanitizeText, type FormDataLike } from "./parse";

function form(entries: Array<[string, FormDataEntryValue]>): FormDataLike {
  return {
    get: (name) => entries.find(([k]) => k === name)?.[1] ?? null,
    getAll: (name) => entries.filter(([k]) => k === name).map(([, v]) => v),
  };
}

describe("parseDecimal (weight range)", () => {
  const weight = (raw: string) => parseDecimal(raw, RANGES.weightKg);

  it("accepts a comma or a dot and rounds once to one decimal", () => {
    expect(weight("99,5")).toEqual({ ok: true, value: 99.5 });
    expect(weight("99.5")).toEqual({ ok: true, value: 99.5 });
    expect(weight("99.56")).toEqual({ ok: true, value: 99.6 });
    expect(weight("99.54")).toEqual({ ok: true, value: 99.5 });
    expect(weight("99.55")).toEqual({ ok: true, value: 99.6 });
    expect(weight("99")).toEqual({ ok: true, value: 99 });
  });

  it("treats an empty field as no answer", () => {
    expect(weight("")).toEqual({ ok: true, value: null });
    expect(weight("   ")).toEqual({ ok: true, value: null });
  });

  it("rejects anything that is not plain digits with one separator", () => {
    for (const bad of ["abc", "1e3", "-5", "+5", "9,9,5", "٩٩", "99.", ".5", "9 9", "0x10"]) {
      expect(weight(bad)).toEqual({ ok: false, code: "invalid_number" });
    }
  });

  it("strips direction marks and surrounding spaces", () => {
    expect(weight("‎99.5‏")).toEqual({ ok: true, value: 99.5 });
    expect(weight("‪ 80 ‬")).toEqual({ ok: true, value: 80 });
  });

  it("checks the range after rounding, inclusive at both ends", () => {
    expect(weight("19.94")).toEqual({ ok: false, code: "out_of_range" });
    expect(weight("19.96")).toEqual({ ok: true, value: 20 });
    expect(weight("20")).toEqual({ ok: true, value: 20 });
    expect(weight("500")).toEqual({ ok: true, value: 500 });
    expect(weight("500.04")).toEqual({ ok: true, value: 500 });
    expect(weight("500.06")).toEqual({ ok: false, code: "out_of_range" });
    expect(weight("0")).toEqual({ ok: false, code: "out_of_range" });
  });

  it("does not overflow on a very long number", () => {
    expect(weight("9".repeat(400))).toEqual({ ok: false, code: "out_of_range" });
  });

  it("covers height", () => {
    const height = (raw: string) => parseDecimal(raw, RANGES.heightCm);
    expect(height("79.9")).toEqual({ ok: false, code: "out_of_range" });
    expect(height("80")).toEqual({ ok: true, value: 80 });
    expect(height("250")).toEqual({ ok: true, value: 250 });
    expect(height("250.1")).toEqual({ ok: false, code: "out_of_range" });
    expect(height("180,5")).toEqual({ ok: true, value: 180.5 });
  });
});

describe("parseIntegerStrict", () => {
  const age = (raw: string) => parseIntegerStrict(raw, RANGES.ageYears);

  it("checks age inclusive at both ends", () => {
    expect(age("9")).toEqual({ ok: false, code: "out_of_range" });
    expect(age("10")).toEqual({ ok: true, value: 10 });
    expect(age("120")).toEqual({ ok: true, value: 120 });
    expect(age("121")).toEqual({ ok: false, code: "out_of_range" });
  });

  it("rejects decimals, signs and letters, and treats empty as no answer", () => {
    expect(age("25.5")).toEqual({ ok: false, code: "invalid_number" });
    expect(age("25,5")).toEqual({ ok: false, code: "invalid_number" });
    expect(age("-25")).toEqual({ ok: false, code: "invalid_number" });
    expect(age("25a")).toEqual({ ok: false, code: "invalid_number" });
    expect(age("")).toEqual({ ok: true, value: null });
  });

  it("accepts zero minutes for candle lighting", () => {
    expect(parseIntegerStrict("0", RANGES.candleMinutes)).toEqual({ ok: true, value: 0 });
    expect(parseIntegerStrict("90", RANGES.candleMinutes)).toEqual({ ok: true, value: 90 });
    expect(parseIntegerStrict("91", RANGES.candleMinutes)).toEqual({ ok: false, code: "out_of_range" });
  });
});

describe("sanitizeText", () => {
  it("removes NUL, normalises line breaks and trims", () => {
    expect(sanitizeText("  a\u0000b\r\nc\rd  ", 100)).toEqual({ ok: true, value: "ab\nc\nd" });
  });

  it("accepts empty text", () => {
    expect(sanitizeText("   ", 10)).toEqual({ ok: true, value: "" });
  });

  it("counts code points, not UTF-16 units", () => {
    expect(sanitizeText("😀".repeat(300), 300).ok).toBe(true);
    expect(sanitizeText("😀".repeat(301), 300)).toEqual({ ok: false, code: "too_long" });
    expect(sanitizeText("א".repeat(300), 300).ok).toBe(true);
    expect(sanitizeText("a".repeat(1001), 1000)).toEqual({ ok: false, code: "too_long" });
  });
});

describe("readRawFields", () => {
  it("reads only the step's own fields", () => {
    const f = form([
      ["age", " 30 "],
      ["height", "180"],
      ["weight", "99"],
      ["extra", "x"],
    ]);
    expect(readRawFields("about-you", f)).toEqual({ age: " 30 ", height: "180" });
  });

  it("reads multi-value fields with getAll and drops files", () => {
    const file = new File(["x"], "x.txt");
    const f = form([
      ["offline", "shabbat"],
      ["offline", "other"],
      ["offline", file],
      ["place", file],
      ["candle_minutes", "40"],
    ]);
    expect(readRawFields("offline", f)).toEqual({ offline: ["shabbat", "other"], candle_minutes: "40" });
  });

  it("gives an empty list for a multi-value field that was not sent", () => {
    expect(readRawFields("goals", form([]))).toEqual({ goals: [] });
  });

  it("reads nothing for steps without fields", () => {
    expect(readRawFields("welcome", form([["x", "y"]]))).toEqual({});
  });
});

describe("readIntent", () => {
  it("accepts skip and decline exactly", () => {
    expect(readIntent(form([["intent", "skip"]]))).toBe("skip");
    expect(readIntent(form([["intent", "decline"]]))).toBe("decline");
  });

  it("defaults everything else to continue", () => {
    expect(readIntent(form([]))).toBe("continue");
    expect(readIntent(form([["intent", "continue"]]))).toBe("continue");
    expect(readIntent(form([["intent", "SKIP"]]))).toBe("continue");
    expect(readIntent(form([["intent", " skip"]]))).toBe("continue");
  });
});

describe("rangeForField", () => {
  it("gives the range of each numeric field the forms send", () => {
    expect(rangeForField("weight")).toEqual(RANGES.weightKg);
    expect(rangeForField("goal_weight")).toEqual(RANGES.weightKg);
    expect(rangeForField("age")).toEqual(RANGES.ageYears);
    expect(rangeForField("height")).toEqual(RANGES.heightCm);
    expect(rangeForField("candle_minutes")).toEqual(RANGES.candleMinutes);
  });

  it("gives nothing for a field without a range", () => {
    expect(rangeForField("motivation")).toBeNull();
    expect(rangeForField("")).toBeNull();
  });
});
