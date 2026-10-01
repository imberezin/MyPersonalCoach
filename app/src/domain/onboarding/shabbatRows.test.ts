import { describe, expect, it } from "vitest";
import { isOffline } from "../offline";
import { getPlace } from "../places";
import { buildShabbatRows, toOfflinePeriods } from "./shabbatRows";

const jerusalem = getPlace("jerusalem")!;

// Jerusalem, Friday 2026-10-02 (candle lighting 17:43, Havdalah 18:58 on Saturday, local time).
const series = [{ candleLighting: new Date("2026-10-02T14:43:00Z"), havdalah: new Date("2026-10-03T15:58:00Z") }];

describe("buildShabbatRows", () => {
  const ctx = { place: jerusalem, candleMinutes: 40, now: new Date("2026-10-01T09:00:00Z") };

  it("makes ISO UTC strings in the right order", () => {
    const [row] = buildShabbatRows(series, ctx);
    expect(row.start_at).toBe("2026-10-02T14:43:00.000Z");
    expect(row.end_at).toBe("2026-10-03T15:58:00.000Z");
    expect(new Date(row.start_at).getTime()).toBeLessThan(new Date(row.end_at).getTime());
  });

  it("records how the times were made", () => {
    const [row] = buildShabbatRows(series, ctx);
    expect(row.metadata).toEqual({
      place_key: "jerusalem",
      city: "Jerusalem",
      timezone: "Asia/Jerusalem",
      in_israel: true,
      candle_lighting_minutes: 40,
      latitude: jerusalem.latitude,
      longitude: jerusalem.longitude,
      havdalah_rule: "tzeit_8.5deg",
      shabbat_date: "2026-10-02",
      started_before_onboarding: false,
    });
  });

  it("dates the Shabbat by the Friday in the place's own zone", () => {
    // Friday 17:30 in Sydney is already Friday 07:30 UTC; the date must be the local one.
    const sydney = getPlace("sydney")!;
    const [row] = buildShabbatRows(
      [{ candleLighting: new Date("2026-10-02T07:30:00Z"), havdalah: new Date("2026-10-03T08:40:00Z") }],
      { place: sydney, candleMinutes: 18, now: ctx.now },
    );
    expect(row.metadata.shabbat_date).toBe("2026-10-02");
  });

  it("uses the local date even when the UTC date differs", () => {
    // Friday 18:00 in Los Angeles (PDT) is already Saturday in UTC.
    const [west] = buildShabbatRows(
      [{ candleLighting: new Date("2026-10-03T01:00:00Z"), havdalah: new Date("2026-10-04T02:00:00Z") }],
      { place: getPlace("los_angeles")!, candleMinutes: 18, now: ctx.now },
    );
    expect(west.metadata.shabbat_date).toBe("2026-10-02");
    // Friday 07:30 in Sydney (AEST) is still Thursday in UTC.
    const [east] = buildShabbatRows(
      [{ candleLighting: new Date("2026-10-01T21:30:00Z"), havdalah: new Date("2026-10-03T08:40:00Z") }],
      { place: getPlace("sydney")!, candleMinutes: 18, now: ctx.now },
    );
    expect(east.metadata.shabbat_date).toBe("2026-10-02");
  });

  it("flags a Shabbat that was already under way", () => {
    const during = buildShabbatRows(series, { ...ctx, now: new Date("2026-10-03T08:00:00Z") });
    expect(during[0].metadata.started_before_onboarding).toBe(true);
    const exactly = buildShabbatRows(series, { ...ctx, now: new Date("2026-10-02T14:43:00Z") });
    expect(exactly[0].metadata.started_before_onboarding).toBe(true);
  });

  it("returns nothing for an empty series", () => {
    expect(buildShabbatRows([], ctx)).toEqual([]);
  });
});

describe("toOfflinePeriods", () => {
  const periods = toOfflinePeriods(buildShabbatRows(series, { place: jerusalem, candleMinutes: 40, now: new Date("2026-10-01T09:00:00Z") }));

  it("makes SHABBAT periods", () => {
    expect(periods).toHaveLength(1);
    expect(periods[0].type).toBe("SHABBAT");
  });

  it("is offline inside the window and online at the exact end", () => {
    expect(isOffline(periods, new Date("2026-10-02T14:42:59Z"))).toBe(false);
    expect(isOffline(periods, new Date("2026-10-02T14:43:00Z"))).toBe(true);
    expect(isOffline(periods, new Date("2026-10-03T12:00:00Z"))).toBe(true);
    expect(isOffline(periods, new Date("2026-10-03T15:58:00Z"))).toBe(false);
  });
});
