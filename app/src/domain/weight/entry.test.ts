import { describe, expect, it } from "vitest";
import { dayOptions, measuredAtForDay, needsDoubleCheck, readWeightForm, validateWeightForm, type WeightFormValues } from "./entry";

const TZ = "Asia/Jerusalem";
// Friday 2026-10-02, 12:00 in Jerusalem (UTC+3 until 2026-10-25).
const NOW = new Date("2026-10-02T09:00:00Z");

const form = (entries: Record<string, FormDataEntryValue | undefined>) => ({
  get: (name: string) => entries[name] ?? null,
  getAll: (name: string) => (entries[name] === undefined ? [] : [entries[name] as FormDataEntryValue]),
});

const values = (overrides: Partial<WeightFormValues> = {}): WeightFormValues => ({ weight: "118.7", day: "now", note: "", confirmed: false, ...overrides });
const NEW = { kind: "new" } as const;
const ctx = (overrides: Partial<Parameters<typeof validateWeightForm>[1]> = {}) => ({ now: NOW, timeZone: TZ, mode: NEW, ...overrides });

describe("readWeightForm", () => {
  it("reads exactly the four fields as posted", () => {
    expect(readWeightForm(form({ weight: " 118,7 ", day: "2026-10-01", note: "x", confirmed: "1", id: "ignored" }))).toEqual({
      weight: " 118,7 ",
      day: "2026-10-01",
      note: "x",
      confirmed: true,
    });
  });

  it("turns missing fields and files into empty strings", () => {
    const file = new File(["x"], "x.txt");
    expect(readWeightForm(form({ weight: file, note: undefined }))).toEqual({ weight: "", day: "", note: "", confirmed: false });
  });

  it("is confirmed only for the exact value 1", () => {
    for (const raw of ["0", "true", "on", "", "11"]) expect(readWeightForm(form({ confirmed: raw })).confirmed).toBe(false);
    expect(readWeightForm(form({ confirmed: "1" })).confirmed).toBe(true);
  });
});

describe("dayOptions", () => {
  it("has now plus the previous 14 local days in new mode, newest first", () => {
    const options = dayOptions({ now: NOW, timeZone: TZ });
    expect(options).toHaveLength(15);
    expect(options[0]).toEqual({ value: "now", kind: "now", dayKey: null });
    expect(options[1]).toEqual({ value: "2026-10-01", kind: "yesterday", dayKey: "2026-10-01" });
    expect(options[2]).toEqual({ value: "2026-09-30", kind: "day", dayKey: "2026-09-30" });
    expect(options[14]).toEqual({ value: "2026-09-18", kind: "day", dayKey: "2026-09-18" });
    expect(options.filter((o) => o.kind === "yesterday")).toHaveLength(1);
  });

  it("starts with keep (not now) in edit mode", () => {
    const options = dayOptions({ now: NOW, timeZone: TZ, currentMeasuredAt: new Date("2026-10-01T05:00:00Z") });
    expect(options[0]).toEqual({ value: "keep", kind: "keep", dayKey: null });
    expect(options.map((o) => o.value)).not.toContain("now");
    expect(options).toHaveLength(15);
  });

  it("names the local day at the day boundary (23:30 UTC is already tomorrow in Jerusalem)", () => {
    const options = dayOptions({ now: new Date("2026-10-02T21:30:00Z"), timeZone: TZ }); // 00:30 on the 3rd, local
    expect(options[1].value).toBe("2026-10-02");
  });

  it("shows each of the 14 local days exactly once on the 25-hour day (2026-10-25)", () => {
    const options = dayOptions({ now: new Date("2026-10-26T06:00:00Z"), timeZone: TZ }); // 2026-10-26 08:00 local
    const keys = options.slice(1).map((o) => o.value);
    expect(keys).toHaveLength(14);
    expect(new Set(keys).size).toBe(14);
    expect(keys).toContain("2026-10-25");
    expect(keys[0]).toBe("2026-10-25");
    expect(keys[13]).toBe("2026-10-12");
  });

  it("shows each of the 14 local days exactly once on the 23-hour day (2026-03-27)", () => {
    const options = dayOptions({ now: new Date("2026-03-28T07:00:00Z"), timeZone: TZ }); // 2026-03-28 10:00 local
    const keys = options.slice(1).map((o) => o.value);
    expect(new Set(keys).size).toBe(14);
    expect(keys).toContain("2026-03-27");
    expect(keys[0]).toBe("2026-03-27");
    expect(keys[13]).toBe("2026-03-14");
  });

  it("does not skip a day when 'now' is shortly after midnight on the day after the 25-hour day", () => {
    const options = dayOptions({ now: new Date("2026-10-25T22:30:00Z"), timeZone: TZ }); // 2026-10-26 00:30 local
    expect(options[1].value).toBe("2026-10-25");
    expect(options[2].value).toBe("2026-10-24");
  });

  it("adds the entry's own older day once in edit mode", () => {
    const own = new Date("2026-08-10T08:00:00Z");
    const options = dayOptions({ now: NOW, timeZone: TZ, currentMeasuredAt: own });
    expect(options).toHaveLength(16);
    expect(options[15]).toEqual({ value: "2026-08-10", kind: "day", dayKey: "2026-08-10" });
    expect(options.filter((o) => o.value === "2026-08-10")).toHaveLength(1);
  });

  it("adds nothing when the entry's own day is already in the window, today or in the future", () => {
    for (const at of ["2026-09-25T08:00:00Z", "2026-10-02T05:00:00Z", "2026-10-20T05:00:00Z"]) {
      expect(dayOptions({ now: NOW, timeZone: TZ, currentMeasuredAt: new Date(at) })).toHaveLength(15);
    }
  });

  it("falls back to Jerusalem for a garbage zone and never throws on an invalid instant", () => {
    expect(dayOptions({ now: NOW, timeZone: "Not/AZone" })).toEqual(dayOptions({ now: NOW, timeZone: TZ }));
    expect(dayOptions({ now: new Date("nope"), timeZone: TZ })).toEqual([{ value: "now", kind: "now", dayKey: null }]);
  });
});

describe("measuredAtForDay", () => {
  it("is 12:00 local on an ordinary summer day and an ordinary winter day", () => {
    expect(measuredAtForDay("2026-10-01", TZ).toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect(measuredAtForDay("2027-01-15", TZ).toISOString()).toBe("2027-01-15T10:00:00.000Z");
  });

  it("is 12:00 local on both DST days", () => {
    expect(measuredAtForDay("2026-10-25", TZ).toISOString()).toBe("2026-10-25T10:00:00.000Z"); // 25-hour day, UTC+2 at noon
    expect(measuredAtForDay("2026-03-27", TZ).toISOString()).toBe("2026-03-27T09:00:00.000Z"); // 23-hour day, UTC+3 at noon
  });

  it("gives an Invalid Date for something that is not a calendar day", () => {
    for (const bad of ["2026-02-30", "garbage", "", "2026-13-01", "2026-1-1"]) expect(Number.isNaN(measuredAtForDay(bad, TZ).getTime())).toBe(true);
  });
});

describe("needsDoubleCheck", () => {
  it.each([
    [118.7, 103.8, false], // 14.9
    [118.7, 103.7, true], // 15.0 exactly (float noise must not move it)
    [103.7, 118.7, true], // the same distance downward
    [60, 100, true],
    [100, 100, false],
    [181, 118, true],
  ])("weight %s against %s -> %s", (weightKg, referenceKg, expected) => {
    expect(needsDoubleCheck({ weightKg, referenceKg })).toBe(expected);
  });

  it("never asks without a reference or with a non-finite number", () => {
    expect(needsDoubleCheck({ weightKg: 200, referenceKg: null })).toBe(false);
    expect(needsDoubleCheck({ weightKg: Number.NaN, referenceKg: 100 })).toBe(false);
    expect(needsDoubleCheck({ weightKg: 100, referenceKg: Number.NaN })).toBe(false);
  });
});

describe("validateWeightForm: the weight", () => {
  const weightOf = (weight: string) => validateWeightForm(values({ weight }), ctx());

  it("accepts both bounds of the inclusive range", () => {
    expect(weightOf("30.0")).toMatchObject({ ok: true, weightKg: 30 });
    expect(weightOf("350.0")).toMatchObject({ ok: true, weightKg: 350 });
    expect(weightOf("30")).toMatchObject({ ok: true, weightKg: 30 });
  });

  it("refuses just outside the range", () => {
    expect(weightOf("29.9")).toEqual({ ok: false, errors: [{ code: "out_of_range", field: "weight" }] });
    expect(weightOf("350.1")).toEqual({ ok: false, errors: [{ code: "out_of_range", field: "weight" }] });
    expect(weightOf("400")).toMatchObject({ ok: false });
    expect(weightOf("12")).toMatchObject({ ok: false });
  });

  it("rounds once to one decimal before the range check (99.55 -> 99.6; 29.95 -> 30.0 passes, 350.04 -> 350.0 passes)", () => {
    expect(weightOf("99,55")).toMatchObject({ ok: true, weightKg: 99.6 });
    expect(weightOf("29.95")).toMatchObject({ ok: true, weightKg: 30 });
    expect(weightOf("350.04")).toMatchObject({ ok: true, weightKg: 350 });
    expect(weightOf("350.05")).toMatchObject({ ok: false });
  });

  it("takes a comma or a dot", () => {
    expect(weightOf("118,7")).toMatchObject({ ok: true, weightKg: 118.7 });
    expect(weightOf("118.7")).toMatchObject({ ok: true, weightKg: 118.7 });
  });

  it("strips direction marks and surrounding spaces", () => {
    expect(weightOf("‏ 118.7‎ ")).toMatchObject({ ok: true, weightKg: 118.7 });
  });

  it("asks for a weight when it is empty or only spaces", () => {
    expect(weightOf("")).toEqual({ ok: false, errors: [{ code: "required", field: "weight" }] });
    expect(weightOf("   ")).toEqual({ ok: false, errors: [{ code: "required", field: "weight" }] });
  });

  it.each(["abc", "1.2.3", "-80", "80 kg", "١١٨.٧", "1e2", "118.", ".5"])("calls %j not a number", (weight) => {
    expect(weightOf(weight)).toEqual({ ok: false, errors: [{ code: "invalid_number", field: "weight" }] });
  });
});

describe("validateWeightForm: the note", () => {
  const noteOf = (note: string) => validateWeightForm(values({ note }), ctx());

  it("is null when empty or only whitespace", () => {
    expect(noteOf("")).toMatchObject({ ok: true, note: null });
    expect(noteOf("  \n\t ")).toMatchObject({ ok: true, note: null });
  });

  it("is trimmed and kept as typed otherwise", () => {
    expect(noteOf("  after a trip  ")).toMatchObject({ ok: true, note: "after a trip" });
    expect(noteOf("שבוע טוב <b>")).toMatchObject({ ok: true, note: "שבוע טוב <b>" });
  });

  it("allows 200 code points and refuses 201", () => {
    expect(noteOf("a".repeat(200))).toMatchObject({ ok: true });
    expect(noteOf("a".repeat(201))).toEqual({ ok: false, errors: [{ code: "note_too_long", field: "note" }] });
  });

  it("counts an emoji as one code point, not two UTF-16 units", () => {
    expect(noteOf("😀".repeat(200))).toMatchObject({ ok: true });
    expect(noteOf("😀".repeat(201))).toMatchObject({ ok: false });
  });

  it("removes NUL, which Postgres text cannot hold", () => {
    expect(noteOf("a\u0000b")).toMatchObject({ ok: true, note: "ab" });
    expect(noteOf("\u0000")).toMatchObject({ ok: true, note: null });
  });
});

describe("validateWeightForm: the day", () => {
  const dayOf = (day: string, c = ctx()) => validateWeightForm(values({ day }), c);

  it("stores the injected now for 'now'", () => {
    expect(dayOf("now")).toEqual({ ok: true, weightKg: 118.7, measuredAt: NOW, note: null, day: "now" });
  });

  it("stores noon local for a listed day", () => {
    expect(dayOf("2026-10-01")).toMatchObject({ ok: true, day: "earlier", measuredAt: new Date("2026-10-01T09:00:00Z") });
    expect(dayOf("2026-09-18")).toMatchObject({ ok: true, day: "earlier", measuredAt: new Date("2026-09-18T09:00:00Z") });
  });

  it("refuses a date outside the options: 15 days back, today as a key, the future, a nonexistent day, garbage", () => {
    for (const day of ["2026-09-17", "2026-10-02", "2026-10-03", "2026-02-30", "garbage", "", "NOW", "keep"]) {
      expect(dayOf(day), day).toEqual({ ok: false, errors: [{ code: "invalid_day", field: "day" }] });
    }
  });

  it("accepts keep only in edit mode, with a null measuredAt", () => {
    const edit = ctx({ mode: { kind: "edit", measuredAt: new Date("2026-09-30T05:00:00Z") } });
    expect(dayOf("keep", edit)).toEqual({ ok: true, weightKg: 118.7, measuredAt: null, note: null, day: "keep" });
    expect(dayOf("keep")).toMatchObject({ ok: false });
  });

  it("refuses 'now' in edit mode (the list there starts with 'keep')", () => {
    const edit = ctx({ mode: { kind: "edit", measuredAt: new Date("2026-09-30T05:00:00Z") } });
    expect(dayOf("now", edit)).toMatchObject({ ok: false });
  });

  it("accepts the entry's own older day in edit mode", () => {
    const edit = ctx({ mode: { kind: "edit", measuredAt: new Date("2026-08-10T08:00:00Z") } });
    expect(dayOf("2026-08-10", edit)).toMatchObject({ ok: true, day: "earlier", measuredAt: new Date("2026-08-10T09:00:00Z") });
    expect(dayOf("2026-08-09", edit)).toMatchObject({ ok: false });
  });

  it("is a stale value when the options moved on (the oldest day of a form drawn yesterday)", () => {
    // The form was drawn on 2026-10-02 (oldest option 2026-09-18); it is posted a day later, when 2026-09-18 is the 15th day back.
    const later = ctx({ now: new Date("2026-10-03T09:00:00Z") });
    expect(dayOf("2026-09-19", later)).toMatchObject({ ok: true });
    expect(dayOf("2026-09-18", later)).toMatchObject({ ok: false });
  });
});

describe("validateWeightForm: all errors together", () => {
  it("returns them in the order weight, day, note", () => {
    const result = validateWeightForm(values({ weight: "abc", day: "garbage", note: "a".repeat(201) }), ctx());
    expect(result).toEqual({
      ok: false,
      errors: [
        { code: "invalid_number", field: "weight" },
        { code: "invalid_day", field: "day" },
        { code: "note_too_long", field: "note" },
      ],
    });
  });

  it("returns only the errors that apply", () => {
    expect(validateWeightForm(values({ weight: "", note: "a".repeat(201) }), ctx())).toEqual({
      ok: false,
      errors: [
        { code: "required", field: "weight" },
        { code: "note_too_long", field: "note" },
      ],
    });
  });

  it("ignores `confirmed` (it only skips a soft question elsewhere)", () => {
    expect(validateWeightForm(values({ confirmed: true }), ctx())).toMatchObject({ ok: true });
  });
});
