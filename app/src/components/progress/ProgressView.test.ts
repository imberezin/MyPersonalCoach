// The Progress screen as markup, with the real catalogs in both languages and loads built through the real domain
// functions. What it says is true or absent; nothing is counted, scored or compared; and a rise reads like a fall.
import { describe, expect, it, vi } from "vitest";
import ui from "@/components/ui/ui.module.css";
import type { NoticedFacts } from "@/lib/progress/noticed";
import type { ProgressLoad } from "@/lib/weight/load";
import { ProgressView } from "./ProgressView";
import { ProgressUnavailable } from "./ProgressUnavailable";
import { OPEN_EXPERIMENT, loadFor, type ReadyLoad } from "./progressTestKit";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "../food/foodTestKit";

const intl = vi.hoisted(() => ({ locale: "he" as "he" | "en" }));
vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("use-intl/core");
  const messages = {
    he: (await import("@/i18n/messages/he.json")).default,
    en: (await import("@/i18n/messages/en.json")).default,
  };
  return {
    getLocale: async () => intl.locale,
    getTranslations: async (namespace?: string) => {
      const t = createTranslator({ locale: intl.locale, messages: messages[intl.locale] as never, namespace: namespace as never, timeZone: "UTC" });
      return (key: string, values?: Record<string, unknown>) => t(key as never, values as never);
    },
  };
});

async function render(locale: TestLocale, load: ReadyLoad): Promise<string> {
  intl.locale = locale;
  return renderWithIntl(await ProgressView({ load }), locale);
}

/** The visible text with the direction isolates the screen puts around numbers taken out, so sentences compare plainly. */
const visible = (html: string) => textOf(html).replace(/[⁦⁧⁩]/g, "");

const hrefs = (html: string) => Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"/g), (match) => match[1]);
/** Every class attribute in document order, so a class that appears on one element and not on its twin is seen. */
const classSequence = (html: string) => Array.from(html.matchAll(/class="([^"]*)"/g), (match) => match[1]);

const FALL = [78.1, 77.4, 76.9, 76.2];
const STEADY = [78.1, 78.3, 78.2, 78.1];
const RISE = [77.0, 77.4, 77.9, 78.5];

const LATE_EVENING: NoticedFacts = { patterns: [{ kind: "late_evening_meals", view: "CANDIDATE" }], activeExperiment: null };

/** `{kg}` filled in the way the screen does, for a regex that ignores the isolates. */
const message = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_match, name: string) => values[name]);

describe.each(LOCALES)("ProgressView in %s", (locale) => {
  const words = catalogs[locale].progress;

  describe("structure", () => {
    it("has exactly one h1, and the page is named by it", async () => {
      const html = await render(locale, loadFor({ kgs: FALL, noticed: LATE_EVENING }));
      expect(count(html, /<h1[\s>]/g)).toBe(1);
      const labelledBy = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
      expect(html).toContain(`<h1 id="${labelledBy}"`);
      expect(visible(html)).toContain(words.title);
      expect(visible(html)).toContain(words.lead);
    });

    it("names every part by its own h2, in the order: weight, landmarks, what we noticed", async () => {
      const html = await render(locale, loadFor({ kgs: FALL, noticed: LATE_EVENING }));
      const labelled = Array.from(html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g), (match) => match[1]).slice(1);
      expect(labelled).toHaveLength(3);
      for (const id of labelled) expect(html, id).toContain(`<h2 id="${id}"`);
      const titles = [words.weight.title, words.milestones.title, words.noticed.title];
      const text = visible(html);
      expect(titles.map((title) => text.indexOf(title))).toEqual([...titles.map((title) => text.indexOf(title))].sort((a, b) => a - b));
      for (const title of titles) expect(text).toContain(title);
    });

    it("leaves out a part with nothing to say, never an empty box", async () => {
      const html = await render(locale, loadFor({ kgs: FALL, goalKg: null }));
      expect(count(html, /<h2[\s>]/g)).toBe(1);
      expect(visible(html)).not.toContain(words.milestones.title);
      expect(visible(html)).not.toContain(words.noticed.title);
    });
  });

  describe("when there is nothing at all", () => {
    const empty = () => loadFor({ kgs: [], startKg: null, goalKg: null });

    it("is ONE card: the heading, the honest sentence and the way to report a weight", async () => {
      const html = await render(locale, empty());
      expect(count(html, /<h1[\s>]/g)).toBe(1);
      expect(count(html, /<h2[\s>]/g)).toBe(0);
      expect(count(html, /<section[\s>]/g)).toBe(1);
      expect(visible(html)).toContain(words.body);
      expect(hrefs(html)).toEqual(["/report/weight"]);
      expect(visible(html)).toContain(words.weight.add);
    });

    it("is not shown when only the start weight and a goal exist: the landmarks have something to say", async () => {
      const html = await render(locale, loadFor({ kgs: [] }));
      expect(visible(html)).not.toContain(words.body);
      expect(visible(html)).toContain(words.weight.startOnly);
      expect(visible(html)).toContain(words.milestones.title);
    });

    it("is not shown when there is a start weight or a weigh-in, even without a goal: those have their own honest sentence", async () => {
      const startOnly = visible(await render(locale, loadFor({ kgs: [], goalKg: null })));
      expect(startOnly).toContain(words.weight.startOnly);
      expect(startOnly).not.toContain(words.body);
      expect(startOnly).not.toContain(words.milestones.title);
      const one = visible(await render(locale, loadFor({ kgs: [78.1], goalKg: null })));
      expect(one).toContain(words.weight.notEnough);
      expect(one).not.toContain(words.body);
    });

    it("is not shown when the First Week noticed something", async () => {
      const html = await render(locale, loadFor({ kgs: [], startKg: null, goalKg: null, noticed: LATE_EVENING }));
      expect(visible(html)).not.toContain(words.body);
      expect(visible(html)).toContain(words.noticed.lateEvening);
    });
  });

  describe("the weight card", () => {
    it("says the honest thing for a start weight and no weigh-in", async () => {
      const html = await render(locale, loadFor({ kgs: [] }));
      expect(visible(html)).toContain(words.weight.startOnly);
      expect(count(html, /<svg[\s>]/g)).toBe(0);
      expect(hrefs(html)).toEqual(["/report/weight"]);
    });

    it("says the honest thing for one weigh-in: no line yet, a link to report and to the list", async () => {
      const html = await render(locale, loadFor({ kgs: [78.1] }));
      expect(visible(html)).toContain(words.weight.notEnough);
      expect(count(html, /<svg[\s>]/g)).toBe(0);
      expect(hrefs(html)).toEqual(["/report/weight", "/me/weights"]);
    });

    it("draws the line from two weekly points, with the numbers in a details list that holds exactly the points", async () => {
      const html = await render(locale, loadFor({ kgs: [78.1, 77.4] }));
      expect(count(html, /<svg[\s>]/g)).toBe(1);
      expect(count(html, /<details[\s>]/g)).toBe(1);
      const list = /<details[^>]*>([^]*?)<\/details>/.exec(html)?.[1] ?? "";
      expect(count(list, /<li[\s>]/g)).toBe(2);
      expect(visible(list)).toContain(words.weight.numbers.summary);
      expect(visible(list)).toContain(message(words.weight.numbers.start, { kg: "80.0" }));
      expect(visible(list)).toMatch(/78\.1/);
      expect(visible(list)).toMatch(/77\.4/);
      expect(hrefs(html)).toEqual(["/report/weight", "/me/weights"]);
    });

    it("names the picture with the first and the last weekly average", async () => {
      const html = await render(locale, loadFor({ kgs: FALL }));
      const desc = /<desc[^>]*>([^<]*)<\/desc>/.exec(html)?.[1] ?? "";
      expect(desc.replace(/&quot;/g, '"')).toBe(message(words.weight.chart.desc, { from: "78.1", to: "76.2" }));
    });

    it("says too early to tell with fewer than four completed weeks", async () => {
      const text = visible(await render(locale, loadFor({ kgs: [78.1, 77.4, 76.9] })));
      expect(text).toContain(words.weight.direction.unknown);
      for (const other of [words.weight.direction.down, words.weight.direction.steady, words.weight.direction.up, words.weight.plateau]) {
        expect(text).not.toContain(other);
      }
    });

    it("says the weekly average went down, once, with the distance from the start in the same plain words", async () => {
      const text = visible(await render(locale, loadFor({ kgs: FALL })));
      expect(text).toContain(words.weight.direction.down);
      expect(text).not.toContain(words.weight.direction.unknown);
      expect(text).toContain(message(words.weight.sinceStart.lower, { kg: "3.8" }));
      expect(text).not.toContain(words.weight.plateau);
    });

    it("says it stayed about the same, with the plateau line while the goal is still ahead", async () => {
      const text = visible(await render(locale, loadFor({ kgs: STEADY })));
      expect(text).toContain(words.weight.direction.steady);
      expect(text).toContain(words.weight.plateau);
    });

    it("keeps the plateau line silent once the goal is reached, and says only that it stayed", async () => {
      const html = await render(locale, loadFor({ kgs: [71.8, 71.9, 71.8, 71.9], goalKg: 72 }));
      const text = visible(html);
      expect(text).toContain(words.weight.direction.steady);
      expect(text).not.toContain(words.weight.plateau);
      expect(text).toContain(words.milestones.goalReached);
    });

    it("says the weekly average went up in the same words and the same tone, with 'higher' from the start", async () => {
      const text = visible(await render(locale, loadFor({ kgs: RISE, startKg: 76 })));
      expect(text).toContain(words.weight.direction.up);
      expect(text).toContain(message(words.weight.sinceStart.higher, { kg: "2.5" }));
    });

    it("says about the same as the start, with no distance, when the average is within half a kilogram", async () => {
      const text = visible(await render(locale, loadFor({ kgs: [78.1, 78.2, 78.1], startKg: 78.0 })));
      expect(text).toContain(words.weight.sinceStart.same);
    });

    it("says only that a little time has passed when the last weigh-in is old, and hides the distance from the start", async () => {
      const text = visible(await render(locale, loadFor({ kgs: FALL, endWeeksAgo: 5 })));
      expect(text).toContain(words.weight.direction.stale);
      for (const other of [
        words.weight.direction.down,
        words.weight.direction.steady,
        words.weight.direction.up,
        words.weight.direction.unknown,
        words.weight.plateau,
      ]) {
        expect(text).not.toContain(other);
      }
      expect(text).not.toContain(message(words.weight.sinceStart.lower, { kg: "3.8" }));
      expect(text).not.toMatch(new RegExp(words.weight.sinceStart.same.replace(/[.]/g, "\\.")));
    });

    it("draws the unfinished week as the last dot, exactly like the others, and decides nothing from it", async () => {
      const html = await render(locale, loadFor({ kgs: FALL, unfinished: 70.0 }));
      const dots = Array.from(html.matchAll(/<circle\b[^>]*class="([^"]*)"/g), (match) => match[1]);
      expect(dots).toHaveLength(FALL.length + 1);
      expect(new Set(dots).size).toBe(1);
      // The sentences are still about the four completed weeks.
      expect(visible(html)).toContain(message(words.weight.sinceStart.lower, { kg: "3.8" }));
      expect(visible(html)).toContain(words.weight.direction.down);
      // The details list shows the unfinished week too.
      expect(count(/<details[^>]*>([^]*?)<\/details>/.exec(html)?.[1] ?? "", /<li[\s>]/g)).toBe(FALL.length + 1);
    });

    it("says the weight could not be loaded, calmly, with no chart, no landmarks and no link", async () => {
      const load: ReadyLoad = { kind: "ready", weight: { kind: "unknown" }, milestones: { kind: "UNKNOWN" }, noticed: { patterns: [], activeExperiment: null } };
      const html = await render(locale, load);
      expect(visible(html)).toContain(words.weight.unavailable);
      expect(count(html, /<svg[\s>]/g)).toBe(0);
      expect(visible(html)).not.toContain(words.milestones.title);
      expect(hrefs(html)).toEqual([]);
      expect(visible(html)).not.toContain(words.body);
    });
  });

  describe("the landmarks", () => {
    it("lists them from the start weight toward the goal as an ordered list with a label", async () => {
      const html = await render(locale, loadFor({ kgs: FALL }));
      const list = /<ol[^>]*role="list"[^>]*aria-label="([^"]*)"[^>]*>([^]*?)<\/ol>/.exec(html);
      expect(list?.[1]).toBe(words.milestones.listLabel);
      expect(count(list?.[2] ?? "", /<li[\s>]/g)).toBe(3);
      const kgs = Array.from((list?.[2] ?? "").matchAll(/<span[^>]*>(?:⁦)?(\d+\.\d)(?:⁩)?(?:&quot;| )?/g), (match) => match[1]);
      expect(kgs).toEqual(["80.0", "75.0", "70.0"]);
    });

    it("says in words which is the start and which is the goal, and which is reached and which is next", async () => {
      const html = await render(locale, loadFor({ kgs: FALL }));
      const items = Array.from(html.matchAll(/<li[^>]*>([^]*?)<\/li>/g), (match) => match[1]).slice(-3);
      expect(items).toHaveLength(3);
      expect(textOf(items[0])).toContain(words.milestones.item.start);
      expect(textOf(items[0])).toContain(words.milestones.item.reached);
      expect(textOf(items[1])).toContain(words.milestones.item.next);
      expect(textOf(items[2])).toContain(words.milestones.item.goal);
      // Those ahead say nothing more than their number.
      expect(textOf(items[2])).not.toContain(words.milestones.item.next);
      expect(textOf(items[2])).not.toContain(words.milestones.item.reached);
    });

    it("hides the marks from assistive technology and keeps the state words for screen readers", async () => {
      const html = await render(locale, loadFor({ kgs: FALL }));
      const items = Array.from(html.matchAll(/<li[^>]*>([^]*?)<\/li>/g), (match) => match[1]).slice(-3);
      for (const item of items) expect(item).toMatch(/^<span aria-hidden="true"[^>]*><\/span>/);
      expect(items[0]).toMatch(/<span class="[^"]*srOnly[^"]*">/);
    });

    it("shows a landmark as reached after two completed weekly averages at or below it, and it stays reached", async () => {
      const html = await render(locale, loadFor({ kgs: [74.9, 74.8, 76.0, 77.0] }));
      const items = Array.from(html.matchAll(/<li[^>]*>([^]*?)<\/li>/g), (match) => match[1]).slice(-3);
      expect(textOf(items[1])).toContain(words.milestones.item.reached);
      expect(textOf(items[2])).toContain(words.milestones.item.next);
    });

    it("adds one sentence when the goal is reached", async () => {
      const text = visible(await render(locale, loadFor({ kgs: [70.0, 69.8], goalKg: 70 })));
      expect(text).toContain(words.milestones.goalReached);
    });

    it("is absent without a numeric goal, and absent when the history was not read in full", async () => {
      expect(visible(await render(locale, loadFor({ kgs: FALL, goalKg: null })))).not.toContain(words.milestones.title);
      const unknown: ReadyLoad = { ...loadFor({ kgs: FALL }), milestones: { kind: "UNKNOWN" } };
      expect(visible(await render(locale, unknown))).not.toContain(words.milestones.title);
    });

    it("has no counter, no distance left and no percentage", async () => {
      const text = visible(await render(locale, loadFor({ kgs: FALL })));
      expect(text).not.toMatch(/%|\bof\b|מתוך|\d\s*\/\s*\d/);
    });
  });

  describe("what we noticed", () => {
    it("says the hedged late-evening sentence, at every level that is noticeable", async () => {
      for (const view of ["EARLY_SIGNAL", "CANDIDATE", "VALIDATED"] as const) {
        const noticed: NoticedFacts = { patterns: [{ kind: "late_evening_meals", view }], activeExperiment: null };
        const text = visible(await render(locale, loadFor({ kgs: FALL, noticed })));
        expect(text, view).toContain(words.noticed.title);
        expect(text, view).toContain(words.noticed.lateEvening);
      }
    });

    it("shows the experiment the person chose, as plain text, in its own language", async () => {
      const own = locale === "he" ? "he" : "en";
      const noticed: NoticedFacts = { patterns: [], activeExperiment: { ...OPEN_EXPERIMENT, wording: "<b>a stored sentence</b>", locale: own } };
      const html = await render(locale, loadFor({ kgs: FALL, noticed }));
      expect(visible(html)).toContain(words.noticed.experiment);
      expect(html).toContain("&lt;b&gt;a stored sentence&lt;/b&gt;");
      expect(html).not.toContain("<b>a stored sentence");
    });

    it("falls back to the library's sentence when the stored one is in the other language", async () => {
      const other = locale === "he" ? "en" : "he";
      const noticed: NoticedFacts = { patterns: [], activeExperiment: { ...OPEN_EXPERIMENT, wording: "stored in the other language", locale: other } };
      const text = visible(await render(locale, loadFor({ kgs: FALL, noticed })));
      expect(text).not.toContain("stored in the other language");
      expect(text).toContain(words.noticed.experiment);
      // The library's approved sentence of the current language.
      const library = catalogs[locale].interventions as Record<string, Record<string, string>>;
      expect(Object.values(library[OPEN_EXPERIMENT.key]).some((sentence) => text.includes(sentence.replace(/\{[^}]*\}/g, "").trim().slice(0, 12)))).toBe(true);
    });

    it("asks no question and shows no number", async () => {
      const noticed: NoticedFacts = { patterns: LATE_EVENING.patterns, activeExperiment: OPEN_EXPERIMENT };
      const html = await render(locale, loadFor({ kgs: [], startKg: null, goalKg: null, noticed }));
      expect(html).not.toContain("<form");
      expect(html).not.toContain("<button");
      expect(visible(html)).not.toMatch(/\d/);
    });
  });

  describe("a rise and a fall look and read the same", () => {
    it("uses the same classes, in the same places, and the same elements for a falling and a rising series (the words differ, the page does not)", async () => {
      // The same start weight and goal for both, so the landmarks are the same list and only the direction differs.
      const falling = await render(locale, loadFor({ kgs: FALL, startKg: 76 }));
      const rising = await render(locale, loadFor({ kgs: RISE, startKg: 76 }));
      expect(classSequence(rising)).toEqual(classSequence(falling));
      const tags = (html: string) => Array.from(html.matchAll(/<(\/?[a-z0-9]+)/g), (match) => match[1]).join(" ");
      expect(tags(rising)).toBe(tags(falling));
    });

    it("shows no icon, no emoji and no tag whose class carries a state", async () => {
      for (const kgs of [FALL, STEADY, RISE]) {
        const html = await render(locale, loadFor({ kgs }));
        expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
        expect(html).not.toMatch(/class="[^"]*(?:error|attention|warning|accent|success|up|down)[^"]*"/i);
      }
    });
  });

  describe("the voice", () => {
    it("has no exclamation mark, score, streak or judgment in any state", async () => {
      const loads = [
        loadFor({ kgs: [], startKg: null, goalKg: null }),
        loadFor({ kgs: [] }),
        loadFor({ kgs: [78.1] }),
        loadFor({ kgs: [78.1, 77.4] }),
        loadFor({ kgs: FALL, noticed: LATE_EVENING }),
        loadFor({ kgs: STEADY }),
        loadFor({ kgs: RISE, startKg: 76 }),
        loadFor({ kgs: FALL, endWeeksAgo: 5 }),
        loadFor({ kgs: [70.0, 69.8], goalKg: 70 }),
      ];
      const forbidden = locale === "he"
        ? ["!", "ציון", "אחוז", "רצף", "נכשל", "החמצת", "פספסת", "חרגת"]
        : ["!", "score", "percent", "streak", "failed", "missed", "overdue", "behind", "on track"];
      for (const load of loads) {
        const text = visible(await render(locale, load)).toLowerCase();
        for (const word of forbidden) expect(text, word).not.toContain(word);
      }
    });

    it("has no buttons and no forms: Progress only reads", async () => {
      const html = await render(locale, loadFor({ kgs: FALL, noticed: LATE_EVENING }));
      expect(html).not.toContain("<button");
      expect(html).not.toContain("<form");
    });

    it("styles its links as the app's buttons: the report link secondary, the list link a quiet text button", async () => {
      const html = await render(locale, loadFor({ kgs: FALL }));
      const links = Array.from(html.matchAll(/<a\b[^>]*>/g), (match) => ({
        href: /href="([^"]+)"/.exec(match[0])?.[1],
        className: /class="([^"]*)"/.exec(match[0])?.[1] ?? "",
      }));
      expect(links.find((link) => link.href === "/report/weight")?.className).toContain(ui.secondary);
      expect(links.find((link) => link.href === "/me/weights")?.className).toContain(ui.tertiary);
    });
  });
});

describe("ProgressUnavailable", () => {
  it.each(LOCALES)("%s: one calm card with a heading and one sentence, and nothing to press", async (locale) => {
    intl.locale = locale;
    const html = renderWithIntl(await ProgressUnavailable(), locale);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(visible(html)).toContain(catalogs[locale].progress.unavailable.title);
    expect(visible(html)).toContain(catalogs[locale].progress.unavailable.body);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<button");
  });
});

// Keeps the type import honest: a Progress load that is not ready never reaches the view.
const _typecheck: ProgressLoad["kind"] = "ready";
void _typecheck;
