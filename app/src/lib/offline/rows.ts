import type { OfflinePeriod, OfflineType } from "@/domain/offline";

// A Record, so a new OfflineType is a compile error here until it is listed.
const KNOWN_OFFLINE_TYPES: Record<OfflineType, true> = { SHABBAT: true, HOLIDAY: true, USER_DEFINED: true, VACATION: true };

const isOfflineType = (v: unknown): v is OfflineType => typeof v === "string" && Object.hasOwn(KNOWN_OFFLINE_TYPES, v);

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `offline_periods` rows (`type, start_at, end_at`) to periods. Rows with an unknown type or an unreadable date
 * are dropped, not guessed. Shared by the Home loader and the First Week loader, so both read a period the same way.
 */
export function parseOfflinePeriodRows(rows: unknown[]): OfflinePeriod[] {
  const periods: OfflinePeriod[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { type, start_at, end_at } = row as Record<string, unknown>;
    const start = toDate(start_at);
    const end = toDate(end_at);
    if (isOfflineType(type) && start && end) periods.push({ type, start, end });
  }
  return periods;
}
