import { describe, expect, it } from "vitest";
import { initialPhotoState, photoReducer, type PhotoEvent, type PhotoState } from "./photoReducer";

const idle: PhotoState = { phase: "idle", notice: "none" };
const idleUnreadable: PhotoState = { phase: "idle", notice: "unreadable" };
const preparing: PhotoState = { phase: "preparing" };
const ready: PhotoState = { phase: "ready", offline: false };
const readyOffline: PhotoState = { phase: "ready", offline: true };
const sending: PhotoState = { phase: "sending", slow: false };
const sendingSlow: PhotoState = { phase: "sending", slow: true };
const problem: PhotoState = { phase: "problem", reason: "ai_error" };

// The transition table of the photo screen (blueprint 2.4 and 6.3). Every row is [name, state, event, expected state].
const transitions: Array<[string, PhotoState, PhotoEvent, PhotoState]> = [
  ["idle: PICK starts preparing", idle, { type: "PICK" }, preparing],
  ["idle with a notice: PICK starts preparing", idleUnreadable, { type: "PICK" }, preparing],
  ["preparing: PREPARED is ready", preparing, { type: "PREPARED" }, ready],
  ["preparing: PREPARE_ERROR is idle with the calm notice", preparing, { type: "PREPARE_ERROR" }, idleUnreadable],
  ["ready: PICK prepares another photo", ready, { type: "PICK" }, preparing],
  ["ready: SEND online sends", ready, { type: "SEND", online: true }, sending],
  ["ready: SEND offline stays ready and says so", ready, { type: "SEND", online: false }, readyOffline],
  ["ready (offline): ONLINE clears the offline line", readyOffline, { type: "ONLINE" }, ready],
  ["ready (offline): SEND online sends", readyOffline, { type: "SEND", online: true }, sending],
  ["ready: RESET goes back to idle", ready, { type: "RESET" }, idle],
  ["sending: SLOW adds the long-wait line", sending, { type: "SLOW" }, sendingSlow],
  ["sending: FAIL is a problem with the reason", sending, { type: "FAIL", reason: "network" }, { phase: "problem", reason: "network" }],
  ["sending (slow): FAIL is a problem", sendingSlow, { type: "FAIL", reason: "daily_cap" }, { phase: "problem", reason: "daily_cap" }],
  ["sending: CANCEL returns to ready", sending, { type: "CANCEL" }, ready],
  ["sending (slow): CANCEL returns to ready", sendingSlow, { type: "CANCEL" }, ready],
  ["problem: RETRY online sends again", problem, { type: "RETRY", online: true }, sending],
  ["problem: RETRY offline goes back to ready, offline", problem, { type: "RETRY", online: false }, readyOffline],
  ["problem: PICK prepares another photo", problem, { type: "PICK" }, preparing],
  ["problem: RESET goes back to idle", problem, { type: "RESET" }, idle],
  ["idle with a notice: RESET clears the notice", idleUnreadable, { type: "RESET" }, idle],
];

// Events that do not apply must return the SAME object, so a late answer or a second tap moves nothing.
const ignored: Array<[string, PhotoState, PhotoEvent]> = [
  ["idle: PREPARED", idle, { type: "PREPARED" }],
  ["idle: SEND", idle, { type: "SEND", online: true }],
  ["idle: CANCEL", idle, { type: "CANCEL" }],
  ["idle: FAIL", idle, { type: "FAIL", reason: "ai_error" }],
  ["idle: RESET (nothing to clear)", idle, { type: "RESET" }],
  ["idle: ONLINE", idle, { type: "ONLINE" }],
  ["preparing: SEND", preparing, { type: "SEND", online: true }],
  ["preparing: PICK", preparing, { type: "PICK" }],
  ["preparing: CANCEL", preparing, { type: "CANCEL" }],
  ["ready: SLOW", ready, { type: "SLOW" }],
  ["ready: FAIL (a late answer after Cancel)", ready, { type: "FAIL", reason: "network" }],
  ["ready: SUCCESS", ready, { type: "SUCCESS" }],
  ["ready: CANCEL (only valid while sending)", ready, { type: "CANCEL" }],
  ["ready: RETRY (only valid after a problem)", ready, { type: "RETRY", online: true }],
  ["ready: ONLINE when already online", ready, { type: "ONLINE" }],
  ["ready (offline): SEND offline again", readyOffline, { type: "SEND", online: false }],
  ["sending: SEND (a second tap)", sending, { type: "SEND", online: true }],
  ["sending: PICK", sending, { type: "PICK" }],
  ["sending: RETRY", sending, { type: "RETRY", online: true }],
  ["sending (slow): SLOW again", sendingSlow, { type: "SLOW" }],
  ["sending: SUCCESS leaves the screen as it is", sending, { type: "SUCCESS" }],
  ["problem: SEND", problem, { type: "SEND", online: true }],
  ["problem: SLOW", problem, { type: "SLOW" }],
  ["problem: FAIL again", problem, { type: "FAIL", reason: "network" }],
  ["problem: CANCEL", problem, { type: "CANCEL" }],
];

describe("photoReducer", () => {
  it("starts idle with no notice", () => {
    expect(initialPhotoState).toEqual(idle);
  });

  it.each(transitions)("%s", (_name, state, event, expected) => {
    expect(photoReducer(state, event)).toEqual(expected);
  });

  it.each(ignored)("ignores %s and returns the same state object", (_name, state, event) => {
    expect(photoReducer(state, event)).toBe(state);
  });

  it("runs a whole report: pick, prepare, send, slow, fail, retry", () => {
    const events: PhotoEvent[] = [
      { type: "PICK" },
      { type: "PREPARED" },
      { type: "SEND", online: true },
      { type: "SLOW" },
      { type: "FAIL", reason: "network" },
      { type: "RETRY", online: true },
    ];
    expect(events.reduce(photoReducer, initialPhotoState)).toEqual(sending);
  });

  it("ignores a late failure after Cancel", () => {
    const events: PhotoEvent[] = [{ type: "PICK" }, { type: "PREPARED" }, { type: "SEND", online: true }, { type: "CANCEL" }];
    const cancelled = events.reduce(photoReducer, initialPhotoState);
    expect(cancelled).toEqual(ready);
    expect(photoReducer(cancelled, { type: "FAIL", reason: "ai_error" })).toBe(cancelled);
  });
});
