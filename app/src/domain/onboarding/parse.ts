/**
 * Reading what the onboarding form submitted: numbers, whole numbers and free text.
 * Pure, and never throws for user input; a bad value comes back as a typed code.
 */
import { MULTI_FIELDS, STEP_FIELDS, type RawFields, type StepId, type StepIntent } from "./model";

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; code: "invalid_number" | "out_of_range" | "too_long" };

type Range = { min: number; max: number };

// Left-to-right and right-to-left marks and embeddings: a phone keyboard in a Hebrew field can add them.
const DIRECTION_MARKS = /[‎‏‪-‮]/g;

const clean = (raw: string): string => raw.replace(DIRECTION_MARKS, "").trim();

/**
 * A decimal number with "," or "." as the separator and ASCII digits only. The value is rounded
 * once, to one decimal, and only then checked against the inclusive range. The rounding works
 * on the digits (the second decimal decides), so 99.55 is 99.6 and no binary-float edge case
 * can move a value across a bound. An empty field is a valid "no answer" (null).
 */
export function parseDecimal(raw: string, range: Range): Parsed<number | null> {
  const text = clean(raw);
  if (text === "") return { ok: true, value: null };

  const match = /^(\d+)(?:[.,](\d+))?$/.exec(text);
  if (!match) return { ok: false, code: "invalid_number" };

  const fraction = match[2] ?? "";
  const tenths = Number(match[1]) * 10 + Number(fraction[0] ?? 0) + (Number(fraction[1] ?? 0) >= 5 ? 1 : 0);
  const value = tenths / 10;
  if (!Number.isFinite(value) || value < range.min || value > range.max) return { ok: false, code: "out_of_range" };
  return { ok: true, value };
}

/** A whole number, digits only. An empty field is null. */
export function parseIntegerStrict(raw: string, range: Range): Parsed<number | null> {
  const text = clean(raw);
  if (text === "") return { ok: true, value: null };
  if (!/^\d+$/.test(text)) return { ok: false, code: "invalid_number" };

  const value = Number(text);
  if (!Number.isFinite(value) || value < range.min || value > range.max) return { ok: false, code: "out_of_range" };
  return { ok: true, value };
}

/**
 * Free text for the database: NUL is removed (Postgres text rejects it), line breaks are
 * normalised, the ends are trimmed, and the length is counted in code points.
 */
export function sanitizeText(raw: string, maxCodePoints: number): Parsed<string> {
  const text = raw.replaceAll("\u0000", "").replace(/\r\n?/g, "\n").trim();
  if (Array.from(text).length > maxCodePoints) return { ok: false, code: "too_long" };
  return { ok: true, value: text };
}

/** The part of FormData the readers need, so tests do not depend on the platform class. */
export interface FormDataLike {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

/**
 * Only the step's own fields, as submitted (values are not trimmed). File entries are dropped.
 * A single-value field the form did not send is simply absent.
 */
export function readRawFields(step: StepId, form: FormDataLike): RawFields {
  const raw: RawFields = {};
  for (const name of STEP_FIELDS[step]) {
    if (MULTI_FIELDS.has(name)) {
      raw[name] = form.getAll(name).filter((v): v is string => typeof v === "string");
    } else {
      const value = form.get(name);
      if (typeof value === "string") raw[name] = value;
    }
  }
  return raw;
}

/** Which submit button was pressed. Anything but the two exact values is a normal "continue". */
export function readIntent(form: FormDataLike): StepIntent {
  const value = form.get("intent");
  return value === "skip" || value === "decline" ? value : "continue";
}
