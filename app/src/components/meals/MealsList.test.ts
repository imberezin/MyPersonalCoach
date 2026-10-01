// The list as markup with the real catalogs, and as a tree: one row per meal, every row and control keyed by
// the ENTRY ID (each control owns client state), the trigger described by the row's own summary.
import { createElement, type ReactElement } from "react";
import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { describe, expect, it } from "vitest";
import { MEALS_FORM } from "@/domain/food/routes";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "../food/foodTestKit";
import type { FoodTranslator } from "../food/formatPortion";
import { buildMealSummary } from "./buildSummary";
import { MealsList, type MealRowData } from "./MealsList";

function translator(locale: TestLocale, namespace: "food" | "meals"): FoodTranslator {
  const t = createTranslator({ locale, messages: catalogs[locale] as AbstractIntlMessages, namespace: namespace as never, timeZone: "UTC" });
  return (key, values) => t(key as never, values as never);
}

const IDS = ["0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60711", "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60712", "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60713"];

function rowsFor(locale: TestLocale, ids: string[] = IDS): MealRowData[] {
  const foods: Record<string, string[]> = { [IDS[0]]: ["לחם", "גבינה"], [IDS[1]]: ["rice"], [IDS[2]]: [] };
  return ids.map((id, index) => ({
    entryId: id,
    summary: buildMealSummary(
      { id, occurredAt: new Date(Date.UTC(2026, 8, 30 - index, 10, 5)), mealType: index === 0 ? "lunch" : "dinner", foods: foods[id] ?? [] },
      { now: new Date("2026-10-01T10:00:00Z"), timeZone: "Asia/Jerusalem", locale, food: translator(locale, "food"), meals: translator(locale, "meals") },
    ),
  }));
}

const noop = async () => {};
const props = (locale: TestLocale, ids?: string[], pages = 1) => ({ rows: rowsFor(locale, ids), deleteAction: noop, pages });

interface TreeProps {
  children?: unknown;
  entryId?: string;
  pages?: number;
  describedBy?: string;
  from?: string;
  action?: unknown;
}
const asElements = (children: unknown): ReactElement<TreeProps>[] => (Array.isArray(children) ? children : [children]) as ReactElement<TreeProps>[];

/** The <li> elements MealsList returns, read from the tree without rendering. */
function rowElements(locale: TestLocale, ids?: string[], pages = 1): ReactElement<TreeProps>[] {
  const list = MealsList(props(locale, ids, pages)) as ReactElement<TreeProps>;
  return asElements(list.props.children);
}

describe.each(LOCALES)("MealsList in %s", (locale) => {
  const words = catalogs[locale].meals;
  const html = renderWithIntl(createElement(MealsList, props(locale)), locale);

  it("is one labelled list with one item per meal", () => {
    expect(count(html, /<ul\b/g)).toBe(1);
    expect(html).toContain(`<ul role="list" aria-label="${words.listLabel}"`);
    expect(count(html, /<li\b/g)).toBe(IDS.length);
  });

  it("gives every trigger a description that exists in the same row", () => {
    const items = html.split("<li").slice(1);
    expect(items).toHaveLength(IDS.length);
    items.forEach((item, index) => {
      const describedBy = /<button[^>]*aria-describedby="([^"]+)"/.exec(item)?.[1];
      expect(describedBy, `row ${index}`).toBe(`meal-${IDS[index]}`);
      expect(count(item, new RegExp(`id="${describedBy}"`, "g")), `row ${index}`).toBe(1);
    });
  });

  it("shows each trigger as the plain word, with no form and no panel until it is pressed", () => {
    expect(count(html, /<button\b/g)).toBe(IDS.length);
    expect(count(html, new RegExp(`>${words.row.delete}</button>`, "g"))).toBe(IDS.length);
    expect(html).not.toContain("<form");
    expect(html).not.toContain('role="group"');
  });

  it("puts the food names in <bdi> and shows the meal line", () => {
    expect(html).toContain("<bdi>לחם</bdi>");
    expect(html).toContain("<bdi>rice</bdi>");
    expect(textOf(html)).toContain(catalogs[locale].food.mealType.lunch);
    expect(textOf(html)).toContain(words.row.noFoods);
  });

  it("shows names only: no number of calories, no percent, no score, no icon", () => {
    expect(html).not.toMatch(/<img|<svg/);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(textOf(html)).not.toMatch(/%|kcal|calorie|score|!/i);
  });

  it("uses no error or alarm class anywhere", () => {
    expect(html).not.toMatch(/role="alert"|alertdialog/);
  });
});

describe("MealsList identity", () => {
  it("keys every row and every control by the entry id", () => {
    const rows = rowElements("he");
    expect(rows.map((row) => row.key)).toEqual(IDS);
    for (const [index, row] of rows.entries()) {
      const [, control] = asElements(row.props.children);
      expect(control.key).toBe(IDS[index]);
      expect(control.props.entryId).toBe(IDS[index]);
    }
  });

  it("keeps each key with its meal when the rows are reordered", () => {
    const reordered = [IDS[2], IDS[0], IDS[1]];
    const rows = rowElements("he", reordered);
    expect(rows.map((row) => row.key)).toEqual(reordered);
    expect(rows.map((row) => asElements(row.props.children)[1].key)).toEqual(reordered);
  });

  it("points each control at the summary of its own row", () => {
    for (const [index, row] of rowElements("he").entries()) {
      const [summary, control] = asElements(row.props.children);
      expect(control.props.describedBy).toBe(`meal-${IDS[index]}`);
      expect((summary.props as { summary?: { id: string } }).summary?.id).toBe(`meal-${IDS[index]}`);
    }
  });

  it("hands every control the delete action it was given, as a list control", () => {
    const deleteAction = async () => {};
    const list = MealsList({ ...props("he"), deleteAction }) as ReactElement<TreeProps>;
    for (const row of asElements(list.props.children)) {
      const control = asElements(row.props.children)[1];
      expect(control.props.action).toBe(deleteAction);
      expect(control.props.from).toBe("list");
    }
  });

  it("carries the page size the list shows to every control, so the landing keeps it", () => {
    for (const pages of [1, 3, 6]) {
      for (const row of rowElements("he", undefined, pages)) expect(asElements(row.props.children)[1].props.pages).toBe(pages);
    }
    expect(MEALS_FORM.pages).toBe("pages");
  });
});
