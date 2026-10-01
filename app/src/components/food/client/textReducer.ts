import type { ProblemReason } from "@/domain/food/analyzeTypes";

/** The phases of the text screen (D3) and its processing state (D5). The text itself lives in the component. */
export type TextState =
  | { phase: "editing"; offline: boolean; restored: boolean }
  | { phase: "sending"; slow: boolean }
  | { phase: "problem"; reason: ProblemReason };

export type TextEvent =
  | { type: "DRAFT_RESTORED" }
  | { type: "SEND"; online: boolean }
  | { type: "SLOW" }
  | { type: "SUCCESS" }
  | { type: "FAIL"; reason: ProblemReason }
  | { type: "CANCEL" }
  | { type: "RETRY"; online: boolean }
  | { type: "ONLINE" }
  | { type: "EDIT" };

export const initialTextState: TextState = { phase: "editing", offline: false, restored: false };

const EDITING: TextState = { phase: "editing", offline: false, restored: false };
const EDITING_OFFLINE: TextState = { phase: "editing", offline: true, restored: false };

/** Same rule as the photo reducer: an event that does not apply returns the same state object. */
export function textReducer(state: TextState, event: TextEvent): TextState {
  switch (event.type) {
    case "DRAFT_RESTORED":
      return state.phase === "editing" && !state.restored ? { ...state, restored: true } : state;
    case "SEND":
      if (state.phase !== "editing") return state;
      if (!event.online) return state.offline ? state : { ...state, offline: true };
      return { phase: "sending", slow: false };
    case "SLOW":
      return state.phase === "sending" && !state.slow ? { phase: "sending", slow: true } : state;
    case "SUCCESS":
      return state;
    case "FAIL":
      return state.phase === "sending" ? { phase: "problem", reason: event.reason } : state;
    case "CANCEL":
      return state.phase === "sending" ? EDITING : state;
    case "RETRY":
      if (state.phase !== "problem") return state;
      return event.online ? { phase: "sending", slow: false } : EDITING_OFFLINE;
    case "ONLINE":
      return state.phase === "editing" && state.offline ? { ...state, offline: false } : state;
    case "EDIT":
      // Typing again takes the person back to editing and retires the "I brought it back" note.
      if (state.phase === "problem") return EDITING;
      if (state.phase === "editing" && state.restored) return { ...state, restored: false };
      return state;
  }
}
