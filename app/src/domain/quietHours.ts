/**
 * The quiet hours every new user starts with (decision of 2026-10-01): 00:00 to 08:00 local time.
 * The database default in 20261001130000_quiet_hours_default.sql must stay equal to these values
 * (tests/db/quiet-hours.test.ts checks it). The Behavior Engine reads each user's own values from
 * user_preferences; a NULL pair there means the user has no quiet hours.
 */
export const DEFAULT_QUIET_HOURS = { start: "00:00", end: "08:00" } as const;
