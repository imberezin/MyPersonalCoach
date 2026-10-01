import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { IMAGE_LIMITS, type Portion } from "@/domain/food";
import { AI_DEFAULTS } from "@/lib/ai/config";
import { AIGateway } from "@/lib/ai/gateway";
import { FakeAIProvider } from "@/lib/ai/providers/fake";
import { GeminiProvider } from "@/lib/ai/providers/gemini";
import { GroqProvider } from "@/lib/ai/providers/groq";
import {
  ProviderError,
  type AIProvider,
  type CallContext,
  type CoachMessage,
  type InsightContext,
  type MealInput,
  type ProviderReply,
  type VoiceInput,
} from "@/lib/ai/types";
import type { BakeOffOptions } from "./args";
import { parseLabels, parseTextCases, photoCasesFromLabels, type BakeCase } from "./cases";
import {
  applyAdjudication,
  parseAdjudication,
  renderSummary,
  summarize,
  type CaseMetrics,
  type CaseResult,
  type Summary,
} from "./report";
import { scoreCase, type CaseOutcome } from "./score";

/**
 * The bake-off runner. It calls the REAL adapters, the REAL gateway and the REAL meal schema, so it
 * measures what the product will do. It sends nothing but the case input (a typed description, or a
 * photo compressed by the same size rule as the app) and it never prints a key, a prompt or a photo.
 * `--dry-run` swaps in the fake provider; the fixture tests use that.
 */

export interface BakeOffDeps {
  /** The app folder; the committed data lives in `<root>/bake-off`. */
  rootDir: string;
  /** Default `<root>/bake-off/photos` (gitignored). */
  photosDir?: string;
  /** Default `<root>/bake-off/results` (gitignored). */
  outDir?: string;
  /** Only GEMINI_* and GROQ_* are read. */
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (line: string) => void;
  /** Returns the JPEG bytes to send for a photo file. Default: sharp, same size rule as the app. */
  loadPhoto?: (filePath: string) => Promise<Uint8Array>;
}

export interface BakeOffRun {
  summary: Summary;
  results: CaseResult[];
  outputDir: string;
}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

/** Same rule as the phone: long side 1024 px, JPEG quality 0.8, EXIF dropped by the re-encode. `sharp` is a devDependency and is not shipped. */
async function compressWithSharp(filePath: string): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const input = await readFile(filePath);
  const out = await sharp(input)
    .rotate()
    .resize({ width: IMAGE_LIMITS.longSidePx, height: IMAGE_LIMITS.longSidePx, fit: "inside", withoutEnlargement: true })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: Math.round(IMAGE_LIMITS.jpegQuality * 100) })
    .toBuffer();
  return new Uint8Array(out);
}

interface CallLog {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  errorKind: string | null;
}

/** Wraps a provider and keeps, per call, the numbers the gateway does not expose (tokens, 429s). */
class MeasuredProvider implements AIProvider {
  readonly id: string;
  calls: CallLog[] = [];

  constructor(private readonly inner: AIProvider) {
    this.id = inner.id;
  }

  private async measure(call: () => Promise<ProviderReply>): Promise<ProviderReply> {
    const started = performance.now();
    try {
      const reply = await call();
      this.calls.push({
        latencyMs: performance.now() - started,
        inputTokens: reply.usage?.inputTokens ?? 0,
        outputTokens: reply.usage?.outputTokens ?? 0,
        reasoningTokens: reply.usage?.reasoningTokens ?? 0,
        errorKind: null,
      });
      return reply;
    } catch (error) {
      this.calls.push({
        latencyMs: performance.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        errorKind: error instanceof ProviderError ? error.kind : "error",
      });
      throw error;
    }
  }

  analyzeMeal(input: MealInput, ctx: CallContext) {
    return this.measure(() => this.inner.analyzeMeal(input, ctx));
  }
  analyzeText(input: { text: string; locale: MealInput["locale"] }, ctx: CallContext) {
    return this.measure(() => this.inner.analyzeText(input, ctx));
  }
  transcribeVoice(input: VoiceInput, ctx: CallContext) {
    return this.inner.transcribeVoice(input, ctx);
  }
  generateInsight(context: InsightContext, ctx: CallContext) {
    return this.inner.generateInsight(context, ctx);
  }
  detectPatternCandidate(events: ReadonlyArray<Record<string, string | number | boolean | null>>, ctx: CallContext) {
    return this.inner.detectPatternCandidate(events, ctx);
  }
  coach(messages: readonly CoachMessage[], context: InsightContext, ctx: CallContext) {
    return this.inner.coach(messages, context, ctx);
  }
}

interface Chosen {
  provider: AIProvider;
  label: { provider: string; model: string; format: string | null };
}

function chooseProvider(options: BakeOffOptions, deps: BakeOffDeps): Chosen {
  if (options.dryRun || options.provider === null) {
    return { provider: new FakeAIProvider("fake"), label: { provider: "fake", model: "fake-1", format: null } };
  }
  if (options.provider === "gemini") {
    const apiKey = deps.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set (put it in .env.local)");
    const model = options.model ?? AI_DEFAULTS.models.gemini;
    return {
      provider: new GeminiProvider({
        apiKey,
        model,
        maxOutputTokens: AI_DEFAULTS.maxOutputTokens,
        thinkingLevel: AI_DEFAULTS.gemini.thinkingLevel,
        promptLanguage: options.prompt,
        fetch: deps.fetch,
      }),
      label: { provider: "gemini", model, format: null },
    };
  }
  const apiKey = deps.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY is not set (put it in .env.local)");
  const model = options.model ?? AI_DEFAULTS.models.groq;
  const format = options.format ?? AI_DEFAULTS.groq.responseFormat;
  return {
    provider: new GroqProvider({
      apiKey,
      model,
      responseFormat: format,
      reasoningEffort: AI_DEFAULTS.groq.reasoningEffort,
      reasoningFormat: AI_DEFAULTS.groq.reasoningFormat,
      maxOutputTokens: AI_DEFAULTS.maxOutputTokens,
      promptLanguage: options.prompt,
      fetch: deps.fetch,
    }),
    label: { provider: "groq", model, format },
  };
}

/** Free-tier pacing: one Groq photo is about 3.1K tokens, so one call every 25 s stays under the 8K-per-minute limit. */
export function delayFor(options: BakeOffOptions, c: BakeCase): number {
  if (options.delayMs !== null) return options.delayMs;
  if (options.dryRun || options.provider === null) return 0;
  if (options.provider === "groq" && c.modality === "photo") return 25_000;
  return 6_000;
}

function portionText(portion: Portion | null): string | null {
  if (portion === null) return null;
  const about = portion.estimated ? "~" : "";
  return portion.kind === "size" ? `${about}${portion.size}` : `${about}${portion.amount} ${portion.unit}`;
}

async function loadCases(options: BakeOffOptions, deps: BakeOffDeps, photosDir: string, log: (line: string) => void): Promise<BakeCase[]> {
  const cases: BakeCase[] = [];
  if (options.set !== "photo") {
    const text = JSON.parse(await readFile(path.join(deps.rootDir, "bake-off", "text-cases.json"), "utf8")) as unknown;
    const textCases = parseTextCases(text);
    cases.push(...(options.limit ? textCases.slice(0, options.limit) : textCases));
  }
  if (options.set !== "text") {
    const labelsPath = path.join(photosDir, "labels.txt");
    if (!(await exists(labelsPath))) {
      if (options.set === "photo") throw new Error("No photos: bake-off/photos/labels.txt does not exist");
      log("No bake-off/photos/labels.txt, so the photo cases are skipped.");
    } else {
      const { entries, errors } = parseLabels(await readFile(labelsPath, "utf8"));
      if (errors.length > 0) throw new Error(`labels.txt needs fixing:\n${errors.join("\n")}`);
      const present: typeof entries = [];
      for (const entry of entries) {
        if (await exists(path.join(photosDir, entry.file))) present.push(entry);
        else log(`Photo ${entry.file} is listed in labels.txt but the file is missing, so it is skipped.`);
      }
      const photoCases = photoCasesFromLabels(present);
      cases.push(...(options.limit ? photoCases.slice(0, options.limit) : photoCases));
    }
  }
  return cases;
}

const safeName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_");

export async function runBakeOff(options: BakeOffOptions, deps: BakeOffDeps): Promise<BakeOffRun> {
  const log = deps.log ?? (() => {});
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => new Date());
  const photosDir = deps.photosDir ?? path.join(deps.rootDir, "bake-off", "photos");
  const outDir = deps.outDir ?? path.join(deps.rootDir, "bake-off", "results");
  const loadPhoto = deps.loadPhoto ?? compressWithSharp;

  const chosen = chooseProvider(options, deps);
  const cases = await loadCases(options, deps, photosDir, log);
  if (cases.length === 0) throw new Error("There are no cases to run");

  const startedAt = now().toISOString();
  const measured = new MeasuredProvider(chosen.provider);
  // The product's own gateway settings: one repair retry, the same per-attempt and total time limits.
  const gateway = new AIGateway([measured], { retriesOnInvalidOutput: 1, timeoutMs: AI_DEFAULTS.timeoutsMs.text, totalBudgetMs: AI_DEFAULTS.timeoutsMs.total });

  const partial: Omit<CaseResult, "finalPass" | "adjudicated">[] = [];
  for (const [index, c] of cases.entries()) {
    if (index > 0) {
      const wait = delayFor(options, c);
      if (wait > 0) await sleep(wait);
    }

    measured.calls = [];
    const wallStart = performance.now();
    let outcome: CaseOutcome;
    let failure: string | null = null;
    try {
      const input: MealInput =
        c.modality === "photo"
          ? { image: { bytes: await loadPhoto(path.join(photosDir, c.file ?? "")), mime: "image/jpeg" }, locale: "he" }
          : { text: c.text ?? "", locale: "he" };
      const result = await gateway.analyzeMeal(input, { timeoutMs: c.modality === "photo" ? AI_DEFAULTS.timeoutsMs.photo : AI_DEFAULTS.timeoutsMs.text });
      if (result.ok) {
        outcome = { ok: true, meal: result.value };
      } else {
        failure = `${result.reason}: ${result.attempts.map((a) => `${a.provider}=${a.error}`).join(", ")}`;
        outcome = { ok: false, reason: failure };
      }
    } catch (error) {
      // Only a code: a photo that cannot be read, never its content.
      failure = `case_error: ${error instanceof Error ? error.message.slice(0, 80) : "error"}`;
      outcome = { ok: false, reason: failure };
    }
    const latencyMs = performance.now() - wallStart;

    const metrics: CaseMetrics = {
      latencyMs,
      attempts: measured.calls.length,
      inputTokens: measured.calls.reduce((n, call) => n + call.inputTokens, 0),
      outputTokens: measured.calls.reduce((n, call) => n + call.outputTokens, 0),
      reasoningTokens: measured.calls.reduce((n, call) => n + call.reasoningTokens, 0),
      rateLimited: measured.calls.filter((call) => call.errorKind === "rate_limited").length,
    };
    const score = scoreCase(c, outcome);
    partial.push({
      id: c.id,
      modality: c.modality,
      items: outcome.ok ? outcome.meal.items.map((i) => ({ name: i.name, portion: portionText(i.portion), uncertain: i.uncertain })) : [],
      unclear: outcome.ok ? outcome.meal.unclear : [],
      notFood: outcome.ok ? outcome.meal.notFood : false,
      failure,
      score,
      metrics,
    });
    log(`${c.id} ${score.pass ? "pass" : "fail"} (${(latencyMs / 1000).toFixed(1)} s, ${metrics.attempts} attempt${metrics.attempts === 1 ? "" : "s"})`);
  }

  const adjudicationPath = path.join(outDir, "adjudication.json");
  const adjudication = (await exists(adjudicationPath)) ? parseAdjudication(JSON.parse(await readFile(adjudicationPath, "utf8")) as unknown) : {};
  const results: CaseResult[] = applyAdjudication(partial, adjudication);

  const summary = summarize(
    { ...chosen.label, prompt: options.prompt, set: options.set, dryRun: options.dryRun, startedAt },
    results,
  );

  const runId = [chosen.label.provider, safeName(chosen.label.model), chosen.label.format ?? "default", options.set, options.prompt].join("__");
  const outputDir = path.join(outDir, runId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "results.json"), JSON.stringify(results, null, 2), "utf8");
  await writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(path.join(outputDir, "summary.md"), renderSummary(summary, results), "utf8");

  return { summary, results, outputDir };
}
