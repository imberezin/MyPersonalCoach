// B6 as markup, with the real catalogs in both languages. The page is a pure READ: what it says is true or absent,
// it counts nothing, and its two decisions are two real forms.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import ui from "@/components/ui/ui.module.css";
import type { FirstWeekSummary } from "@/domain/firstWeekFlow";
import type { OpenExperiment } from "@/lib/experiments/repo";
import { FirstWeekSummaryView } from "./FirstWeekSummaryView";
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

const hrefs = (html: string) => Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"/g), (match) => match[1]);

const base = (over: Partial<FirstWeekSummary> = {}): FirstWeekSummary => ({
  tone: "ENOUGH",
  why: { kind: "SOME", focus: ["improve_eating", "understand_overeating"], notSure: false, motivation: "I want to feel at home in my body" },
  did: [{ kind: "MEALS" }],
  noticed: { kind: "NOT_ENOUGH_YET" },
  moment: { kind: "FIRST_REPORT" },
  next: { kind: "NO_EXPERIMENT" },
  ...over,
});

const stub = async () => {};
const OPEN_ACTIVE: OpenExperiment = {
  id: "exp-1",
  status: "ACTIVE",
  key: "eat_intentionally",
  variantId: "default",
  wording: "stored sentence",
  source: "library",
  locale: "he",
};

async function render(
  locale: TestLocale,
  summary: FirstWeekSummary = base(),
  over: { failed?: boolean; experiment?: { open: OpenExperiment | null; text: string | null } } = {},
): Promise<string> {
  intl.locale = locale;
  return renderWithIntl(
    await FirstWeekSummaryView({
      summary,
      failed: over.failed ?? false,
      finishAction: stub,
      snoozeAction: stub,
      proposeAction: stub,
      experiment: over.experiment ?? { open: null, text: null },
    }),
    locale,
  );
}

/** The person's own words are the one element the "no digit" rule exempts. */
const withoutUserText = (html: string) => html.replace(/<p\b[^>]*data-user-text[^>]*>[^]*?<\/p>/g, "");

const visibleText = (html: string) => textOf(withoutUserText(html));

/** How the static markup writes a catalog string inside an element (an apostrophe becomes an entity). */
const esc = (text: string) => text.replace(/'/g, "&#x27;");

describe.each(LOCALES)("FirstWeekSummaryView in %s", (locale) => {
  const words = catalogs[locale].firstWeek.summary;
  const focusWords = words.why.focus;
  const labels = catalogs[locale].onboarding.goals.options;

  describe("structure", () => {
    it("has exactly one h1 that names the section", async () => {
      const html = await render(locale);
      expect(count(html, /<h1[\s>]/g)).toBe(1);
      const labelledBy = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
      expect(html).toContain(`<h1 id="${labelledBy}"`);
    });

    it("has five parts for a full summary, four without the moment or without the reasons, three without both", async () => {
      const full = base();
      const parts = async (summary: FirstWeekSummary) => count(await render(locale, summary), /<h2[\s>]/g);
      expect(await parts(full)).toBe(5);
      expect(await parts(base({ moment: { kind: "NONE" } }))).toBe(4);
      expect(await parts(base({ why: { kind: "NONE" } }))).toBe(4);
      expect(await parts(base({ moment: { kind: "NONE" }, why: { kind: "NONE" } }))).toBe(3);
    });

    it("names every part by its own h2", async () => {
      const html = await render(locale);
      // The first section is the page itself, named by the h1; every part inside it is named by an h2.
      const labelled = Array.from(html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g), (match) => match[1]).slice(1);
      expect(labelled).toHaveLength(5);
      for (const id of labelled) expect(html, id).toContain(`<h2 id="${id}"`);
      for (const title of [words.why.title, words.did.title, words.noticed.title, words.moment.title, words.next.title]) {
        expect(textOf(html)).toContain(title);
      }
    });

    it("lists what the person did as a real list, with a hidden check glyph before each line", async () => {
      const html = await render(locale, base({ did: [{ kind: "MEALS" }, { kind: "EXPERIMENT" }] }));
      const list = /<ul[^>]*>([^]*?)<\/ul>/.exec(html.slice(html.indexOf(words.did.title)))?.[1] ?? "";
      expect(count(list, /<li[\s>]/g)).toBe(2);
      expect(count(list, /<span[^>]*aria-hidden="true"[^>]*>✓<\/span>/g)).toBe(2);
      expect(textOf(list)).toContain(words.did.meals);
      expect(textOf(list)).toContain(words.did.experiment);
    });

    it("exposes the did lines as a list to VoiceOver too (role=list), and puts no check before the NO_MEALS line", async () => {
      const html = await render(locale, base({ did: [{ kind: "MEALS" }, { kind: "EXPERIMENT" }] }));
      expect(html.slice(html.indexOf(words.did.title))).toMatch(/<ul[^>]*role="list"[^>]*>/);

      const none = await render(locale, base({ tone: "NO_MEALS", did: [{ kind: "NO_MEALS" }], moment: { kind: "NONE" } }));
      const list = /<ul[^>]*>([^]*?)<\/ul>/.exec(none.slice(none.indexOf(words.did.title)))?.[1] ?? "";
      expect(count(list, /<li[\s>]/g)).toBe(1);
      expect(list).not.toContain("✓");
      expect(count(list, /<span[^>]*aria-hidden="true"[^>]*><\/span>/g)).toBe(1);
      expect(textOf(list)).toContain(words.did.none);
    });

    it("keeps the order of the parts: reasons, did, noticed, moment, next, then the decision", async () => {
      const text = textOf(await render(locale));
      const order = [words.why.title, words.did.title, words.noticed.title, words.moment.title, words.next.title, words.continueNote, words.notNow];
      const positions = order.map((part) => text.indexOf(part));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });
  });

  describe("Why we started", () => {
    const some = (over: Partial<Extract<FirstWeekSummary["why"], { kind: "SOME" }>> = {}): FirstWeekSummary["why"] => ({
      kind: "SOME",
      focus: [],
      notSure: false,
      motivation: null,
      ...over,
    });
    const whyPart = (html: string) => html.slice(html.indexOf(words.why.title), html.indexOf(words.did.title));

    it("is absent when there is nothing the person said", async () => {
      const html = await render(locale, base({ why: { kind: "NONE" } }));
      expect(textOf(html)).not.toContain(words.why.title);
      expect(textOf(html)).not.toContain(words.why.link);
      expect(textOf(html)).not.toContain(words.why.linkNotSure);
    });

    it("lists the goals in the app's gentle wording, then the fixed linking sentence", async () => {
      const html = await render(locale, base({ why: some({ focus: ["lose_weight", "be_active"] }) }));
      const list = /<ul[^>]*>([^]*?)<\/ul>/.exec(whyPart(html))?.[1] ?? "";
      expect(Array.from(list.matchAll(/<li[^>]*>([^<]*)<\/li>/g), (match) => match[1])).toEqual([focusWords.lose_weight, focusWords.be_active]);
      const text = textOf(html);
      expect(text).toContain(words.why.goalsLead);
      expect(text).toContain(words.why.link);
      expect(text.indexOf(words.why.link)).toBeGreaterThan(text.indexOf(focusWords.be_active));
      expect(text).not.toContain(words.why.linkNotSure);
      expect(text).not.toContain(words.why.notSure);
      expect(text).not.toContain(words.why.motivationLead);
      expect(html).not.toContain("data-user-text");
    });

    it.each(["lose_weight", "feel_lighter", "improve_eating", "be_active", "understand_overeating"] as const)(
      "%s is one list item in its own gentle phrase",
      async (key) => {
        const html = await render(locale, base({ why: some({ focus: [key] }) }));
        const list = /<ul[^>]*>([^]*?)<\/ul>/.exec(whyPart(html))?.[1] ?? "";
        expect(count(list, /<li[\s>]/g)).toBe(1);
        expect(textOf(list)).toBe(focusWords[key]);
        // The two onboarding labels that name the weight or "eating too much" are not echoed back as they were typed.
        if (key === "lose_weight" || key === "understand_overeating") {
          expect(focusWords[key]).not.toBe(labels[key]);
          expect(textOf(html)).not.toContain(labels[key]);
        }
      },
    );

    it("shows all five goals at once, in the closed order", async () => {
      const keys = ["lose_weight", "feel_lighter", "improve_eating", "be_active", "understand_overeating"] as const;
      const html = await render(locale, base({ why: some({ focus: [...keys] }) }));
      const list = /<ul[^>]*>([^]*?)<\/ul>/.exec(whyPart(html))?.[1] ?? "";
      expect(Array.from(list.matchAll(/<li[^>]*>([^<]*)<\/li>/g), (match) => match[1])).toEqual(keys.map((key) => focusWords[key]));
    });

    it("'not sure' is shown kindly as an answer, with no list, and the sentence that does not point at a change", async () => {
      const html = await render(locale, base({ why: some({ notSure: true }) }));
      const text = textOf(html);
      expect(text).toContain(words.why.title);
      expect(text).toContain(words.why.notSure);
      expect(text).toContain(words.why.linkNotSure);
      expect(text).not.toContain(words.why.goalsLead);
      expect(text).not.toContain(words.why.link);
      expect(text).not.toContain(labels.not_sure);
      expect(count(whyPart(html), /<ul[\s>]/g)).toBe(0);
    });

    it("'not sure' next to the person's own words shows both, in that order", async () => {
      const html = await render(locale, base({ why: some({ notSure: true, motivation: "slowly" }) }));
      const text = textOf(html);
      expect(text.indexOf(words.why.notSure)).toBeLessThan(text.indexOf(words.why.motivationLead));
      expect(text.indexOf(words.why.motivationLead)).toBeLessThan(text.indexOf(words.why.linkNotSure));
    });

    it("a numeric goal and nothing else says only that a change matters, then the linking sentence", async () => {
      const html = await render(locale, base({ why: some() }));
      const text = textOf(html);
      expect(text).toContain(words.why.goalSet);
      expect(text).toContain(words.why.link);
      expect(text).not.toContain(words.why.goalsLead);
      expect(text).not.toContain(words.why.notSure);
      expect(text).not.toContain(words.why.motivationLead);
      expect(count(whyPart(html), /<ul[\s>]/g)).toBe(0);
    });

    it("says the 'a change matters' line only when nothing else was said", async () => {
      for (const over of [{ focus: ["be_active" as const] }, { notSure: true }, { motivation: "words" }]) {
        expect(textOf(await render(locale, base({ why: some(over) })))).not.toContain(words.why.goalSet);
      }
    });

    it("shows the person's own words in an element of its own that follows its text direction, after its lead", async () => {
      const html = await render(locale, base({ why: some({ motivation: "I want to feel at home in my body" }) }));
      const tag = /<p\b[^>]*data-user-text[^>]*>/.exec(html)?.[0] ?? "";
      expect(tag).toContain('dir="auto"');
      expect(html).toContain("I want to feel at home in my body</p>");
      expect(textOf(html)).toContain(words.why.motivationLead);
      expect(count(html, /data-user-text/g)).toBe(1);
      expect(html.indexOf(words.why.motivationLead)).toBeLessThan(html.indexOf("data-user-text"));
      // Only the words: no goals list when the person chose none.
      expect(count(whyPart(html), /<ul[\s>]/g)).toBe(0);
    });

    it("escapes the words: markup appears as text and never as markup", async () => {
      const html = await render(locale, base({ why: some({ motivation: "<b>x</b> & <img src=y onerror=z> <script>alert(1)</script>" }) }));
      expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain("<b>x</b>");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<script>alert");
    });

    it("renders what the domain hands it, shortened text included, without cutting it again", async () => {
      const shortened = `${"word ".repeat(55).trim()}…`;
      const html = await render(locale, base({ why: some({ motivation: shortened }) }));
      expect(html).toContain(`${shortened}</p>`);
    });

    it("lets digits in the person's words appear only inside that element", async () => {
      const motivation = '5 ק"ג עד הקיץ, 72 ideally';
      const html = await render(locale, base({ why: some({ focus: ["lose_weight"], motivation }) }));
      expect(html).toContain("5 ק&quot;ג עד הקיץ, 72 ideally</p>");
      expect(visibleText(html)).not.toMatch(/\d/);
    });

    it("appears for the neutral tones too: it is what the person said, not a claim about the data", async () => {
      for (const tone of ["LITTLE", "NO_MEALS"] as const) {
        expect(textOf(await render(locale, base({ tone })))).toContain(words.why.title);
      }
    });

    it("claims neither success nor failure, and promises nothing", async () => {
      const everything = some({ focus: ["lose_weight", "feel_lighter", "improve_eating", "be_active", "understand_overeating"], motivation: "x" });
      const text = textOf(await render(locale, base({ why: everything })));
      const part = text.slice(text.indexOf(words.why.title), text.indexOf(words.did.title));
      expect(part).not.toMatch(/succe|fail|achiev|progress|target|kg|ק"ג|יעד|הצלח|התקדמ|will lose|you will/i);
    });

    it("never prints a weight: the view has no way to be given one", async () => {
      const source = readFileSync(fileURLToPath(new URL("./FirstWeekSummaryView.tsx", import.meta.url)), "utf8");
      expect(source).not.toMatch(/goal_weight|goalWeight|start_weight|weight_kg|numericGoal/);
      const html = await render(locale, base({ why: some({ focus: ["lose_weight"] }) }));
      expect(visibleText(html)).not.toContain("72");
    });

    it("switches on the kind exhaustively, so a new kind has to be written here", () => {
      const source = readFileSync(fileURLToPath(new URL("./FirstWeekSummaryView.tsx", import.meta.url)), "utf8");
      expect(source).toMatch(/case "NONE":/);
      expect(source).toMatch(/case "SOME":/);
      expect(source).toMatch(/const unhandled: never = why;/);
    });
  });

  describe("the tone", () => {
    it("ENOUGH says the familiarity title and lead", async () => {
      const text = textOf(await render(locale, base({ tone: "ENOUGH" })));
      expect(text).toContain(words.title.enough);
      expect(text).toContain(words.lead.enough);
      expect(text).not.toContain(words.title.neutral);
    });

    it.each(["LITTLE", "NO_MEALS"] as const)("%s says the neutral title and the 'less information' lead, and never the familiarity text", async (tone) => {
      const text = textOf(await render(locale, base({ tone })));
      expect(text).toContain(words.title.neutral);
      expect(text).toContain(words.lead.little);
      expect(text).not.toContain(words.title.enough);
      expect(text).not.toContain(words.lead.enough);
    });

    it("NO_MEALS says plainly that no meals were saved, and omits the moment", async () => {
      const html = await render(locale, base({ tone: "NO_MEALS", did: [{ kind: "NO_MEALS" }], moment: { kind: "NONE" } }));
      expect(textOf(html)).toContain(words.did.none);
      expect(textOf(html)).not.toContain(words.did.meals);
      expect(textOf(html)).not.toContain(words.moment.title);
    });
  });

  describe("what we noticed, and the moment", () => {
    it("shows the hedged late-evening line for an observation, and not the 'too early' one", async () => {
      const text = textOf(await render(locale, base({ noticed: { kind: "OBSERVATIONS", items: [{ kind: "LATE_EVENING_MEALS" }] } })));
      expect(text).toContain(words.noticed.lateEvening);
      expect(text).not.toContain(words.noticed.notEnough);
    });

    it("shows the honest 'too early' line when there is nothing to notice, and not the observation", async () => {
      const text = textOf(await render(locale));
      expect(text).toContain(words.noticed.notEnough);
      expect(text).not.toContain(words.noticed.lateEvening);
    });

    it("shows the experiment line in 'what you did' only when there is one", async () => {
      expect(textOf(await render(locale))).not.toContain(words.did.experiment);
      expect(textOf(await render(locale, base({ did: [{ kind: "MEALS" }, { kind: "EXPERIMENT" }] })))).toContain(words.did.experiment);
    });

    it("says the moment that happened, and omits the section otherwise", async () => {
      expect(textOf(await render(locale, base({ moment: { kind: "RETURNED" } })))).toContain(words.moment.returned);
      expect(textOf(await render(locale, base({ moment: { kind: "FIRST_REPORT" } })))).toContain(words.moment.firstReport);
      expect(textOf(await render(locale, base({ moment: { kind: "NONE" } })))).not.toContain(words.moment.title);
    });
  });

  describe("And what now? (the experiment)", () => {
    it("NO_EXPERIMENT says the plain line and adds no form", async () => {
      const html = await render(locale, base({ next: { kind: "NO_EXPERIMENT" } }));
      expect(textOf(html)).toContain(words.next.none);
      expect(count(html, /<form\b/g)).toBe(2);
    });

    it("OFFER adds exactly one form: one secondary submit button, no hidden field, and the offer line", async () => {
      const html = await render(locale, base({ next: { kind: "OFFER" } }));
      expect(textOf(html)).toContain(words.next.offer);
      expect(count(html, /<form\b/g)).toBe(3);
      const forms = Array.from(html.matchAll(/<form\b[^>]*>([^]*?)<\/form>/g), (match) => match[1]);
      const offer = forms.find((form) => form.includes(`>${esc(words.next.choose)}</button>`)) ?? "";
      expect(offer).not.toBe("");
      expect(count(offer, /<button\b/g)).toBe(1);
      expect(offer).toContain('type="submit"');
      expect(offer).toContain(ui.secondary);
      expect(offer).not.toContain("<input");
    });

    it("PENDING links to the idea, and adds no form", async () => {
      const html = await render(locale, base({ next: { kind: "PENDING" } }));
      expect(textOf(html)).toContain(words.next.pending);
      expect(hrefs(html)).toEqual(["/first-week/experiment"]);
      expect(textOf(html)).toContain(words.next.see);
      expect(count(html, /<form\b/g)).toBe(2);
    });

    it("ACTIVE shows the stored text as plain text, and adds no form", async () => {
      const html = await render(locale, base({ next: { kind: "ACTIVE" } }), { experiment: { open: OPEN_ACTIVE, text: "a <b>stored</b> sentence" } });
      expect(textOf(html)).toContain(words.next.active);
      expect(html).toContain("a &lt;b&gt;stored&lt;/b&gt; sentence");
      expect(html).not.toContain("<b>stored</b>");
      expect(count(html, /<form\b/g)).toBe(2);
    });

    it("ACTIVE with a sentence that could not be read says only the true thing", async () => {
      const text = textOf(await render(locale, base({ next: { kind: "ACTIVE" } })));
      expect(text).not.toContain(words.next.active);
      expect(text).toContain(words.did.experiment);
    });

    it("never moves the decision: the continue form is the first of the two decision forms, whatever Next shows", async () => {
      for (const next of [{ kind: "NO_EXPERIMENT" }, { kind: "OFFER" }, { kind: "PENDING" }, { kind: "ACTIVE" }] as const) {
        const html = await render(locale, base({ next }), { experiment: { open: OPEN_ACTIVE, text: "x" } });
        const text = textOf(html);
        expect(text.indexOf(words.continueNote), next.kind).toBeGreaterThan(text.indexOf(words.continue));
        expect(text.indexOf(words.notNow), next.kind).toBeGreaterThan(text.indexOf(words.continueNote));
        expect(text.indexOf(words.next.title), next.kind).toBeLessThan(text.indexOf(words.continue));
      }
    });
  });

  describe("the decision", () => {
    it("has the continue form with one submit button, the one-way sentence after it, and then the Not now form", async () => {
      const html = await render(locale);
      const forms = Array.from(html.matchAll(/<form\b[^>]*>([^]*?)<\/form>/g), (match) => match[1]);
      expect(forms).toHaveLength(2);

      const [proceed, snooze] = forms;
      expect(count(proceed, /<button\b/g)).toBe(1);
      expect(proceed).toContain('type="submit"');
      expect(proceed).toContain(`>${esc(words.continue)}</button>`);
      expect(proceed).not.toContain("<input");
      expect(proceed).toContain(ui.primary);

      expect(html.indexOf(words.continueNote)).toBeGreaterThan(html.indexOf(proceed));
      expect(textOf(html)).toContain(words.continueNote);

      expect(count(snooze, /<button\b/g)).toBe(1);
      expect(snooze).toContain('type="submit"');
      expect(snooze).toContain(ui.secondary);
      expect(snooze).toContain(`>${words.notNow}</button>`);
      const hidden = /<input\b[^>]*>/.exec(snooze)?.[0] ?? "";
      expect(hidden).toContain('type="hidden"');
      expect(hidden).toContain('name="card"');
      expect(hidden).toContain('value="summary"');
      expect(html.indexOf(snooze)).toBeGreaterThan(html.indexOf(words.continueNote));
    });

    it("adds exactly one status note when a write failed, and none otherwise", async () => {
      const failed = await render(locale, base(), { failed: true });
      expect(count(failed, /role="status"/g)).toBe(1);
      expect(textOf(failed)).toContain(catalogs[locale].firstWeek.problem.save);
      expect(count(await render(locale), /role="status"/g)).toBe(0);
    });
  });

  describe("the voice", () => {
    const summaries: Array<[string, FirstWeekSummary]> = [
      ["enough", base()],
      ["little", base({ tone: "LITTLE" })],
      ["no meals", base({ tone: "NO_MEALS", did: [{ kind: "NO_MEALS" }], moment: { kind: "NONE" } })],
      ["with an observation and an offer", base({ noticed: { kind: "OBSERVATIONS", items: [{ kind: "LATE_EVENING_MEALS" }] }, next: { kind: "OFFER" } })],
      ["with a pending idea", base({ next: { kind: "PENDING" }, moment: { kind: "RETURNED" } })],
    ];

    it.each(summaries)("%s: no digit (the person's words excepted), no count, no score, no exclamation mark", async (_name, summary) => {
      const html = await render(locale, summary, { experiment: { open: null, text: null } });
      const text = visibleText(html);
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/%|day \d|of 15|מתוך|streak|score|!/i);
    });

    it("uses no emoji other than the hidden check glyph", async () => {
      const html = await render(locale, base({ did: [{ kind: "MEALS" }, { kind: "EXPERIMENT" }] }));
      expect(html.replace(/<span[^>]*aria-hidden="true"[^>]*>✓<\/span>/g, "")).not.toMatch(/\p{Extended_Pictographic}/u);
    });
  });
});
