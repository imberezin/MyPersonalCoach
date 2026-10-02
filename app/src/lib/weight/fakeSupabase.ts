import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tiny stand-in for the Supabase client, for the tests of the weight repo and loaders (test-only; the existing
 * fakes are not edited). It records every call and answers with whatever the test configured for that table or
 * function. It does not filter, order or limit: it returns the configured rows and the test checks what was asked
 * from the recorded call.
 * Supported: from().select() with eq, neq, lt, or, order and limit (awaitable); from().upsert().select();
 * from().update().eq().select(); rpc().
 */

export type FilterOp = "eq" | "neq" | "lt";

export interface RecordedCall {
  kind: "select" | "upsert" | "update" | "rpc";
  /** The table, or the function name for an rpc. */
  target: string;
  /** select / the trailing select of an upsert or update. */
  columns?: string;
  filters: Array<[FilterOp, string, unknown]>;
  or?: string;
  order: Array<{ column: string; ascending: boolean }>;
  limit?: number;
  /** upsert / update: the values sent. rpc: the arguments. */
  values?: unknown;
  options?: unknown;
}

/**
 * rows: a table query succeeds with these rows. data: an rpc succeeds with this value. error: it answers with a
 * Supabase error object. "throw": awaiting it rejects, like a network failure that escapes the client.
 */
export type FakeAnswer = { rows: unknown[] } | { data: unknown } | { error: { message?: string; code?: string } } | "throw";

/** One answer, or a queue of answers consumed in call order (the last one repeats). */
export type FakeConfig = FakeAnswer | FakeAnswer[];

export function createFakeWeightSupabase(tables: Record<string, FakeConfig> = {}, rpcs: Record<string, FakeConfig> = {}): {
  client: SupabaseClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const used = new Map<string, number>();

  const answerFor = (scope: "table" | "rpc", target: string): FakeAnswer => {
    const source = scope === "table" ? tables : rpcs;
    const config = Object.hasOwn(source, target) ? source[target] : { error: { message: "fake: not configured" } };
    if (!Array.isArray(config)) return config;
    const key = `${scope}:${target}`;
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    return config[Math.min(index, config.length - 1)];
  };

  function settle(answer: FakeAnswer): Promise<{ data: unknown; error: unknown }> {
    if (answer === "throw") return Promise.reject(new Error("fake: network failure"));
    if ("rows" in answer) return Promise.resolve({ data: answer.rows, error: null });
    if ("data" in answer) return Promise.resolve({ data: answer.data, error: null });
    return Promise.resolve({ data: null, error: answer.error });
  }

  function thenable(call: RecordedCall, answer: FakeAnswer) {
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.filters.push(["eq", column, value]);
        return builder;
      },
      neq(column: string, value: unknown) {
        call.filters.push(["neq", column, value]);
        return builder;
      },
      lt(column: string, value: unknown) {
        call.filters.push(["lt", column, value]);
        return builder;
      },
      or(filters: string) {
        call.or = filters;
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        call.order.push({ column, ascending: options?.ascending ?? true });
        return builder;
      },
      limit(count: number) {
        call.limit = count;
        return builder;
      },
      // Awaiting the builder runs the "query", like the real PostgREST builder.
      then<R1 = unknown, R2 = never>(
        onFulfilled?: ((value: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
        onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
      ): Promise<R1 | R2> {
        return settle(answer).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      const start = (kind: RecordedCall["kind"], values?: unknown, options?: unknown) => {
        const call: RecordedCall = { kind, target: table, filters: [], order: [], values, options };
        calls.push(call);
        return thenable(call, answerFor("table", table));
      };
      return {
        select: (columns: string) => {
          const builder = start("select");
          return builder.select(columns);
        },
        upsert: (values: unknown, options?: unknown) => start("upsert", values, options),
        update: (values: unknown) => start("update", values),
      };
    },
    rpc(fn: string, args?: unknown) {
      const call: RecordedCall = { kind: "rpc", target: fn, filters: [], order: [], values: args };
      calls.push(call);
      return thenable(call, answerFor("rpc", fn));
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}
