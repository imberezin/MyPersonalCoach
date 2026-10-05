// "Your week" as markup, with the real catalogs in both languages. The screen is a pure READ of a story that is already decided:
// what it says is true or absent, it counts nothing, nothing on it is colored by what the weight did, and its decisions are
// real forms (each answer its own, with one closed hidden field at most).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import ui from "@/components/ui/ui.module.css";
import { GOAL_FOCUS_KEYS } from "@/domain/onboarding/model";
import type { ExperimentResult, Rationale, WeeklyExperimentDecision, WeeklyStory, WeightLine } from "@/domain/weekly";
import { LOCALES, catalogs, count, renderWithIntl, textOf, type TestLocale } from "../food/foodTestKit";
import { WEEKLY_MESSAGE_KEYS, WEEKLY_FORM_FIELDS, offerMessageKey } from "./messageKeys";
import { WeeklyView } from "./WeeklyView";
import styles from "./weekly.module.css";

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

const story = (over: Partial<WeeklyStory> = {}): WeeklyStory => ({
  mode: "LEARN",
  reason: "data",
  lineKey: "learn",
  happened: [{ kind: "MEALS" }],
  learned: [{ kind: "NOT_YET" }],
  weight: { kind: "NONE" },
  patternQuestion: { kind: "NONE" },
  invite: { weighIn: false },
  ...over,
});

const NONE: WeeklyExperimentDecision = { kind: "NONE", reason: "none_eligible" };
const offer = (rationale: Rationale): WeeklyExperimentDecision => ({
  kind: "OFFER",
  origin: "starter",
  patternKind: null,
  patternId: null,
  key: "eat_intentionally",
  variantId: "default",
  scope: "next_meal",
  params: {},
  constraints: [],
  rationale,
});
const PENDING: WeeklyExperimentDecision = { kind: "PENDING", experimentId: "exp-1" };
const ACTIVE: WeeklyExperimentDecision = { kind: "ACTIVE", experimentId: "exp-1" };
const RESULT_DUE: WeeklyExperimentDecision = { kind: "RESULT_DUE", experimentId: "exp-1", key: "eat_intentionally", variantId: "default" };

const EXPERIMENT = { text: "בארוחה הבאה, שב ולקח כמה דקות.", source: "library", origin: "pattern" } as const;
const RANGE = "20 בספטמבר עד 26 בספטמבר";
const stub = async () => {};

interface Over {
  story?: WeeklyStory;
  decision?: WeeklyExperimentDecision;
  line?: { source: "ai" | "catalog"; text: string };
  experiment?: { text: string; source: "ai" | "library"; origin: "pattern" | "starter" } | null;
  offer?: { rationale: Rationale } | null;
  failed?: boolean;
}

async function render(locale: TestLocale, over: Over = {}): Promise<string> {
  intl.locale = locale;
  const view = await WeeklyView({
    story: over.story ?? story(),
    decision: over.decision ?? NONE,
    rangeLabel: RANGE,
    line: over.line ?? { source: "catalog", text: catalogs[locale].weekly.line.learn },
    experiment: over.experiment ?? null,
    offer: over.offer ?? null,
    failed: over.failed ?? false,
    actions: { propose: stub, start: stub, skip: stub, answerResult: stub, answerPattern: stub },
  });
  return renderWithIntl(view, locale);
}

/** The visible text with the dates of the range removed: they are the one place digits may appear. */
const withoutRange = (html: string) => html.replace(/<bdi>[^]*?<\/bdi>/g, "");
const visible = (html: string) => textOf(withoutRange(html));

/** How the static markup writes a catalog string inside an element (an apostrophe becomes an entity). */
const esc = (value: string) => value.replace(/'/g, "&#x27;");

const forms = (html: string) => Array.from(html.matchAll(/<form\b[^>]*>([^]*?)<\/form>/g), (match) => match[1]);
const hiddenFields = (form: string) => Array.from(form.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g), (match) => match[0]);
const fieldValue = (tag: string) => /value="([^"]*)"/.exec(tag)?.[1];
const buttonClasses = (html: string) => Array.from(html.matchAll(/<button\b[^>]*class="([^"]*)"/g), (match) => match[1]);

describe.each(LOCALES)("WeeklyView in %s", (locale) => {
  const words = catalogs[locale].weekly;

  describe("structure", () => {
    it("has exactly one h1 that names the section, then the dates in a bdi, then the opening line", async () => {
      const html = await render(locale);
      expect(count(html, /<h1[\s>]/g)).toBe(1);
      const labelledBy = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
      expect(html).toContain(`<h1 id="${labelledBy}"`);
      expect(textOf(html)).toContain(words.title);
      expect(html).toContain(`<bdi>${RANGE}</bdi>`);
      expect(html.indexOf("<bdi>")).toBeLessThan(html.indexOf("data-wording-source"));
      expect(html.indexOf(`<h1`)).toBeLessThan(html.indexOf("<bdi>"));
    });

    it("names every part by its own h2, and keeps the order: happened, learned, changed, next, then the way home", async () => {
      const html = await render(locale, { story: story({ weight: { kind: "STEADY" } }) });
      const labelled = Array.from(html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g), (match) => match[1]).slice(1);
      expect(labelled).toHaveLength(4);
      for (const id of labelled) expect(html, id).toContain(`<h2 id="${id}"`);

      const text = textOf(html);
      const order = [words.happened.title, words.learned.title, words.changed.title, words.next.title, words.back];
      const positions = order.map((part) => text.indexOf(part));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });

    it("omits the parts that have nothing to say: no happened lines, no weight line", async () => {
      const html = await render(locale, { story: story({ happened: [], weight: { kind: "NONE" } }) });
      const text = textOf(html);
      expect(text).not.toContain(words.happened.title);
      expect(text).not.toContain(words.changed.title);
      expect(text).toContain(words.learned.title);
      expect(text).toContain(words.next.title);
      expect(count(html, /<h2[\s>]/g)).toBe(2);
    });

    it("lists what happened and what was learned as real lists, one item per line, and never a count", async () => {
      const html = await render(locale, {
        story: story({
          happened: [{ kind: "MEALS" }, { kind: "WEIGHED" }, { kind: "RETURNED" }, { kind: "EXPERIMENT_TRIED" }],
          learned: [{ kind: "LATE_EVENING", level: "ESTABLISHED" }, { kind: "EXPERIMENT", result: "helpful" }],
        }),
      });
      const lists = Array.from(html.matchAll(/<ul[^>]*role="list"[^>]*>([^]*?)<\/ul>/g), (match) => match[1]);
      expect(lists).toHaveLength(2);
      expect(count(lists[0], /<li[\s>]/g)).toBe(4);
      expect(count(lists[1], /<li[\s>]/g)).toBe(2);
      const first = textOf(lists[0]);
      for (const sentence of [words.happened.meals, words.happened.weighed, words.happened.returned, words.happened.experimentTried]) {
        expect(first).toContain(sentence);
      }
      expect(textOf(lists[1])).toContain(words.learned.lateEveningRepeats);
      expect(textOf(lists[1])).toContain(words.learned.helped);
    });

    it.each([
      [{ kind: "EXPERIMENT_STARTED" } as const, "experimentStarted"],
      [{ kind: "MEALS" } as const, "meals"],
    ])("says the %j line in its own words", async (line, key) => {
      const html = await render(locale, { story: story({ happened: [line] }) });
      expect(textOf(html)).toContain((words.happened as Record<string, string>)[key]);
    });

    it.each([
      [{ kind: "LATE_EVENING", level: "EARLY_SIGNAL" } as const, "lateEveningHedged"],
      [{ kind: "LATE_EVENING", level: "ESTABLISHED" } as const, "lateEveningRepeats"],
      [{ kind: "NOT_YET" } as const, "notYet"],
      [{ kind: "EXPERIMENT", result: "helpful" } as const, "helped"],
      [{ kind: "EXPERIMENT", result: "somewhat" } as const, "somewhat"],
      [{ kind: "EXPERIMENT", result: "not_really" } as const, "notReally"],
      [{ kind: "EXPERIMENT", result: "unknown" } as const, "unknown"],
      [{ kind: "EXPERIMENT", result: "not_tried" } as const, "notTried"],
    ])("says the learned line %j in its own words", async (line, key) => {
      const html = await render(locale, { story: story({ learned: [line] }) });
      expect(textOf(html)).toContain((words.learned as Record<string, string>)[key]);
    });

    it("renders the opening line as plain text with its source, and escapes it", async () => {
      const line = { source: "ai", text: "<b>x</b> & <img src=y onerror=z>" } as const;
      const html = await render(locale, { line });
      expect(html).toMatch(/<p\b[^>]*data-wording-source="ai"[^>]*>&lt;b&gt;x&lt;\/b&gt; &amp; &lt;img src=y onerror=z&gt;<\/p>/);
      expect(html).not.toContain("<b>x</b>");
      expect(html).not.toContain("<img");
      const catalog = await render(locale, { line: { source: "catalog", text: words.line.quiet } });
      expect(catalog).toContain('data-wording-source="catalog"');
    });

    it("shows the failed-save note only after a failed write, calmly, as a status", async () => {
      expect(await render(locale)).not.toContain('role="status"');
      const html = await render(locale, { failed: true });
      expect(html).toMatch(/role="status"/);
      expect(textOf(html)).toContain(words.problem.save);
    });

    it("ends with one link home, and it is a link, not a form", async () => {
      const html = await render(locale);
      const links = Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g));
      expect(links.map((link) => [link[1], link[2]])).toEqual([["/", words.back]]);
    });
  });

  describe("the weight line", () => {
    const KINDS: Array<[WeightLine, string]> = [
      [{ kind: "FIRST" }, "first"],
      [{ kind: "BUILDING" }, "building"],
      [{ kind: "DOWN" }, "down"],
      [{ kind: "STEADY" }, "steady"],
      [{ kind: "UP" }, "up"],
    ];

    it.each(KINDS)("says %j in one plain sentence under its own title", async (weight, key) => {
      const html = await render(locale, { story: story({ weight }) });
      expect(textOf(html)).toContain((words.changed as Record<string, string>)[key]);
      expect(textOf(html)).toContain(words.changed.title);
    });

    it("gives an increase, a decrease and a steady week exactly the same markup and classes", async () => {
      const strip = (html: string, weight: WeightLine) => {
        const key = weight.kind.toLowerCase();
        return html.replace(esc((words.changed as Record<string, string>)[key]), "§");
      };
      const [down, steady, up] = await Promise.all(
        ([{ kind: "DOWN" }, { kind: "STEADY" }, { kind: "UP" }] as const).map(async (weight) => strip(await render(locale, { story: story({ weight }) }), weight)),
      );
      expect(down).toContain("§");
      expect(steady).toBe(down);
      expect(up).toBe(down);
    });

    it("never colors, arrows or iconifies the weight: no inline style, no glyph, no aria-hidden mark", async () => {
      for (const [weight] of KINDS) {
        const html = await render(locale, { story: story({ weight }) });
        expect(html).not.toMatch(/style=|aria-hidden|[↑↓▲▼⬆⬇📈📉]/);
      }
    });

    it("shows no number and no kilogram figure", async () => {
      for (const [weight] of KINDS) expect(visible(await render(locale, { story: story({ weight }) }))).not.toMatch(/\d|kg|ק"ג/i);
    });
  });

  describe("what next", () => {
    const part = (html: string) => html.slice(html.indexOf(`id="weekly-next"`));

    it("NONE says plainly that there is nothing new, with no button but the way home", async () => {
      const html = await render(locale, { decision: NONE });
      expect(textOf(part(html))).toContain(words.next.none);
      expect(count(html, /<form\b/g)).toBe(0);
      expect(count(html, /<button\b/g)).toBe(0);
    });

    it("a recovery or a quiet week says the light line instead", async () => {
      for (const mode of ["RECOVER", "RESET"] as const) {
        const html = await render(locale, { story: story({ mode, lineKey: mode === "RECOVER" ? "recover" : "quiet" }), decision: NONE });
        expect(textOf(part(html))).toContain(words.next.light);
        expect(textOf(part(html))).not.toContain(words.next.none);
      }
    });

    it("an OFFER is one fixed sentence and one secondary form button that needs no field", async () => {
      const html = await render(locale, { decision: offer({ kind: "DEFAULT" }), offer: { rationale: { kind: "DEFAULT" } } });
      expect(textOf(part(html))).toContain(words.next.offer.default);
      expect(count(html, /<form\b/g)).toBe(1);
      expect(hiddenFields(forms(html)[0])).toEqual([]);
      const button = /<button\b[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/.exec(html);
      expect(button?.[2]).toBe(esc(words.next.choose));
      expect(button?.[1]).toContain(ui.secondary);
      expect(button?.[1]).not.toContain(ui.primary);
    });

    it("a quiet week with a pattern-led OFFER shows the light line above the idea, never as a task", async () => {
      const html = await render(locale, {
        story: story({ mode: "RESET", lineKey: "quiet" }),
        decision: offer({ kind: "PATTERN", patternKind: "late_evening_meals" }),
        offer: { rationale: { kind: "PATTERN", patternKind: "late_evening_meals" } },
      });
      const text = textOf(part(html));
      expect(text.indexOf(words.next.light)).toBeGreaterThanOrEqual(0);
      expect(text.indexOf(words.next.light)).toBeLessThan(text.indexOf(words.next.offer.pattern));
    });

    it("PENDING shows the idea, the neutral frame, the no-pressure note, and I'll-try (primary) before Not-this-time (secondary)", async () => {
      const html = await render(locale, { decision: PENDING, experiment: EXPERIMENT });
      const text = textOf(part(html));
      for (const piece of [words.next.pendingLead, EXPERIMENT.text, words.next.frame, words.next.note]) expect(text).toContain(piece);
      expect(text.indexOf(words.next.pendingLead)).toBeLessThan(text.indexOf(EXPERIMENT.text));
      expect(text.indexOf(EXPERIMENT.text)).toBeLessThan(text.indexOf(words.next.frame));
      expect(html).toMatch(/<p\b[^>]*data-wording-source="library"[^>]*>/);

      expect(count(html, /<form\b/g)).toBe(2);
      for (const form of forms(html)) expect(hiddenFields(form)).toEqual([]);
      const buttons = Array.from(html.matchAll(/<button\b[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g), (match) => ({ cls: match[1], label: match[2] }));
      expect(buttons.map((b) => b.label)).toEqual([esc(words.next.try), esc(words.next.notThisTime)]);
      expect(buttons[0].cls).toContain(ui.primary);
      expect(buttons[1].cls).toContain(ui.secondary);
    });

    it("PENDING whose row could not be read says the plain thing and offers nothing to press", async () => {
      const html = await render(locale, { decision: PENDING, experiment: null });
      expect(textOf(part(html))).toContain(words.next.none);
      expect(count(html, /<form\b/g)).toBe(0);
    });

    it("ACTIVE shows the experiment and the calm body, with nothing to report and no form", async () => {
      const html = await render(locale, { decision: ACTIVE, experiment: { ...EXPERIMENT, source: "ai" } });
      const text = textOf(part(html));
      expect(text).toContain(words.next.activeLead);
      expect(text).toContain(EXPERIMENT.text);
      expect(text).toContain(words.next.activeBody);
      expect(html).toMatch(/<p\b[^>]*data-wording-source="ai"[^>]*>/);
      expect(count(html, /<form\b/g)).toBe(0);
    });

    it("shows the soft weigh-in line only when the story invites it", async () => {
      expect(textOf(await render(locale, { story: story({ invite: { weighIn: true } }) }))).toContain(words.next.weighInvite);
      expect(textOf(await render(locale, { story: story({ invite: { weighIn: false } }) }))).not.toContain(words.next.weighInvite);
    });
  });

  describe("the result question", () => {
    const ORDER: ExperimentResult[] = ["helpful", "somewhat", "not_really", "unknown", "not_tried"];

    it("comes FIRST on the page, before every part, and the Next part only says what comes after it", async () => {
      const html = await render(locale, {
        story: story({ happened: [{ kind: "MEALS" }], weight: { kind: "FIRST" } }),
        decision: RESULT_DUE,
        experiment: EXPERIMENT,
      });
      const text = textOf(html);
      const resultAt = text.indexOf(words.result.title);
      expect(resultAt).toBeGreaterThan(text.indexOf(words.title));
      for (const title of [words.happened.title, words.learned.title, words.changed.title, words.next.title]) {
        expect(resultAt, title).toBeLessThan(text.indexOf(title));
      }
      expect(text.indexOf(words.result.reminder)).toBeGreaterThan(resultAt);
      expect(text).toContain(EXPERIMENT.text);
      expect(text).toContain(words.next.afterResult);
      expect(count(html, /<h1[\s>]/g)).toBe(1);
    });

    it("has five equal answers in the spec's order, each its own form with ONE closed hidden field, and no id", async () => {
      const html = await render(locale, { decision: RESULT_DUE, experiment: EXPERIMENT });
      const all = forms(html);
      expect(all).toHaveLength(5);
      expect(all.map((form) => hiddenFields(form).length)).toEqual([1, 1, 1, 1, 1]);
      expect(all.map((form) => fieldValue(hiddenFields(form)[0]))).toEqual(ORDER);
      for (const form of all) expect(hiddenFields(form)[0]).toContain(`name="${WEEKLY_FORM_FIELDS.result}"`);
      expect(all.map((form) => />([^<]+)<\/button>/.exec(form)?.[1])).toEqual(
        [words.result.helpful, words.result.somewhat, words.result.notReally, words.result.unknown, words.result.notTried],
      );

      const classes = buttonClasses(html);
      expect(classes).toHaveLength(5);
      expect(new Set(classes).size).toBe(1);
      expect(classes[0]).toContain(ui.secondary);
      for (const button of html.matchAll(/<button\b[^>]*>/g)) expect(button[0]).toContain('type="submit"');
    });

    it("keeps the five answers in one group named by the result title, and says there is no right answer", async () => {
      const html = await render(locale, { decision: RESULT_DUE, experiment: EXPERIMENT });
      const group = /<div role="group" aria-labelledby="([^"]+)"/.exec(html)?.[1];
      expect(group).toBe("weekly-result-title");
      expect(html).toContain(`<h2 id="weekly-result-title"`);
      expect(textOf(html)).toContain(words.result.lead);
    });

    it("still asks when the experiment's own row could not be read, only without the reminder", async () => {
      const html = await render(locale, { decision: RESULT_DUE, experiment: null });
      expect(forms(html)).toHaveLength(5);
      expect(textOf(html)).not.toContain(words.result.reminder);
    });

    it("is absent for every other decision", async () => {
      for (const decision of [NONE, PENDING, ACTIVE, offer({ kind: "DEFAULT" })]) {
        const html = await render(locale, { decision, experiment: EXPERIMENT, offer: { rationale: { kind: "DEFAULT" } } });
        expect(textOf(html)).not.toContain(words.result.title);
      }
    });
  });

  describe("the pattern question", () => {
    const ASK = story({ learned: [{ kind: "LATE_EVENING", level: "ESTABLISHED" }], patternQuestion: { kind: "ASK", patternKind: "late_evening_meals" } });

    it("has three equal answers in the spec's order, each its own form with ONE closed hidden field, right after the learned lines", async () => {
      const html = await render(locale, { story: ASK });
      const all = forms(html);
      expect(all).toHaveLength(3);
      expect(all.map((form) => fieldValue(hiddenFields(form)[0]))).toEqual(["confirm", "unsure", "reject"]);
      expect(all.map((form) => hiddenFields(form).length)).toEqual([1, 1, 1]);
      for (const form of all) expect(hiddenFields(form)[0]).toContain(`name="${WEEKLY_FORM_FIELDS.answer}"`);
      expect(all.map((form) => />([^<]+)<\/button>/.exec(form)?.[1])).toEqual([words.learned.confirm, words.learned.unsure, words.learned.reject]);

      const classes = buttonClasses(html);
      expect(new Set(classes).size).toBe(1);
      expect(classes[0]).toContain(ui.secondary);

      const text = textOf(html);
      expect(text.indexOf(words.learned.lateEveningRepeats)).toBeLessThan(text.indexOf(words.learned.patternQuestion));
      expect(text.indexOf(words.learned.patternQuestion)).toBeLessThan(text.indexOf(words.learned.confirm));
      expect(html).toMatch(/<div role="group" aria-labelledby="weekly-pattern-question"/);
    });

    it("is absent unless the story asks", async () => {
      const html = await render(locale, { story: story({ learned: [{ kind: "LATE_EVENING", level: "ESTABLISHED" }] }) });
      expect(textOf(html)).not.toContain(words.learned.patternQuestion);
      expect(count(html, /<form\b/g)).toBe(0);
    });
  });

  describe("the voice and the words", () => {
    // Every state the screen can be in at once, to scan what it can say.
    const BUSY: Over[] = [
      {
        story: story({
          happened: [{ kind: "MEALS" }, { kind: "WEIGHED" }, { kind: "RETURNED" }, { kind: "EXPERIMENT_TRIED" }],
          learned: [{ kind: "LATE_EVENING", level: "ESTABLISHED" }, { kind: "EXPERIMENT", result: "helpful" }],
          weight: { kind: "UP" },
          patternQuestion: { kind: "ASK", patternKind: "late_evening_meals" },
          invite: { weighIn: true },
        }),
        decision: RESULT_DUE,
        experiment: EXPERIMENT,
        failed: true,
      },
      { decision: offer({ kind: "GOAL", goal: "feel_lighter" }), offer: { rationale: { kind: "GOAL", goal: "feel_lighter" } } },
      { decision: PENDING, experiment: EXPERIMENT },
      { decision: ACTIVE, experiment: EXPERIMENT },
      { decision: NONE, story: story({ mode: "RESET", lineKey: "quiet", happened: [] }) },
    ];

    it("has no digit outside the range of dates, and no exclamation mark", async () => {
      for (const over of BUSY) {
        const text = visible(await render(locale, over));
        expect(text).not.toMatch(/\d/);
        expect(text).not.toContain("!");
      }
    });

    it("never mentions a score, a percentage, a streak, a day or week number, or a comparison", async () => {
      const lower: Record<TestLocale, RegExp> = {
        he: /ציון|אחוז|%|רצף|לעומת|מהשבוע שעבר/,
        en: /score|percent|%|streak|than last week|compared/i,
      };
      for (const over of BUSY) expect(visible(await render(locale, over))).not.toMatch(lower[locale]);
    });

    it("has no hidden field that carries an id, a week or a user, anywhere", async () => {
      for (const over of BUSY) {
        const html = await render(locale, over);
        for (const tag of html.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)) {
          expect(tag[0]).toMatch(/name="(result|answer)"/);
          expect(tag[0]).not.toMatch(/name="(id|week|user|week_start|userId)"/i);
        }
      }
    });

    it("never carries a button that is red, a destructive variant, or a link that posts", async () => {
      for (const over of BUSY) {
        const html = await render(locale, over);
        // Only class names count: the static markup also carries React's form-replay code, which says "Error".
        for (const cls of html.matchAll(/class="([^"]*)"/g)) expect(cls[1]).not.toMatch(/destructive|danger|error|red/i);
        for (const button of html.matchAll(/<button\b[^>]*>/g)) expect(button[0]).toContain('type="submit"');
      }
    });

    it("does not use the words of the First Week or of the engine", async () => {
      for (const over of BUSY) expect(visible(await render(locale, over)).toLowerCase()).not.toMatch(/reset|lifecycle|evidence|pattern|דפוס|איפוס/);
    });
  });
});

describe("offerMessageKey", () => {
  const key = (rationale: Rationale) => offerMessageKey(rationale);

  it("maps KEEP_GOING, NEXT_STEP, PATTERN and DEFAULT to their own fixed sentences", () => {
    expect(key({ kind: "KEEP_GOING" })).toBe("weekly.next.offer.keepGoing");
    expect(key({ kind: "NEXT_STEP" })).toBe("weekly.next.offer.nextStep");
    expect(key({ kind: "PATTERN", patternKind: "late_evening_meals" })).toBe("weekly.next.offer.pattern");
    expect(key({ kind: "DEFAULT" })).toBe("weekly.next.offer.default");
  });

  it("gives the two goals that can be named without saying what to change their own sentence", () => {
    expect(key({ kind: "GOAL", goal: "improve_eating" })).toBe("weekly.next.offer.goalEating");
    expect(key({ kind: "GOAL", goal: "feel_lighter" })).toBe("weekly.next.offer.goalFeeling");
  });

  it.each(["lose_weight", "understand_overeating", "be_active", "not_sure"] as const)("reads like no goal at all for %s", (goal) => {
    expect(key({ kind: "GOAL", goal })).toBe("weekly.next.offer.default");
  });

  it("covers every goal the person can choose, and every key it returns is in the catalogs and in the contract", () => {
    for (const goal of GOAL_FOCUS_KEYS) {
      const messageKey = key({ kind: "GOAL", goal });
      expect(WEEKLY_MESSAGE_KEYS).toContain(messageKey);
      for (const locale of LOCALES) expect(messageKey.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalogs[locale]), `${locale}: ${messageKey}`).toBeTruthy();
    }
  });

  it.each(LOCALES)("%s: no rendered offer sentence contains an onboarding option text, whatever the goal", async (locale) => {
    const options = Object.values(catalogs[locale].onboarding.goals.options).map((label) => label.toLowerCase());
    for (const goal of GOAL_FOCUS_KEYS) {
      const rationale: Rationale = { kind: "GOAL", goal };
      const html = await render(locale, { decision: offer(rationale), offer: { rationale } });
      const text = visible(html).toLowerCase();
      for (const label of options) expect(text, `${locale}: ${goal} quotes "${label}"`).not.toContain(label);
    }
  });

  it("shows the sentence the rationale chose, in the page's language", async () => {
    for (const locale of LOCALES) {
      const words = catalogs[locale].weekly.next.offer;
      const cases: Array<[Rationale, string]> = [
        [{ kind: "KEEP_GOING" }, words.keepGoing],
        [{ kind: "NEXT_STEP" }, words.nextStep],
        [{ kind: "PATTERN", patternKind: "late_evening_meals" }, words.pattern],
        [{ kind: "GOAL", goal: "improve_eating" }, words.goalEating],
        [{ kind: "GOAL", goal: "feel_lighter" }, words.goalFeeling],
        [{ kind: "GOAL", goal: "lose_weight" }, words.default],
        [{ kind: "DEFAULT" }, words.default],
      ];
      for (const [rationale, sentence] of cases) {
        const html = await render(locale, { decision: offer(rationale), offer: { rationale } });
        expect(visible(html), `${locale}: ${rationale.kind}`).toContain(sentence);
      }
    }
  });
});

describe("the components, as source", () => {
  const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

  it("uses only server components apart from the shared submit button and title", () => {
    for (const name of ["WeeklyView.tsx", "WeeklyNext.tsx", "WeeklyResult.tsx", "WeeklyPatternQuestion.tsx", "WeeklyUnavailable.tsx"]) {
      expect(read(name), name).not.toMatch(/"use client"/);
    }
  });

  it("uses the stylesheet's classes only (a missing one would be undefined)", () => {
    for (const name of ["actions", "stack", "part", "partTitle", "lines", "lead", "range", "note", "experimentText", "screen", "homeLink"]) {
      expect(styles[name as keyof typeof styles], name).toBeTruthy();
    }
  });
});
