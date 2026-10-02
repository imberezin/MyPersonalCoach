/**
 * Time helpers. Instants are stored in UTC; rules (days, weeks) are evaluated in the
 * user's time zone. Pure functions, no I/O.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The zone used when a profile's zone is not a valid IANA name. Must equal HOME_FALLBACK_TIME_ZONE and DEFAULT_TIME_ZONE (time.test.ts pins both). */
const FALLBACK_TIME_ZONE = "Asia/Jerusalem";

/**
 * Returns `tz` when `new Intl.DateTimeFormat("en-US", { timeZone: tz })` accepts it, else "Asia/Jerusalem". Never
 * throws. `profiles.timezone` is a `text not null` column with no check constraint, so every code path that
 * reads it calls this before any Intl call. It lives here (below home/, firstWeekFlow/ and patterns/) so none
 * of them imports another to reach it; `@/domain/home` re-exports it.
 */
export function resolveTimeZone(tz: string): string {
  if (typeof tz !== "string") return FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

interface ZonedParts {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute"), ss: get("second") };
}

/** Offset of a time zone from UTC at an instant, in milliseconds (positive east of UTC). */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight at the start of a calendar day in a time zone. */
export function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day);
  let guess = wallClockAsUtc;
  for (let i = 0; i < 3; i++) {
    const next = wallClockAsUtc - tzOffsetMs(new Date(guess), timeZone);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

export interface LocalDay {
  /** "YYYY-MM-DD" in the user's time zone. */
  key: string;
  start: Date;
  /** Start of the next local day (exclusive). A day can be 23 or 25 hours long around DST. */
  end: Date;
}

/** The local day (in a time zone) that contains an instant. */
export function localDayOf(instant: Date, timeZone: string): LocalDay {
  const { y, m, d } = zonedParts(instant, timeZone);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    key: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    start: zonedMidnightUtc(y, m, d, timeZone),
    end: zonedMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
  };
}

/**
 * Wall-clock minutes since local midnight (0..1439) of an instant in a time zone. Midnight is 0,
 * never 24 (hourCycle h23). On a DST day the repeated hour gives the same value twice and the
 * skipped hour gives none, because this reads the clock on the wall, not the time elapsed.
 */
export function localMinuteOfDay(instant: Date, timeZone: string): number {
  const { hh, mm } = zonedParts(instant, timeZone);
  return hh * 60 + mm;
}

/**
 * The UTC instant of a wall-clock time on a local calendar day. A time skipped by a DST jump
 * (02:30 on the spring-forward day) resolves to the first valid instant after the gap, and a
 * repeated time (01:30 on the fall-back day) to its first occurrence. Never throws for a valid zone.
 */
export function zonedInstantUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  // The offsets a day before and a day after the wall time bracket any one transition.
  const before = tzOffsetMs(new Date(wallClockAsUtc - DAY_MS), timeZone);
  const after = tzOffsetMs(new Date(wallClockAsUtc + DAY_MS), timeZone);

  // An offset is right for the wall time when the instant it gives really has that offset.
  const valid = [...new Set([before, after])]
    .map((offset) => wallClockAsUtc - offset)
    .filter((instant) => wallClockAsUtc - instant === tzOffsetMs(new Date(instant), timeZone));
  if (valid.length > 0) return new Date(Math.min(...valid));

  // The wall time falls in a gap: find the instant the clock jumped, the first one with the new offset.
  let lo = wallClockAsUtc - Math.max(before, after);
  let hi = wallClockAsUtc - Math.min(before, after);
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (tzOffsetMs(new Date(mid), timeZone) === after) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}
