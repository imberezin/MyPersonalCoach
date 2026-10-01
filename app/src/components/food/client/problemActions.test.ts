import { describe, expect, it } from "vitest";
import { PROBLEM_REASONS, type ProblemReason } from "@/domain/food/analyzeTypes";
import { PHOTO_BODY_REASONS, problemActionsFor, type ProblemAction, type ProblemFlow } from "./problemActions";

// Display order: the first action is the primary button.
const expected: Array<[ProblemReason, ProblemFlow, ProblemAction[]]> = [
  ["ai_unavailable", "text", ["saveAsWritten"]],
  ["ai_unavailable", "photo", ["writeInstead"]],
  ["daily_cap", "text", ["saveAsWritten"]],
  ["daily_cap", "photo", ["writeInstead"]],
  ["rate_limited", "text", ["retry", "saveAsWritten"]],
  ["rate_limited", "photo", ["retry", "writeInstead"]],
  ["ai_error", "text", ["retry", "saveAsWritten"]],
  ["ai_error", "photo", ["retry", "writeInstead"]],
  ["nothing_found", "text", ["retry"]],
  ["nothing_found", "photo", ["retry", "writeInstead"]],
  ["not_signed_in", "text", ["signIn"]],
  ["not_signed_in", "photo", ["signIn"]],
  ["invalid_input", "text", ["retry"]],
  ["invalid_input", "photo", ["retry"]],
  ["too_large", "photo", ["writeInstead"]],
  ["unsupported_type", "photo", ["writeInstead"]],
  ["save_error", "text", ["retry", "goHome"]],
  ["save_error", "photo", ["retry", "goHome"]],
  ["network", "text", ["checkPending", "retry"]],
  ["network", "photo", ["checkPending", "retry"]],
  ["network", "manual", ["checkPending", "retry"]],
];

describe("problemActionsFor", () => {
  it.each(expected)("%s in the %s flow offers %j", (reason, flow, actions) => {
    expect(problemActionsFor(reason, flow)).toEqual(actions);
  });

  it("puts Check before Try again after a dropped connection (the report may already have arrived)", () => {
    for (const flow of ["photo", "text", "manual"] as const) {
      expect(problemActionsFor("network", flow).slice(0, 2)).toEqual(["checkPending", "retry"]);
    }
  });

  it("has an entry for every reason in every flow, never an empty one, and no duplicates", () => {
    for (const reason of PROBLEM_REASONS) {
      for (const flow of ["photo", "text", "manual"] as const) {
        const actions = problemActionsFor(reason, flow);
        expect(actions.length, `${reason}/${flow}`).toBeGreaterThan(0);
        expect(new Set(actions).size, `${reason}/${flow}`).toBe(actions.length);
      }
    }
  });

  it("has no entry for quiet_time: it is not a problem reason", () => {
    expect(PROBLEM_REASONS).not.toContain("quiet_time");
  });

  it("never offers 'keep it as I wrote it' to a photo, which has no written words", () => {
    for (const reason of PROBLEM_REASONS) expect(problemActionsFor(reason, "photo")).not.toContain("saveAsWritten");
  });

  it("never offers 'keep it as I wrote it' or 'write instead' in the manual flow, which already is the list", () => {
    for (const reason of PROBLEM_REASONS) {
      const actions = problemActionsFor(reason, "manual");
      expect(actions).not.toContain("saveAsWritten");
      expect(actions).not.toContain("writeInstead");
      expect(actions.length).toBeGreaterThan(0);
    }
  });

  it("gives the photo body only to the three reasons that offer keeping the written words", () => {
    expect([...PHOTO_BODY_REASONS].sort()).toEqual(["ai_unavailable", "daily_cap", "rate_limited"]);
  });
});
