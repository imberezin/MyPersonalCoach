import { describe, expect, it, vi } from "vitest";
import { SHABBAT_HORIZON_WEEKS, buildShabbatRows, type ShabbatPeriodRow } from "@/domain/onboarding";
import { getPlace, type Place } from "@/domain/places";
import { computeShabbatSeries } from "./series";
import { TOPUP_ADDED_BY, planShabbatTopup, type ExistingAutoShabbat, type TopupPlan, type TopupProfile } from "./topup";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date("2026-10-02T09:00:00Z");

const inputFor = (place: Place, minutes: number) => ({
  latitude: place.latitude,
  longitude: place.longitude,
  timezone: place.timezone,
  inIsrael: place.inIsrael,
  candleLightingMinutes: minutes,
  cityName: place.cityName,
});

const placeOf = (key: string): Place => {
  const place = getPlace(key);
  if (!place) throw new Error(`no place ${key}`);
  return place;
};

const profile = (placeKey: string | null, candleMinutes: number | null, observesShabbat: boolean | null = true): TopupProfile => ({
  observesShabbat,
  placeKey,
  candleMinutes,
});

/** What onboarding writes: the first `weeks` Shabbatot from `from`. */
function onboardingRows(key: string, minutes: number, from: Date, weeks = SHABBAT_HORIZON_WEEKS): ShabbatPeriodRow[] {
  const place = placeOf(key);
  return buildShabbatRows(computeShabbatSeries(inputFor(place, minutes), from, weeks), { place, candleMinutes: minutes, now: from });
}

const added = (plan: TopupPlan): ShabbatPeriodRow[] => {
  if (plan.kind !== "add") throw new Error(`expected add, got ${plan.kind}`);
  return plan.rows;
};

const startMs = (r: { start_at: string }) => new Date(r.start_at).getTime();
const endMs = (r: { end_at: string }) => new Date(r.end_at).getTime();

const zoneWeekday = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(iso));

/** An independent oracle: the whole run of Shabbatot from a fixed early date, so Yom Tov gaps are in it. */
function oracle(key: string, minutes: number) {
  const place = placeOf(key);
  return computeShabbatSeries(inputFor(place, minutes), new Date("2026-10-01T09:00:00Z"), 60);
}

describe("planShabbatTopup: a user with nothing stored", () => {
  it("adds the next eight Shabbatot, shaped like onboarding's rows", () => {
    const rows = added(planShabbatTopup({ profile: profile("jerusalem", 40), existing: [], now: NOW }));
    expect(rows).toHaveLength(8);

    const onboarding = onboardingRows("jerusalem", 40, NOW);
    expect(rows).toEqual(
      onboarding.map((r) => ({ ...r, metadata: { ...r.metadata, started_before_onboarding: false, added_by: TOPUP_ADDED_BY } })),
    );
    expect(TOPUP_ADDED_BY).toBe("weekly_topup");

    rows.forEach((row, i) => {
      expect(zoneWeekday(row.start_at, "Asia/Jerusalem")).toBe("Fri");
      expect(row.metadata.shabbat_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const hours = (endMs(row) - startMs(row)) / HOUR_MS;
      expect(hours).toBeGreaterThan(24);
      expect(hours).toBeLessThan(29);
      if (i > 0) expect(startMs(row)).toBeGreaterThan(startMs(rows[i - 1]));
    });
  });

  it("uses the place's own values and the stored minutes, as onboarding does", () => {
    const compute = vi.fn(computeShabbatSeries);
    planShabbatTopup({ profile: profile("haifa", 30), existing: [], now: NOW }, compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(compute).toHaveBeenCalledWith(inputFor(placeOf("haifa"), 30), NOW, SHABBAT_HORIZON_WEEKS);
  });

  it("accepts the boundary minutes 0 and 90", () => {
    expect(planShabbatTopup({ profile: profile("jerusalem", 0), existing: [], now: NOW }).kind).toBe("add");
    expect(planShabbatTopup({ profile: profile("jerusalem", 90), existing: [], now: NOW }).kind).toBe("add");
  });
});

describe("planShabbatTopup: idempotency and the cheap path", () => {
  it("plans nothing after its own plan is applied, and nothing for a copy of the stored rows", () => {
    const first = added(planShabbatTopup({ profile: profile("jerusalem", 40), existing: [], now: NOW }));
    expect(planShabbatTopup({ profile: profile("jerusalem", 40), existing: first, now: NOW })).toEqual({ kind: "current" });

    const copy = first.map((r) => ({ ...r, metadata: { ...r.metadata } }));
    expect(planShabbatTopup({ profile: profile("jerusalem", 40), existing: copy, now: NOW })).toEqual({ kind: "current" });
  });

  it("does not run the calculation when eight future rows are stored", () => {
    const compute = vi.fn(computeShabbatSeries);
    const existing = onboardingRows("jerusalem", 40, NOW);
    expect(planShabbatTopup({ profile: profile("jerusalem", 40), existing, now: NOW }, compute)).toEqual({ kind: "current" });
    expect(compute).not.toHaveBeenCalled();
  });

  it("ignores past rows: they are not counted as future and cannot make the future ones look stale", () => {
    const compute = vi.fn(computeShabbatSeries);
    const future = onboardingRows("jerusalem", 40, NOW);
    const past: ExistingAutoShabbat[] = [
      { start_at: "2026-09-18T15:00:00Z", end_at: "2026-09-19T17:00:00Z", metadata: { place_key: "london", candle_lighting_minutes: 18 } },
      { start_at: "2026-09-11T15:00:00Z", end_at: "2026-09-12T17:00:00Z", metadata: null },
    ];
    expect(planShabbatTopup({ profile: profile("jerusalem", 40), existing: [...past, ...future], now: NOW }, compute)).toEqual({ kind: "current" });
    expect(compute).not.toHaveBeenCalled();

    // A row that ends exactly now is over: it is neither counted nor allowed to make the others look stale.
    const justEnded: ExistingAutoShabbat = { start_at: new Date(NOW.getTime() - 25 * HOUR_MS).toISOString(), end_at: NOW.toISOString(), metadata: { place_key: "london" } };
    expect(planShabbatTopup({ profile: profile("jerusalem", 40), existing: [justEnded, ...future], now: NOW }, compute)).toEqual({ kind: "current" });

    // Seven future rows plus the past ones: the past rows do not fill the eighth place.
    const seven = future.slice(1);
    expect(added(planShabbatTopup({ profile: profile("jerusalem", 40), existing: [...past, ...seven], now: NOW }))).toHaveLength(1);
  });

  it("adds exactly the one missing Shabbat when seven are stored", () => {
    const stored = onboardingRows("jerusalem", 40, NOW);
    const later = new Date("2026-10-04T06:00:00Z"); // Sunday: the first Shabbat is over
    const existing = stored.filter((r) => endMs(r) > later.getTime());
    expect(existing).toHaveLength(7);
    const rows = added(planShabbatTopup({ profile: profile("jerusalem", 40), existing, now: later }));
    expect(rows).toHaveLength(1);
    expect(startMs(rows[0])).toBeGreaterThan(startMs(existing[6]));
  });
});

describe("planShabbatTopup: never a row that has begun, never an overlap", () => {
  it("counts a stored row in progress as covering its Shabbat and does not propose it again", () => {
    const stored = onboardingRows("jerusalem", 40, NOW);
    const during = new Date(startMs(stored[0]) + 2 * HOUR_MS);
    // Eight stored, the first under way: nothing is missing.
    expect(planShabbatTopup({ profile: profile("jerusalem", 40), existing: stored, now: during })).toEqual({ kind: "current" });

    // Seven stored, the first under way: only the eighth Shabbat is new, the one under way is not proposed again.
    const rows = added(planShabbatTopup({ profile: profile("jerusalem", 40), existing: stored.slice(0, 7), now: during }));
    expect(rows.map((r) => r.start_at)).toEqual([stored[7].start_at]);
  });

  it("never proposes a Shabbat that has already started, even one the calculation returns", () => {
    const future = onboardingRows("jerusalem", 40, new Date("2026-10-03T20:00:00Z")).slice(0, 2);
    const now = new Date(startMs(future[0]) - HOUR_MS);
    const underWay = { candleLighting: new Date(now.getTime() - HOUR_MS), havdalah: new Date(now.getTime() + 20 * HOUR_MS) };
    const spy = vi.fn(() => [
      underWay,
      { candleLighting: new Date(startMs(future[0])), havdalah: new Date(endMs(future[0])) },
      { candleLighting: new Date(startMs(future[1])), havdalah: new Date(endMs(future[1])) },
    ]);
    const rows = added(planShabbatTopup({ profile: profile("jerusalem", 40), existing: [], now }, spy));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => startMs(r) > now.getTime())).toBe(true);

    // The boundary: a Shabbat that starts exactly now has started.
    const exact = vi.fn(() => [{ candleLighting: new Date(now.getTime()), havdalah: new Date(now.getTime() + 25 * HOUR_MS) }]);
    expect(planShabbatTopup({ profile: profile("jerusalem", 40), existing: [], now }, exact)).toEqual({ kind: "current" });
  });

  it("drops a candidate that overlaps a stored row with a drifted time", () => {
    const series = computeShabbatSeries(inputFor(placeOf("jerusalem"), 40), NOW, 8);
    const [first] = onboardingRows("jerusalem", 40, NOW, 1);
    const drifted: ExistingAutoShabbat = {
      start_at: new Date(startMs(first) + 2 * 60_000).toISOString(),
      end_at: new Date(endMs(first) + 2 * 60_000).toISOString(),
      metadata: first.metadata,
    };
    const rows = added(planShabbatTopup({ profile: profile("jerusalem", 40), existing: [drifted], now: NOW }));
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.start_at)).not.toContain(series[0].candleLighting.toISOString());
    expect(rows.some((r) => startMs(r) < endMs(drifted) && startMs(drifted) < endMs(r))).toBe(false);
  });

  it("returns rows in ascending order and at most the horizon", () => {
    const now = new Date("2026-10-02T09:00:00Z");
    const spy = vi.fn(() =>
      Array.from({ length: 12 }, (_, i) => {
        // Deliberately unsorted, with gaps that never overlap.
        const day = i % 2 === 0 ? 10 + i : 30 - i;
        return { candleLighting: new Date(Date.UTC(2026, 9, day, 15)), havdalah: new Date(Date.UTC(2026, 9, day, 20)) };
      }),
    );
    const rows = added(planShabbatTopup({ profile: profile("jerusalem", 40), existing: [], now }, spy));
    expect(rows).toHaveLength(SHABBAT_HORIZON_WEEKS);
    const starts = rows.map(startMs);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe("planShabbatTopup: who is skipped", () => {
  const skipReason = (p: TopupProfile, existing: ExistingAutoShabbat[] = []) => {
    const plan = planShabbatTopup({ profile: p, existing, now: NOW });
    return plan.kind === "skip" ? plan.reason : plan.kind;
  };

  it("skips a user who does not observe Shabbat, whatever else is stored", () => {
    expect(skipReason(profile("jerusalem", 40, null))).toBe("not_observing");
    expect(skipReason(profile("jerusalem", 40, false))).toBe("not_observing");
    expect(skipReason(profile("jerusalem", 40, false), onboardingRows("jerusalem", 40, NOW))).toBe("not_observing");
  });

  it("skips a missing or unknown place", () => {
    expect(skipReason(profile(null, 40))).toBe("no_place");
    expect(skipReason(profile("", 40))).toBe("no_place");
    expect(skipReason(profile("atlantis", 40))).toBe("unknown_place");
    expect(skipReason(profile("constructor", 40))).toBe("unknown_place");
    expect(skipReason(profile("__proto__", 40))).toBe("unknown_place");
  });

  it("skips minutes that are missing, not whole or out of range", () => {
    for (const minutes of [null, Number.NaN, 91, -1, 1.5, Infinity]) {
      expect(skipReason(profile("jerusalem", minutes))).toBe("bad_minutes");
    }
    expect(skipReason({ observesShabbat: true, placeKey: "jerusalem", candleMinutes: "40" as unknown as number })).toBe("bad_minutes");
  });

  it("skips, and does not repair, rows computed for another place or other minutes", () => {
    expect(skipReason(profile("jerusalem", 40), onboardingRows("london", 18, NOW, 3))).toBe("stale_rows");
    expect(skipReason(profile("jerusalem", 30), onboardingRows("jerusalem", 40, NOW, 3))).toBe("stale_rows");

    // A changed place with the SAME candle minutes is still stale: the place check alone catches it.
    expect(skipReason(profile("paris", 18), onboardingRows("london", 18, NOW, 3))).toBe("stale_rows");
    expect(skipReason(profile("beer_sheva", 20), onboardingRows("tel_aviv", 20, NOW, 3))).toBe("stale_rows");
    expect(skipReason(profile("zikhron_yaakov", 30), onboardingRows("haifa", 30, NOW, 3))).toBe("stale_rows");

    const [one] = onboardingRows("jerusalem", 40, NOW, 1);
    expect(skipReason(profile("jerusalem", 40), [{ ...one, metadata: {} }])).toBe("stale_rows");
    expect(skipReason(profile("jerusalem", 40), [{ ...one, metadata: null }])).toBe("stale_rows");
    expect(skipReason(profile("jerusalem", 40), [{ ...one, metadata: "x" }])).toBe("stale_rows");
    expect(skipReason(profile("jerusalem", 40), [{ ...one, metadata: { ...one.metadata, candle_lighting_minutes: "40" } }])).toBe("stale_rows");

    // One stale row among good ones is enough.
    const foreign = { start_at: "2027-06-01T10:00:00Z", end_at: "2027-06-02T10:00:00Z", metadata: { place_key: "paris" } };
    expect(skipReason(profile("jerusalem", 40), [...onboardingRows("jerusalem", 40, NOW, 3), foreign])).toBe("stale_rows");
  });

  it("treats an unreadable stored date as no row, not as a crash", () => {
    const broken: ExistingAutoShabbat[] = [{ start_at: "not a date", end_at: "also not", metadata: { place_key: "paris" } }];
    expect(skipReason(profile("jerusalem", 40), broken)).toBe("add");
  });

  it("reports a failed calculation instead of throwing, and never treats an empty series as 'no Shabbat'", () => {
    expect(planShabbatTopup({ profile: profile("jerusalem", 40), existing: [], now: NOW }, () => [])).toEqual({ kind: "skip", reason: "calc_failed" });
    const boom = planShabbatTopup({ profile: profile("jerusalem", 40), existing: [], now: NOW }, () => {
      throw new Error("hebcal exploded");
    });
    expect(boom).toEqual({ kind: "skip", reason: "calc_failed" });
    expect(planShabbatTopup({ profile: profile("jerusalem", 40), existing: [], now: new Date(Number.NaN) })).toEqual({ kind: "skip", reason: "calc_failed" });
  });

  it("does not change its inputs", () => {
    const existing = onboardingRows("jerusalem", 40, NOW)
      .slice(2)
      .map((r) => Object.freeze({ ...r, metadata: Object.freeze({ ...r.metadata }) }));
    const frozenExisting = Object.freeze([...existing]);
    const frozenProfile = Object.freeze(profile("jerusalem", 40));
    const before = JSON.stringify(frozenExisting);
    const plan = planShabbatTopup({ profile: frozenProfile, existing: frozenExisting, now: NOW });
    expect(plan.kind).toBe("add");
    expect(JSON.stringify(frozenExisting)).toBe(before);
    if (plan.kind === "add") expect(plan.rows.every((r) => !(existing as readonly unknown[]).includes(r))).toBe(true);
  });
});

describe("planShabbatTopup: time zones and DST", () => {
  const cases: { key: string; minutes: number; label: string; now: string }[] = [
    { key: "jerusalem", minutes: 40, label: "Israel DST starts (Fri 2027-03-26, Saturday-local 02:30)", now: "2027-03-26T23:30:00Z" },
    { key: "jerusalem", minutes: 40, label: "the evening before Israel DST ends", now: "2026-10-24T23:30:00Z" },
    { key: "jerusalem", minutes: 40, label: "the day Israel DST ends", now: "2026-10-25T10:00:00Z" },
    { key: "new_york", minutes: 18, label: "Friday 23:30 local, which is Saturday in UTC", now: "2026-11-07T04:30:00Z" },
    { key: "new_york", minutes: 18, label: "the Sunday US DST ends", now: "2026-11-01T06:00:00Z" },
    { key: "new_york", minutes: 18, label: "the Sunday US DST starts", now: "2027-03-14T06:00:00Z" },
    { key: "sydney", minutes: 18, label: "Saturday 01:00 local, which is Friday in UTC", now: "2026-11-06T14:00:00Z" },
    { key: "sydney", minutes: 18, label: "the Sunday Australian DST starts", now: "2026-10-04T06:00:00Z" },
    { key: "sydney", minutes: 18, label: "the Sunday Australian DST ends", now: "2027-04-04T06:00:00Z" },
    { key: "london", minutes: 18, label: "the Sunday European DST ends", now: "2026-10-25T06:00:00Z" },
  ];

  it.each(cases)("$key: exactly the Shabbatot after now, none for an ended one: $label", ({ key, minutes, now }) => {
    const at = new Date(now);
    const place = placeOf(key);
    // The next eight Shabbatot (one under way counts as the first), minus any that has already begun.
    const expected = oracle(key, minutes)
      .filter((s) => s.havdalah.getTime() > at.getTime())
      .slice(0, SHABBAT_HORIZON_WEEKS)
      .filter((s) => s.candleLighting.getTime() > at.getTime());
    const rows = added(planShabbatTopup({ profile: profile(key, minutes), existing: [], now: at }));

    expect(rows.map((r) => r.start_at)).toEqual(expected.map((s) => s.candleLighting.toISOString()));
    expect(rows.map((r) => r.end_at)).toEqual(expected.map((s) => s.havdalah.toISOString()));
    for (const row of rows) {
      expect(startMs(row)).toBeGreaterThan(at.getTime());
      expect(zoneWeekday(row.start_at, place.timezone)).toBe("Fri");
      expect(zoneWeekday(row.end_at, place.timezone)).toBe("Sat");
      const hours = (endMs(row) - startMs(row)) / HOUR_MS;
      expect(hours).toBeGreaterThan(23);
      expect(hours).toBeLessThan(30);
    }
  });
});

describe("planShabbatTopup: twice a week for sixteen weeks, against an independent oracle", () => {
  const places: [string, number][] = [
    ["jerusalem", 40],
    ["new_york", 18],
    ["london", 18],
    ["sydney", 18],
  ];

  it.each(places)("%s: the next eight Shabbatot are always stored, once each", (key, minutes) => {
    const slots = oracle(key, minutes);
    const compute = vi.fn(computeShabbatSeries);
    const seed = new Date("2026-10-01T09:00:00Z");
    let stored: ShabbatPeriodRow[] = onboardingRows(key, minutes, seed);
    let previousRun = seed.getTime();
    // Sunday 2026-10-04 06:00Z, then every 3 and 4 days: Sunday, Wednesday, Sunday, ...
    let run = Date.UTC(2026, 9, 4, 6);
    let sundays = 0;

    for (let i = 0; i < 32; i++) {
      const now = new Date(run);
      const isSunday = now.getUTCDay() === 0;
      stored = stored.filter((r) => endMs(r) > now.getTime());
      compute.mockClear();

      const plan = planShabbatTopup({ profile: profile(key, minutes), existing: stored, now }, compute);
      // The Shabbatot that ended since the last run are the ones that enter the eight-week window.
      const expectedNew = slots.filter((s) => s.havdalah.getTime() > previousRun && s.havdalah.getTime() <= now.getTime()).length;
      if (plan.kind === "add") {
        if (isSunday) expect(plan.rows).toHaveLength(expectedNew);
        stored = [...stored, ...plan.rows];
      }
      if (isSunday) {
        sundays += 1;
        if (expectedNew === 0) expect(plan.kind).toBe("current");
      } else {
        // Wednesday: everything was added on Sunday, so this takes the cheap path.
        expect(plan.kind).toBe("current");
        expect(compute).not.toHaveBeenCalled();
      }

      // The invariants after every run.
      expect(stored.length).toBeGreaterThanOrEqual(SHABBAT_HORIZON_WEEKS);
      const starts = stored.map(startMs);
      expect(new Set(starts).size).toBe(starts.length);
      const sorted = [...stored].sort((a, b) => startMs(a) - startMs(b));
      sorted.forEach((r, j) => {
        if (j > 0) expect(startMs(r)).toBeGreaterThanOrEqual(endMs(sorted[j - 1]));
      });
      const nextEight = slots.filter((s) => s.havdalah.getTime() > now.getTime()).slice(0, SHABBAT_HORIZON_WEEKS);
      for (const slot of nextEight) {
        expect(stored.filter((r) => r.start_at === slot.candleLighting.toISOString())).toHaveLength(1);
      }

      previousRun = now.getTime();
      run += (isSunday ? 3 : 4) * DAY_MS;
    }
    expect(sundays).toBe(16);
  });

  it("jerusalem adds exactly one row every Sunday while the weeks are consecutive", () => {
    let stored = onboardingRows("jerusalem", 40, new Date("2026-10-01T09:00:00Z"));
    // Sundays from 2026-10-04 to 2026-11-22: the stored and the new Shabbatot are seven days apart.
    for (let sunday = Date.UTC(2026, 9, 4, 6); sunday <= Date.UTC(2026, 10, 22, 6); sunday += 7 * DAY_MS) {
      const now = new Date(sunday);
      stored = stored.filter((r) => endMs(r) > now.getTime());
      expect(stored).toHaveLength(7);
      const rows = added(planShabbatTopup({ profile: profile("jerusalem", 40), existing: stored, now }));
      expect(rows).toHaveLength(1);
      stored = [...stored, ...rows];
    }
  });
});
