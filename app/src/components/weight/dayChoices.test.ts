import { describe, expect, it } from "vitest";
import { createTranslator } from "use-intl/core";
import { dayOptions, formatDayKeyLabel } from "@/domain/weight";
import { buildDayChoices } from "./dayChoices";
import { LOCALES, catalogs } from "./weightTestKit";

const ZONE = "Asia/Jerusalem";
const NOW = new Date("2026-10-01T09:30:00Z");

describe.each(LOCALES)("buildDayChoices in %s", (locale) => {
  const words = catalogs[locale].weight;
  const translate = createTranslator({ locale, messages: catalogs[locale] as never, namespace: "weight" as never, timeZone: "UTC" });
  const t = (key: string) => translate(key as never);
  const build = (options: ReturnType<typeof dayOptions>, currentYear = "2026") => buildDayChoices({ options, t, locale, timeZone: ZONE, currentYear });

  it("names 'now' and yesterday from the catalog and every other day by its weekday and date, in the same order the domain gave", () => {
    const options = dayOptions({ now: NOW, timeZone: ZONE });
    const choices = build(options);
    expect(choices.map((choice) => choice.value)).toEqual(options.map((option) => option.value));
    expect(choices[0].label).toBe(words.form.dayNow);
    expect(choices[1].label).toBe(words.form.dayYesterday);
    expect(choices[2].label).toBe(formatDayKeyLabel("2026-09-29", locale, ZONE, false));
    expect(choices.map((choice) => choice.label)).toHaveLength(15);
  });

  it("names 'keep' as 'As saved' in edit mode", () => {
    const choices = build(dayOptions({ now: NOW, timeZone: ZONE, currentMeasuredAt: new Date("2026-09-29T09:00:00Z") }));
    expect(choices[0]).toEqual({ value: "keep", label: words.form.dayKeep });
  });

  it("gives a day of another year its year, and only that", () => {
    const choices = build(dayOptions({ now: new Date("2027-01-03T09:30:00Z"), timeZone: ZONE }), "2027");
    expect(choices.find((c) => c.value === "2026-12-30")?.label).toContain("2026");
    expect(choices.find((c) => c.value === "2027-01-01")?.label).not.toContain("2027");
  });

  it("gives an old entry's own day its year in edit mode", () => {
    const choices = build(dayOptions({ now: NOW, timeZone: ZONE, currentMeasuredAt: new Date("2025-06-10T09:00:00Z") }));
    expect(choices.at(-1)?.value).toBe("2025-06-10");
    expect(choices.at(-1)?.label).toContain("2025");
  });

  it("gives every day a different label", () => {
    const choices = build(dayOptions({ now: NOW, timeZone: ZONE }));
    expect(new Set(choices.map((choice) => choice.label)).size).toBe(choices.length);
  });
});
