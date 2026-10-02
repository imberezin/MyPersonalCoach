import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolveInstant } from "@/lib/clock/now";
import { tzOffsetMs } from "@/domain/time";

/**
 * The dev clock file (`app/.dev-clock`, gitignored): ONE ISO-8601 instant with an offset. The app reads it only in
 * development against the local stack (src/lib/clock/now.ts); this module is the only writer. Reading goes through the
 * app's own `resolveInstant`, so what is written here is exactly what the app accepts.
 */

const MINUTE_MS = 60_000;
const UNIT_MS = { m: MINUTE_MS, h: 60 * MINUTE_MS, d: 24 * 60 * MINUTE_MS } as const;

/** "2026-09-17T09:00:00+03:00": the instant on the wall clock of `timeZone`, with its offset. */
export function formatClockInstant(instant: Date, timeZone: string): string {
  const wholeSecond = Math.floor(instant.getTime() / 1000) * 1000;
  const offsetMs = tzOffsetMs(instant, timeZone);
  const wall = new Date(wholeSecond + offsetMs).toISOString().slice(0, 19);
  const sign = offsetMs < 0 ? "-" : "+";
  const total = Math.round(Math.abs(offsetMs) / MINUTE_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${wall}${sign}${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** "+25h", "-2h", "+15d", "+30m" to milliseconds, or null when it is not one of those. */
export function parseShift(spec: string): number | null {
  const match = /^([+-])(\d{1,4})([mhd])$/.exec(spec.trim());
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * Number(match[2]) * UNIT_MS[match[3] as keyof typeof UNIT_MS];
}

/** `instant` moved by a shift such as "+25h". null for a shift that is not valid. */
export function shiftInstant(instant: Date, spec: string): Date | null {
  const ms = parseShift(spec);
  return ms === null ? null : new Date(instant.getTime() + ms);
}

/** The instant a clock file's text holds (the app's own rules), or null for anything the app would ignore. */
export function parseClockText(text: string | null): Date | null {
  const instant = resolveInstant({
    nodeEnv: "development",
    supabaseUrl: "http://127.0.0.1",
    readFile: () => text,
    real: () => new Date(Number.NaN),
  });
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export function readClockFile(path: string): Date | null {
  try {
    return existsSync(path) ? parseClockText(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

export function writeClockFile(path: string, instant: Date, timeZone: string): string {
  const text = formatClockInstant(instant, timeZone);
  writeFileSync(path, `${text}\n`, "utf8");
  return text;
}

/** true when a file was there. */
export function removeClockFile(path: string): boolean {
  try {
    const existed = existsSync(path);
    rmSync(path, { force: true });
    return existed;
  } catch {
    return false;
  }
}
