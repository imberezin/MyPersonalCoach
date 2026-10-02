import { describe, expect, it } from "vitest";
import { BASELINE_LABEL, CHART, buildChartModel } from "./chart";
import { addDaysToDayKey, type TrendPoint } from "./trend";

const FIRST_SUNDAY = "2026-09-13";
const week = (i: number) => addDaysToDayKey(FIRST_SUNDAY, 7 * i);
const point = (weekIndex: number, averageKg: number, complete = true): TrendPoint => ({ weekStart: week(weekIndex), averageKg, entries: 1, complete });
const series = (averages: number[]): TrendPoint[] => averages.map((kg, i) => point(i, kg));

const INNER_LEFT = CHART.left;
const INNER_RIGHT = CHART.width - CHART.right;
const INNER_TOP = CHART.top;
const INNER_BOTTOM = CHART.height - CHART.bottom;

describe("buildChartModel", () => {
  it("is null below two points", () => {
    expect(buildChartModel({ points: [], baselineKg: 80 })).toBeNull();
    expect(buildChartModel({ points: series([79]), baselineKg: 80 })).toBeNull();
  });

  it("gives a fixed model for a fixed input (dots, path, labels; checked by hand: range 77.4..80 + 0.3 pad = 77.1..80.3)", () => {
    const model = buildChartModel({ points: series([79.6, 78.9, 78.1, 77.4]), baselineKg: 80 });
    expect(model).toEqual({
      width: 320,
      height: 168,
      dots: [
        { x: 44, y: 39.6, weekStart: "2026-09-13", averageKg: 79.6, isLast: false },
        { x: 132, y: 67.1, weekStart: "2026-09-20", averageKg: 78.9, isLast: false },
        { x: 220, y: 98.6, weekStart: "2026-09-27", averageKg: 78.1, isLast: false },
        { x: 308, y: 126.2, weekStart: "2026-10-04", averageKg: 77.4, isLast: true },
      ],
      path: "M 44 39.6 L 132 67.1 L 220 98.6 L 308 126.2",
      baseline: { y: 23.8, kg: 80, labelBelow: false },
      yLabels: [
        { y: 12, kg: 80.3 },
        { y: 138, kg: 77.1 },
      ],
      xLabels: [
        { x: 44, weekStart: "2026-09-13", anchor: "start" },
        { x: 308, weekStart: "2026-10-04", anchor: "end" },
      ],
      summary: { fromKg: 79.6, toKg: 77.4 },
    });
  });

  it("spaces x by the real week number: a one-week gap is a longer step", () => {
    const model = buildChartModel({ points: [point(0, 79), point(1, 78), point(3, 77)], baselineKg: null });
    const xs = model!.dots.map((d) => d.x);
    expect(xs).toEqual([INNER_LEFT, INNER_LEFT + (INNER_RIGHT - INNER_LEFT) / 3, INNER_RIGHT].map((x) => Math.round(x * 10) / 10));
    expect(xs[2] - xs[1]).toBeCloseTo(2 * (xs[1] - xs[0]), 0);
  });

  it("puts the first week at the left edge of the plot and the last at the right edge (time runs left to right)", () => {
    const model = buildChartModel({ points: series([80, 79, 78]), baselineKg: null })!;
    expect(model.dots[0].x).toBe(INNER_LEFT);
    expect(model.dots[2].x).toBe(INNER_RIGHT);
    expect(model.dots.map((d) => d.x)).toEqual([...model.dots.map((d) => d.x)].sort((a, b) => a - b));
  });

  it("gives a flat series at least minSpanKg, so it looks flat", () => {
    const model = buildChartModel({ points: series([78.1, 78.1, 78.1]), baselineKg: null })!;
    expect(model.yLabels[0].kg - model.yLabels[1].kg).toBeGreaterThanOrEqual(CHART.minSpanKg);
    expect(new Set(model.dots.map((d) => d.y)).size).toBe(1);
    expect(model.dots[0].y).toBe(75); // the middle of the plot
  });

  it("keeps a tiny wobble small on the page (0.2 kg moves a dot only a few pixels)", () => {
    const model = buildChartModel({ points: series([78.1, 78.3]), baselineKg: null })!;
    expect(Math.abs(model.dots[0].y - model.dots[1].y)).toBeLessThan(15);
  });

  it("includes the baseline in the y range, above and below the data", () => {
    for (const baselineKg of [90, 60]) {
      const model = buildChartModel({ points: series([79, 78, 77]), baselineKg })!;
      expect(model.baseline).not.toBeNull();
      expect(model.baseline!.y).toBeGreaterThanOrEqual(INNER_TOP);
      expect(model.baseline!.y).toBeLessThanOrEqual(INNER_BOTTOM);
      expect(model.baseline!.kg).toBe(baselineKg);
      for (const dot of model.dots) {
        expect(dot.y).toBeGreaterThanOrEqual(INNER_TOP);
        expect(dot.y).toBeLessThanOrEqual(INNER_BOTTOM);
      }
    }
  });

  it("has no baseline without one", () => {
    expect(buildChartModel({ points: series([79, 78]), baselineKg: null })!.baseline).toBeNull();
  });

  it("puts higher weights higher on the page, whatever the direction of the series", () => {
    const model = buildChartModel({ points: series([77, 80, 78]), baselineKg: null })!;
    expect(model.dots[1].y).toBeLessThan(model.dots[2].y);
    expect(model.dots[2].y).toBeLessThan(model.dots[0].y);
  });

  it("labels the top and the bottom of the range, and the first and last week", () => {
    const model = buildChartModel({ points: series([79.6, 78.9, 78.1]), baselineKg: 80 })!;
    expect(model.yLabels.map((l) => l.y)).toEqual([INNER_TOP, INNER_BOTTOM]);
    expect(model.yLabels[0].kg).toBeGreaterThan(model.yLabels[1].kg);
    expect(model.xLabels).toEqual([
      { x: model.dots[0].x, weekStart: week(0), anchor: "start" },
      { x: model.dots[2].x, weekStart: week(2), anchor: "end" },
    ]);
  });

  it("marks only the last dot as the last", () => {
    const model = buildChartModel({ points: series([79, 78, 77]), baselineKg: null })!;
    expect(model.dots.map((d) => d.isLast)).toEqual([false, false, true]);
  });

  it("draws the unfinished week like any other dot", () => {
    const model = buildChartModel({ points: [point(0, 79), point(1, 78), point(2, 77, false)], baselineKg: null })!;
    expect(model.dots).toHaveLength(3);
    expect(model.path.split("L")).toHaveLength(3);
  });

  it("rounds every coordinate to one decimal", () => {
    const model = buildChartModel({ points: series([79.637, 78.912, 78.123]), baselineKg: 80.071 })!;
    const numbers = model.path.match(/-?\d+(\.\d+)?/g)!;
    for (const n of numbers) expect(n).toMatch(/^-?\d+(\.\d)?$/);
    for (const d of model.dots) {
      expect(Math.round(d.x * 10) / 10).toBe(d.x);
      expect(Math.round(d.y * 10) / 10).toBe(d.y);
    }
    for (const l of model.yLabels) expect(Math.round(l.kg * 10) / 10).toBe(l.kg);
  });

  it("accepts the points in any order", () => {
    const sorted = buildChartModel({ points: series([79, 78, 77]), baselineKg: null });
    const reversed = buildChartModel({ points: series([79, 78, 77]).reverse(), baselineKg: null });
    expect(reversed).toEqual(sorted);
  });

  it("starts the path with M and continues with L", () => {
    const { path } = buildChartModel({ points: series([79, 78, 77]), baselineKg: null })!;
    expect(path).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
  });

  it("uses identical rules for a rising and a falling series: same keys, no color and no direction field", () => {
    const falling = buildChartModel({ points: series([80, 79, 78, 77]), baselineKg: 80 })!;
    const rising = buildChartModel({ points: series([77, 78, 79, 80]), baselineKg: 77 })!;
    expect(Object.keys(rising)).toEqual(Object.keys(falling));
    expect(Object.keys(rising.dots[0])).toEqual(Object.keys(falling.dots[0]));
    const names = JSON.stringify([...Object.keys(falling), ...Object.keys(falling.dots[0])]).toLowerCase();
    expect(names).not.toMatch(/color|class|direction|trend|up|down|delta|change|good|bad/);
    // The mirrored series is the mirrored picture: same x, y reflected around the middle of the plot.
    const middle = (INNER_TOP + INNER_BOTTOM) / 2;
    falling.dots.forEach((dot, i) => {
      expect(rising.dots[i].x).toBe(dot.x);
      expect(rising.dots[i].y + dot.y).toBeCloseTo(2 * middle, 0);
    });
  });
});

describe("buildChartModel: where the word on the dashed line sits", () => {
  const label = (averages: number[], baselineKg = 80) => buildChartModel({ points: series(averages), baselineKg })!.baseline!;

  it("is above the dashed line when the series is away from it", () => {
    expect(label([80, 79, 78, 77]).labelBelow).toBe(false);
    expect(label([76, 77, 78, 79]).labelBelow).toBe(false);
  });

  it("goes below when the last weeks hover just above the line, where the word above would sit on the series", () => {
    // The last dot and the segment into it pass through the band above the line.
    expect(label([80.2, 80.4, 80.1, 80.3]).labelBelow).toBe(true);
  });

  it("stays above when the series lies on the line (both sides are crossed: the default wins)", () => {
    expect(label([80, 80, 80, 80]).labelBelow).toBe(false);
  });

  it("never goes below when there is no room under the line (a line at the very bottom)", () => {
    const { y, labelBelow } = label([81, 82, 83, 84], 80);
    expect(y + BASELINE_LABEL.drop).toBeGreaterThan(CHART.height - CHART.bottom);
    expect(labelBelow).toBe(false);
  });

  it("looks only at the positions: the same weeks in the other order are decided by where the dots are", () => {
    // Reversing the order puts the high end of the series under the word instead of the low end.
    const calm = label([80.6, 80.5, 80.2, 80.1]);
    const reversed = label([80.1, 80.2, 80.5, 80.6]);
    expect(calm.labelBelow).not.toBe(reversed.labelBelow);
  });
});
