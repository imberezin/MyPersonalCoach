import { INTERVENTIONS } from "../interventions/library";
import { EARLY_SIGNAL } from "../patterns/earlySignal";
import { PATTERN_FLOW } from "../patterns/types";
import { DAY_MS } from "../time";
import { PATTERN_EXPERIMENT_MAP } from "./map";
import { EXPERIMENT_RULES, type ExperimentFact, type ExperimentSelection, type PatternFact } from "./types";

type NoneReason = Extract<ExperimentSelection, { kind: "NONE" }>["reason"];

/** The most informative reason wins when several patterns say no (higher = more informative). */
const REASON_RANK: Readonly<Record<NoneReason, number>> = {
  switch_off: 0,
  no_pattern: 1,
  pattern_rejected: 2,
  pattern_not_established: 3,
  no_mapping: 4,
  pattern_unsure_cooldown: 5,
  skipped_recently: 6,
};

const isEstablished = (view: PatternFact["view"]): boolean => view === "CANDIDATE" || view === "VALIDATED";

/** The OFFERED row, resolved AGAINST THE LIVE PATTERN it came from. */
function resolveOffered(offered: ExperimentFact, patterns: readonly PatternFact[]): ExperimentSelection {
  const fact = offered.sourcePatternId === null ? undefined : patterns.find((p) => p.patternId === offered.sourcePatternId);
  if (!fact) return { kind: "NONE", reason: "pattern_not_established" };
  if (isEstablished(fact.view)) return { kind: "PENDING", experimentId: offered.id };
  return { kind: "NONE", reason: fact.view === "REJECTED" ? "pattern_rejected" : "pattern_not_established" };
}

/** Why this one pattern gives no offer right now, or null when it does. */
function blockedBy(pattern: PatternFact, experiments: readonly ExperimentFact[], nowMs: number): NoneReason | null {
  if (pattern.view === "REJECTED") return "pattern_rejected";
  if (!isEstablished(pattern.view)) return pattern.view === "NONE" ? "no_pattern" : "pattern_not_established";

  // "Not sure" pauses the offer. Without the time of the answer the pause cannot be shown to have ended.
  if (pattern.feedback === "unsure") {
    const endsAt =
      pattern.feedbackAt === null
        ? Number.POSITIVE_INFINITY
        : pattern.feedbackAt.getTime() + EARLY_SIGNAL.cooldownDays * DAY_MS;
    if (nowMs < endsAt) return "pattern_unsure_cooldown";
  }

  // "Not this time" is respected for the library's cooldown, for THAT pattern only. A SKIPPED row with no end
  // time cannot be shown to be old, so it keeps the pause.
  const skippedRecently = experiments.some((e) => {
    if (e.status !== "SKIPPED" || pattern.patternId === null || e.sourcePatternId !== pattern.patternId) return false;
    return e.endedAt === null ? true : nowMs < e.endedAt.getTime() + EXPERIMENT_RULES.skippedCooldownDays * DAY_MS;
  });
  if (skippedRecently) return "skipped_recently";

  return PATTERN_EXPERIMENT_MAP[pattern.kind] ? null : "no_mapping";
}

/**
 * Pure. Order of the answer:
 *  1. PATTERN_FLOW.experimentEnabled false -> NONE switch_off.
 *  2. An ACTIVE experiment -> ACTIVE (always wins, whatever the meals say).
 *  3. An OFFERED one is resolved against the live pattern: its pattern CANDIDATE or VALIDATED -> PENDING;
 *     REJECTED -> NONE pattern_rejected; any other view, or no matching pattern (the row is gone, or
 *     `sourcePatternId` is null) -> NONE pattern_not_established. In those NONE cases the stored row is left
 *     untouched and the selection does NOT fall through to a new OFFER (one experiment is open at a time, and the
 *     unique index would reject a second row), so the idea waits and PENDING returns if the pattern is
 *     established again.
 *  4. Otherwise, for each pattern in the given order, the first that is CANDIDATE or VALIDATED, not rejected,
 *     not "unsure" inside the cooldown, without a SKIPPED experiment of that pattern that ended inside the
 *     cooldown, and with a mapping -> OFFER with the library's own params and constraints. If none: NONE with the
 *     most informative reason.
 * It never reads a stored pattern status: `view` is the live level.
 */
export function selectFirstExperiment(input: {
  patterns: readonly PatternFact[];
  experiments: readonly ExperimentFact[];
  now: Date;
}): ExperimentSelection {
  if (!PATTERN_FLOW.experimentEnabled) return { kind: "NONE", reason: "switch_off" };

  const active = input.experiments.find((e) => e.status === "ACTIVE");
  if (active) return { kind: "ACTIVE", experimentId: active.id };

  const offered = input.experiments.find((e) => e.status === "OFFERED");
  if (offered) return resolveOffered(offered, input.patterns);

  const nowMs = input.now.getTime();
  if (Number.isNaN(nowMs)) return { kind: "NONE", reason: "no_pattern" };

  let reason: NoneReason = "no_pattern";
  for (const pattern of input.patterns) {
    const blocked = blockedBy(pattern, input.experiments, nowMs);
    if (blocked !== null) {
      if (REASON_RANK[blocked] > REASON_RANK[reason]) reason = blocked;
      continue;
    }
    const mapped = PATTERN_EXPERIMENT_MAP[pattern.kind];
    const def = INTERVENTIONS[mapped.key];
    return {
      kind: "OFFER",
      patternKind: pattern.kind,
      key: mapped.key,
      variantId: mapped.variantId,
      scope: mapped.scope,
      params: { ...def.params },
      constraints: [...def.constraints],
    };
  }
  return { kind: "NONE", reason };
}
