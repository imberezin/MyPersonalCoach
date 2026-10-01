import { describe, expect, it } from "vitest";
import { ANALYZE_FAILURES, ANALYZE_FIELDS, PROBLEM_REASONS, parseAnalyzeFields } from "./analyzeTypes";

const REQUEST_ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

/** A `get` over plain values, like FormData.get. */
const fields = (values: Record<string, unknown>) => (name: string) => values[name];

const valid = (over: Record<string, unknown> = {}) => ({
  [ANALYZE_FIELDS.mode]: "text",
  [ANALYZE_FIELDS.text]: "two slices of bread",
  [ANALYZE_FIELDS.requestId]: REQUEST_ID,
  [ANALYZE_FIELDS.composedMs]: "4200",
  ...over,
});

describe("parseAnalyzeFields", () => {
  it("reads a text report", () => {
    expect(parseAnalyzeFields(fields(valid()))).toEqual({
      ok: true,
      value: { mode: "text", text: "two slices of bread", requestId: REQUEST_ID, composedMs: 4200 },
    });
  });

  it("reads a manual report", () => {
    const result = parseAnalyzeFields(fields(valid({ mode: "manual" })));
    expect(result).toMatchObject({ ok: true, value: { mode: "manual" } });
  });

  it("allows a photo report with no note, and with one", () => {
    expect(parseAnalyzeFields(fields(valid({ mode: "photo", text: "" })))).toMatchObject({ ok: true, value: { mode: "photo", text: "" } });
    expect(parseAnalyzeFields(fields(valid({ mode: "photo", text: undefined })))).toMatchObject({ ok: true, value: { text: "" } });
    expect(parseAnalyzeFields(fields(valid({ mode: "photo", text: null })))).toMatchObject({ ok: true, value: { text: "" } });
    expect(parseAnalyzeFields(fields(valid({ mode: "photo", text: "half the portion" })))).toMatchObject({ ok: true, value: { text: "half the portion" } });
  });

  it("rejects empty text for text and manual", () => {
    for (const mode of ["text", "manual"]) {
      for (const text of ["", "   \n\t ", undefined, null]) {
        expect(parseAnalyzeFields(fields(valid({ mode, text }))), `${mode} ${JSON.stringify(text)}`).toEqual({ ok: false, reason: "invalid_input" });
      }
    }
  });

  it("accepts 500 code points and rejects 501 instead of cutting", () => {
    expect(parseAnalyzeFields(fields(valid({ text: "א".repeat(500) })))).toMatchObject({ ok: true });
    expect(parseAnalyzeFields(fields(valid({ text: "א".repeat(501) })))).toEqual({ ok: false, reason: "invalid_input" });
    expect(parseAnalyzeFields(fields(valid({ text: "🍎".repeat(500) })))).toMatchObject({ ok: true });
    expect(parseAnalyzeFields(fields(valid({ text: "🍎".repeat(501) })))).toEqual({ ok: false, reason: "invalid_input" });
    expect(parseAnalyzeFields(fields(valid({ mode: "photo", text: "x".repeat(501) })))).toEqual({ ok: false, reason: "invalid_input" });
  });

  it("strips control characters from the text", () => {
    const text = `bread${String.fromCharCode(0)}${String.fromCharCode(7)} and${String.fromCodePoint(0x202e)} jam`;
    expect(parseAnalyzeFields(fields(valid({ text })))).toMatchObject({ ok: true, value: { text: "bread and jam" } });
  });

  it("does not count characters that are stripped toward the limit", () => {
    const padded = "x".repeat(500) + String.fromCharCode(0).repeat(50);
    expect(parseAnalyzeFields(fields(valid({ text: padded })))).toMatchObject({ ok: true });
  });

  it("rejects a text field that is a file or any other object", () => {
    expect(parseAnalyzeFields(fields(valid({ text: new Blob(["x"]) })))).toEqual({ ok: false, reason: "invalid_input" });
    expect(parseAnalyzeFields(fields(valid({ text: 42 })))).toEqual({ ok: false, reason: "invalid_input" });
    expect(parseAnalyzeFields(fields(valid({ mode: "photo", text: { a: 1 } })))).toEqual({ ok: false, reason: "invalid_input" });
  });

  it("rejects a mode that is missing, unknown or not a string", () => {
    for (const mode of [undefined, "", "voice", "TEXT", "Photo", 1, null]) {
      expect(parseAnalyzeFields(fields(valid({ mode }))), String(mode)).toEqual({ ok: false, reason: "invalid_input" });
    }
  });

  it("rejects a request id that is not a UUID", () => {
    for (const requestId of [undefined, "", "abc", "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5", `${REQUEST_ID}0`, 12, "' or 1=1 --"]) {
      expect(parseAnalyzeFields(fields(valid({ requestId }))), String(requestId)).toEqual({ ok: false, reason: "invalid_input" });
    }
  });

  it("accepts an upper-case UUID", () => {
    expect(parseAnalyzeFields(fields(valid({ requestId: REQUEST_ID.toUpperCase() })))).toMatchObject({ ok: true });
  });

  describe("composedMs", () => {
    const composed = (composedMs: unknown) => {
      const result = parseAnalyzeFields(fields(valid({ composedMs })));
      return result.ok ? result.value.composedMs : "invalid";
    };

    it("reads a number or a numeric string, rounded", () => {
      expect(composed("0")).toBe(0);
      expect(composed(1500)).toBe(1500);
      expect(composed("1500.6")).toBe(1501);
      expect(composed("86400000")).toBe(86_400_000);
    });

    it("is null for negative, huge, non-numeric or missing values, and never makes the request invalid", () => {
      for (const bad of ["-1", -5, "86400001", 1e12, "abc", "", "  ", undefined, null, "NaN", "Infinity", {}]) {
        expect(composed(bad), String(bad)).toBeNull();
      }
    });
  });
});

describe("PROBLEM_REASONS", () => {
  it("holds every failure except quiet_time, plus network, with no duplicates", () => {
    const expected = [...ANALYZE_FAILURES.filter((f) => f !== "quiet_time"), "network"];
    expect([...PROBLEM_REASONS].sort()).toEqual([...expected].sort());
    expect(new Set(PROBLEM_REASONS).size).toBe(PROBLEM_REASONS.length);
    expect(PROBLEM_REASONS).not.toContain("quiet_time");
    expect(PROBLEM_REASONS).toContain("network");
  });

  it("names the eleven server failures", () => {
    expect([...ANALYZE_FAILURES].sort()).toEqual(
      [
        "quiet_time",
        "rate_limited",
        "daily_cap",
        "ai_unavailable",
        "ai_error",
        "nothing_found",
        "not_signed_in",
        "invalid_input",
        "too_large",
        "unsupported_type",
        "save_error",
      ].sort(),
    );
  });
});
