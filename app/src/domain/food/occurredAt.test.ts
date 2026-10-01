import { describe, expect, it } from "vitest";
import { OCCURRED_AT_LIMITS, checkOccurredAt, instantFromDayAndTime, localDayAndTime, proposeMeal } from "./occurredAt";

const TZ = "Asia/Jerusalem";
const MIN = 60_000;
const HOUR = 3_600_000;

// 12:30 in Jerusalem (UTC+2 in winter).
const WINTER_NOON = new Date("2027-01-12T10:30:00Z");

const noHints = { mealTypeHint: null, timeHint: null };

describe("proposeMeal", () => {
  it("with no hints gives now and the type the clock says", () => {
    const meal = proposeMeal(noHints, { now: WINTER_NOON, timeZone: TZ });
    expect(meal.occurredAt.toISOString()).toBe(WINTER_NOON.toISOString());
    expect(meal.mealType).toBe("lunch");
  });

  it("returns a new Date, not the caller's", () => {
    const meal = proposeMeal(noHints, { now: WINTER_NOON, timeZone: TZ });
    expect(meal.occurredAt).not.toBe(WINTER_NOON);
  });

  it("lets an explicit meal type beat the clock", () => {
    const meal = proposeMeal({ mealTypeHint: "dinner", timeHint: null }, { now: WINTER_NOON, timeZone: TZ });
    expect(meal.mealType).toBe("dinner");
    expect(meal.occurredAt.toISOString()).toBe(WINTER_NOON.toISOString());
  });

  it("puts 'yesterday dinner' with no clock time at the default minute of dinner yesterday", () => {
    const meal = proposeMeal({ mealTypeHint: "dinner", timeHint: { day: "yesterday", minuteOfDay: null } }, { now: WINTER_NOON, timeZone: TZ });
    expect(meal.mealType).toBe("dinner");
    expect(meal.occurredAt.toISOString()).toBe("2027-01-11T17:30:00.000Z"); // 19:30 local on the 11th
  });

  it("uses the default minute of 'other' (noon) for 'yesterday' with no type, and infers the type from it", () => {
    const meal = proposeMeal({ mealTypeHint: null, timeHint: { day: "yesterday", minuteOfDay: null } }, { now: WINTER_NOON, timeZone: TZ });
    expect(meal.occurredAt.toISOString()).toBe("2027-01-11T10:00:00.000Z"); // 12:00 local
    expect(meal.mealType).toBe("lunch");
  });

  it("treats 'today' with no clock time as now", () => {
    const meal = proposeMeal({ mealTypeHint: "breakfast", timeHint: { day: "today", minuteOfDay: null } }, { now: WINTER_NOON, timeZone: TZ });
    expect(meal.occurredAt.toISOString()).toBe(WINTER_NOON.toISOString());
    expect(meal.mealType).toBe("breakfast");
  });

  it("puts a clock time earlier today on that time today", () => {
    const meal = proposeMeal({ mealTypeHint: null, timeHint: { day: "today", minuteOfDay: 7 * 60 + 30 } }, { now: WINTER_NOON, timeZone: TZ });
    expect(meal.occurredAt.toISOString()).toBe("2027-01-12T05:30:00.000Z");
    expect(meal.mealType).toBe("breakfast");
  });

  it("moves a clock time that would be in the future to yesterday", () => {
    const meal = proposeMeal({ mealTypeHint: null, timeHint: { day: "today", minuteOfDay: 20 * 60 } }, { now: WINTER_NOON, timeZone: TZ });
    expect(meal.occurredAt.toISOString()).toBe("2027-01-11T18:00:00.000Z");
    expect(meal.mealType).toBe("dinner");
  });

  it("allows exactly 5 minutes ahead and moves anything later", () => {
    const ok = proposeMeal({ mealTypeHint: null, timeHint: { day: "today", minuteOfDay: 12 * 60 + 35 } }, { now: WINTER_NOON, timeZone: TZ });
    expect(ok.occurredAt.toISOString()).toBe("2027-01-12T10:35:00.000Z");
    const moved = proposeMeal({ mealTypeHint: null, timeHint: { day: "today", minuteOfDay: 12 * 60 + 36 } }, { now: WINTER_NOON, timeZone: TZ });
    expect(moved.occurredAt.toISOString()).toBe("2027-01-11T10:36:00.000Z");
  });

  it("keeps a clock time on 'yesterday' on yesterday, even if it is later than now's clock", () => {
    const meal = proposeMeal({ mealTypeHint: null, timeHint: { day: "yesterday", minuteOfDay: 20 * 60 } }, { now: WINTER_NOON, timeZone: TZ });
    expect(meal.occurredAt.toISOString()).toBe("2027-01-11T18:00:00.000Z");
  });

  it("works across local midnight: just after 00:00, 'yesterday' is the day that just ended", () => {
    const justAfterMidnight = new Date("2027-01-12T22:30:00Z"); // 00:30 on the 13th
    const meal = proposeMeal({ mealTypeHint: null, timeHint: { day: "yesterday", minuteOfDay: 22 * 60 } }, { now: justAfterMidnight, timeZone: TZ });
    expect(meal.occurredAt.toISOString()).toBe("2027-01-12T20:00:00.000Z"); // 22:00 on the 12th
  });

  it("reads wall-clock times in the user's zone: the same hint gives different instants in UTC and Jerusalem", () => {
    const hint = { mealTypeHint: null, timeHint: { day: "today", minuteOfDay: 8 * 60 } } as const;
    expect(proposeMeal(hint, { now: WINTER_NOON, timeZone: "UTC" }).occurredAt.toISOString()).toBe("2027-01-12T08:00:00.000Z");
    expect(proposeMeal(hint, { now: WINTER_NOON, timeZone: TZ }).occurredAt.toISOString()).toBe("2027-01-12T06:00:00.000Z");
  });

  describe("on the day daylight saving time ends (2026-10-25)", () => {
    const now = new Date("2026-10-25T08:00:00Z"); // 10:00 IST

    it("puts the repeated 01:30 on its first occurrence", () => {
      const meal = proposeMeal({ mealTypeHint: null, timeHint: { day: "today", minuteOfDay: 90 } }, { now, timeZone: TZ });
      expect(meal.occurredAt.toISOString()).toBe("2026-10-24T22:30:00.000Z");
      expect(meal.mealType).toBe("snack");
    });

    it("puts 'yesterday 20:00' at 20:00 IDT of the day before", () => {
      const meal = proposeMeal({ mealTypeHint: null, timeHint: { day: "yesterday", minuteOfDay: 20 * 60 } }, { now, timeZone: TZ });
      expect(meal.occurredAt.toISOString()).toBe("2026-10-24T17:00:00.000Z");
    });
  });

  describe("on the day daylight saving time starts (2027-03-26)", () => {
    const now = new Date("2027-03-26T10:00:00Z"); // 13:00 IDT

    it("moves the skipped 02:30 to the first valid instant after the gap", () => {
      const meal = proposeMeal({ mealTypeHint: null, timeHint: { day: "today", minuteOfDay: 150 } }, { now, timeZone: TZ });
      expect(meal.occurredAt.toISOString()).toBe("2027-03-26T00:00:00.000Z"); // 03:00 IDT
    });

    it("finds yesterday correctly on the 23-hour day", () => {
      const meal = proposeMeal({ mealTypeHint: null, timeHint: { day: "yesterday", minuteOfDay: 20 * 60 } }, { now, timeZone: TZ });
      expect(meal.occurredAt.toISOString()).toBe("2027-03-25T18:00:00.000Z"); // 20:00 IST
    });
  });

  it("does not throw for an invalid zone and falls back to Asia/Jerusalem", () => {
    const meal = proposeMeal({ mealTypeHint: null, timeHint: { day: "today", minuteOfDay: 7 * 60 } }, { now: WINTER_NOON, timeZone: "Mars/Phobos" });
    expect(meal.occurredAt.toISOString()).toBe("2027-01-12T05:00:00.000Z");
  });
});

describe("checkOccurredAt", () => {
  const now = new Date("2027-01-12T10:30:00Z");

  it("accepts exactly 5 minutes ahead and rejects a millisecond more", () => {
    expect(checkOccurredAt(new Date(now.getTime() + OCCURRED_AT_LIMITS.maxFutureMs), now)).toBe("ok");
    expect(checkOccurredAt(new Date(now.getTime() + OCCURRED_AT_LIMITS.maxFutureMs + 1), now)).toBe("future");
  });

  it("accepts exactly 48 hours back and rejects a millisecond more", () => {
    expect(checkOccurredAt(new Date(now.getTime() - 48 * HOUR), now)).toBe("ok");
    expect(checkOccurredAt(new Date(now.getTime() - 48 * HOUR - 1), now)).toBe("too_old");
  });

  it("accepts now and the recent past", () => {
    expect(checkOccurredAt(now, now)).toBe("ok");
    expect(checkOccurredAt(new Date(now.getTime() - 2 * HOUR), now)).toBe("ok");
    expect(checkOccurredAt(new Date(now.getTime() + MIN), now)).toBe("ok");
  });

  it("refuses an invalid date", () => {
    expect(checkOccurredAt(new Date("nope"), now)).toBe("too_old");
  });
});

describe("localDayAndTime", () => {
  const now = new Date("2027-01-12T22:30:00Z"); // 00:30 on the 13th in Jerusalem

  it("splits at local midnight, not at UTC midnight", () => {
    expect(localDayAndTime(new Date("2027-01-12T21:30:00Z"), now, TZ)).toEqual({ day: "yesterday", time: "23:30" });
    expect(localDayAndTime(new Date("2027-01-12T22:00:00Z"), now, TZ)).toEqual({ day: "today", time: "00:00" });
    expect(localDayAndTime(now, now, TZ)).toEqual({ day: "today", time: "00:30" });
  });

  it("says 'other' for anything before yesterday", () => {
    expect(localDayAndTime(new Date("2027-01-11T12:00:00Z"), now, TZ).day).toBe("other");
    expect(localDayAndTime(new Date("2027-01-12T21:59:59Z"), now, TZ).day).toBe("yesterday");
    expect(localDayAndTime(new Date("2027-01-11T21:59:59Z"), now, TZ).day).toBe("other");
  });

  it("finds yesterday on a 23-hour and a 25-hour day", () => {
    const springNow = new Date("2027-03-26T10:00:00Z");
    expect(localDayAndTime(new Date("2027-03-25T21:00:00Z"), springNow, TZ)).toEqual({ day: "yesterday", time: "23:00" });
    expect(localDayAndTime(new Date("2027-03-25T22:00:00Z"), springNow, TZ)).toEqual({ day: "today", time: "00:00" });
    const fallNow = new Date("2026-10-25T08:00:00Z");
    expect(localDayAndTime(new Date("2026-10-24T08:00:00Z"), fallNow, TZ)).toEqual({ day: "yesterday", time: "11:00" });
  });

  it("finds yesterday when it is the 23-hour day and today is the day after it", () => {
    // 2027-03-26 has 23 hours in Jerusalem: stepping back a fixed 24 hours from the next midnight would land a day too early.
    expect(localDayAndTime(new Date("2027-03-26T00:30:00Z"), new Date("2027-03-27T10:00:00Z"), TZ)).toEqual({ day: "yesterday", time: "03:30" });
  });

  it("does not throw for an invalid zone", () => {
    expect(localDayAndTime(now, now, "Mars/Phobos").day).toBe("today");
  });
});

describe("instantFromDayAndTime", () => {
  const now = new Date("2027-01-12T10:30:00Z");

  it("resolves today and yesterday", () => {
    expect(instantFromDayAndTime("today", "08:15", now, TZ)?.toISOString()).toBe("2027-01-12T06:15:00.000Z");
    expect(instantFromDayAndTime("yesterday", "08:15", now, TZ)?.toISOString()).toBe("2027-01-11T06:15:00.000Z");
    expect(instantFromDayAndTime("today", "8:15", now, TZ)?.toISOString()).toBe("2027-01-12T06:15:00.000Z");
  });

  it("gives null for a time that is not valid", () => {
    for (const bad of ["", "24:00", "7:5", "abc", "12:60"]) expect(instantFromDayAndTime("today", bad, now, TZ), bad).toBeNull();
  });

  it("is the inverse of localDayAndTime", () => {
    const at = new Date("2027-01-11T17:42:00Z");
    const { day, time } = localDayAndTime(at, now, TZ);
    expect(day).toBe("yesterday");
    expect(instantFromDayAndTime("yesterday", time, now, TZ)?.toISOString()).toBe(at.toISOString());
  });
});
