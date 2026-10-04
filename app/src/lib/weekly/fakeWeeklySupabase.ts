import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tiny stand-in for the Supabase client, for the tests of the weekly loaders and writers (test-only; the shared fakes
 * are not edited beyond the `lt` filter of ../home/fakeReadSupabase.ts). It records every call in order and answers with
 * whatever the test configured for that table. It does not filter, order or limit: it returns the configured rows and the
 * test checks what was asked from the recorded call.
 *
 * Supported: from().select() with eq, neq, gt, gte, lt, lte, order and limit (awaitable); from().upsert().select();
 * from().update().eq().select(). The weekly loaders read the same table with several different questions (meal_entries is
 * read three times), so an answer may be a list consumed in call order (the last one repeats) or a function of the
 * recorded call.
 */

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

export interface WeeklyCall {
  kind: "select" | "upsert" | "update";
  table: string;
  /** select / the trailing select of an upsert or update. */
  columns?: string;
  filters: Array<[FilterOp, string, unknown]>;
  order: Array<{ column: string; ascending: boolean }>;
  limit?: number;
  /** upsert / update: the values sent. */
  values?: unknown;
  options?: unknown;
}

/** rows: the call succeeds with these rows. error: a Supabase error object. "throw": awaiting it rejects like a network failure. */
export type WeeklyAnswer = { rows: unknown[] } | { data: unknown } | { error: { message?: string; code?: string } } | "throw";

export type WeeklyConfig = WeeklyAnswer | WeeklyAnswer[] | ((call: WeeklyCall) => WeeklyAnswer);

export function createFakeWeeklySupabase(tables: Record<string, WeeklyConfig> = {}): { client: SupabaseClient; calls: WeeklyCall[] } {
  const calls: WeeklyCall[] = [];
  const used = new Map<string, number>();

  const answerFor = (table: string, call: WeeklyCall): WeeklyAnswer => {
    const config = Object.hasOwn(tables, table) ? tables[table] : { error: { message: "fake: table not configured" } };
    if (typeof config === "function") return config(call);
    if (!Array.isArray(config)) return config;
    const index = used.get(table) ?? 0;
    used.set(table, index + 1);
    return config[Math.min(index, config.length - 1)];
  };

  function settle(answer: WeeklyAnswer): Promise<{ data: unknown; error: unknown }> {
    if (answer === "throw") return Promise.reject(new Error("fake: network failure"));
    if ("rows" in answer) return Promise.resolve({ data: answer.rows, error: null });
    if ("data" in answer) return Promise.resolve({ data: answer.data, error: null });
    return Promise.resolve({ data: null, error: answer.error });
  }

  const client = {
    from(table: string) {
      const start = (kind: WeeklyCall["kind"], values?: unknown, options?: unknown) => {
        const call: WeeklyCall = { kind, table, filters: [], order: [], values, options };
        calls.push(call);
        const filter = (op: FilterOp) => (column: string, value: unknown) => {
          call.filters.push([op, column, value]);
          return builder;
        };
        const builder = {
          select(columns: string) {
            call.columns = columns;
            return builder;
          },
          eq: filter("eq"),
          neq: filter("neq"),
          gt: filter("gt"),
          gte: filter("gte"),
          lt: filter("lt"),
          lte: filter("lte"),
          order(column: string, opts?: { ascending?: boolean }) {
            call.order.push({ column, ascending: opts?.ascending ?? true });
            return builder;
          },
          limit(count: number) {
            call.limit = count;
            return builder;
          },
          // Awaiting the builder runs the "query", like the real PostgREST builder. The answer is chosen at that moment,
          // so a function answer sees the finished call (filters, columns, limit).
          then<R1 = unknown, R2 = never>(
            onFulfilled?: ((value: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
            onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
          ): Promise<R1 | R2> {
            return settle(answerFor(table, call)).then(onFulfilled, onRejected);
          },
        };
        return builder;
      };
      return {
        select: (columns: string) => start("select").select(columns),
        upsert: (values: unknown, options?: unknown) => start("upsert", values, options),
        update: (values: unknown) => start("update", values),
      };
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}
