import { describe, expect, it } from "vitest";
import { initialTextState, textReducer, type TextEvent, type TextState } from "./textReducer";

const editing: TextState = { phase: "editing", offline: false, restored: false };
const restored: TextState = { phase: "editing", offline: false, restored: true };
const editingOffline: TextState = { phase: "editing", offline: true, restored: false };
const sending: TextState = { phase: "sending", slow: false };
const sendingSlow: TextState = { phase: "sending", slow: true };
const problem: TextState = { phase: "problem", reason: "rate_limited" };

const transitions: Array<[string, TextState, TextEvent, TextState]> = [
  ["editing: DRAFT_RESTORED shows the note", editing, { type: "DRAFT_RESTORED" }, restored],
  ["editing: SEND online sends", editing, { type: "SEND", online: true }, sending],
  ["editing: SEND offline stays editing and says so", editing, { type: "SEND", online: false }, editingOffline],
  ["editing (offline): ONLINE clears the line", editingOffline, { type: "ONLINE" }, editing],
  ["editing (restored): EDIT retires the note", restored, { type: "EDIT" }, editing],
  ["sending: SLOW adds the long-wait line", sending, { type: "SLOW" }, sendingSlow],
  ["sending: FAIL is a problem with the reason", sending, { type: "FAIL", reason: "ai_error" }, { phase: "problem", reason: "ai_error" }],
  ["sending: CANCEL returns to editing", sending, { type: "CANCEL" }, editing],
  ["sending (slow): CANCEL returns to editing", sendingSlow, { type: "CANCEL" }, editing],
  ["problem: RETRY online sends again", problem, { type: "RETRY", online: true }, sending],
  ["problem: RETRY offline goes back to editing, offline", problem, { type: "RETRY", online: false }, editingOffline],
  ["problem: EDIT goes back to editing", problem, { type: "EDIT" }, editing],
];

const ignored: Array<[string, TextState, TextEvent]> = [
  ["editing: DRAFT_RESTORED when already restored", restored, { type: "DRAFT_RESTORED" }],
  ["editing: SLOW", editing, { type: "SLOW" }],
  ["editing: FAIL (a late answer after Cancel)", editing, { type: "FAIL", reason: "network" }],
  ["editing: SUCCESS", editing, { type: "SUCCESS" }],
  ["editing: CANCEL (only valid while sending)", editing, { type: "CANCEL" }],
  ["editing: RETRY (only valid after a problem)", editing, { type: "RETRY", online: true }],
  ["editing: ONLINE when already online", editing, { type: "ONLINE" }],
  ["editing: EDIT with nothing to retire", editing, { type: "EDIT" }],
  ["editing (offline): SEND offline again", editingOffline, { type: "SEND", online: false }],
  ["editing (offline): EDIT keeps the offline line", editingOffline, { type: "EDIT" }],
  ["sending: SEND (a second tap)", sending, { type: "SEND", online: true }],
  ["sending: EDIT", sending, { type: "EDIT" }],
  ["sending: DRAFT_RESTORED", sending, { type: "DRAFT_RESTORED" }],
  ["sending: RETRY", sending, { type: "RETRY", online: true }],
  ["sending (slow): SLOW again", sendingSlow, { type: "SLOW" }],
  ["sending: SUCCESS leaves the screen as it is", sending, { type: "SUCCESS" }],
  ["problem: SEND", problem, { type: "SEND", online: true }],
  ["problem: FAIL again", problem, { type: "FAIL", reason: "network" }],
  ["problem: CANCEL", problem, { type: "CANCEL" }],
  ["problem: ONLINE", problem, { type: "ONLINE" }],
];

describe("textReducer", () => {
  it("starts in editing with nothing restored", () => {
    expect(initialTextState).toEqual(editing);
  });

  it.each(transitions)("%s", (_name, state, event, expected) => {
    expect(textReducer(state, event)).toEqual(expected);
  });

  it.each(ignored)("ignores %s and returns the same state object", (_name, state, event) => {
    expect(textReducer(state, event)).toBe(state);
  });

  it("ignores a late failure after Cancel", () => {
    const events: TextEvent[] = [{ type: "SEND", online: true }, { type: "CANCEL" }];
    const cancelled = events.reduce(textReducer, initialTextState);
    expect(cancelled).toEqual(editing);
    expect(textReducer(cancelled, { type: "FAIL", reason: "ai_error" })).toBe(cancelled);
  });
});
