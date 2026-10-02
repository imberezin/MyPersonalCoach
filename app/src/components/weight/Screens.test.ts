// The list, the three calm states and the Saved card as markup, with the real catalogs. The async server components are
// awaited and their elements rendered; the translator is the real catalog's, in the language under test.
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "use-intl/core";
import { WEIGHT_NOTICES, WEIGHT_ROUTES } from "@/domain/weight";
import { WeightSavedView } from "./WeightSavedView";
import { WeightsEmpty } from "./WeightsEmpty";
import { WeightsList } from "./WeightsList";
import { WeightsNotice } from "./WeightsNotice";
import { WeightsUnavailable } from "./WeightsUnavailable";
import type { WeightRowData } from "./WeightRow";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "./weightTestKit";

const mocks = vi.hoisted(() => ({ locale: { current: "he" as "he" | "en" }, flow: { reportingEnabled: true, progressEnabled: true, milestoneMomentEnabled: true } }));

vi.mock("@/i18n/server", async () => {
  const he = (await import("@/i18n/messages/he.json")).default;
  const en = (await import("@/i18n/messages/en.json")).default;
  return {
    getLocale: async () => mocks.locale.current,
    getTranslations: async (namespace?: string) => {
      const t = createTranslator({
        locale: mocks.locale.current,
        messages: (mocks.locale.current === "he" ? he : en) as never,
        namespace: namespace as never,
        timeZone: "UTC",
      });
      return (key: string, values?: Record<string, unknown>) => t(key as never, values as never);
    },
  };
});
vi.mock("@/domain/weight/types", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domain/weight/types")>();
  return { ...original, WEIGHT_FLOW: mocks.flow };
});

const ID_A = "0b6f7e0a-8d9c-4f3e-a1b2-c3d4e5f60718";
const ID_B = "1c7f8f1b-9eab-4a4f-b2c3-d4e5f6a70829";
const CURSOR = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const noop = async () => {};

const row = (id: string, over: Partial<WeightRowData> = {}): WeightRowData => ({
  entryId: id,
  dayText: "DAY-TEXT",
  kgText: "118.7",
  unit: "UNIT",
  note: null,
  editHref: WEIGHT_ROUTES.edit(id),
  ...over,
});

/** Awaits an async server component and renders what it returns. */
async function renderAsync(component: (props: never) => Promise<React.ReactElement>, props: object, locale: TestLocale): Promise<string> {
  mocks.locale.current = locale;
  return renderWithIntl(await component(props as never), locale);
}

describe.each(LOCALES)("WeightsList in %s", (locale) => {
  const words = catalogs[locale].weight;
  const render = (rows: WeightRowData[], after: string | null = null) =>
    renderWithIntl(createElement(WeightsList, { rows, label: words.list.label, editLabel: words.row.edit, deleteAction: noop, after }), locale);

  it("is one labelled list with the list role, and one item per row", () => {
    const html = render([row(ID_A), row(ID_B)]);
    expect(html).toMatch(new RegExp(`<ul role="list" aria-label="${words.list.label}"`));
    expect(count(html, /<li\b/g)).toBe(2);
  });

  it("shows the day, the number with its unit, and the quiet Edit and Delete of each row", () => {
    const html = render([row(ID_A)]);
    expect(textOf(html)).toContain("DAY-TEXT");
    expect(html).toContain('<bdi dir="ltr">118.7</bdi> UNIT');
    expect(html).toContain(`href="/report/weight/${ID_A}/edit"`);
    expect(textOf(html)).toContain(words.row.edit);
    expect(textOf(html)).toContain(words.row.delete);
  });

  it("shows the note as typed, as plain escaped text in its own direction", () => {
    const html = render([row(ID_A, { note: '<b>bold</b> "quoted" 😀' })]);
    expect(html).toContain('<bdi dir="auto">&lt;b&gt;bold&lt;/b&gt; &quot;quoted&quot; 😀</bdi>');
    expect(html).not.toContain("<b>");
  });

  it("shows no note line when there is none", () => {
    expect(count(render([row(ID_A)]), /dir="auto"/g)).toBe(0);
  });

  it("drops the Edit link when weight reporting is off (editHref null), and keeps Delete", () => {
    const html = render([row(ID_A, { editHref: null })]);
    expect(html).not.toContain("/edit");
    expect(html).not.toContain(`>${words.row.edit}<`);
    expect(textOf(html)).toContain(words.row.delete);
  });

  it("points each Delete at its own row's text, so a screen reader hears which weight it is about", () => {
    const html = render([row(ID_A), row(ID_B)]);
    for (const id of [ID_A, ID_B]) {
      expect(html).toContain(`id="weight-row-${id}"`);
      expect(html).toContain(`aria-describedby="weight-row-${id}"`);
    }
  });

  it("has no unique-id clash", () => {
    const html = render([row(ID_A), row(ID_B)]);
    const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses plain cards: no error, attention or accent class on any row", () => {
    const html = render([row(ID_A), row(ID_B)]);
    const classes = Array.from(html.matchAll(/class="([^"]*)"/g), (match) => match[1]).join(" ");
    expect(classes).not.toMatch(/error|attention|accent|warning/i);
  });

  it("renders the same classes for every weight: nothing changes with the number", () => {
    const shape = (kgText: string) => render([row(ID_A, { kgText })]).replace(kgText, "N");
    expect(shape("60.0")).toBe(shape("181.0"));
  });
});

describe("WeightsList keys", () => {
  it("keys every row by its entry id, never its position", () => {
    const list = WeightsList({ rows: [row(ID_A), row(ID_B)], label: "l", editLabel: "e", deleteAction: noop, after: null });
    const items = (list.props as { children: React.ReactElement[] }).children;
    expect(items.map((item) => item.key)).toEqual([ID_A, ID_B]);
  });

  it("hands every row the cursor of the page, so a delete returns to the same page", () => {
    const list = WeightsList({ rows: [row(ID_A)], label: "l", editLabel: "e", deleteAction: noop, after: CURSOR });
    const [item] = (list.props as { children: React.ReactElement<{ after: string | null }>[] }).children;
    expect(item.props.after).toBe(CURSOR);
  });
});

describe.each(LOCALES)("the calm states in %s", (locale) => {
  const words = catalogs[locale].weight;

  it("WeightsEmpty says nothing is saved yet and offers the entry screen", async () => {
    mocks.flow.reportingEnabled = true;
    const html = await renderAsync(WeightsEmpty, {}, locale);
    expect(textOf(html)).toContain(words.empty.title);
    expect(textOf(html)).toContain(words.empty.body);
    expect(html).toContain(`href="${WEIGHT_ROUTES.entry}"`);
    expect(textOf(html)).toContain(words.list.add);
  });

  it("WeightsEmpty offers nothing to press while weight reporting is switched off", async () => {
    mocks.flow.reportingEnabled = false;
    const html = await renderAsync(WeightsEmpty, {}, locale);
    mocks.flow.reportingEnabled = true;
    expect(textOf(html)).toContain(words.empty.title);
    expect(html).not.toContain("<a ");
  });

  it("WeightsUnavailable says it could not load, never that nothing is saved, and offers to try again and to go back", async () => {
    const html = await renderAsync(WeightsUnavailable, {}, locale);
    expect(textOf(html)).toContain(words.unavailable.title);
    expect(textOf(html)).toContain(words.unavailable.body);
    expect(textOf(html)).not.toContain(words.empty.title);
    expect(html).toContain(`href="${WEIGHT_ROUTES.list}"`);
    expect(html).toContain(`href="${WEIGHT_ROUTES.me}"`);
    expect(textOf(html)).toContain(words.unavailable.retry);
  });

  it.each(WEIGHT_NOTICES)("WeightsNotice (%s) says its sentence in a focusable wrapper", (notice) => {
    const html = renderWithIntl(createElement(WeightsNotice, { notice }), locale);
    expect(textOf(html)).toBe(words.notice[notice]);
    expect(html).toContain('tabindex="-1"');
  });

  it("WeightsNotice announces the information notices politely and only the technical one as an alert", () => {
    for (const notice of ["deleted", "gone"] as const) expect(renderWithIntl(createElement(WeightsNotice, { notice }), locale)).toContain('role="status"');
    expect(renderWithIntl(createElement(WeightsNotice, { notice: "error" }), locale)).toContain('role="alert"');
  });
});

describe.each(LOCALES)("WeightSavedView in %s", (locale) => {
  const words = catalogs[locale].weight;
  const props = { entryId: ID_A, kgText: "118.7", unit: "UNIT", dayText: "DAY-TEXT", edited: false, canEdit: true, deleteAction: noop };
  const render = (over: Partial<typeof props> = {}) => renderAsync(WeightSavedView as never, { ...props, ...over }, locale);

  it("confirms in a status block with one h1, the sentence, the day and the number, and the one calm line", async () => {
    const html = await render();
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(html).toMatch(/<div role="status"/);
    expect(textOf(html)).toContain(words.saved.title);
    expect(textOf(html)).toContain(words.saved.body);
    expect(textOf(html)).toContain("118.7");
    expect(textOf(html)).toContain("DAY-TEXT");
    expect(textOf(html)).toContain(words.saved.note);
  });

  it("says 'updated' for an edit", async () => {
    const text = textOf(await render({ edited: true }));
    expect(text).toContain(words.saved.edited);
    expect(text).not.toContain(words.saved.body);
  });

  it("offers Progress, Edit and Back as links, in that order, then the quiet delete", async () => {
    const html = await render();
    const hrefs = Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"/g), (match) => match[1]);
    expect(hrefs).toEqual([WEIGHT_ROUTES.progress, WEIGHT_ROUTES.edit(ID_A), "/"]);
    expect(html.indexOf(`>${words.row.deleteThis}</button>`)).toBeGreaterThan(html.lastIndexOf("<a "));
  });

  it("keeps the delete control outside the status block, so the arrival announcement is unchanged", async () => {
    const html = await render();
    const status = html.slice(html.indexOf('<div role="status"'), html.indexOf("</div>", html.indexOf('<div role="status"')));
    expect(status).not.toContain("<button");
  });

  it("drops the Edit link when weight reporting is off", async () => {
    const html = await render({ canEdit: false });
    expect(html).not.toContain("/edit");
  });

  it("shows no comparison, total, change or emoji", async () => {
    const text = textOf(await render());
    expect(text).not.toMatch(/[+−-]\s?\d/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toContain("!");
  });
});
