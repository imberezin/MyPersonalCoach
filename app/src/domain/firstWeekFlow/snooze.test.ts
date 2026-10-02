import { describe, expect, it } from "vitest";
import { activeSnoozes } from "./snooze";
import { FIRST_WEEK_SNOOZE, NOT_SNOOZED } from "./types";

const NOW = new Date("2027-01-12T10:00:00Z");
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("activeSnoozes", () => {
  it("has no snooze without events", () => {
    expect(activeSnoozes({ events: [], now: NOW })).toEqual(NOT_SNOOZED);
  });

  it("snoozes the summary for an event of that card one hour old", () => {
    expect(activeSnoozes({ events: [{ card: "summary", occurredAt: ago(HOUR) }], now: NOW })).toEqual({
      summary: true,
      welcomeBack: false,
    });
  });

  it("snoozes the welcome-back card on its own", () => {
    expect(activeSnoozes({ events: [{ card: "welcome_back", occurredAt: ago(HOUR) }], now: NOW })).toEqual({
      summary: false,
      welcomeBack: true,
    });
  });

  it("snoozes both when there is one event for each", () => {
    const events = [
      { card: "summary", occurredAt: ago(2 * HOUR) },
      { card: "welcome_back", occurredAt: ago(5 * HOUR) },
    ];
    expect(activeSnoozes({ events, now: NOW })).toEqual({ summary: true, welcomeBack: true });
  });

  it("expires an event exactly `hours` old (the window is open at that end) and keeps one a millisecond younger", () => {
    const window = FIRST_WEEK_SNOOZE.hours * HOUR;
    expect(activeSnoozes({ events: [{ card: "summary", occurredAt: ago(window) }], now: NOW }).summary).toBe(false);
    expect(activeSnoozes({ events: [{ card: "summary", occurredAt: ago(window - 1) }], now: NOW }).summary).toBe(true);
    expect(activeSnoozes({ events: [{ card: "summary", occurredAt: ago(window + 1) }], now: NOW }).summary).toBe(false);
  });

  it("counts an event at exactly `now` and ignores one in the future", () => {
    expect(activeSnoozes({ events: [{ card: "summary", occurredAt: NOW }], now: NOW }).summary).toBe(true);
    expect(activeSnoozes({ events: [{ card: "summary", occurredAt: new Date(NOW.getTime() + 1) }], now: NOW }).summary).toBe(false);
  });

  it("ignores an unknown card, a missing card, a non-string card and an invalid date", () => {
    const events: { card: unknown; occurredAt: Date }[] = [
      { card: "other", occurredAt: ago(HOUR) },
      { card: undefined, occurredAt: ago(HOUR) },
      { card: null, occurredAt: ago(HOUR) },
      { card: 7, occurredAt: ago(HOUR) },
      { card: ["summary"], occurredAt: ago(HOUR) },
      { card: "Summary", occurredAt: ago(HOUR) },
      { card: "summary", occurredAt: new Date("nope") },
      { card: "welcome_back", occurredAt: "yesterday" as unknown as Date },
    ];
    expect(activeSnoozes({ events, now: NOW })).toEqual(NOT_SNOOZED);
  });

  it("is not snoozed for any card when `now` is invalid", () => {
    expect(activeSnoozes({ events: [{ card: "summary", occurredAt: ago(HOUR) }], now: new Date("nope") })).toEqual(NOT_SNOOZED);
  });

  it("does not mutate its input and returns a fresh object", () => {
    const events = [{ card: "summary", occurredAt: ago(HOUR) }];
    const copy = structuredClone(events);
    const result = activeSnoozes({ events, now: NOW });
    expect(events).toEqual(copy);
    expect(result).not.toBe(NOT_SNOOZED);
    expect(activeSnoozes({ events: [], now: NOW })).not.toBe(NOT_SNOOZED);
  });

  it("names exactly the two cards of the form contract", () => {
    expect(FIRST_WEEK_SNOOZE.cards).toEqual(["summary", "welcome_back"]);
    expect(FIRST_WEEK_SNOOZE.hours).toBe(24);
  });
});
