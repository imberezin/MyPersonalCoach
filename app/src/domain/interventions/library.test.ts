import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { INTERVENTIONS, INTERVENTION_KEYS, INTERVENTION_RULES } from "./library";

const defs = Object.values(INTERVENTIONS);

describe("intervention library", () => {
  it("has the 11 approved interventions, each registered under its own key", () => {
    expect(INTERVENTION_KEYS).toHaveLength(11);
    expect(new Set(INTERVENTION_KEYS).size).toBe(11);
    for (const key of INTERVENTION_KEYS) expect(INTERVENTIONS[key].key).toBe(key);
  });

  it("no longer has a separate Next Bite; it is a variant of slow_down", () => {
    expect(INTERVENTION_KEYS).not.toContain("next_bite" as never);
    expect(INTERVENTIONS.slow_down.variants.map((v) => v.id)).toContain("notice_before_next_bite");
  });

  it("allows self_compassion_recovery only in RECOVERY mode", () => {
    const recovery = defs.filter((d) => d.mode === "RECOVERY");
    expect(recovery.map((d) => d.key)).toEqual(["self_compassion_recovery"]);
    expect(INTERVENTIONS.self_compassion_recovery.timing).toEqual(["RECOVERY"]);
  });

  it("runs environment only before a predicted risk context", () => {
    expect(INTERVENTIONS.environment.timing).toEqual(["PRE_CONTEXT"]);
    expect(INTERVENTIONS.environment.constraints).toContain("pre_context_only");
  });

  it("never lets micro_walk be a compensation", () => {
    expect(INTERVENTIONS.micro_walk.constraints).toEqual(
      expect.arrayContaining(["never_for_compensation", "never_link_to_calories", "never_as_punishment"]),
    );
  });

  it("only lets slow_down address true hunger while the user is already eating", () => {
    for (const variant of INTERVENTIONS.slow_down.variants) {
      if (variant.contexts?.includes("TRUE_HUNGER")) expect(variant.eatingPhase).toBe("DURING_EATING");
    }
  });

  it("stops check_hunger from following up when the answer is true hunger", () => {
    expect(INTERVENTIONS.check_hunger.constraints).toContain("no_followup_intervention_on_true_hunger");
    expect(INTERVENTIONS.check_hunger.eatingPhase).toBe("BEFORE_EATING");
  });

  it("treats ask_instead as a short question (level 1) that is not rated", () => {
    expect(INTERVENTIONS.ask_instead.levels).toEqual({ min: 1, max: 1 });
    expect(INTERVENTIONS.ask_instead.asksOutcome).toBe(false);
    expect(defs.filter((d) => !d.asksOutcome).map((d) => d.key)).toEqual(["ask_instead"]);
  });

  it("keeps variant contexts inside the intervention's contexts", () => {
    for (const def of defs) {
      for (const variant of def.variants) {
        for (const ctx of variant.contexts ?? []) expect(def.contexts).toContain(ctx);
      }
    }
  });

  it("has sane levels", () => {
    for (const def of defs) {
      expect(def.levels.min).toBeLessThanOrEqual(def.levels.max);
      expect([1, 2, 3]).toContain(def.levels.min);
      expect([1, 2, 3]).toContain(def.levels.max);
    }
  });

  it("keeps the approved engine rules", () => {
    expect(INTERVENTION_RULES).toEqual({
      dailyProactiveBudget: 1,
      cooldownAfterConsecutiveNotReally: 2,
      cooldownDays: 14,
    });
  });
});

describe("intervention wording", () => {
  const locales = { he, en } as const;

  for (const [locale, messages] of Object.entries(locales)) {
    it(`has approved wording for every variant in ${locale}`, () => {
      const texts = messages.interventions as Record<string, Record<string, string>>;
      for (const def of defs) {
        for (const variant of def.variants) {
          const text = texts[def.key]?.[variant.id];
          expect(text, `${locale}: interventions.${def.key}.${variant.id}`).toBeTruthy();
        }
      }
    });
  }

  it("passes every tunable parameter to the wording that uses it", () => {
    expect(he.interventions.delay.default).toContain("{delayMinutes}");
    expect(en.interventions.delay.default).toContain("{delayMinutes}");
    expect(INTERVENTIONS.delay.params.delayMinutes).toBe(10);
  });

  it("never uses shame, compensation or calorie language", () => {
    const forbidden = {
      he: ["נכשל", "הרסת", "מתחילים מחדש", "להתחיל מחדש", "פיצוי", "קלוריות", "לשרוף"],
      en: ["failed", "ruined", "start over", "compensat", "calorie", "burn"],
    };
    for (const [locale, words] of Object.entries(forbidden)) {
      const text = JSON.stringify(locales[locale as "he" | "en"]).toLowerCase();
      for (const word of words) expect(text, `${locale}: "${word}"`).not.toContain(word.toLowerCase());
    }
  });
});
