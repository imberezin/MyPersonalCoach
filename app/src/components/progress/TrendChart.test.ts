// The weekly line as markup. The point of these tests is the rule the owner insisted on: an increase and a decrease are
// drawn identically, with nothing in the picture that changes with the direction.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildChartModel } from "@/domain/weight";
import { TrendChart } from "./TrendChart";
import { buildTrend, weeklyEntries } from "./progressTestKit";

const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

function modelFor(kgs: readonly number[], baselineKg: number | null = 78) {
  const trend = buildTrend(weeklyEntries(kgs), baselineKg);
  const model = buildChartModel({ points: trend.points, baselineKg });
  if (!model) throw new Error("the fixture needs at least two points");
  return model;
}

function render(kgs: readonly number[], locale = "he", baselineKg: number | null = 78): string {
  return renderToStaticMarkup(
    createElement(TrendChart, {
      model: modelFor(kgs, baselineKg),
      locale,
      title: "The weekly average",
      description: "The weekly average, from A to B kg.",
      startLabel: "Start",
    }),
  );
}

/** The markup with every number replaced, so two charts of the same weeks compare by structure, classes and attributes. */
const shape = (html: string) => html.replace(/-?\d+(?:\.\d+)?/g, "N");

const classNames = (html: string) => new Set(Array.from(html.matchAll(/class="([^"]*)"/g), (match) => match[1]));

const FALLING = [80, 79, 78, 77, 76];
const FLAT = [78, 78, 78, 78, 78];
const RISING = [76, 77, 78, 79, 80];

describe("TrendChart", () => {
  it("is a picture with a title and a description that name it", () => {
    const html = render(FALLING);
    expect(html).toMatch(/<svg[^>]*role="img"/);
    expect(html).toMatch(/<svg[^>]*aria-labelledby="trend-chart-title trend-chart-desc"/);
    expect(html).toContain('<title id="trend-chart-title">The weekly average</title>');
    expect(html).toContain('<desc id="trend-chart-desc">The weekly average, from A to B kg.</desc>');
    expect(html).toMatch(/<svg[^>]*viewBox="0 0 320 168"/);
  });

  it.each(["he", "en"])("%s: the wrapper reads left to right, because time does", (locale) => {
    expect(render(FALLING, locale)).toMatch(/^<div[^>]*dir="ltr"/);
  });

  it("draws one line and one dot per weekly point, the last a little larger", () => {
    const html = render(FALLING);
    expect(count(html, /<path\b/g)).toBe(1);
    const radii = Array.from(html.matchAll(/<circle\b[^>]*\br="([\d.]+)"/g), (match) => Number(match[1]));
    expect(radii).toHaveLength(FALLING.length);
    expect(Math.max(...radii.slice(0, -1))).toBeLessThan(radii[radii.length - 1]);
    expect(new Set(radii.slice(0, -1)).size).toBe(1);
  });

  it("draws a dashed reference at the starting weight and labels it", () => {
    const html = render(FALLING);
    expect(html).toMatch(/<line[^>]*class="[^"]*baseline[^"]*"/);
    expect(html).toContain(">Start</text>");
    // The axis is the only other line.
    expect(count(html, /<line\b/g)).toBe(2);
    const without = render(FALLING, "he", null);
    expect(count(without, /<line\b/g)).toBe(1);
    expect(without).not.toContain(">Start</text>");
  });

  it("labels the top and the bottom of the range and the first and the last week", () => {
    const html = render(FALLING, "en");
    expect(count(html, /<text\b/g)).toBe(1 + 2 + 2);
    expect(html).toMatch(/text-anchor="start"[^>]*>\d+ \w+<\/text>/);
    expect(html).toMatch(/text-anchor="end"[^>]*>\d+ \w+<\/text>/);
  });

  it("styles nothing inline and carries no color of its own: the sheet owns every stroke and fill", () => {
    for (const kgs of [FALLING, FLAT, RISING]) {
      const html = render(kgs);
      expect(html).not.toMatch(/\sstyle="/);
      expect(html).not.toMatch(/\s(?:fill|stroke)="(?!none")/);
      expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
  });

  it("draws a rising, a flat and a falling series with the same classes, the same attributes and the same structure", () => {
    const falling = render(FALLING);
    const flat = render(FLAT);
    const rising = render(RISING);
    expect(classNames(rising)).toEqual(classNames(falling));
    expect(classNames(flat)).toEqual(classNames(falling));
    // Beyond the classes: every tag and attribute, with only the numbers (and so the positions) allowed to differ.
    expect(shape(rising)).toBe(shape(falling));
    expect(shape(flat)).toBe(shape(falling));
  });

  it("draws the same way in English as in Hebrew", () => {
    expect(classNames(render(FALLING, "en"))).toEqual(classNames(render(FALLING, "he")));
  });

  it("isolates a Hebrew date label as right-to-left, so the day and the month read in the order of every other Hebrew date; English is untouched", () => {
    const he = Array.from(render(FALLING, "he").matchAll(/<text[^>]*dateLabel[^>]*>([^<]*)<\/text>/g), (match) => match[1]);
    expect(he).toHaveLength(2);
    for (const label of he) {
      expect(label.startsWith(String.fromCharCode(0x2067))).toBe(true);
      expect(label.endsWith(String.fromCharCode(0x2069))).toBe(true);
    }
    const en = Array.from(render(FALLING, "en").matchAll(/<text[^>]*dateLabel[^>]*>([^<]*)<\/text>/g), (match) => match[1]);
    expect(en).toHaveLength(2);
    for (const label of en) expect(label).toMatch(/^\d+ \w+$/);
    // The anchors stay as they are: setting a direction on the text would swap start and end.
    expect(render(FALLING, "he")).not.toMatch(/<text[^>]*\sdirection=/);
  });

  it("draws the word on the dashed line after the line and the dots, so its halo can mask them", () => {
    const html = render(FALLING);
    expect(html.indexOf(">Start</text>")).toBeGreaterThan(html.lastIndexOf("<circle"));
  });

  it("puts the word below the dashed line only when the series hugs the line from above, the same classes either way", () => {
    const above = render(FALLING, "en", 80);
    const below = render([80.2, 80.4, 80.1, 80.3], "en", 80);
    const at = (html: string) => {
      const line = Number(/<line[^>]*class="[^"]*baseline[^"]*"[^>]*\sy1="([\d.]+)"/.exec(html)?.[1]);
      const word = Number(/<text[^>]*class="[^"]*baselineLabel[^"]*"[^>]*\sy="([\d.]+)"/.exec(html)?.[1]);
      return word - line;
    };
    expect(at(above)).toBeLessThan(0);
    expect(at(below)).toBeGreaterThan(0);
    expect(classNames(below)).toEqual(classNames(above));
  });

  it("keeps a flat series flat: its line sits at one height", () => {
    const html = render(FLAT);
    const heights = new Set(Array.from(html.matchAll(/<circle\b[^>]*\bcy="([\d.]+)"/g), (match) => match[1]));
    expect(heights.size).toBe(1);
  });
});
