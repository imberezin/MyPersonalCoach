import { createHash } from "node:crypto";
import { eveningOfDay } from "@/domain/asOf";
import { INTERVENTIONS, type InterventionKey } from "@/domain/interventions/library";
import { detectLateEvening, effectivePatternStatus, toDbStatus, type PatternFeedback } from "@/domain/patterns";
import { resolveTimeZone } from "@/domain/time";
import { RESULT_TO_DB, type Helpfulness } from "@/domain/weekly/types";
import he from "@/i18n/messages/he.json";
import type { SeedExperiment, SeedOptions } from "./args";

/**
 * The rows the Weekly Learning presets add to the history (15.1): experiments (`--exp`), the person's answer to the late-evening
 * question (`--pattern-answer`). Pure: no clock, no I/O, no randomness, so the same options always give the same rows, ids
 * included, and an additive re-run inserts only what is new. The wording of an experiment is the library's Hebrew sentence (the
 * demo user's language), never AI text: nothing here calls a provider.
 *
 * Calendar: "day N" is the 1-based local calendar day counted from `startedAt`, exactly as the meals and the weigh-ins.
 */

export interface PlannedExperiment {
  /** A deterministic v5-style UUID of (e-mail, seed, index). */
  id: string;
  status: SeedExperiment["status"];
  key: InterventionKey;
  /** The first variant of the library entry. */
  variantId: string;
  /** The library sentence the person was shown (Hebrew, no ICU placeholder left). */
  wording: string;
  /** 1-based local day of the offer. */
  day: number;
  /** The offer, 10:00 local. The history is read newest first by this column. */
  createdAt: Date;
  /** ACTIVE and DONE: 10:00 local on `day`. OFFERED and SKIPPED never started. */
  startedAt: Date | null;
  /** DONE: 7 days later at 09:00. SKIPPED: five minutes after the offer. */
  endedAt: Date | null;
  /** DONE only. "I did not get to try" is tried NO with NO helpfulness (not applicable), never UNKNOWN. */
  tried: "YES" | "NO" | null;
  helpfulness: Helpfulness | null;
}

export interface PlannedPatternAnswer {
  answer: PatternFeedback;
  /** 09:00 local on the 1-based day. */
  answeredAt: Date;
  /** The `p_status` of the evidence sync, from the live level at the answer (OBSERVATION for a rejection: it syncs an empty set first). */
  syncStatus: "OBSERVATION" | "CANDIDATE" | "VALIDATED";
  /** The live late-evening occurrences at the answer. Empty for a rejection: the person who said no leaves no evidence behind. */
  occurrences: { mealId: string; observedAt: Date }[];
}

const NAMESPACE = Buffer.from("9e2b6c14a8d34f7b85c0d1e3a47f2b69", "hex");
const EXPERIMENT_DAYS = 7;
const SKIP_MINUTES = 5;
const MINUTE_MS = 60_000;

function uuidV5(name: string): string {
  const bytes = createHash("sha1").update(NAMESPACE).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The id of the experiment at `index` of the plan. The e-mail is part of the name so two demo users never collide on a primary key. */
export function plannedExperimentId(options: Pick<SeedOptions, "email" | "seed">, index: number): string {
  return uuidV5(`experiment|${options.email}|${options.seed}|${index}`);
}

/** The first variant of a library entry (the one every `--exp` row uses). */
export function firstVariantOf(key: InterventionKey): string {
  return INTERVENTIONS[key].variants[0].id;
}

/**
 * The library sentence of `key` and its first variant, in Hebrew, with the ICU placeholders filled from the entry's own params
 * (what `getTranslations("interventions")` returns in the app). Throws on a sentence that is missing or still has a placeholder.
 */
export function experimentWording(key: InterventionKey): string {
  const variantId = firstVariantOf(key);
  const entry = (he.interventions as Record<string, Record<string, string> | undefined>)[key];
  const template = entry?.[variantId];
  if (typeof template !== "string" || template.trim() === "") throw new Error("seed_wording_missing");
  const params = INTERVENTIONS[key].params;
  const text = template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
  if (/[{}]/.test(text)) throw new Error("seed_wording_missing");
  return text;
}

/** The experiments of `--exp`, in time order (args.ts has checked the order, the single open row and the clock). */
export function planExperiments(options: Pick<SeedOptions, "email" | "seed" | "timeZone" | "experiments">, startedAt: Date): PlannedExperiment[] {
  const timeZone = resolveTimeZone(options.timeZone);
  const at = (day: number, time: string) => eveningOfDay({ startedAt, day, time, timeZone });
  return options.experiments.map((exp, index): PlannedExperiment => {
    const offeredAt = at(exp.day, "10:00");
    const result = exp.status === "DONE" && exp.result !== null ? RESULT_TO_DB[exp.result] : null;
    return {
      id: plannedExperimentId(options, index),
      status: exp.status,
      key: exp.key,
      variantId: firstVariantOf(exp.key),
      wording: experimentWording(exp.key),
      day: exp.day,
      createdAt: offeredAt,
      startedAt: exp.status === "ACTIVE" || exp.status === "DONE" ? offeredAt : null,
      endedAt:
        exp.status === "DONE"
          ? at(exp.day + EXPERIMENT_DAYS, "09:00")
          : exp.status === "SKIPPED"
            ? new Date(offeredAt.getTime() + SKIP_MINUTES * MINUTE_MS)
            : null,
      tried: result === null ? null : result.tried,
      helpfulness: result === null ? null : result.helpfulness,
    };
  });
}

/**
 * The `experiments` insert for a planned row. `created_at` is explicit (the database default is the real clock, which under a past
 * dev clock would be in the future of every reader, and the history is ordered by it); `user_id` is the column default (the signed-in
 * user); no source pattern (a seeded row is not about a stored pattern); the wording is the library's, in Hebrew.
 */
export function toExperimentRow(e: PlannedExperiment) {
  return {
    id: e.id,
    intervention_key: e.key,
    variant: e.variantId,
    status: e.status,
    wording: e.wording,
    wording_source: "library" as const,
    wording_locale: "he" as const,
    created_at: e.createdAt.toISOString(),
    started_at: e.startedAt === null ? null : e.startedAt.toISOString(),
    ended_at: e.endedAt === null ? null : e.endedAt.toISOString(),
    tried: e.tried,
    helpfulness: e.helpfulness,
  };
}

/**
 * `--pattern-answer`: what the app does at the press of an answer on the late-evening question, at 09:00 of the day. A rejection
 * syncs an EMPTY set first and then marks the row REJECTED; confirm and unsure sync the live occurrences with the status the live
 * level gives (an answer given at the Early Signal never makes the pattern Validated: effectivePatternStatus decides). The meals are
 * the plan's non-aggregated ones that had happened by then.
 */
export function planPatternAnswer(
  options: Pick<SeedOptions, "patternAnswer" | "timeZone">,
  meals: readonly { id: string; occurredAt: Date; aggregated: boolean }[],
  startedAt: Date,
): PlannedPatternAnswer | null {
  const given = options.patternAnswer;
  if (given === null) return null;
  const timeZone = resolveTimeZone(options.timeZone);
  const answeredAt = eveningOfDay({ startedAt, day: given.day, time: "09:00", timeZone });
  if (given.answer === "reject") return { answer: "reject", answeredAt, syncStatus: "OBSERVATION", occurrences: [] };

  const stamps = meals.filter((m) => !m.aggregated).map((m) => ({ id: m.id, occurredAt: m.occurredAt }));
  const occurrences = detectLateEvening({ meals: stamps, timeZone, asOf: answeredAt });
  const view = effectivePatternStatus({
    occurrences: occurrences.map((o) => o.occurredAt),
    timeZone,
    row: { id: "", status: "OBSERVATION", feedback: given.answer, feedbackAt: answeredAt },
  });
  return {
    answer: given.answer,
    answeredAt,
    syncStatus: view === "REJECTED" ? "OBSERVATION" : toDbStatus(view),
    occurrences: view === "REJECTED" ? [] : occurrences.map((o) => ({ mealId: o.mealId, observedAt: o.occurredAt })),
  };
}

/** The `p_occurrences` argument of `sync_pattern_evidence`. */
export function toSyncOccurrences(answer: PlannedPatternAnswer): { meal_id: string; observed_at: string }[] {
  return answer.occurrences.map((o) => ({ meal_id: o.mealId, observed_at: o.observedAt.toISOString() }));
}

/** The `patterns` update of the answer: the answer and its time (the cooldown clock), and REJECTED for a rejection. */
export function toPatternAnswerPatch(answer: PlannedPatternAnswer): Record<string, string> {
  const patch: Record<string, string> = { user_feedback: answer.answer, user_feedback_at: answer.answeredAt.toISOString() };
  if (answer.answer === "reject") patch.status = "REJECTED";
  return patch;
}
