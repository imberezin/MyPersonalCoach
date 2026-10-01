import type { CaseScore } from "./score";

/** Targets of the decision rule (Technology Stack / blueprint 4.8). */
export const TARGETS = { overall: 0.85, perModality: 0.8, p50LatencyMs: [6_000, 8_000] as const } as const;

export interface CaseMetrics {
  /** Wall time of the whole gateway call (retries included). */
  latencyMs: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  rateLimited: number;
}

export interface CaseResult {
  id: string;
  modality: "text" | "photo";
  /** Where the answer came from: the item names, not the raw provider body. */
  items: { name: string; portion: string | null; uncertain: boolean }[];
  unclear: string[];
  notFood: boolean;
  /** A failure reason such as all_providers_failed, with the attempt codes. */
  failure: string | null;
  score: CaseScore;
  metrics: CaseMetrics;
  /** pass after the human overrides in adjudication.json. */
  finalPass: boolean;
  adjudicated: boolean;
}

export type Adjudication = Record<string, "pass" | "fail">;

/** A human can flip any case: `{ "P07": "pass" }`. Unknown or malformed entries are ignored. */
export function parseAdjudication(json: unknown): Adjudication {
  const out: Adjudication = {};
  if (typeof json !== "object" || json === null || Array.isArray(json)) return out;
  for (const [id, verdict] of Object.entries(json)) {
    if (verdict === "pass" || verdict === "fail") out[id] = verdict;
  }
  return out;
}

export function applyAdjudication<T extends { id: string; score: { pass: boolean } }>(results: readonly T[], adjudication: Adjudication): (T & { finalPass: boolean; adjudicated: boolean })[] {
  return results.map((r) => {
    const verdict = adjudication[r.id];
    return { ...r, finalPass: verdict ? verdict === "pass" : r.score.pass, adjudicated: verdict !== undefined };
  });
}

/** Nearest-rank percentile of a list of numbers (p in 0..100). Empty list: 0. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

const rate = (passed: number, total: number) => (total === 0 ? 0 : passed / total);

export interface Share {
  passed: number;
  total: number;
  rate: number;
}

const share = (passed: number, total: number): Share => ({ passed, total, rate: rate(passed, total) });

export interface RunMeta {
  provider: string;
  model: string;
  format: string | null;
  prompt: "he" | "en";
  set: "text" | "photo" | "all";
  dryRun: boolean;
  startedAt: string;
}

export interface Summary {
  meta: RunMeta;
  cases: number;
  machine: Share;
  final: Share;
  byModality: { text: Share; photo: Share };
  schemaValid: Share;
  hallucinatedPerCase: number;
  uncertainShare: number;
  latency: { p50Ms: number; p95Ms: number };
  rateLimited: number;
  tokens: { input: number; output: number; reasoning: number };
  /** Reasoning tokens above zero on Groq mean the adapter's reasoning switch is not working. */
  reasoningWarning: boolean;
  /** Only for Groq in json_schema mode: did the schema + image combination give valid answers. */
  jsonSchemaImageCheck: { photos: number; valid: number } | null;
  targets: { overallMet: boolean; perModalityMet: boolean; p50InRange: boolean };
}

export function summarize(meta: RunMeta, results: readonly CaseResult[]): Summary {
  const count = (filter: (r: CaseResult) => boolean, pick: (r: CaseResult) => boolean) => {
    const subset = results.filter(filter);
    return share(subset.filter(pick).length, subset.length);
  };
  const all = () => true;
  const machine = count(all, (r) => r.score.pass);
  const final = count(all, (r) => r.finalPass);
  const text = count((r) => r.modality === "text", (r) => r.finalPass);
  const photo = count((r) => r.modality === "photo", (r) => r.finalPass);
  const schemaValid = count(all, (r) => r.score.valid);

  const items = results.flatMap((r) => r.items);
  const latencies = results.map((r) => r.metrics.latencyMs);
  const sum = (pick: (r: CaseResult) => number) => results.reduce((total, r) => total + pick(r), 0);
  const photos = results.filter((r) => r.modality === "photo");
  const reasoning = sum((r) => r.metrics.reasoningTokens);

  const p50 = percentile(latencies, 50);
  const modalityMet = (s: Share) => s.total === 0 || s.rate >= TARGETS.perModality;
  return {
    meta,
    cases: results.length,
    machine,
    final,
    byModality: { text, photo },
    schemaValid,
    hallucinatedPerCase: results.length === 0 ? 0 : sum((r) => r.score.extra.length) / results.length,
    uncertainShare: items.length === 0 ? 0 : items.filter((i) => i.uncertain).length / items.length,
    latency: { p50Ms: p50, p95Ms: percentile(latencies, 95) },
    rateLimited: sum((r) => r.metrics.rateLimited),
    tokens: { input: sum((r) => r.metrics.inputTokens), output: sum((r) => r.metrics.outputTokens), reasoning },
    reasoningWarning: meta.provider === "groq" && reasoning > 0,
    jsonSchemaImageCheck: meta.provider === "groq" && meta.format === "json_schema" ? { photos: photos.length, valid: photos.filter((r) => r.score.valid).length } : null,
    targets: {
      overallMet: results.length > 0 && final.rate >= TARGETS.overall,
      perModalityMet: modalityMet(text) && modalityMet(photo),
      p50InRange: p50 >= TARGETS.p50LatencyMs[0] && p50 <= TARGETS.p50LatencyMs[1],
    },
  };
}

const pct = (r: number) => `${(r * 100).toFixed(0)}%`;
const share2 = (s: Share) => `${s.passed}/${s.total} (${pct(s.rate)})`;

/** A readable summary for a non-technical reader: the numbers first, then the cases that need a look. */
export function renderSummary(summary: Summary, results: readonly CaseResult[]): string {
  const m = summary.meta;
  const lines: string[] = [];
  lines.push(`# Bake-off: ${m.provider} / ${m.model}${m.format ? ` / ${m.format}` : ""}`);
  lines.push("");
  lines.push(`Prompt: ${m.prompt}. Set: ${m.set}.${m.dryRun ? " DRY RUN (fake provider, the numbers mean nothing)." : ""} Started: ${m.startedAt}.`);
  lines.push("");
  lines.push("## Result");
  lines.push("");
  lines.push(`- Passed (after your overrides): ${share2(summary.final)}. By the machine alone: ${share2(summary.machine)}.`);
  lines.push(`- Text: ${share2(summary.byModality.text)}. Photos: ${share2(summary.byModality.photo)}.`);
  lines.push(`- Target: at least ${pct(TARGETS.overall)} overall and ${pct(TARGETS.perModality)} in each kind. Overall target ${summary.targets.overallMet ? "met" : "NOT met"}; each kind ${summary.targets.perModalityMet ? "met" : "NOT met"}.`);
  lines.push(`- Answers that validated: ${share2(summary.schemaValid)} (target: all of them).`);
  lines.push(`- Invented foods per case: ${summary.hallucinatedPerCase.toFixed(2)}. Items marked "maybe": ${pct(summary.uncertainShare)}.`);
  lines.push(`- Time: median ${(summary.latency.p50Ms / 1000).toFixed(1)} s, slowest 5% over ${(summary.latency.p95Ms / 1000).toFixed(1)} s (target median 6 to 8 s: ${summary.targets.p50InRange ? "in range" : "outside"}).`);
  lines.push(`- Rate limit answers (429): ${summary.rateLimited}.`);
  lines.push(`- Tokens: ${summary.tokens.input} in, ${summary.tokens.output} out, ${summary.tokens.reasoning} reasoning.`);
  if (summary.reasoningWarning) lines.push("- WARNING: the model reported reasoning tokens, so the reasoning switch in the Groq adapter is not working.");
  if (summary.jsonSchemaImageCheck) {
    lines.push(`- Groq json_schema together with an image: ${summary.jsonSchemaImageCheck.valid} of ${summary.jsonSchemaImageCheck.photos} photos gave a valid answer.`);
  }

  const needLook = results.filter((r) => !r.finalPass || r.adjudicated);
  if (needLook.length > 0) {
    lines.push("", "## Cases to look at", "");
    for (const r of needLook) {
      const parts: string[] = [];
      if (r.failure) parts.push(`no usable answer (${r.failure})`);
      if (r.score.missing.length) parts.push(`missed: ${r.score.missing.join(", ")}`);
      if (r.score.extra.length) parts.push(`invented or extra: ${r.score.extra.join(", ")}`);
      if (r.score.portionWrong.length) parts.push(`portion differs: ${r.score.portionWrong.join(", ")}`);
      if (r.score.contradiction) parts.push("said it is not food");
      lines.push(`- ${r.id}: ${r.finalPass ? "passes (your override)" : "fails"}${r.adjudicated ? " [overridden]" : ""}. ${parts.join("; ")}`.trim());
    }
  }
  const hints = results.filter((r) => r.score.hintsWrong.length > 0);
  if (hints.length > 0) {
    lines.push("", "## Time and meal-type hints that differ (not counted)", "");
    for (const r of hints) lines.push(`- ${r.id}: ${r.score.hintsWrong.join("; ")}`);
  }
  lines.push("");
  return lines.join("\n");
}
