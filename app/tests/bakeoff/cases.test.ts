import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCandidates, parseLabels, parseTextCases, photoCasesFromLabels, splitAlternatives } from "../../scripts/bake-off/lib/cases";
import { APP_ROOT } from "../../scripts/bake-off/lib/config";

const readJson = (file: string) => JSON.parse(readFileSync(path.join(APP_ROOT, "bake-off", file), "utf8")) as unknown;

describe("the committed text-cases.json", () => {
  const cases = parseTextCases(readJson("text-cases.json"));

  it("has the 20 well-formed cases T01 to T20, in order", () => {
    expect(cases.map((c) => c.id)).toEqual(Array.from({ length: 20 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`));
    expect(cases.every((c) => c.modality === "text" && typeof c.text === "string" && c.text.length > 0)).toBe(true);
  });

  it("keeps the special cases special", () => {
    const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
    expect(byId.T09.kind).toBe("nothing_expected");
    expect(byId.T16.kind).toBe("not_food");
    expect(byId.T17.expected.map((e) => e.names)).toEqual([["תפוח"]]);
    expect(byId.T01.expected[0]).toEqual({ names: ["לחם"], portion: { amount: 2, unit: "slice" } });
    expect(byId.T03.expected[0].names).toEqual(["חביתה", "ביצים"]);
    expect(byId.T11.text).toMatch(/^2 slices of toast/);
    expect(byId.T14.hints).toEqual({ mealType: "breakfast", time: "07:30", day: undefined });
  });

  it("is synthetic: no e-mail addresses and no links", () => {
    const raw = readFileSync(path.join(APP_ROOT, "bake-off", "text-cases.json"), "utf8");
    expect(raw).not.toMatch(/@|https?:\/\//);
  });
});

describe("parseTextCases", () => {
  const good = { id: "T01", text: "x", expect: [{ name: "a" }] };

  it("accepts a minimal case", () => {
    expect(parseTextCases([good])).toEqual([{ id: "T01", modality: "text", kind: "foods", expected: [{ names: ["a"] }], text: "x", hints: undefined, note: undefined }]);
  });

  it.each([
    ["not an array", {}],
    ["a bad id", [{ ...good, id: "X1" }]],
    ["a duplicate id", [good, good]],
    ["no text", [{ ...good, text: "" }]],
    ["text over 500", [{ ...good, text: "x".repeat(501) }]],
    ["an unknown kind", [{ ...good, kind: "maybe" }]],
    ["a foods case with nothing expected", [{ id: "T01", text: "x" }]],
    ["a not_food case that lists foods", [{ ...good, kind: "not_food" }]],
    ["an empty name", [{ ...good, expect: [{ name: " | " }] }]],
    ["a portion with an unknown unit", [{ ...good, expect: [{ name: "a", portion: { amount: 1, unit: "barrel" } }] }]],
    ["a portion with neither size nor amount", [{ ...good, expect: [{ name: "a", portion: {} }] }]],
    ["expect not an array", [{ ...good, expect: "a" }]],
  ])("rejects %s", (_label, value) => {
    expect(() => parseTextCases(value)).toThrow();
  });
});

describe("parseLabels", () => {
  it("reads foods, alternatives, notes and not-food lines", () => {
    const text = [
      "# comment",
      "",
      "01-breakfast.jpg: חביתה|ביצה, לחם, סלט ירקות  # home",
      "13-notfood.jpg:",
      "05.JPG: פיצה،קולה",
    ].join("\n");
    const { entries, errors } = parseLabels(text);
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { file: "01-breakfast.jpg", foods: [["חביתה", "ביצה"], ["לחם"], ["סלט ירקות"]], note: "home" },
      { file: "13-notfood.jpg", foods: [], note: undefined },
      { file: "05.JPG", foods: [["פיצה"], ["קולה"]], note: undefined },
    ]);
  });

  it("reports bad lines instead of throwing", () => {
    const { entries, errors } = parseLabels(["no colon here", "notes.txt: food", "a.jpg: x", "A.jpg: y", "../up.jpg: z"].join("\n"));
    expect(entries.map((e) => e.file)).toEqual(["a.jpg"]);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain("line 1");
    expect(errors.some((e) => e.includes("listed twice"))).toBe(true);
  });

  it("the committed labels.example.txt parses with no errors and has three lines", () => {
    const { entries, errors } = parseLabels(readFileSync(path.join(APP_ROOT, "bake-off", "labels.example.txt"), "utf8"));
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(3);
    expect(entries[2].foods).toEqual([]);
  });
});

describe("photoCasesFromLabels", () => {
  it("numbers the cases in file order and marks a line with no foods as not food", () => {
    const cases = photoCasesFromLabels([
      { file: "a.jpg", foods: [["x", "y"]] },
      { file: "b.jpg", foods: [] },
    ]);
    expect(cases).toEqual([
      { id: "P01", modality: "photo", kind: "foods", expected: [{ names: ["x", "y"] }], file: "a.jpg", note: undefined },
      { id: "P02", modality: "photo", kind: "not_food", expected: [], file: "b.jpg", note: undefined },
    ]);
  });
});

describe("splitAlternatives", () => {
  it("splits on | and trims", () => {
    expect(splitAlternatives(" a | b ||c ")).toEqual(["a", "b", "c"]);
  });
});

describe("candidates", () => {
  it("the committed candidates.json is valid and lists the models of the blueprint", () => {
    const list = parseCandidates(readJson("candidates.json"));
    expect(list.map((c) => `${c.provider}:${c.model}:${c.responseFormat ?? ""}`)).toEqual([
      "gemini:gemini-3.1-flash-lite:",
      "gemini:gemini-3.5-flash-lite:",
      "gemini:gemini-3.5-flash:",
      "groq:qwen/qwen3.8-27b:json_object",
      "groq:qwen/qwen3.8-27b:json_schema",
    ]);
  });

  it.each([
    [[]],
    [{}],
    [[{ provider: "openai", model: "x" }]],
    [[{ provider: "gemini", model: "bad model" }]],
    [[{ provider: "gemini", model: "x", responseFormat: "json_object" }]],
    [[{ provider: "groq", model: "x", responseFormat: "xml" }]],
  ])("rejects %j", (value) => {
    expect(() => parseCandidates(value)).toThrow();
  });
});
