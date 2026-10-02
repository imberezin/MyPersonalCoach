/**
 * Flags of `npm run seed:demo -- <flags>`. The vitest CLI rejects unknown options, so `scripts/seed-demo.mjs` packs the flags
 * into one JSON environment variable (SEED_ARGS) and this module validates it BEFORE any call. A flag without a value
 * arrives as `true`. There is deliberately no flag for a password or a key: the password comes from the tester's shell
 * variable, and nothing here ever echoes a value back (only flag names), so free text such as --motivation never reaches
 * a log line.
 */
import { GOAL_FOCUS_KEYS, TEXT_LIMITS, type GoalFocusKey } from "@/domain/onboarding/model";
import { resolveTimeZone } from "@/domain/time";
import { checkDemoEmail } from "./guard";

export const SEED_SCENARIOS = ["day1-empty", "day3", "day4-candidate", "day5-early-finish", "absence", "shabbat-week", "max-days"] as const;
export type SeedScenario = (typeof SEED_SCENARIOS)[number];

export const DEFAULT_SEED_EMAIL = "demo@eating-coach.test";
/** A short Hebrew sentence with no digit: the default "in your own words" of the profile. */
export const DEFAULT_MOTIVATION = "אני רוצה להרגיש טוב יותר עם האוכל שלי";
export const DEFAULT_GOALS: readonly GoalFocusKey[] = ["improve_eating", "understand_overeating"];
export const DEFAULT_START_DATE = "2026-09-13";
export const DEFAULT_TIME_ZONE = "Asia/Jerusalem";
export const DEFAULT_ASSUMED_DAILY_CAP = 40;

/**
 * What one run does. `seed` fills the demo user (the default); `explain` only prints the decisions; `clock` only touches
 * `.dev-clock`; `drop` deletes the newest meals; `reset` deletes the demo user.
 */
export type SeedAction = "seed" | "explain" | "clock" | "drop" | "reset";

export interface SeedOptions {
  email: string;
  scenario: SeedScenario | null;
  action: SeedAction;
  days: number;
  /** Local date of day 1 (fixed mode); relative mode derives it from today. */
  startDate: string;
  mode: "fixed" | "relative";
  mealsPerDay: number;
  lateDays: readonly number[];
  doubleLateDays: readonly number[];
  gapDays: readonly number[];
  shabbat: boolean;
  /** null = automatic: on whenever a Saturday falls inside the span. */
  aggregatedSaturdayNight: boolean | null;
  /** Keep only the first N planned meals in time order. */
  totalMeals: number | null;
  seed: number;
  timeZone: string;
  /** `day N`, `day N HH:mm` or an ISO instant with an offset. null = `day <days>`. */
  asOf: string | null;
  clockShift: string | null;
  clockOff: boolean;
  clockOnly: boolean;
  fresh: boolean;
  reset: boolean;
  explain: boolean;
  dropMeals: number | "all" | null;
  goals: readonly GoalFocusKey[];
  motivation: string | null;
  /** --explain only: the daily cap ASSUMED for the wording gate. Real configuration is never read. */
  explainDailyCap: number;
}

export type ParsedSeedArgs = { ok: true; value: SeedOptions } | { ok: false; error: string };

interface Shape {
  days: number;
  mealsPerDay: number;
  lateDays: readonly number[];
  doubleLateDays: readonly number[];
  gapDays: readonly number[];
  aggregatedSaturdayNight: boolean | null;
  totalMeals: number | null;
}

const BASE: Shape = {
  days: 8,
  mealsPerDay: 3,
  lateDays: [2, 3, 4, 8],
  doubleLateDays: [],
  gapDays: [5],
  aggregatedSaturdayNight: null,
  totalMeals: null,
};

/** The documented defaults of each preset (16.5); explicit flags override them. */
export const SEED_PRESETS: Readonly<Record<SeedScenario, Partial<Shape>>> = {
  "day1-empty": { days: 1, mealsPerDay: 0, lateDays: [], gapDays: [], aggregatedSaturdayNight: false },
  day3: { days: 3, lateDays: [2, 3], gapDays: [] },
  "day4-candidate": { days: 4, lateDays: [2, 3, 4], doubleLateDays: [4], gapDays: [] },
  "day5-early-finish": { days: 5, lateDays: [2, 3, 4, 5], gapDays: [] },
  absence: { days: 5, lateDays: [], gapDays: [3, 4, 5] },
  "shabbat-week": { days: 8, lateDays: [2, 3], gapDays: [5] },
  "max-days": { days: 17, mealsPerDay: 1, totalMeals: 2, lateDays: [], gapDays: [], aggregatedSaturdayNight: false },
};

const KNOWN = new Set([
  "email", "scenario", "days", "meals-per-day", "late-days", "double-late-days", "gap-days", "shabbat", "aggregated-saturday-night",
  "total-meals", "mode", "start", "tz", "seed", "as-of", "clock-only", "clock-shift", "clock-off", "fresh", "reset", "drop-meals",
  "explain", "daily-cap", "goals", "motivation",
]);

/** Flags that ask for data to be written. Without any of them, `--explain` alone only explains. */
const DATA_FLAGS = [
  "scenario", "days", "meals-per-day", "late-days", "double-late-days", "gap-days", "shabbat", "aggregated-saturday-night",
  "total-meals", "mode", "start", "tz", "seed", "as-of", "goals", "motivation", "fresh",
] as const;
/** The subset that is about the meals and the profile themselves (not about the calendar): a `--clock-off` next to one is a seeding run. */
const SEEDING_ONLY_FLAGS = DATA_FLAGS.filter((f) => !["days", "start", "tz", "as-of"].includes(f));

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const AS_OF_DAY = /^day (\d{1,3})(?: ([01]\d|2[0-3]):([0-5]\d))?$/;
const SHIFT = /^[+-]\d{1,4}[mhd]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Raw = string | number | boolean | null | undefined;
class ArgError extends Error {}
const fail = (message: string): never => {
  throw new ArgError(message);
};

function wholeNumber(flag: string, value: Raw, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return fail(`--${flag} must be a whole number from ${min} to ${max}`);
  return n;
}

function text(flag: string, value: Raw): string {
  if (typeof value !== "string") return fail(`--${flag} needs a value`);
  return value;
}

function bool(flag: string, value: Raw): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fail(`--${flag} must be true or false`);
}

/** A flag that takes no value: `--fresh`, or `--fresh true`. */
function switchFlag(flag: string, value: Raw): boolean {
  return bool(flag, value);
}

function dayList(flag: string, value: Raw, max: number): number[] {
  if (value === "none") return [];
  const parts = typeof value === "number" ? [String(value)] : typeof value === "string" ? value.split(",") : [];
  if (parts.length === 0) return fail(`--${flag} needs a value (for example 2,3 or none)`);
  const days = parts.map((part) => {
    const trimmed = part.trim();
    if (!/^\d{1,3}$/.test(trimmed)) return fail(`--${flag} takes 1-based day numbers, like 2,3, or none`);
    const n = Number(trimmed);
    if (n < 1 || n > max) return fail(`--${flag} takes 1-based day numbers from 1 to ${max}`);
    return n;
  });
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Date.parse rolls 2026-02-30 over to March 2; a test clock must not quietly invent a day. */
function isRealCalendarDay(text: string): boolean {
  const [y, m, d] = text.slice(0, 10).split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

function realDate(flag: string, value: Raw): string {
  const v = text(flag, value);
  if (!DATE.test(v)) return fail(`--${flag} must look like 2026-09-13`);
  if (!isRealCalendarDay(v)) return fail(`--${flag} is not a real calendar day`);
  return v;
}

function asOf(value: Raw): string {
  const v = text("as-of", value).trim();
  if (AS_OF_DAY.test(v)) return v;
  if (ISO_WITH_OFFSET.test(v) && isRealCalendarDay(v) && !Number.isNaN(new Date(v).getTime())) return v;
  return fail('--as-of must be "day N", "day N HH:mm" or an ISO instant with an offset');
}

function goals(value: Raw): GoalFocusKey[] {
  const v = text("goals", value);
  if (v === "none") return [];
  const keys = v.split(",").map((k) => k.trim());
  const known = keys.filter((k): k is GoalFocusKey => (GOAL_FOCUS_KEYS as readonly string[]).includes(k));
  if (known.length !== keys.length) return fail(`--goals takes ${GOAL_FOCUS_KEYS.join(", ")} or none`);
  const unique = [...new Set(known)];
  if (unique.includes("not_sure") && unique.length > 1) return fail("--goals: not_sure must be alone");
  return unique;
}

function motivation(value: Raw): string | null {
  const v = text("motivation", value);
  if (v === "none") return null;
  const trimmed = v.trim();
  if (trimmed === "") return fail("--motivation needs text, or none");
  if ([...trimmed].length > TEXT_LIMITS.motivation) return fail(`--motivation is longer than ${TEXT_LIMITS.motivation} characters`);
  return trimmed;
}

function timeZone(value: Raw): string {
  const v = text("tz", value).trim();
  return resolveTimeZone(v) === v ? v : fail("--tz must be an IANA time zone, like Asia/Jerusalem");
}

function parse(flags: Record<string, Raw>): SeedOptions {
  for (const key of Object.keys(flags)) {
    if (!KNOWN.has(key)) return fail(`Unknown flag --${key.slice(0, 40)}`);
  }
  const has = (flag: string) => flags[flag] !== undefined;

  const scenario = has("scenario")
    ? (SEED_SCENARIOS.find((s) => s === flags.scenario) ?? fail(`--scenario must be one of ${SEED_SCENARIOS.join(", ")}`))
    : null;

  const emailRaw = has("email") ? text("email", flags.email) : DEFAULT_SEED_EMAIL;
  const email = checkDemoEmail(emailRaw);
  if (!email.ok) return fail("--email must be <name>@eating-coach.test (throwaway users only)");

  const reset = has("reset") ? switchFlag("reset", flags.reset) : false;
  const fresh = has("fresh") ? switchFlag("fresh", flags.fresh) : false;
  if (reset && fresh) return fail("--reset and --fresh cannot be combined (a reset is a reset)");
  if (reset) {
    const other = Object.keys(flags).filter((k) => k !== "reset" && k !== "email");
    if (other.length > 0) return fail("--reset accepts only --email");
  }

  const dropMeals = has("drop-meals")
    ? flags["drop-meals"] === "all"
      ? "all"
      : wholeNumber("drop-meals", flags["drop-meals"], 1, 100000)
    : null;
  if (dropMeals !== null) {
    const other = Object.keys(flags).filter((k) => !["drop-meals", "email", "explain"].includes(k));
    if (other.length > 0) return fail("--drop-meals accepts only --email and --explain");
  }

  const clockShift = has("clock-shift") ? text("clock-shift", flags["clock-shift"]).trim() : null;
  if (clockShift !== null && !SHIFT.test(clockShift)) return fail('--clock-shift must look like "+25h", "-2h" or "+15d"');
  const clockOffFlag = has("clock-off") ? switchFlag("clock-off", flags["clock-off"]) : false;
  const clockOnlyFlag = has("clock-only") ? switchFlag("clock-only", flags["clock-only"]) : false;
  if (clockOffFlag && clockShift !== null) return fail("--clock-off and --clock-shift cannot be combined");

  const seedingFlagGiven = SEEDING_ONLY_FLAGS.some((f) => has(f));
  const clockOnly = clockOnlyFlag || clockShift !== null || (clockOffFlag && !seedingFlagGiven);
  if (clockOnly && (fresh || reset || dropMeals !== null)) return fail("The clock flags change only the clock");

  const mode = has("mode") ? (flags.mode === "fixed" || flags.mode === "relative" ? flags.mode : fail("--mode must be fixed or relative")) : "fixed";
  if (mode === "relative") {
    if (has("as-of")) return fail("--as-of applies to --mode fixed (relative mode always ends today)");
    if (has("start")) return fail("--start applies to --mode fixed (relative mode counts back from today)");
  }

  const preset: Partial<Shape> = scenario ? SEED_PRESETS[scenario] : {};
  const shape: Shape = { ...BASE, ...preset };

  const days = has("days") ? wholeNumber("days", flags.days, 1, 60) : shape.days;
  const mealsPerDay = has("meals-per-day") ? wholeNumber("meals-per-day", flags["meals-per-day"], 0, 5) : shape.mealsPerDay;
  const lateDays = has("late-days") ? dayList("late-days", flags["late-days"], 60) : shape.lateDays;
  const doubleLateDays = has("double-late-days") ? dayList("double-late-days", flags["double-late-days"], 60) : shape.doubleLateDays;
  const gapDays = has("gap-days") ? dayList("gap-days", flags["gap-days"], 60) : shape.gapDays;
  const aggregatedSaturdayNight = has("aggregated-saturday-night")
    ? bool("aggregated-saturday-night", flags["aggregated-saturday-night"])
    : shape.aggregatedSaturdayNight;
  const totalMeals = has("total-meals") ? wholeNumber("total-meals", flags["total-meals"], 0, 100000) : shape.totalMeals;

  const explain = has("explain") ? switchFlag("explain", flags.explain) : false;
  const dataRequested = DATA_FLAGS.some((f) => has(f));

  let action: SeedAction = "seed";
  if (reset) action = "reset";
  else if (dropMeals !== null) action = "drop";
  else if (clockOnly) action = "clock";
  else if (explain && !dataRequested) action = "explain";

  return {
    email: email.email,
    scenario,
    action,
    days,
    startDate: has("start") ? realDate("start", flags.start) : DEFAULT_START_DATE,
    mode,
    mealsPerDay,
    lateDays,
    doubleLateDays,
    gapDays,
    shabbat: has("shabbat") ? bool("shabbat", flags.shabbat) : true,
    aggregatedSaturdayNight,
    totalMeals,
    seed: has("seed") ? wholeNumber("seed", flags.seed, 0, 2_147_483_647) : 1,
    timeZone: has("tz") ? timeZone(flags.tz) : DEFAULT_TIME_ZONE,
    asOf: has("as-of") ? asOf(flags["as-of"]) : null,
    clockShift,
    clockOff: clockOffFlag,
    clockOnly,
    fresh,
    reset,
    explain,
    dropMeals,
    goals: has("goals") ? goals(flags.goals) : DEFAULT_GOALS,
    motivation: has("motivation") ? motivation(flags.motivation) : DEFAULT_MOTIVATION,
    explainDailyCap: has("daily-cap") ? wholeNumber("daily-cap", flags["daily-cap"], 1, 1_000_000) : DEFAULT_ASSUMED_DAILY_CAP,
  };
}

/** Never throws. `raw` is the JSON of SEED_ARGS (undefined or "" = no flags). */
export function parseSeedArgs(raw: string | undefined): ParsedSeedArgs {
  let flags: unknown = {};
  if (raw !== undefined && raw !== "") {
    try {
      flags = JSON.parse(raw);
    } catch {
      return { ok: false, error: "SEED_ARGS is not valid JSON" };
    }
  }
  if (typeof flags !== "object" || flags === null || Array.isArray(flags)) return { ok: false, error: "SEED_ARGS must be an object" };
  try {
    return { ok: true, value: parse(flags as Record<string, Raw>) };
  } catch (error) {
    return { ok: false, error: error instanceof ArgError ? error.message : "The flags could not be read" };
  }
}
