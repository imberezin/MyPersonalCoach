import type { ProblemReason } from "@/domain/food/analyzeTypes";

/** The phases of the photo screen (D2) and its processing state (D5). The photo itself lives in the component. */
export type PhotoState =
  | { phase: "idle"; notice: "none" | "unreadable" }
  | { phase: "preparing" }
  | { phase: "ready"; offline: boolean }
  | { phase: "sending"; slow: boolean }
  | { phase: "problem"; reason: ProblemReason };

export type PhotoEvent =
  | { type: "PICK" }
  | { type: "PREPARED" }
  | { type: "PREPARE_ERROR" }
  | { type: "SEND"; online: boolean }
  | { type: "SLOW" }
  | { type: "SUCCESS" }
  | { type: "FAIL"; reason: ProblemReason }
  | { type: "CANCEL" }
  | { type: "RETRY"; online: boolean }
  | { type: "RESET" }
  | { type: "ONLINE" };

export const initialPhotoState: PhotoState = { phase: "idle", notice: "none" };

const IDLE: PhotoState = { phase: "idle", notice: "none" };
const READY: PhotoState = { phase: "ready", offline: false };
const READY_OFFLINE: PhotoState = { phase: "ready", offline: true };
const PREPARING: PhotoState = { phase: "preparing" };

/**
 * Events that do not apply in the current phase return the SAME state object, so a late answer (a FAIL
 * after Cancel, a second tap on Send) can never move the screen.
 */
export function photoReducer(state: PhotoState, event: PhotoEvent): PhotoState {
  switch (event.type) {
    case "PICK":
      return state.phase === "idle" || state.phase === "ready" || state.phase === "problem" ? PREPARING : state;
    case "PREPARED":
      return state.phase === "preparing" ? READY : state;
    case "PREPARE_ERROR":
      return state.phase === "preparing" ? { phase: "idle", notice: "unreadable" } : state;
    case "SEND":
      if (state.phase !== "ready") return state;
      if (!event.online) return state.offline ? state : READY_OFFLINE;
      return { phase: "sending", slow: false };
    case "SLOW":
      return state.phase === "sending" && !state.slow ? { phase: "sending", slow: true } : state;
    case "SUCCESS":
      // Navigation happens next; the screen stays as it is until the new page replaces it.
      return state;
    case "FAIL":
      return state.phase === "sending" ? { phase: "problem", reason: event.reason } : state;
    case "CANCEL":
      return state.phase === "sending" ? READY : state;
    case "RETRY":
      if (state.phase !== "problem") return state;
      return event.online ? { phase: "sending", slow: false } : READY_OFFLINE;
    case "RESET":
      return state.phase === "idle" && state.notice === "none" ? state : IDLE;
    case "ONLINE":
      return state.phase === "ready" && state.offline ? READY : state;
  }
}
