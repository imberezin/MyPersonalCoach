import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpeningMode } from "@/domain/weekly";
import type { StoredLine } from "./load";

/**
 * The two writes to `weekly_summaries`. Every call runs as the signed-in user, so Row Level Security applies and the admin
 * client is never used. No function throws: a failure is `{ ok: false }`, and nothing is ever put in a log except Postgres
 * error codes (never the line, never a date the person could recognise). Both are reachable only from an explicit
 * Server Action: no read path imports this file.
 */

export type WeeklyRepoResult<T> = { ok: true; value: T } | { ok: false };

const TABLE = "weekly_summaries";
const UNIQUE_VIOLATION = "23505";
const FAILED = { ok: false } as const;

/**
 * The FIRST step of the press that opens the week: INSERT one row, `on conflict (user_id, week_start) do nothing`.
 * `created: true` = a row came back (this press opened the week). `created: false` = the week was already opened (an empty
 * answer, or a unique violation if the server answers the conflict with an error): the caller makes no AI call and emits
 * no event. `generated_at` and `viewed_at` are written EXPLICITLY from the action's instant: the database default is the
 * real clock, which under a past dev clock would be in the future of every reader. `weekStart` is the local Sunday date;
 * the database also checks that it is a Sunday.
 */
export async function openWeeklyStory(
  supabase: SupabaseClient,
  a: { userId: string; weekStart: string; mode: OpeningMode; now: Date },
): Promise<WeeklyRepoResult<{ created: boolean }>> {
  try {
    const nowIso = a.now.toISOString();
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        { user_id: a.userId, week_start: a.weekStart, opening_mode: a.mode, content: { v: 1 }, generated_at: nowIso, viewed_at: nowIso },
        { onConflict: "user_id,week_start", ignoreDuplicates: true },
      )
      .select("id");
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return { ok: true, value: { created: false } };
      console.error("Weekly: opening the week failed", error.code ?? "no_code");
      return FAILED;
    }
    if (!Array.isArray(data)) return FAILED;
    return { ok: true, value: { created: data.length > 0 } };
  } catch {
    console.error("Weekly: opening the week threw");
    return FAILED;
  }
}

/**
 * ONE update of `content` with the validated AI opening line. Only called by the press whose insert said `created: true`
 * (so only one press ever reaches it) and only for a LEARN week (the gate is closed for every other mode). The row keeps its
 * `opening_mode` and its timestamps. 0 rows (the row was erased meanwhile with its source) is `changed: false`.
 */
export async function upgradeWeeklyLine(
  supabase: SupabaseClient,
  a: { userId: string; weekStart: string; line: StoredLine },
): Promise<WeeklyRepoResult<{ changed: boolean }>> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ content: { v: 1, line: { text: a.line.text, locale: a.line.locale, source: "ai", mode: a.line.mode, key: a.line.key } } })
      .eq("user_id", a.userId)
      .eq("week_start", a.weekStart)
      .select("id");
    if (error) {
      console.error("Weekly: saving the opening line failed", error.code ?? "no_code");
      return FAILED;
    }
    if (!Array.isArray(data)) return FAILED;
    return { ok: true, value: { changed: data.length > 0 } };
  } catch {
    console.error("Weekly: saving the opening line threw");
    return FAILED;
  }
}
