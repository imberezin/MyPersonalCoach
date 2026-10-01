import { describe, expect, it } from "vitest";
import { applyAdjudication, parseAdjudication, percentile, renderSummary, summarize, type CaseResult, type RunMeta } from "../../scripts/bake-off/lib/report";
import type { CaseScore } from "../../scripts/bake-off/lib/score";

const meta: RunMeta = { provider: "gemini", model: "m", format: null, prompt: "he", set: "all", dryRun: false, startedAt: "2026-10-01T00:00:00.000Z" };

const score = (id: string, over: Partial<CaseScore> = {}): CaseScore => ({
  id,
  valid: true,
  missing: [],
  extra: [],
  portionWrong: [],
  edits: 0,
  contradiction: false,
  hintsWrong: [],
  pass: true,
  ...over,
});

function result(id: string, modality: "text" | "photo", over: Partial<CaseResult> = {}, scoreOver: Partial<CaseScore> = {}): CaseResult {
  const s = score(id, scoreOver);
  return {
    id,
    modality,
    items: [{ name: "x", portion: null, uncertain: false }],
    unclear: [],
    notFood: false,
    failure: null,
    score: s,
    metrics: { latencyMs: 1000, attempts: 1, inputTokens: 100, outputTokens: 20, reasoningTokens: 0, rateLimited: 0 },
    finalPass: s.pass,
    adjudicated: false,
    ...over,
  };
}

describe("percentile", () => {
  it("nearest rank", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
    expect(percentile(values, 0)).toBe(10);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });
  it("does not need sorted input and does not change it", () => {
    const values = [3, 1, 2];
    expect(percentile(values, 50)).toBe(2);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("adjudication", () => {
  it("parses pass/fail verdicts and ignores anything else", () => {
    expect(parseAdjudication({ P07: "pass", T03: "fail", T04: "maybe", T05: 1 })).toEqual({ P07: "pass", T03: "fail" });
    expect(parseAdjudication(null)).toEqual({});
    expect(parseAdjudication([])).toEqual({});
    expect(parseAdjudication("x")).toEqual({});
  });

  it("a human verdict flips the machine's, in both directions, and is marked", () => {
    const rows = [
      { id: "P07", score: { pass: false } },
      { id: "T03", score: { pass: true } },
      { id: "T04", score: { pass: true } },
    ];
    expect(applyAdjudication(rows, { P07: "pass", T03: "fail" })).toEqual([
      { id: "P07", score: { pass: false }, finalPass: true, adjudicated: true },
      { id: "T03", score: { pass: true }, finalPass: false, adjudicated: true },
      { id: "T04", score: { pass: true }, finalPass: true, adjudicated: false },
    ]);
  });
});

describe("summarize", () => {
  it("computes the percentages per modality and overall, machine and final", () => {
    const results = [
      ...Array.from({ length: 17 }, (_, i) => result(`T${i + 1}`, "text")),
      result("T18", "text", {}, { pass: false, edits: 2, extra: ["a", "b"] }),
      result("T19", "text", {}, { pass: false }),
      result("T20", "text"),
      ...Array.from({ length: 17 }, (_, i) => result(`P${i + 1}`, "photo")),
      result("P18", "photo", { finalPass: true, adjudicated: true }, { pass: false }),
      result("P19", "photo", {}, { pass: false }),
      result("P20", "photo", {}, { pass: false }),
    ];
    const s = summarize(meta, results);
    expect(s.cases).toBe(40);
    expect(s.machine).toEqual({ passed: 35, total: 40, rate: 35 / 40 });
    expect(s.final).toEqual({ passed: 36, total: 40, rate: 0.9 });
    expect(s.byModality.text).toEqual({ passed: 18, total: 20, rate: 0.9 });
    expect(s.byModality.photo).toEqual({ passed: 18, total: 20, rate: 0.9 });
    expect(s.targets).toMatchObject({ overallMet: true, perModalityMet: true });
  });

  it("the targets are 85% overall and 80% in each modality; 34 of 40 is the boundary", () => {
    const build = (passed: number) => Array.from({ length: 40 }, (_, i) => result(`T${i + 1}`, i < 20 ? "text" : "photo", {}, { pass: i < passed }));
    expect(summarize(meta, build(34)).targets.overallMet).toBe(true);
    expect(summarize(meta, build(33)).targets.overallMet).toBe(false);
    // 34 passes, but all the failures are in photos: photos 14/20 = 70% < 80%.
    const lopsided = Array.from({ length: 40 }, (_, i) => result(`T${i + 1}`, i < 20 ? "text" : "photo", {}, { pass: i < 26 || i >= 32 }));
    expect(summarize(meta, lopsided).targets).toMatchObject({ overallMet: true, perModalityMet: false });
  });

  it("a run with only one modality does not fail the other's target", () => {
    expect(summarize(meta, [result("T1", "text")]).targets.perModalityMet).toBe(true);
  });

  it("reports validity, invented foods per case, uncertain share, latency percentiles, 429s and tokens", () => {
    const results = [
      result("T1", "text", { metrics: { latencyMs: 4000, attempts: 1, inputTokens: 100, outputTokens: 10, reasoningTokens: 0, rateLimited: 1 }, items: [{ name: "a", portion: null, uncertain: true }, { name: "b", portion: null, uncertain: false }] }, { extra: ["z"] }),
      result("T2", "text", { metrics: { latencyMs: 7000, attempts: 2, inputTokens: 200, outputTokens: 30, reasoningTokens: 0, rateLimited: 0 } }, { valid: false, pass: false }),
      result("T3", "text", { metrics: { latencyMs: 10_000, attempts: 1, inputTokens: 50, outputTokens: 5, reasoningTokens: 0, rateLimited: 2 } }),
    ];
    const s = summarize(meta, results);
    expect(s.schemaValid).toEqual({ passed: 2, total: 3, rate: 2 / 3 });
    expect(s.hallucinatedPerCase).toBeCloseTo(1 / 3);
    expect(s.uncertainShare).toBeCloseTo(1 / 4);
    expect(s.latency).toEqual({ p50Ms: 7000, p95Ms: 10_000 });
    expect(s.rateLimited).toBe(3);
    expect(s.tokens).toEqual({ input: 350, output: 45, reasoning: 0 });
    expect(s.targets.p50InRange).toBe(true);
  });

  it("warns when Groq reports reasoning tokens (the reasoning switch is not working)", () => {
    const withReasoning = result("T1", "text", { metrics: { latencyMs: 1, attempts: 1, inputTokens: 1, outputTokens: 1, reasoningTokens: 500, rateLimited: 0 } });
    expect(summarize({ ...meta, provider: "groq" }, [withReasoning]).reasoningWarning).toBe(true);
    expect(summarize({ ...meta, provider: "gemini" }, [withReasoning]).reasoningWarning).toBe(false);
    expect(summarize({ ...meta, provider: "groq" }, [result("T1", "text")]).reasoningWarning).toBe(false);
  });

  it("reports the Groq json_schema + image check only for that combination", () => {
    const rows = [result("P1", "photo"), result("P2", "photo", {}, { valid: false, pass: false }), result("T1", "text")];
    expect(summarize({ ...meta, provider: "groq", format: "json_schema" }, rows).jsonSchemaImageCheck).toEqual({ photos: 2, valid: 1 });
    expect(summarize({ ...meta, provider: "groq", format: "json_object" }, rows).jsonSchemaImageCheck).toBeNull();
    expect(summarize({ ...meta, provider: "gemini", format: null }, rows).jsonSchemaImageCheck).toBeNull();
  });

  it("an empty run does not divide by zero", () => {
    const s = summarize(meta, []);
    expect(s.final.rate).toBe(0);
    expect(s.hallucinatedPerCase).toBe(0);
    expect(s.targets.overallMet).toBe(false);
  });
});

describe("renderSummary", () => {
  it("shows the numbers and lists the cases that need a look, including overrides", () => {
    const results = [
      result("T01", "text"),
      result("T02", "text", {}, { pass: false, missing: ["שקדים"], extra: ["זיתים"], portionWrong: ["לחם"] }),
      result("P07", "photo", { finalPass: true, adjudicated: true }, { pass: false, missing: ["חומוס"] }),
      result("T05", "text", { failure: "all_providers_failed: gemini=timeout" }, { valid: false, pass: false }),
    ];
    const text = renderSummary(summarize(meta, results), results);
    expect(text).toContain("# Bake-off: gemini / m");
    expect(text).toContain("Passed (after your overrides): 2/4 (50%)");
    expect(text).toContain("- T02: fails.");
    expect(text).toContain("missed: שקדים");
    expect(text).toContain("invented or extra: זיתים");
    expect(text).toContain("portion differs: לחם");
    expect(text).toContain("- P07: passes (your override) [overridden]");
    expect(text).toContain("no usable answer (all_providers_failed: gemini=timeout)");
    expect(text).not.toContain("- T01:");
  });

  it("marks a dry run and the reasoning warning", () => {
    const rows = [result("T1", "text", { metrics: { latencyMs: 1, attempts: 1, inputTokens: 1, outputTokens: 1, reasoningTokens: 9, rateLimited: 0 } })];
    const text = renderSummary(summarize({ ...meta, provider: "groq", dryRun: true }, rows), rows);
    expect(text).toContain("DRY RUN");
    expect(text).toContain("reasoning switch");
  });

  it("lists hint differences separately", () => {
    const rows = [result("T14", "text", {}, { hintsWrong: ["time 08:00 (expected 07:30)"] })];
    expect(renderSummary(summarize(meta, rows), rows)).toContain("- T14: time 08:00 (expected 07:30)");
  });
});
