import { createHash } from "node:crypto";
import { eveningOfDay } from "@/domain/asOf";
import { resolveTimeZone } from "@/domain/time";
import { WEIGHT_ENTRY } from "@/domain/weight";
import { JUNK_WEIGHT_KG, type SeedOptions } from "./args";

/**
 * The deterministic weigh-ins the seed script writes (15.1). Pure: no clock, no I/O, no randomness (a hash of the seed, the
 * e-mail and the day decides the noise), so the same options always give the same plan, ids included, and an additive re-run
 * inserts only what is new.
 *
 * Calendar: day 1 is the local date `startDate` (the same calendar as the meals). Weekly weigh-ins sit on `weighDay` at
 * `weighTime`; daily ones on every day at 08:00. Like meals, an entry that would fall inside a Shabbat period is dropped, and so
 * is anything after the clock. The junk entry is the one absurd value the owner has to be able to delete.
 */

export type PlannedWeightKind = "weekly" | "daily" | "junk";

export interface PlannedWeight {
  /** A deterministic v5-style UUID of (e-mail, seed, slot, index). */
  id: string;
  kind: PlannedWeightKind;
  /** 1-based local day. */
  day: number;
  measuredAt: Date;
  /** One decimal. */
  weightKg: number;
}

const NAMESPACE = Buffer.from("3b8e5d21c7a04f69b1d2e8a05c4f7a13", "hex");
const DAILY_TIME = "08:00";
const JUNK_TIME = "08:00";

/** FNV-1a with a final avalanche: a stable 32-bit number for any text (the same family plan.ts uses for meals). */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function uuidV5(name: string): string {
  const bytes = createHash("sha1").update(NAMESPACE).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** "w" = the weekly weigh-in number `index`, "d" = the daily one of day `index`, "junk" = the one absurd entry. The e-mail is part of the name so two demo users never collide. */
export function plannedWeightId(options: Pick<SeedOptions, "email" | "seed">, slot: "w" | "d" | "junk", index: number): string {
  return uuidV5(`weight|${options.email}|${options.seed}|${slot}|${index}`);
}

/** A number in [-1, 1] decided by the seed, the e-mail and the day alone. */
function noiseOf(options: Pick<SeedOptions, "email" | "seed">, day: number): number {
  return (hash32(`${options.email}|${options.seed}|wn|${day}`) / 0xffffffff) * 2 - 1;
}

const round1 = (kg: number): number => Math.round(kg * 10) / 10;

/** The generated value of a day: the start weight, the drift per day, and the deterministic noise; one decimal, inside what the weight screen accepts. */
export function generatedWeight(options: Pick<SeedOptions, "email" | "seed" | "startWeightKg" | "weightDrift" | "weightNoise">, day: number): number {
  const kg = round1(options.startWeightKg + options.weightDrift * (day - 1) + options.weightNoise * noiseOf(options, day));
  return Math.min(WEIGHT_ENTRY.maxKg, Math.max(WEIGHT_ENTRY.minKg, kg));
}

/**
 * `startedAt` (day 1 at 12:00 local), `asOf` (the dev clock) and the Shabbat periods come from the caller (plan.ts), so this
 * module needs nothing of the meals' plan. Ascending by time.
 */
export function buildWeightPlan(
  options: SeedOptions,
  ctx: { startedAt: Date; asOf: Date; offline: readonly { start: Date; end: Date }[] },
): PlannedWeight[] {
  const timeZone = resolveTimeZone(options.timeZone);
  const [y, m, d] = options.startDate.split("-").map(Number);
  const weekdayOfDay = (day: number): number => new Date(Date.UTC(y, m - 1, d + day - 1)).getUTCDay();
  const at = (day: number, time: string): Date => eveningOfDay({ startedAt: ctx.startedAt, day, time, timeZone });

  const found: PlannedWeight[] = [];
  const add = (w: PlannedWeight) => {
    const t = w.measuredAt.getTime();
    if (t < ctx.startedAt.getTime() || t > ctx.asOf.getTime()) return;
    if (ctx.offline.some((p) => t >= p.start.getTime() && t < p.end.getTime())) return;
    found.push(w);
  };

  // Day 1 is the day onboarding finished: weigh-ins start on day 2, or on `--first-weigh-day` (weekly mode only: it puts the very
  // first weigh-in into the week a weekly preset summarises). Later weekly entries follow on the same weekday, every 7 days.
  if (options.weights === "weekly") {
    let ordinal = 0;
    for (let day = options.firstWeighDay ?? 2; day <= options.days; day++) {
      if (weekdayOfDay(day) !== options.weighDay) continue;
      const fromSeries = options.weightSeries !== null ? options.weightSeries[ordinal] : undefined;
      // A series is the whole list: weigh-ins after its end do not exist. Without one the values are generated.
      if (options.weightSeries === null || fromSeries !== undefined) {
        add({
          id: plannedWeightId(options, "w", ordinal),
          kind: "weekly",
          day,
          measuredAt: at(day, options.weighTime),
          weightKg: fromSeries ?? generatedWeight(options, day),
        });
      }
      ordinal++;
    }
  } else if (options.weights === "daily") {
    for (let day = 2; day <= options.days; day++) {
      add({ id: plannedWeightId(options, "d", day), kind: "daily", day, measuredAt: at(day, DAILY_TIME), weightKg: generatedWeight(options, day) });
    }
  }

  // The junk entry is dated inside the span (a day past --days has not happened yet).
  if (options.junkWeights && options.junkDay >= 2 && options.junkDay <= options.days) {
    add({ id: plannedWeightId(options, "junk", 0), kind: "junk", day: options.junkDay, measuredAt: at(options.junkDay, JUNK_TIME), weightKg: JUNK_WEIGHT_KG });
  }

  return found.sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime() || (a.id < b.id ? -1 : 1));
}

/** The `weight_entries` insert for a planned weigh-in. `user_id` is the column default (the signed-in user); no note, the column may not exist before the weight migration. */
export function toWeightRow(w: PlannedWeight) {
  return { id: w.id, weight_kg: w.weightKg, measured_at: w.measuredAt.toISOString(), source: "manual" as const };
}
