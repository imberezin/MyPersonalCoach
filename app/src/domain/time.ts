/**
 * Time helpers. Instants are stored in UTC; rules (days, weeks) are evaluated in the
 * user's time zone. Pure functions, no I/O.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

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
