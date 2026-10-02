/**
 * The quiet hours every new user starts with (decision of 2026-10-01): 00:00 to 08:00 local time.
 * The database default in 20261001130000_quiet_hours_default.sql must stay equal to these values
 * (tests/db/quiet-hours.test.ts checks it). The Behavior Engine reads each user's own values from
 * user_preferences; a NULL pair there means the user has no quiet hours.
 */
export const DEFAULT_QUIET_HOURS = { start: "00:00", end: "08:00" } as const;

export type QuietHours = { kind: "WINDOW"; startMinute: number; endMinute: number } | { kind: "NONE" };

const TIME_COLUMN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/;

function minuteOfTimeColumn(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = TIME_COLUMN.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * The two `time` columns of user_preferences ("HH:MM[:SS]"), to minutes since local midnight. Both null = no
 * quiet hours (the person turned them off). A window with start === end is also NONE. Anything unparseable, or
 * only one of the two present, is null: unknown, and the caller must then stay silent rather than guess.
 */
export function parseQuietHours(start: unknown, end: unknown): QuietHours | null {
  if (start === null && end === null) return { kind: "NONE" };
  const startMinute = minuteOfTimeColumn(start);
  const endMinute = minuteOfTimeColumn(end);
  if (startMinute === null || endMinute === null) return null;
  if (startMinute === endMinute) return { kind: "NONE" };
  return { kind: "WINDOW", startMinute, endMinute };
}

/** `start` is inclusive and `end` exclusive; the window wraps midnight when start > end (22:00 to 07:00). NONE is never quiet. */
export function isQuiet(quiet: QuietHours, minuteOfDay: number): boolean {
  if (quiet.kind === "NONE") return false;
  const { startMinute, endMinute } = quiet;
  return startMinute < endMinute
    ? minuteOfDay >= startMinute && minuteOfDay < endMinute
    : minuteOfDay >= startMinute || minuteOfDay < endMinute;
}
