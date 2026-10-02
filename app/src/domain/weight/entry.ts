import { parseDecimal, sanitizeText, type FormDataLike } from "../onboarding/parse";
import { localDayOf, resolveTimeZone, zonedInstantUtc } from "../time";
import { WEIGHT_FORM } from "./routes";
import { parseDayKey } from "./trend";
import { WEIGHT_ENTRY } from "./types";

/** The entry form: reading what was posted, the "when" list, and the rules that decide what is saved. Pure: no I/O, no clock. */

export type WeightErrorCode = "required" | "invalid_number" | "out_of_range" | "note_too_long" | "invalid_day" | "not_saved";
export interface WeightError {
  code: WeightErrorCode;
  field?: "weight" | "day" | "note";
}

/** Exactly what the form posted. `confirmed` is true only for the second submit after the double-check. */
export interface WeightFormValues {
  weight: string;
  day: string;
  note: string;
  confirmed: boolean;
}

export type WeightFormState =
  | null
  | { status: "error"; errors: readonly WeightError[]; values: WeightFormValues }
  /** The "is that right?" step: nothing was saved. */
  | { status: "check"; values: WeightFormValues };

function field(form: FormDataLike, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Only the WEIGHT_FORM fields; non-strings and files become "". */
export function readWeightForm(form: FormDataLike): WeightFormValues {
  return {
    weight: field(form, WEIGHT_FORM.weight),
    day: field(form, WEIGHT_FORM.day),
    note: field(form, WEIGHT_FORM.note),
    confirmed: form.get(WEIGHT_FORM.confirmed) === "1",
  };
}

export interface DayOption {
  /** "now", "keep" or the local day key "YYYY-MM-DD". */
  value: string;
  kind: "now" | "keep" | "yesterday" | "day";
  /** The local day key for "yesterday" and "day"; null for "now" and "keep". */
  dayKey: string | null;
}

/**
 * The "when" list. First "now" (new) or "keep" (edit, `currentMeasuredAt` given), then the previous
 * WEIGHT_ENTRY.earlierDays LOCAL days in the profile's zone, newest first, stepping back by local-day boundaries
 * (localDayOf(dayStart - 1 ms)), never by 24 hours, so a 23 or 25 hour day cannot repeat or skip a day. The first of them
 * has kind "yesterday". In edit mode the entry's own local day is added at the end when it is older than the window.
 * `timeZone` goes through resolveTimeZone.
 */
export function dayOptions(a: { now: Date; timeZone: string; currentMeasuredAt?: Date }): readonly DayOption[] {
  const tz = resolveTimeZone(a.timeZone);
  const editing = a.currentMeasuredAt !== undefined;
  const options: DayOption[] = [editing ? { value: "keep", kind: "keep", dayKey: null } : { value: "now", kind: "now", dayKey: null }];
  if (Number.isNaN(a.now.getTime())) return options;

  let dayStart = localDayOf(a.now, tz).start;
  for (let i = 1; i <= WEIGHT_ENTRY.earlierDays; i++) {
    const day = localDayOf(new Date(dayStart.getTime() - 1), tz);
    options.push({ value: day.key, kind: i === 1 ? "yesterday" : "day", dayKey: day.key });
    dayStart = day.start;
  }

  if (a.currentMeasuredAt !== undefined && !Number.isNaN(a.currentMeasuredAt.getTime())) {
    const ownKey = localDayOf(a.currentMeasuredAt, tz).key;
    const oldestKey = options[options.length - 1].value;
    // Keys are ISO dates, so string order is date order.
    if (ownKey < oldestKey) options.push({ value: ownKey, kind: "day", dayKey: ownKey });
  }
  return options;
}

/**
 * The instant stored for an "earlier" day: 12:00 local on that day (noon always exists, DST never skips it).
 * A key that is not a real calendar date gives an Invalid Date.
 */
export function measuredAtForDay(dayKey: string, timeZone: string): Date {
  const parts = parseDayKey(dayKey);
  if (!parts) return new Date(Number.NaN);
  return zonedInstantUtc(parts.year, parts.month, parts.day, 12, 0, resolveTimeZone(timeZone));
}

export type WeightValidation =
  /** `measuredAt` is null only for "keep". */
  | { ok: true; weightKg: number; measuredAt: Date | null; note: string | null; day: "now" | "earlier" | "keep" }
  | { ok: false; errors: readonly WeightError[] };

/**
 * What a submit means. All errors of one submit are returned together, in the order weight, day, note. The weight is rounded
 * once to one decimal and then checked against the INCLUSIVE range; the day must be one of the values `dayOptions` gives for
 * the same `now` (a forged or stale value is `invalid_day`; "keep" exists only in edit mode); the note is trimmed and an
 * empty one is null.
 */
export function validateWeightForm(
  values: WeightFormValues,
  ctx: { now: Date; timeZone: string; mode: { kind: "new" } | { kind: "edit"; measuredAt: Date } },
): WeightValidation {
  const errors: WeightError[] = [];

  let weightKg = 0;
  const weight = parseDecimal(values.weight, { min: WEIGHT_ENTRY.minKg, max: WEIGHT_ENTRY.maxKg });
  if (!weight.ok) {
    errors.push({ code: weight.code === "out_of_range" ? "out_of_range" : "invalid_number", field: "weight" });
  } else if (weight.value === null) {
    errors.push({ code: "required", field: "weight" });
  } else {
    weightKg = weight.value;
  }

  const options = dayOptions({
    now: ctx.now,
    timeZone: ctx.timeZone,
    currentMeasuredAt: ctx.mode.kind === "edit" ? ctx.mode.measuredAt : undefined,
  });
  const chosen = options.find((option) => option.value === values.day);
  if (!chosen) errors.push({ code: "invalid_day", field: "day" });

  let note: string | null = null;
  const sanitized = sanitizeText(values.note, WEIGHT_ENTRY.noteMaxCodePoints);
  if (!sanitized.ok) errors.push({ code: "note_too_long", field: "note" });
  else note = sanitized.value === "" ? null : sanitized.value;

  if (errors.length > 0 || !chosen) return { ok: false, errors };

  switch (chosen.kind) {
    case "now":
      return { ok: true, weightKg, measuredAt: ctx.now, note, day: "now" };
    case "keep":
      return { ok: true, weightKg, measuredAt: null, note, day: "keep" };
    default: {
      const measuredAt = measuredAtForDay(chosen.value, ctx.timeZone);
      // A listed day always exists; this only guards the impossible.
      if (Number.isNaN(measuredAt.getTime())) return { ok: false, errors: [{ code: "invalid_day", field: "day" }] };
      return { ok: true, weightKg, measuredAt, note, day: "earlier" };
    }
  }
}

/**
 * True when both are known and |weightKg - referenceKg| >= WEIGHT_ENTRY.jumpCheckKg. The difference is compared in integer
 * hundredths so float noise (118.7 - 103.7) cannot move it across the line. A null reference never asks.
 */
export function needsDoubleCheck(a: { weightKg: number; referenceKg: number | null }): boolean {
  if (a.referenceKg === null || !Number.isFinite(a.weightKg) || !Number.isFinite(a.referenceKg)) return false;
  return Math.round(Math.abs(a.weightKg - a.referenceKg) * 100) >= WEIGHT_ENTRY.jumpCheckKg * 100;
}
