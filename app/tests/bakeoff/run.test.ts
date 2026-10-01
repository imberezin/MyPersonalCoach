import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBakeOffArgs, type BakeOffOptions } from "../../scripts/bake-off/lib/args";
import type { BakeCase } from "../../scripts/bake-off/lib/cases";
import { APP_ROOT } from "../../scripts/bake-off/lib/config";
import { delayFor, runBakeOff, type BakeOffDeps } from "../../scripts/bake-off/lib/run";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "bakeoff-test-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const options = (over: Partial<BakeOffOptions> = {}): BakeOffOptions => ({ provider: null, model: null, set: "text", prompt: "he", format: null, limit: null, delayMs: null, dryRun: true, ...over });

const deps = (over: Partial<BakeOffDeps> = {}): BakeOffDeps => ({
  rootDir: APP_ROOT,
  photosDir: path.join(tmp, "photos"),
  outDir: path.join(tmp, "results"),
  env: {},
  now: () => new Date("2026-10-01T10:00:00.000Z"),
  ...over,
});

describe("runBakeOff --dry-run (fake provider, fixtures only)", () => {
  it("runs the 20 committed text cases and writes the results and the summary to the output folder", async () => {
    const lines: string[] = [];
    const run = await runBakeOff(options(), deps({ log: (l) => lines.push(l) }));

    expect(run.results).toHaveLength(20);
    expect(run.results.map((r) => r.id)[0]).toBe("T01");
    expect(run.summary.meta).toMatchObject({ provider: "fake", model: "fake-1", dryRun: true, set: "text", prompt: "he" });
    expect(run.summary.cases).toBe(20);
    expect(run.summary.schemaValid.rate).toBe(1);
    expect(run.summary.tokens).toEqual({ input: 200, output: 400, reasoning: 0 });
    expect(lines).toHaveLength(20);

    expect(run.outputDir.startsWith(path.join(tmp, "results"))).toBe(true);
    expect((await readdir(run.outputDir)).sort()).toEqual(["results.json", "summary.json", "summary.md"]);
    const summary = JSON.parse(await readFile(path.join(run.outputDir, "summary.json"), "utf8"));
    expect(summary.final.total).toBe(20);
    expect(await readFile(path.join(run.outputDir, "summary.md"), "utf8")).toContain("DRY RUN");
  });

  it("the fake answer (schnitzel, rice) scores as the machine says: it passes none of the Hebrew cases except the vague and not-food ones", async () => {
    const run = await runBakeOff(options(), deps());
    const passed = run.results.filter((r) => r.score.pass).map((r) => r.id);
    // T16 (not food): the fake lists two foods, so it fails. T09 (nothing expected): confident items, fails.
    expect(passed).not.toContain("T16");
    expect(passed).not.toContain("T09");
    expect(run.results.find((r) => r.id === "T02")?.score.missing).toContain("סלט");
  });

  it("--limit takes the first N cases of each modality", async () => {
    const run = await runBakeOff(options({ limit: 3 }), deps());
    expect(run.results.map((r) => r.id)).toEqual(["T01", "T02", "T03"]);
  });

  it("applies adjudication.json and marks the overridden cases", async () => {
    await mkdir(path.join(tmp, "results"), { recursive: true });
    await writeFile(path.join(tmp, "results", "adjudication.json"), JSON.stringify({ T01: "pass", T02: "fail" }));
    const run = await runBakeOff(options({ limit: 2 }), deps());
    const t01 = run.results.find((r) => r.id === "T01");
    expect(t01).toMatchObject({ finalPass: true, adjudicated: true });
    expect(t01?.score.pass).toBe(false);
    expect(run.summary.final.passed).toBe(1);
    expect(run.summary.machine.passed).toBe(0);
  });

  it("waits between cases (not before the first) with the delay it is given", async () => {
    const waits: number[] = [];
    await runBakeOff(options({ limit: 3, delayMs: 1234 }), deps({ sleep: (ms) => Promise.resolve(void waits.push(ms)) }));
    expect(waits).toEqual([1234, 1234]);
  });

  it("runs photo cases from labels.txt with an injected loader, and skips a listed file that is missing", async () => {
    const photos = path.join(tmp, "photos");
    await mkdir(photos, { recursive: true });
    await writeFile(path.join(photos, "labels.txt"), ["a.jpg: schnitzel, rice", "b.jpg:", "gone.jpg: x"].join("\n"));
    await writeFile(path.join(photos, "a.jpg"), "not really a jpeg");
    await writeFile(path.join(photos, "b.jpg"), "not really a jpeg");
    const loaded: string[] = [];
    const lines: string[] = [];
    const run = await runBakeOff(
      options({ set: "photo" }),
      deps({ log: (l) => lines.push(l), loadPhoto: async (p) => (loaded.push(path.basename(p)), new Uint8Array([0xff, 0xd8, 0xff])) }),
    );
    expect(loaded).toEqual(["a.jpg", "b.jpg"]);
    expect(run.results.map((r) => [r.id, r.modality])).toEqual([["P01", "photo"], ["P02", "photo"]]);
    expect(run.results[0].score).toMatchObject({ valid: true, missing: [], extra: [], pass: true });
    expect(run.results[1].score.pass).toBe(false); // the fake lists foods for a not-food photo
    expect(lines.some((l) => l.includes("gone.jpg"))).toBe(true);
  });

  it("set 'all' skips the photos with a note when there is no labels.txt", async () => {
    const lines: string[] = [];
    const run = await runBakeOff(options({ set: "all", limit: 2 }), deps({ log: (l) => lines.push(l) }));
    expect(run.results.map((r) => r.id)).toEqual(["T01", "T02"]);
    expect(lines[0]).toContain("photo cases are skipped");
  });

  it("set 'photo' without labels.txt, or with a malformed one, stops with a clear message before any call", async () => {
    await expect(runBakeOff(options({ set: "photo" }), deps())).rejects.toThrow(/labels\.txt/);
    await mkdir(path.join(tmp, "photos"), { recursive: true });
    await writeFile(path.join(tmp, "photos", "labels.txt"), "bad line without colon");
    await expect(runBakeOff(options({ set: "photo" }), deps())).rejects.toThrow(/needs fixing/);
  });

  it("an image that cannot be loaded fails that case with a code, not the whole run", async () => {
    const photos = path.join(tmp, "photos");
    await mkdir(photos, { recursive: true });
    await writeFile(path.join(photos, "labels.txt"), "a.jpg: x");
    await writeFile(path.join(photos, "a.jpg"), "x");
    const run = await runBakeOff(options({ set: "photo" }), deps({ loadPhoto: async () => { throw new Error("corrupt"); } }));
    expect(run.results[0]).toMatchObject({ failure: "case_error: corrupt" });
    expect(run.results[0].score.pass).toBe(false);
  });
});

describe("runBakeOff with a real adapter and an injected fetch (no network)", () => {
  const answer = (names: string[]) => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            items: names.map((name) => ({ name, portion_size: null, portion_amount: null, portion_unit: null, portion_estimated: false, confidence: 0.9, uncertain: false })),
            unclear: [],
            overall_confidence: 0.9,
            meal_type: null,
            day: null,
            local_time: null,
            not_food: false,
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 500, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 7 } },
  });

  it("measures tokens, reasoning tokens and 429s per case, and needs the key", async () => {
    let call = 0;
    const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const doFetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
      call++;
      if (call === 1) return new Response("{}", { status: 429 }); // T01: groq is rate limited
      return new Response(JSON.stringify(answer(["לחם", "גבינה", "קפה"])), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(runBakeOff(options({ dryRun: false, provider: "groq", limit: 2, delayMs: 0 }), deps({ env: {}, fetch: doFetch }))).rejects.toThrow("GROQ_API_KEY");

    const run = await runBakeOff(
      options({ dryRun: false, provider: "groq", format: "json_schema", limit: 2, delayMs: 0, prompt: "en" }),
      deps({ env: { GROQ_API_KEY: "test-key" }, fetch: doFetch }),
    );
    expect(run.summary.meta).toMatchObject({ provider: "groq", model: "qwen/qwen3.8-27b", format: "json_schema", prompt: "en" });
    expect(run.results[0].failure).toContain("all_providers_failed");
    expect(run.results[0].metrics).toMatchObject({ attempts: 1, rateLimited: 1 });
    expect(run.results[1].metrics).toMatchObject({ attempts: 1, inputTokens: 500, outputTokens: 50, reasoningTokens: 7 });
    expect(run.summary.rateLimited).toBe(1);
    expect(run.summary.reasoningWarning).toBe(true);
    expect(requests[1].body.response_format).toMatchObject({ type: "json_schema" });
    expect(requests[1].headers.Authorization).toBe("Bearer test-key");
    expect(requests[1].url).not.toContain("test-key");
    // The English twin of the prompt was used.
    expect(JSON.stringify(requests[1].body.messages)).toContain("You tidy up food reports");
    expect(run.outputDir).toContain("groq__qwen_qwen3.8-27b__json_schema__text__en");
  });

  it("Gemini needs its own key", async () => {
    await expect(runBakeOff(options({ dryRun: false, provider: "gemini" }), deps())).rejects.toThrow("GEMINI_API_KEY");
  });
});

describe("delayFor", () => {
  const text: BakeCase = { id: "T01", modality: "text", kind: "foods", expected: [] };
  const photo: BakeCase = { id: "P01", modality: "photo", kind: "foods", expected: [] };

  it("6 s by default, 25 s for Groq photos, 0 for a dry run, and the flag wins", () => {
    expect(delayFor(options({ dryRun: false, provider: "gemini" }), text)).toBe(6000);
    expect(delayFor(options({ dryRun: false, provider: "gemini" }), photo)).toBe(6000);
    expect(delayFor(options({ dryRun: false, provider: "groq" }), text)).toBe(6000);
    expect(delayFor(options({ dryRun: false, provider: "groq" }), photo)).toBe(25_000);
    expect(delayFor(options({ dryRun: true }), photo)).toBe(0);
    expect(delayFor(options({ dryRun: false, provider: "groq", delayMs: 100 }), photo)).toBe(100);
  });
});

describe("end to end: cli flags to options", () => {
  it("the flags the wrapper packs are exactly what parseBakeOffArgs accepts", () => {
    const packed = JSON.stringify({ provider: "gemini", model: "gemini-3.1-flash-lite", set: "text", "delay-ms": "6000" });
    expect(parseBakeOffArgs(packed)).toMatchObject({ ok: true, value: { provider: "gemini", delayMs: 6000 } });
  });
});
