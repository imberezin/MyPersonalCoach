import { describe, expect, it } from "vitest";
import { WEEKLY_LINE_FORBIDDEN, WEEKLY_LINE_LIMITS, weeklyLineExtraOk } from "./extra";

const HE = "עוד חלק קטן נכנס לתמונה של מה שמתאים לך.";
const EN = "One more small piece fell into the picture of what suits you.";

describe("weeklyLineExtraOk", () => {
  it("accepts the approved sentence itself and a reword of one tone word", () => {
    expect(weeklyLineExtraOk({ candidate: HE, approved: HE })).toBe(true);
    expect(weeklyLineExtraOk({ candidate: EN, approved: EN })).toBe(true);
    expect(weeklyLineExtraOk({ candidate: "One more small piece fell into the picture of what suits you, gently.", approved: EN })).toBe(true);
  });

  it("the limits are pinned (tighter than the shared ones)", () => {
    expect(WEEKLY_LINE_LIMITS).toEqual({ maxNewTokens: 1, minTokenOverlap: 0.85 });
  });

  it("neither approved sentence contains a forbidden entry (the catalog text can never be rejected)", () => {
    for (const [text, entries] of [
      [HE, WEEKLY_LINE_FORBIDDEN.he],
      [EN.toLowerCase(), WEEKLY_LINE_FORBIDDEN.en],
    ] as const) {
      const padded = ` ${text.replace(/[.,]/g, "")} `;
      for (const entry of entries) expect(padded.includes(` ${entry} `), entry).toBe(false);
    }
  });

  it("a Hebrew clitic does not hide a forbidden word (ו, ה, ב in front)", () => {
    for (const word of ["וירדת", "והשמנה", "וההשמנה", "בקילוגרמים", "ובהצלחה", "והצלחת"]) {
      expect(weeklyLineExtraOk({ candidate: `${HE.slice(0, -1)}, ${word}.`, approved: HE }), word).toBe(false);
    }
  });

  it("an English forbidden word is rejected in a Hebrew line and the reverse, in any letter case", () => {
    expect(weeklyLineExtraOk({ candidate: `${HE.slice(0, -1)}, KG.`, approved: HE })).toBe(false);
    expect(weeklyLineExtraOk({ candidate: `${EN.slice(0, -1)}, Well Done.`, approved: EN })).toBe(false);
  });

  it("a phrase entry needs its words next to each other", () => {
    expect(weeklyLineExtraOk({ candidate: `${EN.slice(0, -1)}, keep it up.`, approved: EN })).toBe(false);
    expect(weeklyLineExtraOk({ candidate: `${EN.slice(0, -1)}, keep it.`, approved: EN })).toBe(true);
  });

  it("never throws on odd input", () => {
    expect(weeklyLineExtraOk({ candidate: "", approved: "" })).toBe(true);
    expect(weeklyLineExtraOk({ candidate: undefined as unknown as string, approved: EN })).toBe(false);
  });
});
