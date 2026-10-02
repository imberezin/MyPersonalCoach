import { describe, expect, it } from "vitest";
import { formatDayKeyLabel, formatDayLabel, formatKg, formatWeekLabel } from "./format";

const TZ = "Asia/Jerusalem";
// Friday 2026-10-02, 12:00 in Jerusalem.
const FRIDAY = new Date("2026-10-02T09:00:00Z");

describe("formatKg", () => {
  it("always has one decimal", () => {
    expect(formatKg(118, "he")).toBe("118.0");
    expect(formatKg(118.7, "he")).toBe("118.7");
    expect(formatKg(118.7, "en")).toBe("118.7");
    expect(formatKg(76.25, "en")).toBe("76.3");
    expect(formatKg(0, "en")).toBe("0.0");
  });

  it("turns grouping off, so a number never gains a separator inside a sentence", () => {
    expect(formatKg(1118.7, "he")).toBe("1118.7");
    expect(formatKg(1118.7, "en")).toBe("1118.7");
  });

  it("falls back to English for a locale that does not exist", () => {
    expect(formatKg(118.7, "not a locale")).toBe("118.7");
    expect(formatKg(118.7, "")).toBe("118.7");
  });
});

describe("formatDayLabel", () => {
  it("is the weekday, the day and the month in Hebrew and in English", () => {
    expect(formatDayLabel({ instant: FRIDAY, locale: "he", timeZone: TZ, includeYear: false })).toBe("יום שישי, 2 באוקטובר");
    expect(formatDayLabel({ instant: FRIDAY, locale: "en", timeZone: TZ, includeYear: false })).toBe("Friday, 2 October");
  });

  it("adds the year only when asked", () => {
    expect(formatDayLabel({ instant: FRIDAY, locale: "he", timeZone: TZ, includeYear: true })).toBe("יום שישי, 2 באוקטובר 2026");
    expect(formatDayLabel({ instant: FRIDAY, locale: "en", timeZone: TZ, includeYear: true })).toBe("Friday, 2 October 2026");
  });

  it("writes day before month for every English tag, whatever the runtime default", () => {
    for (const locale of ["en", "en-US", "en-GB"]) {
      expect(formatDayLabel({ instant: FRIDAY, locale, timeZone: TZ, includeYear: false })).toBe("Friday, 2 October");
    }
  });

  it("reads the day in the given zone (late evening UTC is already tomorrow in Jerusalem)", () => {
    const lateUtc = new Date("2026-10-02T21:30:00Z");
    expect(formatDayLabel({ instant: lateUtc, locale: "en", timeZone: TZ, includeYear: false })).toBe("Saturday, 3 October");
    expect(formatDayLabel({ instant: lateUtc, locale: "en", timeZone: "UTC", includeYear: false })).toBe("Friday, 2 October");
  });

  it("falls back to Jerusalem for a garbage zone, and gives an empty label for an invalid instant", () => {
    expect(formatDayLabel({ instant: FRIDAY, locale: "en", timeZone: "Not/AZone", includeYear: false })).toBe("Friday, 2 October");
    expect(formatDayLabel({ instant: new Date("nope"), locale: "en", timeZone: TZ, includeYear: false })).toBe("");
  });
});

describe("formatDayKeyLabel", () => {
  it("reads a day key as that local calendar day (noon, so no zone can shift it)", () => {
    expect(formatDayKeyLabel("2026-10-01", "he", TZ, false)).toBe("יום חמישי, 1 באוקטובר");
    expect(formatDayKeyLabel("2026-10-01", "en", TZ, false)).toBe("Thursday, 1 October");
    expect(formatDayKeyLabel("2026-10-01", "en", TZ, true)).toBe("Thursday, 1 October 2026");
  });

  it("is right on both DST days", () => {
    expect(formatDayKeyLabel("2026-10-25", "en", TZ, false)).toBe("Sunday, 25 October");
    expect(formatDayKeyLabel("2026-03-27", "en", TZ, false)).toBe("Friday, 27 March");
  });

  it("gives an empty label for a key that is not a day", () => {
    expect(formatDayKeyLabel("2026-02-30", "en", TZ, false)).toBe("");
    expect(formatDayKeyLabel("garbage", "he", TZ, false)).toBe("");
  });
});

describe("formatWeekLabel", () => {
  it("is the day and the short month", () => {
    expect(formatWeekLabel("2026-10-04", "he")).toBe("4 באוק׳");
    expect(formatWeekLabel("2026-10-04", "en")).toBe("4 Oct");
    expect(formatWeekLabel("2026-10-11", "en-GB")).toBe("11 Oct");
  });

  it("reads the key as a calendar date with no zone shift", () => {
    expect(formatWeekLabel("2026-01-01", "en")).toBe("1 Jan");
    expect(formatWeekLabel("2026-12-27", "en")).toBe("27 Dec");
  });

  it("gives an empty label for a key that is not a day", () => {
    expect(formatWeekLabel("2026-02-30", "en")).toBe("");
    expect(formatWeekLabel("", "he")).toBe("");
  });
});
