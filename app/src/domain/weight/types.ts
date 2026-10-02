import { isUuid } from "../food/routes";

/**
 * The vocabulary of weight reporting and the Progress trend: constants, switches and the shapes the roles share.
 * Pure: no I/O, no clock. Every threshold the rules use is a single constant here.
 */

/** One-line kill switches. false = that piece is silent. */
export const WEIGHT_FLOW = {
  /** Report sheet row, /report/weight*, saveWeightAction, editWeightAction. */
  reportingEnabled: true,
  /** The Progress weight card and milestones (false: the old honest placeholder). */
  progressEnabled: true,
  /** The Home MILESTONE_REACHED state and its loader read. */
  milestoneMomentEnabled: true,
} as const;

export const WEIGHT_ENTRY = {
  /** A typo guard, narrower than the table CHECK (> 20 and < 500) so nothing accepted can violate it. */
  minKg: 30,
  maxKg: 350,
  /** Equals the table CHECK. */
  noteMaxCodePoints: 200,
  /** The "when" list reaches back this many local days (plus today as "now"). */
  earlierDays: 14,
  /** |new - previous| >= this asks "is that right?" once; never a refusal. */
  jumpCheckKg: 15,
} as const;

export const WEIGHT_TREND = {
  /** Sunday (Israel). 0 = Sunday ... 6 = Saturday. */
  weekStartsOn: 0,
  /** Weekly points (the unfinished current week included) needed to draw a line. */
  minPointsForLine: 2,
  /** COMPLETED weekly points needed to say a direction; the newest four decide it. */
  directionWeeks: 4,
  /** The newest four completed weeks must lie within this many weeks (first to last) to say a direction; spread wider, they are not "the last weeks". */
  directionSpanWeeks: 8,
  /** |mean of the newest two completed weeks - mean of the two before| at or above this is DOWN / UP; below is STEADY. */
  directionBandKg: 0.5,
  /** |newest completed average - start weight| below this is "about the same as the start". */
  sameBandKg: 0.5,
  /** The newest point older than this many weeks (before the current week) = stale: no direction sentence, no since-start sentence. */
  staleAfterWeeks: 3,
  /** The chart and the numbers list show the newest N weekly points. */
  maxChartWeeks: 52,
  /** Rows the series query reads; exactly this many back = truncated. */
  maxEntriesRead: 1500,
} as const;

/** No page cap: "Show older" follows a cursor, so every entry stays reachable. */
export const WEIGHT_LIST = { pageSize: 30 } as const;

export const MILESTONE_MOMENT = {
  /** Consecutive COMPLETED weekly averages at or below a landmark before it counts as reached. */
  weeksInARow: 2,
  /** Calendar days the Home card lasts, from the first day of the week AFTER the confirming week. */
  windowDays: 14,
  ackEvent: "milestone_acknowledged",
} as const;

export interface WeightEntry {
  id: string;
  weightKg: number;
  measuredAt: Date;
}

export interface WeightRow extends WeightEntry {
  note: string | null;
}

/** The sanity bounds of a stored weight when a row is read back (the table CHECK is narrower: > 20 and < 500). */
const MAX_PARSED_KG = 1000;

function toKg(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  // PostgREST can return a numeric column as a string.
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The row as the loaders parse it: `{ id, weight_kg, measured_at, note? }`. Unknown shapes are dropped, not guessed:
 * the id must be a uuid, the weight finite and within 0..1000 (a numeric string is coerced), `measured_at` a valid date
 * (a string or a Date) and `note` a string or null (absent = null, because the series query does not select it).
 */
export function parseWeightRow(row: unknown): WeightRow | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;

  if (!isUuid(r.id)) return null;

  const weightKg = toKg(r.weight_kg);
  if (weightKg === null || weightKg < 0 || weightKg > MAX_PARSED_KG) return null;

  if (!(typeof r.measured_at === "string" || r.measured_at instanceof Date)) return null;
  const measuredAt = new Date(r.measured_at);
  if (Number.isNaN(measuredAt.getTime())) return null;

  if (r.note !== undefined && r.note !== null && typeof r.note !== "string") return null;
  const note = typeof r.note === "string" ? r.note : null;

  return { id: r.id, weightKg, measuredAt, note };
}
