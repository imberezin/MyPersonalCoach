import { createHash } from "node:crypto";
import { instantAfterDays } from "@/domain/asOf";
import { toConfirmedItems } from "@/domain/food/draft";
import { itemsToJson } from "@/domain/food/stored";
import type { ConfirmedItem, MealSource, MealType } from "@/domain/food/types";
import { STEP_IDS } from "@/domain/onboarding/model";
import { getPlace } from "@/domain/places";
import { localDayOf, resolveTimeZone, zonedInstantUtc } from "@/domain/time";
import type { SeedOptions } from "./args";
import { FOODS, mealTypeOfSlot, type FoodSlot } from "./foods";

/**
 * The deterministic history the seed script writes. Pure: no clock, no I/O, no randomness (a small hash of the seed, the
 * e-mail, the day and the slot decides every "random" choice), so the same options always give the same plan, ids
 * included, and an additive re-run inserts only what is new.
 *
 * Calendar: day 1 is the local date `startDate`; the profile's First Week began at 12:00 that day. Shabbat is not
 * modeled here, it is passed in (the runner computes it with the same engine onboarding uses).
 */

export interface PlannedMeal {
  /** A deterministic v5-style UUID of (e-mail, seed, day, slot). */
  id: string;
  occurredAt: Date;
  /** occurredAt plus two to six minutes. */
  confirmedAt: Date;
  mealType: MealType;
  items: ConfirmedItem[];
  source: MealSource;
  /** The after-Shabbat report (Motzei Shabbat): the detector must ignore it. */
  aggregated: boolean;
  /** 1-based local day. */
  day: number;
}

export interface PlannedOffline {
  type: "SHABBAT";
  start: Date;
  end: Date;
}

export interface SeedPlan {
  /** profiles.first_week_started_at = onboarding_completed_at: day 1 at 12:00 local. */
  startedAt: Date;
  /** The dev clock this plan is for. Nothing in the plan is later than this. */
  asOf: Date;
  /** Ascending by time. */
  meals: PlannedMeal[];
  offline: PlannedOffline[];
  /** The 1-based days that have at least one late-evening meal (not aggregated). */
  lateDays: number[];
}

/** A late-evening meal is placed between these local minutes (21:10 to 23:20), always after the detector's 21:00. */
export const LATE_WINDOW = { startMinute: 1270, endMinute: 1400 } as const;
const AGGREGATED_MINUTE = 1335; // 22:15 local, plus a jitter of up to 10 minutes
const ONBOARDING_HOUR = 12;
const MINUTE_MS = 60_000;

interface Slot {
  key: string;
  kind: FoodSlot;
  minute: number;
}
const B: Slot = { key: "b", kind: "breakfast", minute: 480 };
const S1: Slot = { key: "s1", kind: "snack", minute: 630 };
const L: Slot = { key: "l", kind: "lunch", minute: 780 };
const S2: Slot = { key: "s2", kind: "snack", minute: 990 };
const D: Slot = { key: "d", kind: "dinner", minute: 1170 };
/** Breakfast about 08:00, lunch about 13:00, dinner about 19:30. */
const SLOTS: Readonly<Record<number, readonly Slot[]>> = {
  0: [],
  1: [L],
  2: [B, D],
  3: [B, L, D],
  4: [B, L, S2, D],
  5: [B, S1, L, S2, D],
};

const SOURCES: readonly MealSource[] = ["ai_unedited", "ai_edited", "user_manual"];
const NAMESPACE = Buffer.from("7d1a3c52e4b94f0a8c6d2b9e5f314a07", "hex");

/** FNV-1a with a final avalanche: a stable 32-bit number for any text. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** An integer in [lo, hi] decided by `key` alone. */
function intIn(key: string, lo: number, hi: number): number {
  return lo + (hash32(key) % (hi - lo + 1));
}

function uuidV5(name: string): string {
  const bytes = createHash("sha1").update(NAMESPACE).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The id of a planned meal. The e-mail is part of the name so two demo users never collide on a primary key. */
export function plannedMealId(options: Pick<SeedOptions, "email" | "seed">, day: number, slot: string): string {
  return uuidV5(`meal|${options.email}|${options.seed}|${day}|${slot}`);
}

function dateParts(startDate: string): { y: number; m: number; d: number } {
  const [y, m, d] = startDate.split("-").map(Number);
  return { y, m, d };
}

/** Day 1 at 12:00 local: when onboarding finished and the First Week began. */
export function startedAtOf(options: Pick<SeedOptions, "startDate" | "timeZone">): Date {
  const { y, m, d } = dateParts(options.startDate);
  return zonedInstantUtc(y, m, d, ONBOARDING_HOUR, 0, resolveTimeZone(options.timeZone));
}

/**
 * The dev clock a run is for. null = "day <days>". "day N" is 09:00 of day N+1 (N whole days have ended), "day N HH:mm"
 * is that wall-clock time of day N+1, an ISO instant is itself. Throws RangeError on a text that is none of those
 * (the argument parser has already refused them).
 */
export function resolveAsOf(options: Pick<SeedOptions, "asOf" | "days" | "timeZone">, startedAt: Date): Date {
  const timeZone = resolveTimeZone(options.timeZone);
  const spec = options.asOf;
  if (spec === null) return instantAfterDays({ startedAt, days: options.days, timeZone });
  const match = /^day (\d{1,3})(?: (\d{2}:\d{2}))?$/.exec(spec);
  if (match) return instantAfterDays({ startedAt, days: Number(match[1]), time: match[2], timeZone });
  const instant = new Date(spec);
  if (Number.isNaN(instant.getTime())) throw new RangeError("as-of is not a usable instant");
  return instant;
}

/**
 * Relative mode: today is day N+1, so day 1 is N days before today's local date, and the clock is the real one (no clock
 * file is written, which is what lets a meal be saved through the UI afterwards). Any other mode is returned unchanged.
 */
export function resolveRelative(options: SeedOptions, now: Date): SeedOptions {
  if (options.mode !== "relative") return options;
  const timeZone = resolveTimeZone(options.timeZone);
  const [y, m, d] = localDayOf(now, timeZone).key.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, d - options.days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    ...options,
    startDate: `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(first.getUTCDate())}`,
    asOf: now.toISOString(),
  };
}

/** The Shabbat period an after-Shabbat (aggregated) meal belongs to: the one that ended most recently before it. */
export function periodBeforeMeal(meal: Pick<PlannedMeal, "occurredAt">, offline: readonly PlannedOffline[]): PlannedOffline | null {
  let found: PlannedOffline | null = null;
  for (const period of offline) {
    if (period.end.getTime() > meal.occurredAt.getTime()) continue;
    if (found === null || period.end.getTime() > found.end.getTime()) found = period;
  }
  return found;
}

function atMinute(y: number, m: number, d: number, minute: number, timeZone: string): Date {
  return zonedInstantUtc(y, m, d, Math.floor(minute / 60), minute % 60, timeZone);
}

export function buildSeedPlan(options: SeedOptions, shabbat: readonly { start: Date; end: Date }[]): SeedPlan {
  const timeZone = resolveTimeZone(options.timeZone);
  const startedAt = startedAtOf(options);
  const asOf = resolveAsOf(options, startedAt);
  const offline: PlannedOffline[] = options.shabbat
    ? shabbat.map((p) => ({ type: "SHABBAT" as const, start: p.start, end: p.end })).sort((a, b) => a.start.getTime() - b.start.getTime())
    : [];

  const inShabbat = (at: Date) => offline.some((p) => at.getTime() >= p.start.getTime() && at.getTime() < p.end.getTime());
  const { y, m, d } = dateParts(options.startDate);
  const slots = SLOTS[options.mealsPerDay] ?? [];

  const meals: (PlannedMeal & { slot: string })[] = [];
  const add = (a: { day: number; slot: string; kind: FoodSlot; at: Date; aggregated: boolean; order: number }) => {
    // Day 1 starts when onboarding finished; nothing is dated before it.
    if (a.at.getTime() < startedAt.getTime()) return;
    const key = `${options.email}|${options.seed}|${a.day}|${a.slot}`;
    const dishes = FOODS[a.kind];
    meals.push({
      id: plannedMealId(options, a.day, a.slot),
      occurredAt: a.at,
      confirmedAt: new Date(a.at.getTime() + intIn(`${key}|c`, 2, 6) * MINUTE_MS),
      mealType: mealTypeOfSlot(a.kind),
      items: toConfirmedItems(dishes[hash32(`${key}|f`) % dishes.length]),
      source: a.aggregated ? "user_manual" : SOURCES[(a.day + a.order) % SOURCES.length],
      aggregated: a.aggregated,
      day: a.day,
      slot: a.slot,
    });
  };

  for (let day = 1; day <= options.days; day++) {
    if (options.gapDays.includes(day)) continue;
    const local = new Date(Date.UTC(y, m - 1, d + day - 1));
    const [yy, mm, dd] = [local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()];
    const saturday = local.getUTCDay() === 6;
    const base = `${options.email}|${options.seed}|${day}`;

    // A Saturday has no meals at all, whatever the havdalah minute: the plan never has a meal near the boundary.
    if (!(options.shabbat && saturday)) {
      slots.forEach((slot, order) => {
        const minute = slot.minute + intIn(`${base}|${slot.key}|j`, -25, 25);
        const at = atMinute(yy, mm, dd, minute, timeZone);
        if (!inShabbat(at)) add({ day, slot: slot.key, kind: slot.kind, at, aggregated: false, order });
      });

      if (options.lateDays.includes(day)) {
        const double = options.doubleLateDays.includes(day);
        const first = double ? LATE_WINDOW.startMinute + intIn(`${base}|late|j`, 0, 60) : LATE_WINDOW.startMinute + intIn(`${base}|late|j`, 0, LATE_WINDOW.endMinute - LATE_WINDOW.startMinute);
        const firstAt = atMinute(yy, mm, dd, first, timeZone);
        if (!inShabbat(firstAt)) add({ day, slot: "late", kind: "late", at: firstAt, aggregated: false, order: slots.length });
        if (double) {
          const second = LATE_WINDOW.startMinute + 70 + intIn(`${base}|late2|j`, 0, 60);
          const secondAt = atMinute(yy, mm, dd, second, timeZone);
          if (!inShabbat(secondAt)) add({ day, slot: "late2", kind: "late", at: secondAt, aggregated: false, order: slots.length + 1 });
        }
      }
    }

    // The after-Shabbat report: reconstructed from memory, so its time is an estimate the detector must not use.
    if (options.shabbat && saturday && (options.aggregatedSaturdayNight ?? true)) {
      const at = atMinute(yy, mm, dd, AGGREGATED_MINUTE + intIn(`${base}|agg|j`, -10, 10), timeZone);
      if (!inShabbat(at)) add({ day, slot: "agg", kind: "dinner", at, aggregated: true, order: 0 });
    }
  }

  let planned = meals
    .filter((meal) => meal.confirmedAt.getTime() <= asOf.getTime())
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : 1));
  if (options.totalMeals !== null) planned = planned.slice(0, options.totalMeals);

  const lateDays = [...new Set(planned.filter((meal) => meal.slot.startsWith("late")).map((meal) => meal.day))].sort((a, b) => a - b);
  // The slot is bookkeeping of this function; the plan the runner and the tests see has no such field.
  const result: PlannedMeal[] = planned.map((m) => ({
    id: m.id,
    occurredAt: m.occurredAt,
    confirmedAt: m.confirmedAt,
    mealType: m.mealType,
    items: m.items,
    source: m.source,
    aggregated: m.aggregated,
    day: m.day,
  }));
  return { startedAt, asOf, meals: result, offline, lateDays };
}

/** The `meal_entries` insert for a planned meal. `user_id` is the column default (the signed-in user); `confirmed_at` is explicit (it is what the First Week counts read). */
export function toMealRow(meal: PlannedMeal, offlinePeriodId: string | null) {
  return {
    id: meal.id,
    occurred_at: meal.occurredAt.toISOString(),
    confirmed_at: meal.confirmedAt.toISOString(),
    meal_type: meal.mealType,
    items: itemsToJson(meal.items),
    source: meal.source,
    aggregated: meal.aggregated,
    offline_period_id: offlinePeriodId,
  };
}

/**
 * The profile columns a run sets: the same fields onboarding writes, through the app's own constants. The goal weight
 * is always numeric and set only so that the "Why we started" checks can prove the target number is never shown.
 */
export function toProfileUpdate(options: SeedOptions, startedAt: Date) {
  const place = getPlace("jerusalem");
  if (!place) throw new Error("seed_place_missing");
  return {
    lifecycle_state: "FIRST_WEEK",
    onboarding_step: STEP_IDS[STEP_IDS.length - 1],
    timezone: resolveTimeZone(options.timeZone),
    observes_shabbat: options.shabbat,
    place_key: place.key,
    city: place.cityName,
    latitude: place.latitude,
    longitude: place.longitude,
    in_israel: place.inIsrael,
    candle_lighting_minutes: place.candleDefault,
    onboarding_completed_at: startedAt.toISOString(),
    first_week_started_at: startedAt.toISOString(),
    first_week_ended_at: null,
    goal_focus: [...options.goals],
    motivation: options.motivation,
    goal_type: "numeric",
    start_weight_kg: 80,
    goal_weight_kg: 72,
  };
}
