/** Building and comparing portions, and reading a time of day. Pure, never throws for bad input. */
import { PORTION_AMOUNT_MAX, PORTION_SIZES, PORTION_UNITS, type Portion, type PortionSize, type PortionUnit } from "./types";

function asSize(value: string | null | undefined): PortionSize | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return (PORTION_SIZES as readonly string[]).includes(key) ? (key as PortionSize) : null;
}

function asUnit(value: string | null | undefined): PortionUnit | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  return (PORTION_UNITS as readonly string[]).includes(key) ? (key as PortionUnit) : null;
}

const hasText = (value: string | null | undefined): boolean => typeof value === "string" && value.trim() !== "";

/**
 * A size XOR an amount with a unit. Anything else is null: both given, a unit without an amount,
 * an unknown size or unit (case-insensitive), or an amount outside (0, PORTION_AMOUNT_MAX[unit]].
 * The amount is rounded to 2 decimals before it is checked.
 */
export function buildPortion(a: {
  size?: string | null;
  amount?: number | null;
  unit?: string | null;
  estimated: boolean;
}): Portion | null {
  const hasSize = hasText(a.size);
  const hasAmount = a.amount !== null && a.amount !== undefined;
  const hasUnit = hasText(a.unit);

  if (hasSize && (hasAmount || hasUnit)) return null;

  if (hasSize) {
    const size = asSize(a.size);
    return size ? { kind: "size", size, estimated: a.estimated } : null;
  }

  if (!hasAmount || !hasUnit) return null;
  const unit = asUnit(a.unit);
  if (!unit || typeof a.amount !== "number" || !Number.isFinite(a.amount)) return null;
  const amount = Math.round(a.amount * 100) / 100;
  if (amount <= 0 || amount > PORTION_AMOUNT_MAX[unit]) return null;
  return { kind: "amount", amount, unit, estimated: a.estimated };
}

/**
 * Whether two portions say the same thing. `estimated` is not part of the answer: it describes how
 * sure the system was, not what the portion is, so an edit that keeps the value is not a change.
 */
export function portionsEqual(a: Portion | null, b: Portion | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "size") return b.kind === "size" && a.size === b.size;
  return b.kind === "amount" && a.amount === b.amount && a.unit === b.unit;
}

/** "7:30" and "07:30" give 450. Anything else, including "24:00" and "7:5", gives null. */
export function parseLocalTime(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

/** 450 gives "07:30". The value is taken modulo one day, so it can never print "24:00". */
export function formatLocalTime(minuteOfDay: number): string {
  const minute = Number.isFinite(minuteOfDay) ? ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440 : 0;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
