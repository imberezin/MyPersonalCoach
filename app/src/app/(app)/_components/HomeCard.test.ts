import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, type AbstractIntlMessages } from "use-intl/core";
import { describe, expect, it } from "vitest";
import type { HomeDecision, HomeState } from "@/domain/home";
import { DEFAULT_TIME_ZONE } from "@/i18n/config";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import type { Translator } from "@/i18n/server";
import { HomeCard } from "./HomeCard";
import { homeCopyFor, type HomeCopy } from "./homeCopy";

const copy = (over: Partial<HomeCopy> = {}): HomeCopy => ({
  emoji: "🕯️",
  title: "A title",
  lead: null,
  body: "A sentence.",
  invitation: null,
  earlySignal: null,
  degradedNote: null,
  ...over,
});

const render = (props: Parameters<typeof HomeCard>[0]) => renderToStaticMarkup(createElement(HomeCard, props));
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

describe("HomeCard", () => {
  it("has exactly one h1, and the section is named by it", () => {
    const html = render({ copy: copy(), action: null });
    expect(count(html, /<h1[\s>]/g)).toBe(1);

    const labelledBy = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`<h1 id="${labelledBy}"`);
  });

  it("hides the emoji from assistive technology, and renders none when there is none", () => {
    expect(render({ copy: copy(), action: null })).toMatch(/<span[^>]*aria-hidden="true"[^>]*>🕯️<\/span>/);
    expect(render({ copy: copy({ emoji: null }), action: null })).not.toContain("<span");
  });

  it("renders no button when there is no action", () => {
    expect(render({ copy: copy(), action: null })).not.toContain("<button");
  });

  it("renders the invitation's lead with the action under it", () => {
    const action = createElement("button", { type: "button" }, "The cta");
    const html = render({ copy: copy({ invitation: { lead: "The lead", cta: "The cta", snoozeLabel: null } }), action });
    expect(html).toContain("The lead");
    expect(count(html, /<button/g)).toBe(1);
    expect(html.indexOf("The lead")).toBeLessThan(html.indexOf("<button"));
  });

  it("renders an action that has no invitation (the Early Signal answers) in the same place, with no sentence above it", () => {
    const action = createElement("div", { role: "group" }, createElement("button", { type: "button" }, "An answer"));
    const html = render({ copy: copy({ invitation: null }), action });
    expect(count(html, /<button/g)).toBe(1);
    expect(count(html, /<p[\s>]/g)).toBe(1);
    expect(html.indexOf("A sentence.")).toBeLessThan(html.indexOf("<button"));
  });

  it("renders an opening line between the title and the body, and none when there is none", () => {
    const html = render({ copy: copy({ lead: "The opening line" }), action: null });
    expect(html).toContain("The opening line");
    expect(html.indexOf("A title")).toBeLessThan(html.indexOf("The opening line"));
    expect(html.indexOf("The opening line")).toBeLessThan(html.indexOf("A sentence."));
    expect(count(render({ copy: copy(), action: null }), /<p[\s>]/g)).toBe(1);
  });

  it("renders the button without a sentence above it when the invitation has no lead", () => {
    const action = createElement("button", { type: "button" }, "The cta");
    const html = render({ copy: copy({ invitation: { lead: null, cta: "The cta", snoozeLabel: null } }), action });
    expect(count(html, /<p[\s>]/g)).toBe(1);
    expect(count(html, /<button/g)).toBe(1);
  });

  it("puts the degraded note in a status region, and only when there is one", () => {
    expect(render({ copy: copy(), action: null })).not.toContain('role="status"');
    expect(render({ copy: copy({ degradedNote: "Some of it did not load." }), action: null })).toMatch(
      /<p[^>]*role="status"[^>]*>Some of it did not load\.<\/p>/,
    );
  });

  // The real words, rendered: Home never shows a score, a percentage or a day number.
  describe.each([
    ["he", he],
    ["en", en],
  ] as const)("with the %s catalog", (locale, messages) => {
    const created = createTranslator({
      locale,
      messages: messages as AbstractIntlMessages,
      namespace: "home",
      timeZone: DEFAULT_TIME_ZONE,
    });
    const t: Translator = (key, values) => created(key as never, values as never);
    const states: HomeState[] = [
      { key: "MORNING" },
      { key: "EVENING" },
      { key: "BEFORE_SHABBAT", candleLighting: new Date("2027-01-08T14:10:00Z") },
      { key: "MOTZEI_SHABBAT", havdalah: new Date("2027-01-09T15:25:00Z") },
      { key: "FIRST_WEEK_START" },
      { key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: true },
      { key: "FIRST_WEEK_SUMMARY_READY", hadEnoughData: false },
      { key: "FIRST_WEEK_WELCOME_BACK" },
      { key: "EARLY_SIGNAL", signal: "late_evening_meals" },
      { key: "SILENCE", reason: "NOTHING_TO_SAY" },
      { key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "SHABBAT" },
      { key: "SILENCE", reason: "OFFLINE_PERIOD", periodType: "HOLIDAY" },
    ];

    it("renders one heading and no counters in any state", () => {
      for (const state of states) {
        const decision: HomeDecision = {
          state,
          action: { kind: "OPEN_REPORT_SHEET", reason: "FIRST_REPORT" },
          degraded: true,
        };
        const html = render({ copy: homeCopyFor(decision, t, { locale, timeZone: "Asia/Jerusalem" }), action: null });
        expect(count(html, /<h1[\s>]/g), state.key).toBe(1);
        expect(html, state.key).not.toMatch(/\d+\s*%|score|day \d+/i);
      }
    });
  });
});
