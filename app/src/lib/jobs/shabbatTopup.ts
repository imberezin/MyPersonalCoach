import "server-only";
import type { ShabbatPeriodRow } from "@/domain/onboarding";
import { planShabbatTopup, type ExistingAutoShabbat, type TopupSkipReason } from "@/lib/shabbat/topup";

export interface TopupCandidate {
  userId: string;
  observesShabbat: boolean | null;
  placeKey: string | null;
  candleMinutes: number | null;
}

/** Everything the job needs from the database; the runner itself imports no Supabase code. */
export interface TopupStore {
  /** observes_shabbat = true AND onboarding_completed_at is not null, ordered by user_id, keyset after `afterUserId`. Throws on error. */
  listCandidates(afterUserId: string | null, limit: number): Promise<TopupCandidate[]>;
  /** type SHABBAT, source auto, end_at > now, for ONE user. Throws on error. */
  listFutureAutoShabbat(userId: string, now: Date): Promise<ExistingAutoShabbat[]>;
  /** Calls the insert-only function. Returns the rows inserted, or an error CODE (never a message). */
  insertRows(
    userId: string,
    target: { placeKey: string; candleMinutes: number },
    rows: ShabbatPeriodRow[],
  ): Promise<{ inserted: number } | { error: string }>;
}

export interface TopupSummary {
  /** Users examined. */
  candidates: number;
  /** Users who got at least one row (in a dry run: who would). */
  usersAdded: number;
  rowsPlanned: number;
  /** 0 in a dry run. */
  rowsInserted: number;
  /** Nothing to add (includes "the function inserted 0"). */
  current: number;
  /** The sum of skippedBy. */
  skipped: number;
  skippedBy: Partial<Record<TopupSkipReason, number>>;
  /** A read or write error for that user. */
  failed: number;
  dryRun: boolean;
  aborted: null | "candidates_failed" | "rpc_missing" | "deadline" | "user_cap";
}

export const TOPUP_PAGE_SIZE = 50;
export const TOPUP_MAX_USERS = 100;
/** Inside the route's maxDuration of 30 s: leaves 8 s for the user in flight and the response. */
export const TOPUP_DEADLINE_MS = 22_000;

/** Postgres / PostgREST codes for "this function does not exist" (the migration is not applied yet). */
const FUNCTION_MISSING = new Set(["PGRST202", "42883"]);

/** True when the run did not fully succeed: a failure, an abort, or a skip for a reason other than not observing. */
export function topupNeedsAttention(summary: TopupSummary): boolean {
  if (summary.failed > 0 || summary.aborted !== null) return true;
  return Object.entries(summary.skippedBy).some(([reason, count]) => reason !== "not_observing" && (count ?? 0) > 0);
}

/**
 * Adds the missing upcoming Shabbat rows for every user who observes Shabbat. Insert-only, idempotent, never
 * throws. One user failing never stops the others. Logs and the summary carry counts and fixed phrases only:
 * no user id, place, coordinates or minutes.
 */
export async function runShabbatTopup(
  store: TopupStore,
  options: {
    now: Date;
    dryRun?: boolean;
    nowMs?: () => number;
    pageSize?: number;
    maxUsers?: number;
    deadlineMs?: number;
    plan?: typeof planShabbatTopup;
  },
): Promise<TopupSummary> {
  const { now, dryRun = false } = options;
  const clock = options.nowMs ?? Date.now;
  const pageSize = options.pageSize ?? TOPUP_PAGE_SIZE;
  const maxUsers = options.maxUsers ?? TOPUP_MAX_USERS;
  const deadlineMs = options.deadlineMs ?? TOPUP_DEADLINE_MS;
  const plan = options.plan ?? planShabbatTopup;
  const startedAt = clock();

  const summary: TopupSummary = {
    candidates: 0,
    usersAdded: 0,
    rowsPlanned: 0,
    rowsInserted: 0,
    current: 0,
    skipped: 0,
    skippedBy: {},
    failed: 0,
    dryRun,
    aborted: null,
  };

  try {
    let cursor: string | null = null;
    pages: for (;;) {
      let page: TopupCandidate[];
      try {
        page = await store.listCandidates(cursor, pageSize);
      } catch {
        console.error("Shabbat top-up: reading the users failed");
        summary.aborted = "candidates_failed";
        break;
      }
      if (page.length === 0) break;

      for (const candidate of page) {
        if (summary.candidates >= maxUsers) {
          summary.aborted = "user_cap";
          break pages;
        }
        if (clock() - startedAt > deadlineMs) {
          summary.aborted = "deadline";
          break pages;
        }
        summary.candidates += 1;
        cursor = candidate.userId;

        try {
          const existing = await readExisting(store, candidate.userId, now);
          if (existing === null) {
            summary.failed += 1;
            continue;
          }
          const result = plan({
            profile: { observesShabbat: candidate.observesShabbat, placeKey: candidate.placeKey, candleMinutes: candidate.candleMinutes },
            existing,
            now,
          });

          if (result.kind === "skip") {
            summary.skipped += 1;
            summary.skippedBy[result.reason] = (summary.skippedBy[result.reason] ?? 0) + 1;
          } else if (result.kind === "current") {
            summary.current += 1;
          } else {
            summary.rowsPlanned += result.rows.length;
            if (dryRun) {
              summary.usersAdded += 1;
            } else {
              // The planner only returns "add" for a valid place and minutes, so both are present here.
              const target = { placeKey: candidate.placeKey as string, candleMinutes: candidate.candleMinutes as number };
              const written = await store.insertRows(candidate.userId, target, result.rows);
              if ("error" in written) {
                console.error("Shabbat top-up: insert failed", written.error);
                if (FUNCTION_MISSING.has(written.error)) {
                  summary.failed += 1;
                  summary.aborted = "rpc_missing";
                  break pages;
                }
                summary.failed += 1;
              } else if (written.inserted > 0) {
                summary.usersAdded += 1;
                summary.rowsInserted += written.inserted;
              } else {
                summary.current += 1;
              }
            }
          }
        } catch {
          console.error("Shabbat top-up: unexpected error for one user");
          summary.failed += 1;
        }
      }

      if (page.length < pageSize) break;
    }
  } catch {
    // Defensive: nothing above should throw out of the loop, but the job must never throw.
    console.error("Shabbat top-up: unexpected error");
    summary.failed += 1;
  }

  console.info("Shabbat top-up: done", summary);
  return summary;
}

/** The user's stored future rows, or null when the read failed (already logged as a fixed phrase). */
async function readExisting(store: TopupStore, userId: string, now: Date): Promise<ExistingAutoShabbat[] | null> {
  try {
    return await store.listFutureAutoShabbat(userId, now);
  } catch {
    console.error("Shabbat top-up: read failed");
    return null;
  }
}
