import { describe, expect, it } from "vitest";
import { activeSnoozes, experimentCardSnoozed } from "./snooze";
import { FIRST_WEEK_SNOOZE, NOT_SNOOZED } from "./types";

// Jerusalem is UTC+2 in January: 12:00 UTC is 14:00 local, and local midnight is 22:00 UTC the evening before.
const TZ = "Asia/Jerusalem";
const NOW = new Date("2027-01-12T10:00:00Z"); // Tuesday 12:00 local
const LOCAL_MIDNIGHT = new Date("2027-01-11T22:00:00Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const press = (at: Date) => ({ card: "experiment" as unknown, occurredAt: at });
const pressOf = (at: Date, card: unknown) => ({ card, occurredAt: at });

describe("experimentCardSnoozed", () => {
  it("is not snoozed without events", () => {
    expect(experimentCardSnoozed({ events: [], now: NOW, timeZone: TZ })).toBe(false);
  });

  it("is snoozed by a Thanks earlier the same local day, from one minute ago to the first minute of the day", () => {
    for (const at of [new Date(NOW.getTime() - MINUTE), new Date(NOW.getTime() - 5 * HOUR), new Date(LOCAL_MIDNIGHT.getTime() + MINUTE), NOW]) {
      expect(experimentCardSnoozed({ events: [press(at)], now: NOW, timeZone: TZ }), at.toISOString()).toBe(true);
    }
  });

  it("lasts to local midnight, not for 24 hours: an event of yesterday evening no longer hides the card", () => {
    const lastNight = new Date("2027-01-11T21:59:59Z"); // 23:59:59 local, a few hours before NOW
    expect(NOW.getTime() - lastNight.getTime()).toBeLessThan(FIRST_WEEK_SNOOZE.hours * HOUR);
    expect(experimentCardSnoozed({ events: [press(lastNight)], now: NOW, timeZone: TZ })).toBe(false);
  });

  it("starts the new day exactly at local midnight (the event at midnight belongs to the new day)", () => {
    expect(experimentCardSnoozed({ events: [press(LOCAL_MIDNIGHT)], now: NOW, timeZone: TZ })).toBe(true);
    expect(experimentCardSnoozed({ events: [press(new Date(LOCAL_MIDNIGHT.getTime() - 1))], now: NOW, timeZone: TZ })).toBe(false);
  });

  it("follows the person's zone, not UTC: the same instants fall on different days in another zone", () => {
    const event = press(new Date("2027-01-12T00:30:00Z")); // 02:30 on the 12th in Jerusalem, 00:30 on the 12th in UTC
    expect(experimentCardSnoozed({ events: [event], now: NOW, timeZone: TZ })).toBe(true);
    // In New York it is the evening of the 11th: a different local day from NOW (05:00 on the 12th).
    expect(experimentCardSnoozed({ events: [event], now: NOW, timeZone: "America/New_York" })).toBe(false);
  });

  it("ignores a press in the future", () => {
    expect(experimentCardSnoozed({ events: [press(new Date(NOW.getTime() + 1))], now: NOW, timeZone: TZ })).toBe(false);
  });

  it("is only for the experiment card: the First Week's cards, an unknown, a missing or a non-string card are ignored", () => {
    const at = new Date(NOW.getTime() - HOUR);
    const events = [
      pressOf(at, "summary"),
      pressOf(at, "welcome_back"),
      pressOf(at, "Experiment"),
      pressOf(at, "experiment "),
      pressOf(at, undefined),
      pressOf(at, null),
      pressOf(at, 7),
      pressOf(at, ["experiment"]),
    ];
    expect(experimentCardSnoozed({ events, now: NOW, timeZone: TZ })).toBe(false);
  });

  it("ignores an invalid date and a non-Date, and keeps looking at the rest", () => {
    const events = [press(new Date("nope")), { card: "experiment", occurredAt: "today" as unknown as Date }, press(new Date(NOW.getTime() - HOUR))];
    expect(experimentCardSnoozed({ events: events.slice(0, 2), now: NOW, timeZone: TZ })).toBe(false);
    expect(experimentCardSnoozed({ events, now: NOW, timeZone: TZ })).toBe(true);
  });

  it("is not snoozed when `now` is invalid, and does not throw for a garbage zone (Jerusalem is used)", () => {
    expect(experimentCardSnoozed({ events: [press(NOW)], now: new Date("nope"), timeZone: TZ })).toBe(false);
    expect(experimentCardSnoozed({ events: [press(new Date(NOW.getTime() - HOUR))], now: NOW, timeZone: "Not/AZone" })).toBe(true);
  });

  it("does not mutate its input", () => {
    const events = [press(new Date(NOW.getTime() - HOUR))];
    const copy = structuredClone(events);
    experimentCardSnoozed({ events, now: NOW, timeZone: TZ });
    expect(events).toEqual(copy);
  });

  it("never hides a First Week card, and the First Week reader never sees this one", () => {
    const events = [press(new Date(NOW.getTime() - HOUR))];
    expect(activeSnoozes({ events, now: NOW })).toEqual(NOT_SNOOZED);
  });
});

describe("the experiment card's place in the snooze contract", () => {
  it("rides the First Week's event and field, and is not one of its two cards", () => {
    expect(FIRST_WEEK_SNOOZE.experimentCard).toBe("experiment");
    expect(FIRST_WEEK_SNOOZE.cards).not.toContain(FIRST_WEEK_SNOOZE.experimentCard);
    expect(FIRST_WEEK_SNOOZE.event).toBe("first_week_card_snoozed");
    expect(FIRST_WEEK_SNOOZE.field).toBe("card");
  });
});
