import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tiny stand-in for the Supabase client, for tests of code that WRITES through it (the write twin of
 * ../home/fakeReadSupabase.ts; ../food/fakeSupabase.ts is shared with the meals item and is not edited). It records
 * every rpc and query in order and answers with whatever the test configured for that table and operation. It does
 * not filter, order or limit: it returns the configured rows and the test checks what was asked from the recorded call.
 *
 * Supported: rpc(name, args), and from(table) with select / insert / update followed by eq / neq / in / gt / gte / lte /
 * order / limit, and a select() after a write (it only names the returned columns). Awaited, like the real builder.
 */

export type FakeWriteFilter = [op: "eq" | "neq" | "in" | "gt" | "gte" | "lte", column: string, value: unknown];

export interface FakeWriteQuery {
  kind: "query";
  table: string;
  op: "select" | "insert" | "update";
  /** The columns named by select(), also after insert() or update(). */
  columns: string;
  /** The insert row or the update patch. */
  payload?: unknown;
  filters: FakeWriteFilter[];
  order?: { column: string; ascending: boolean };
  limit?: number;
}

export type FakeWriteCall = { kind: "rpc"; name: string; args: unknown } | FakeWriteQuery;

type FakeError = { message?: string; code?: string };

/** rows: the call succeeds with these rows. error: it answers with a Supabase error. "throw": awaiting rejects. */
export type FakeWriteAnswer = { rows: unknown[] } | { error: FakeError } | "throw";

/** `data` is returned as is; `error` is an error object, or "throw" to reject like a network failure. */
export type FakeRpcAnswer = { data?: unknown; error?: FakeError | "throw" };

export function createFakeWriteSupabase(config: {
  rpc?: Record<string, FakeRpcAnswer>;
  tables?: Record<string, Partial<Record<"select" | "insert" | "update", FakeWriteAnswer>>>;
}): { client: SupabaseClient; calls: FakeWriteCall[]; queries: FakeWriteQuery[]; rpcs: Array<Extract<FakeWriteCall, { kind: "rpc" }>> } {
  const calls: FakeWriteCall[] = [];
  const queries: FakeWriteQuery[] = [];
  const rpcs: Array<Extract<FakeWriteCall, { kind: "rpc" }>> = [];
  const rpcAnswers = config.rpc ?? {};
  const tables = config.tables ?? {};

  const settle = (table: string, op: FakeWriteQuery["op"]): Promise<{ data: unknown[] | null; error: unknown }> => {
    const answer = tables[table]?.[op];
    if (answer === undefined) return Promise.resolve({ data: null, error: { message: "fake: not configured" } });
    if (answer === "throw") return Promise.reject(new Error("fake: network failure"));
    return Promise.resolve("rows" in answer ? { data: answer.rows, error: null } : { data: null, error: answer.error });
  };

  const client = {
    from(table: string) {
      const query: FakeWriteQuery = { kind: "query", table, op: "select", columns: "", filters: [] };
      calls.push(query);
      queries.push(query);
      const filter = (op: FakeWriteFilter[0]) => (column: string, value: unknown) => {
        query.filters.push([op, column, value]);
        return builder;
      };
      const builder = {
        select(columns: string) {
          query.columns = columns;
          return builder;
        },
        insert(payload: unknown) {
          query.op = "insert";
          query.payload = payload;
          return builder;
        },
        update(payload: unknown) {
          query.op = "update";
          query.payload = payload;
          return builder;
        },
        eq: filter("eq"),
        neq: filter("neq"),
        in: filter("in"),
        gt: filter("gt"),
        gte: filter("gte"),
        lte: filter("lte"),
        order(column: string, options?: { ascending?: boolean }) {
          query.order = { column, ascending: options?.ascending ?? true };
          return builder;
        },
        limit(count: number) {
          query.limit = count;
          return builder;
        },
        // Awaiting the builder runs the "query", like the real PostgREST builder.
        then<R1 = unknown, R2 = never>(
          onFulfilled?: ((value: { data: unknown[] | null; error: unknown }) => R1 | PromiseLike<R1>) | null,
          onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
        ): Promise<R1 | R2> {
          return settle(table, query.op).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
    rpc(name: string, args: unknown) {
      const call = { kind: "rpc" as const, name, args };
      calls.push(call);
      rpcs.push(call);
      const answer = Object.hasOwn(rpcAnswers, name) ? rpcAnswers[name] : { error: { message: "fake: rpc not configured" } };
      if (answer.error === "throw") return Promise.reject(new Error("fake: network failure"));
      return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
    },
  };

  return { client: client as unknown as SupabaseClient, calls, queries, rpcs };
}
