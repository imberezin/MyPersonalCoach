import { describe, expect, it } from "vitest";
import { deleteConfirmReducer, escapeKeeps, focusTargetFor, initialDeleteConfirm, type DeleteConfirmState } from "./deleteConfirm";

const CONFIRMING: DeleteConfirmState = { phase: "confirming" };

describe("deleteConfirmReducer", () => {
  it("starts closed", () => {
    expect(initialDeleteConfirm).toEqual({ phase: "closed" });
  });

  it("opens the question on ASK", () => {
    expect(deleteConfirmReducer(initialDeleteConfirm, { type: "ASK" })).toEqual({ phase: "confirming" });
  });

  it("closes it on KEEP", () => {
    expect(deleteConfirmReducer(CONFIRMING, { type: "KEEP" })).toEqual({ phase: "closed" });
  });

  it("returns the SAME state object for an event that does not apply, so nothing re-renders", () => {
    const asked = deleteConfirmReducer(initialDeleteConfirm, { type: "ASK" });
    expect(deleteConfirmReducer(asked, { type: "ASK" })).toBe(asked);
    expect(deleteConfirmReducer(initialDeleteConfirm, { type: "KEEP" })).toBe(initialDeleteConfirm);
  });

  it("has no state that means 'deleting': the server answers with a redirect, and the page is new", () => {
    const phases = new Set<string>();
    let state: DeleteConfirmState = initialDeleteConfirm;
    for (const event of [{ type: "ASK" }, { type: "KEEP" }, { type: "ASK" }] as const) {
      state = deleteConfirmReducer(state, event);
      phases.add(state.phase);
    }
    expect([...phases].sort()).toEqual(["closed", "confirming"]);
  });
});

describe("focusTargetFor", () => {
  it("sends focus to the panel when it opens and back to the trigger when it closes", () => {
    expect(focusTargetFor({ type: "ASK" })).toBe("panel");
    expect(focusTargetFor({ type: "KEEP" })).toBe("trigger");
  });
});

describe("escapeKeeps", () => {
  it("keeps the meal on Escape while nothing is in flight", () => {
    expect(escapeKeeps("Escape", false)).toBe(true);
  });

  it("ignores Escape while a delete is in flight (a closed and reopened panel could submit twice)", () => {
    expect(escapeKeeps("Escape", true)).toBe(false);
  });

  it("ignores every other key", () => {
    for (const key of ["Enter", " ", "Tab", "Esc", "escape", "a"]) {
      expect(escapeKeeps(key, false), key).toBe(false);
      expect(escapeKeeps(key, true), key).toBe(false);
    }
  });
});
