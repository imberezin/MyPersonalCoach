/**
 * Flags of `npm run seed:demo -- <flags>`. The vitest CLI rejects unknown options, so `scripts/seed-demo.mjs` packs the flags
 * into one JSON environment variable (SEED_ARGS) and this module validates it BEFORE any call. A flag without a value
 * arrives as `true`. There is deliberately no flag for a password or a key: the password comes from the tester's shell
 * variable, and nothing here ever echoes a value back (only flag names), so free text such as --motivation never reaches
 * a log line.
 */
import { GOAL_FOCUS_KEYS, TEXT_LIMITS, type GoalFocusKey } from "@/domain/onboarding/model";
import { resolveTimeZone } from "@/domain/time";
import { WEIGHT_ENTRY } from "@/domain/weight";
import { checkDemoEmail } from "./guard";

export const SEED_SCENARIOS = [
  "day1-empty", "day3", "day4-candidate", "day5-early-finish", "absence", "shabbat-week", "max-days",
  "w-none", "w-one", "w-down", "w-milestone", "w-goal", "w-steady", "w-rising", "w-daily", "w-junk", "w-nogoal",
] as const;
export type SeedScenario = (typeof SEED_SCENARIOS)[number];

export const DEFAULT_SEED_EMAIL = "demo@eating-coach.test";
/** A short Hebrew sentence with no digit: the default "in your own words" of the profile. */
export const DEFAULT_MOTIVATION = "אני רוצה להרגיש טוב יותר עם האוכל שלי";
export const DEFAULT_GOALS: readonly GoalFocusKey[] = ["improve_eating", "understand_overeating"];
export const DEFAULT_START_DATE = "2026-09-13";
export const DEFAULT_TIME_ZONE = "Asia/Jerusalem";
export const DEFAULT_ASSUMED_DAILY_CAP = 40;
/** The weight defaults (15.1): the profile's start and goal weights, the weekly weigh-in on Friday morning. */
export const DEFAULT_START_WEIGHT_KG = 80;
export const DEFAULT_GOAL_WEIGHT_KG = 72;
export const DEFAULT_WEIGH_DAY = 5;
export const DEFAULT_WEIGH_TIME = "08:00";
export const DEFAULT_WEIGHT_DRIFT = -0.1;
export const DEFAULT_WEIGHT_NOISE = 0.6;
export const DEFAULT_JUNK_DAY = 30;
/** The one absurd entry of `--junk-weights on`. */
export const JUNK_WEIGHT_KG = 181;
/** The accepted range of --start-weight and --goal-weight: the profile column's CHECK. */
export const PROFILE_WEIGHT_RANGE = { min: 20, max: 500 } as const;
const MAX_SERIES = 120;

export type SeedLifecycle = "first_week" | "weekly_cycle";
export type SeedWeights = "none" | "weekly" | "daily";

/**
 * What one run does. `seed` fills the demo user (the default); `explain` only prints the decisions; `clock` only touches
 * `.dev-clock`; `drop` deletes the newest meals and/or weights; `reset` deletes the demo user.
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
  /** Delete the newest N weight entries (through RLS; the content-free audit trail stays). */
  dropWeights: number | "all" | null;
  goals: readonly GoalFocusKey[];
  motivation: string | null;
  /** --explain only: the daily cap ASSUMED for the wording gate. Real configuration is never read. */
  explainDailyCap: number;
  /** `first_week` (the default) or `weekly_cycle` (the First Week is over). */
  lifecycle: SeedLifecycle;
  /** profiles.start_weight_kg, one decimal. */
  startWeightKg: number;
  /** profiles.goal_weight_kg with goal_type numeric; null = goal_type none. */
  goalWeightKg: number | null;
  weights: SeedWeights;
  /** Weekly mode: one value per weigh-in, in order. null = generated from the drift and the noise. */
  weightSeries: readonly number[] | null;
  /** 0 = Sunday ... 6 = Saturday. */
  weighDay: number;
  /** "HH:mm" local. */
  weighTime: string;
  /** Daily and generated weekly values: kg per day on top of the start weight. */
  weightDrift: number;
  /** The amplitude of the deterministic noise, in kg. */
  weightNoise: number;
  junkWeights: boolean;
  /** 1-based day of the junk entry (08:00). */
  junkDay: number;
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
  lifecycle: SeedLifecycle;
  startWeightKg: number;
  goalWeightKg: number | null;
  weights: SeedWeights;
  weightSeries: readonly number[] | null;
  junkWeights: boolean;
}

const BASE: Shape = {
  days: 8,
  mealsPerDay: 3,
  lateDays: [2, 3, 4, 8],
  doubleLateDays: [],
  gapDays: [5],
  aggregatedSaturdayNight: null,
  totalMeals: null,
  lifecycle: "first_week",
  startWeightKg: DEFAULT_START_WEIGHT_KG,
  goalWeightKg: DEFAULT_GOAL_WEIGHT_KG,
  weights: "none",
  weightSeries: null,
  junkWeights: false,
};

/**
 * The weight presets (15.3). Weight only: no meals at all (so no after-Shabbat report either), the First Week is over, and
 * `days` is 3 mod 7 so the clock (09:00 of day days+1) is a Wednesday, outside the window where the Weekly Learning card would
 * hide the milestone card. Weekly weigh-ins are on Fridays (days 6, 13, 20, 27, 34, 41, 48).
 */
function weightPreset(days: number, over: Partial<Shape> = {}): Partial<Shape> {
  const weights: SeedWeights = over.weightSeries ? "weekly" : "none";
  return { days, mealsPerDay: 0, lateDays: [], gapDays: [], aggregatedSaturdayNight: false, lifecycle: "weekly_cycle", weights, ...over };
}
const W_DOWN = weightPreset(45, { weightSeries: [79.6, 78.9, 78.1, 77.4, 76.9, 76.2] });

/** The documented defaults of each preset (16.5 and 15.3); explicit flags override them. */
export const SEED_PRESETS: Readonly<Record<SeedScenario, Partial<Shape>>> = {
  "day1-empty": { days: 1, mealsPerDay: 0, lateDays: [], gapDays: [], aggregatedSaturdayNight: false },
  day3: { days: 3, lateDays: [2, 3], gapDays: [] },
  "day4-candidate": { days: 4, lateDays: [2, 3, 4], doubleLateDays: [4], gapDays: [] },
  "day5-early-finish": { days: 5, lateDays: [2, 3, 4, 5], gapDays: [] },
  absence: { days: 5, lateDays: [], gapDays: [3, 4, 5] },
  "shabbat-week": { days: 8, lateDays: [2, 3], gapDays: [5] },
  "max-days": { days: 17, mealsPerDay: 1, totalMeals: 2, lateDays: [], gapDays: [], aggregatedSaturdayNight: false },
  "w-none": weightPreset(24),
  "w-one": weightPreset(10, { weightSeries: [79.5] }),
  "w-down": W_DOWN,
  "w-milestone": weightPreset(45, { weightSeries: [80.4, 79.6, 78.2, 77.0, 74.9, 74.6] }),
  "w-goal": weightPreset(52, { weightSeries: [79.0, 77.0, 74.8, 74.0, 72.6, 71.9, 71.6] }),
  "w-steady": weightPreset(38, { weightSeries: [78.2, 78.1, 78.3, 78.2, 78.1] }),
  "w-rising": weightPreset(31, { startWeightKg: 76, weightSeries: [76.4, 76.9, 77.5, 78.2] }),
  "w-daily": weightPreset(31, { weights: "daily" }),
  "w-junk": { ...W_DOWN, junkWeights: true },
  "w-nogoal": { ...W_DOWN, goalWeightKg: null },
};

const KNOWN = new Set([
  "email", "scenario", "days", "meals-per-day", "late-days", "double-late-days", "gap-days", "shabbat", "aggregated-saturday-night",
  "total-meals", "mode", "start", "tz", "seed", "as-of", "clock-only", "clock-shift", "clock-off", "fresh", "reset", "drop-meals",
  "explain", "daily-cap", "goals", "motivation", "lifecycle", "start-weight", "goal-weight", "weights", "weight-series", "weigh-day",
  "weigh-time", "weight-drift", "weight-noise", "junk-weights", "junk-day", "drop-weights",
]);

/** Flags that ask for data to be written. Without any of them, `--explain` alone only explains. */
const DATA_FLAGS = [
  "scenario", "days", "meals-per-day", "late-days", "double-late-days", "gap-days", "shabbat", "aggregated-saturday-night",
  "total-meals", "mode", "start", "tz", "seed", "as-of", "goals", "motivation", "fresh", "lifecycle", "start-weight", "goal-weight",
  "weights", "weight-series", "weigh-day", "weigh-time", "weight-drift", "weight-noise", "junk-weights", "junk-day",
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

/** A number typed as text ("79.5", "-0.1") or given as a number, as text; anything else is not a number. */
function numberText(value: Raw): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  return typeof value === "string" ? value.trim() : null;
}

/** A weight in kilograms with at most one decimal, from `min` to `max`. */
function kilograms(flag: string, value: Raw, min: number, max: number): number {
  const t = numberText(value);
  if (t === null || !/^\d{1,3}(?:\.\d)?$/.test(t)) return fail(`--${flag} must be a number of kilograms with at most one decimal, like 76.5`);
  const n = Number(t);
  if (n < min || n > max) return fail(`--${flag} must be from ${min} to ${max}`);
  return n;
}

function goalWeight(value: Raw): number | null {
  if (value === "none") return null;
  return kilograms("goal-weight", value, PROFILE_WEIGHT_RANGE.min, PROFILE_WEIGHT_RANGE.max);
}

/** "a,b,c": one value per weigh-in. Each value is what the weight screen itself would accept. */
function weightSeries(value: Raw): number[] {
  const parts = typeof value === "number" ? [String(value)] : typeof value === "string" ? value.split(",") : [];
  if (parts.length === 0) return fail('--weight-series needs a value (for example "79.6,78.9,78.1")');
  if (parts.length > MAX_SERIES) return fail(`--weight-series takes at most ${MAX_SERIES} values`);
  return parts.map((part) => {
    const t = part.trim();
    if (!/^\d{1,3}(?:\.\d)?$/.test(t)) return fail("--weight-series takes numbers with at most one decimal, separated by commas");
    const n = Number(t);
    if (n < WEIGHT_ENTRY.minKg || n > WEIGHT_ENTRY.maxKg) return fail(`--weight-series values must be from ${WEIGHT_ENTRY.minKg} to ${WEIGHT_ENTRY.maxKg}`);
    return n;
  });
}

/** A signed decimal with at most three digits after the point, within `min` to `max`. */
function decimal(flag: string, value: Raw, min: number, max: number): number {
  const t = numberText(value);
  if (t === null || !/^-?\d{1,2}(?:\.\d{1,3})?$/.test(t)) return fail(`--${flag} must be a number like 0.6`);
  const n = Number(t);
  if (n < min || n > max) return fail(`--${flag} must be from ${min} to ${max}`);
  return n;
}

function onOff(flag: string, value: Raw): boolean {
  if (value === "on" || value === true || value === "true") return true;
  if (value === "off" || value === false || value === "false") return false;
  return fail(`--${flag} must be on or off`);
}

function weighTime(value: Raw): string {
  const v = text("weigh-time", value).trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fail("--weigh-time must look like 08:00");
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

  const dropWeights = has("drop-weights")
    ? flags["drop-weights"] === "all"
      ? "all"
      : wholeNumber("drop-weights", flags["drop-weights"], 1, 100000)
    : null;
  if (dropMeals !== null || dropWeights !== null) {
    const other = Object.keys(flags).filter((k) => !["drop-meals", "drop-weights", "email", "explain"].includes(k));
    if (other.length > 0) return fail(`--${dropMeals !== null ? "drop-meals" : "drop-weights"} accepts only --email, --explain and the other --drop flag`);
  }

  const clockShift = has("clock-shift") ? text("clock-shift", flags["clock-shift"]).trim() : null;
  if (clockShift !== null && !SHIFT.test(clockShift)) return fail('--clock-shift must look like "+25h", "-2h" or "+15d"');
  const clockOffFlag = has("clock-off") ? switchFlag("clock-off", flags["clock-off"]) : false;
  const clockOnlyFlag = has("clock-only") ? switchFlag("clock-only", flags["clock-only"]) : false;
  if (clockOffFlag && clockShift !== null) return fail("--clock-off and --clock-shift cannot be combined");

  const seedingFlagGiven = SEEDING_ONLY_FLAGS.some((f) => has(f));
  const clockOnly = clockOnlyFlag || clockShift !== null || (clockOffFlag && !seedingFlagGiven);
  if (clockOnly && (fresh || reset || dropMeals !== null || dropWeights !== null)) return fail("The clock flags change only the clock");

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

  const lifecycle: SeedLifecycle = has("lifecycle")
    ? flags.lifecycle === "first_week" || flags.lifecycle === "weekly_cycle"
      ? flags.lifecycle
      : fail("--lifecycle must be first_week or weekly_cycle")
    : shape.lifecycle;
  const startWeightKg = has("start-weight") ? kilograms("start-weight", flags["start-weight"], PROFILE_WEIGHT_RANGE.min, PROFILE_WEIGHT_RANGE.max) : shape.startWeightKg;
  const goalWeightKg = has("goal-weight") ? goalWeight(flags["goal-weight"]) : shape.goalWeightKg;
  const series = has("weight-series") ? weightSeries(flags["weight-series"]) : shape.weightSeries;
  const weightsFlag =
    flags.weights === undefined
      ? null
      : flags.weights === "none" || flags.weights === "weekly" || flags.weights === "daily"
        ? flags.weights
        : fail("--weights must be none, weekly or daily");
  if (has("weight-series") && weightsFlag !== null && weightsFlag !== "weekly") return fail("--weight-series gives weekly weigh-ins (drop --weights, or use --weights weekly)");
  const weights: SeedWeights = weightsFlag ?? (has("weight-series") ? "weekly" : shape.weights);
  const weighDay = has("weigh-day") ? wholeNumber("weigh-day", flags["weigh-day"], 0, 6) : DEFAULT_WEIGH_DAY;

  const explain = has("explain") ? switchFlag("explain", flags.explain) : false;
  const dataRequested = DATA_FLAGS.some((f) => has(f));

  let action: SeedAction = "seed";
  if (reset) action = "reset";
  else if (dropMeals !== null || dropWeights !== null) action = "drop";
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
    dropWeights,
    goals: has("goals") ? goals(flags.goals) : DEFAULT_GOALS,
    motivation: has("motivation") ? motivation(flags.motivation) : DEFAULT_MOTIVATION,
    explainDailyCap: has("daily-cap") ? wholeNumber("daily-cap", flags["daily-cap"], 1, 1_000_000) : DEFAULT_ASSUMED_DAILY_CAP,
    lifecycle,
    startWeightKg,
    goalWeightKg,
    weights,
    weightSeries: series,
    weighDay,
    weighTime: has("weigh-time") ? weighTime(flags["weigh-time"]) : DEFAULT_WEIGH_TIME,
    weightDrift: has("weight-drift") ? decimal("weight-drift", flags["weight-drift"], -2, 2) : DEFAULT_WEIGHT_DRIFT,
    weightNoise: has("weight-noise") ? decimal("weight-noise", flags["weight-noise"], 0, 5) : DEFAULT_WEIGHT_NOISE,
    junkWeights: has("junk-weights") ? onOff("junk-weights", flags["junk-weights"]) : shape.junkWeights,
    junkDay: has("junk-day") ? wholeNumber("junk-day", flags["junk-day"], 2, 60) : DEFAULT_JUNK_DAY,
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
