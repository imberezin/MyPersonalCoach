import { weeksBetween, type TrendPoint } from "./trend";
import { WEIGHT_TREND } from "./types";

/**
 * The geometry of the weekly line. Numbers only: no color, no class, no field that depends on the direction or the sign of a
 * change, so the screen cannot style an increase differently from a decrease. Pure.
 */

export const CHART = {
  width: 320,
  height: 168,
  left: 44,
  right: 12,
  top: 12,
  bottom: 30,
  /** The y range is never narrower than this many kilograms, so a flat trend looks flat. */
  minSpanKg: 2,
  /** Pad above and below the data, as a fraction of the range... */
  padFraction: 0.1,
  /** ...and never less than this many kilograms. */
  minPadKg: 0.3,
} as const;

/**
 * Where the word on the dashed line sits, in viewBox units: it ends at the right edge of the plot, `width` wide, and either
 * rises `rise` above the line or hangs `drop` below it; `aboveOffset` / `belowOffset` are the text baseline relative to the
 * line. `clearance` keeps the series line and the dots (radius up to 4.5) off the word.
 */
export const BASELINE_LABEL = { width: 48, rise: 17, drop: 20, clearance: 5, aboveOffset: -5, belowOffset: 16 } as const;

export interface ChartDot {
  x: number;
  y: number;
  weekStart: string;
  averageKg: number;
  isLast: boolean;
}

export interface ChartModel {
  width: number;
  height: number;
  dots: readonly ChartDot[];
  /** "M x y L x y ..." with coordinates rounded to one decimal. */
  path: string;
  /** The dashed reference at the starting weight (its value is included in the y range). */
  baseline: { y: number; kg: number; labelBelow: boolean } | null;
  /** The top and the bottom of the range, rounded to one decimal. */
  yLabels: readonly { y: number; kg: number }[];
  /** The first and the last week. */
  xLabels: readonly { x: number; weekStart: string; anchor: "start" | "end" }[];
  /** First and last weekly average, for the accessible description. */
  summary: { fromKg: number; toKg: number };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** True when the dots or the line between them pass through the band `top..bottom` within the word's x range. Geometry only. */
function crossesBand(dots: readonly ChartDot[], top: number, bottom: number): boolean {
  const right = CHART.width - CHART.right;
  const left = right - BASELINE_LABEL.width;
  const pad = BASELINE_LABEL.clearance;
  const lo = top - pad;
  const hi = bottom + pad;
  if (dots.some((d) => d.x >= left - pad && d.x <= right + pad && d.y >= lo && d.y <= hi)) return true;
  for (let i = 1; i < dots.length; i++) {
    const a = dots[i - 1];
    const b = dots[i];
    const from = Math.max(left, Math.min(a.x, b.x));
    const to = Math.min(right, Math.max(a.x, b.x));
    if (from > to || a.x === b.x) continue;
    const yAt = (x: number): number => a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    const y1 = yAt(from);
    const y2 = yAt(to);
    if (Math.max(y1, y2) >= lo && Math.min(y1, y2) <= hi) return true;
  }
  return false;
}

/**
 * Above the dashed line unless the word would sit on the series and below is clear. Never looks at the sign of a change. The
 * bands stop `clearance` short of the line itself (a dot that close to the line does not touch the word); `crossesBand` then
 * widens them by `clearance` on every side, so the far edge keeps a dot's radius off the word.
 */
function labelBelow(dots: readonly ChartDot[], baselineY: number): boolean {
  const { rise, drop, clearance } = BASELINE_LABEL;
  const axisY = CHART.height - CHART.bottom;
  const aboveBlocked = crossesBand(dots, baselineY - rise, baselineY - clearance);
  const belowBlocked = baselineY + drop > axisY || crossesBand(dots, baselineY + clearance, baselineY + drop);
  return aboveBlocked && !belowBlocked;
}

/**
 * null with fewer than WEIGHT_TREND.minPointsForLine points. x is proportional to the real week number (a gap is a longer
 * step); y spans the data and the baseline with a small pad and never less than minSpanKg. Identical geometry rules whatever
 * the direction.
 */
export function buildChartModel(input: { points: readonly TrendPoint[]; baselineKg: number | null }): ChartModel | null {
  if (input.points.length < WEIGHT_TREND.minPointsForLine) return null;

  const points = [...input.points].sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));
  const baselineKg = input.baselineKg !== null && Number.isFinite(input.baselineKg) ? input.baselineKg : null;

  const innerWidth = CHART.width - CHART.left - CHART.right;
  const innerHeight = CHART.height - CHART.top - CHART.bottom;

  const firstWeek = points[0].weekStart;
  // At least one week, so two points that somehow share a week still get a width.
  const spanWeeks = Math.max(1, weeksBetween(firstWeek, points[points.length - 1].weekStart));
  const xOf = (weekStart: string): number => CHART.left + (weeksBetween(firstWeek, weekStart) / spanWeeks) * innerWidth;

  const values = points.map((p) => p.averageKg);
  if (baselineKg !== null) values.push(baselineKg);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < CHART.minSpanKg) {
    const middle = (lo + hi) / 2;
    lo = middle - CHART.minSpanKg / 2;
    hi = middle + CHART.minSpanKg / 2;
  }
  const pad = Math.max((hi - lo) * CHART.padFraction, CHART.minPadKg);
  lo -= pad;
  hi += pad;

  const yOf = (kg: number): number => round1(CHART.top + ((hi - kg) / (hi - lo)) * innerHeight);

  const dots: ChartDot[] = points.map((p, i) => ({
    x: round1(xOf(p.weekStart)),
    y: yOf(p.averageKg),
    weekStart: p.weekStart,
    averageKg: p.averageKg,
    isLast: i === points.length - 1,
  }));

  const first = dots[0];
  const last = dots[dots.length - 1];
  return {
    width: CHART.width,
    height: CHART.height,
    dots,
    path: dots.map((d, i) => `${i === 0 ? "M" : "L"} ${d.x} ${d.y}`).join(" "),
    baseline: baselineKg !== null ? { y: yOf(baselineKg), kg: baselineKg, labelBelow: labelBelow(dots, yOf(baselineKg)) } : null,
    yLabels: [
      { y: CHART.top, kg: round1(hi) },
      { y: CHART.height - CHART.bottom, kg: round1(lo) },
    ],
    xLabels: [
      { x: first.x, weekStart: first.weekStart, anchor: "start" },
      { x: last.x, weekStart: last.weekStart, anchor: "end" },
    ],
    summary: { fromKg: first.averageKg, toKg: last.averageKg },
  };
}
