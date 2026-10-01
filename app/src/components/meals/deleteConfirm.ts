/** The inline "are you sure" of a meal: closed, or asking. It lives in the browser only; a reload closes it, and nothing was sent. */
export type DeleteConfirmState = { phase: "closed" } | { phase: "confirming" };

export type DeleteConfirmEvent = { type: "ASK" } | { type: "KEEP" };

export const initialDeleteConfirm: DeleteConfirmState = { phase: "closed" };

const CONFIRMING: DeleteConfirmState = { phase: "confirming" };

/** An event that does not apply returns the SAME state object, so React skips the render. */
export function deleteConfirmReducer(state: DeleteConfirmState, event: DeleteConfirmEvent): DeleteConfirmState {
  switch (event.type) {
    case "ASK":
      return state.phase === "closed" ? CONFIRMING : state;
    case "KEEP":
      return state.phase === "confirming" ? initialDeleteConfirm : state;
  }
}

/** Where focus goes AFTER the state changed: asking moves it to the panel's heading, keeping returns it to the trigger. */
export function focusTargetFor(event: DeleteConfirmEvent): "panel" | "trigger" {
  return event.type === "ASK" ? "panel" : "trigger";
}

/** Esc closes the panel only while no delete is in flight, so a second submit cannot follow a closed and reopened panel. */
export function escapeKeeps(key: string, pending: boolean): boolean {
  return key === "Escape" && !pending;
}
