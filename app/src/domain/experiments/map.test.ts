import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { INTERVENTIONS } from "../interventions/library";
import { LATE_EVENING, type PatternKind } from "../patterns/types";
import { PATTERN_EXPERIMENT_MAP } from "./map";

const kinds: readonly PatternKind[] = [LATE_EVENING.kind];
const entries = Object.entries(PATTERN_EXPERIMENT_MAP);

type Catalog = { interventions: Record<string, Record<string, string>> };

describe("PATTERN_EXPERIMENT_MAP", () => {
  it("has an entry for every pattern kind, and nothing else", () => {
    expect(Object.keys(PATTERN_EXPERIMENT_MAP).sort()).toEqual([...kinds].sort());
  });

  it.each(entries)("%s names an existing library key and one of its variant ids", (_kind, entry) => {
    const def = INTERVENTIONS[entry.key];
    expect(def).toBeDefined();
    expect(def.variants.map((v) => v.id)).toContain(entry.variantId);
  });

  it.each(entries)("%s maps to a NORMAL-mode intervention that is not a recovery one", (_kind, entry) => {
    const def = INTERVENTIONS[entry.key];
    expect(def.mode).toBe("NORMAL");
    expect(def.timing).not.toContain("RECOVERY");
  });

  it.each(entries)("%s has its approved text in both catalogs", (_kind, entry) => {
    for (const catalog of [en, he] as unknown as Catalog[]) {
      const text = catalog.interventions[entry.key]?.[entry.variantId];
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("proposes eat_intentionally / default / next_meal for late-evening meals (the owner-approvable default)", () => {
    expect(PATTERN_EXPERIMENT_MAP.late_evening_meals).toEqual({ key: "eat_intentionally", variantId: "default", scope: "next_meal" });
  });

  it("carries no digit in the approved text (the wording validator would then allow no number at all)", () => {
    const { key, variantId } = PATTERN_EXPERIMENT_MAP.late_evening_meals;
    for (const catalog of [en, he] as unknown as Catalog[]) expect(catalog.interventions[key][variantId]).not.toMatch(/\d/);
  });
});
