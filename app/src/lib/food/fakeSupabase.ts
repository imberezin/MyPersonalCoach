import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tiny stand-in for the Supabase client, for tests of code that reads and writes the food tables
 * (the sibling of ../onboarding/fakeSupabase.ts and ../home/fakeReadSupabase.ts). It records every
 * rpc and query in order and answers with whatever the test configured. It does not filter, order or
 * limit: it returns the configured rows and the test checks what was asked from the recorded call.
 *
 * Supported: rpc(name, args), and from(table) with select / update / eq / gt / order / limit /
 * maybeSingle, awaited (the builder is thenable, like the real PostgREST builder).
 */

export type FakeFoodCall =
  | { kind: "rpc"; name: string; args: unknown }
  | {
      kind: "query";
      table: string;
      /** "select" unless update() was called; then a following select() only names the returned columns. */
      op: "select" | "update";
      columns: string;
      patch?: unknown;
      filters: Array<["eq" | "gt", string, unknown]>;
      /** The FIRST order() call. */
      order?: { column: string; ascending: boolean };
      /** Every order() call in order (the first included); only set when order() was called more than once. */
      orders?: Array<{ column: string; ascending: boolean }>;
      limit?: number;
      single: boolean;
    };

type FakeError = { message?: string; code?: string };

/** `data`/`error` as the client would answer; "throw" makes awaiting reject, like a network failure. */
export type FakeRpcAnswer = { data?: unknown; error?: FakeError | "throw" };

/**
 * A table answers with an array of rows, with `{ error }`, or with "throw". Any other value is
 * returned as the data as is. A table that is not configured answers with an error.
 */
export function createFakeFoodSupabase(config: {
  rpc?: Record<string, FakeRpcAnswer>;
  tables?: Record<string, unknown>;
}): { client: SupabaseClient; calls: FakeFoodCall[] } {
  const calls: FakeFoodCall[] = [];
  const rpcs = config.rpc ?? {};
  const tables = config.tables ?? {};

  const answerFor = (table: string, single: boolean): Promise<{ data: unknown; error: unknown }> => {
    if (!Object.hasOwn(tables, table)) return Promise.resolve({ data: null, error: { message: "fake: table not configured" } });
    const answer = tables[table];
    if (answer === "throw") return Promise.reject(new Error("fake: network failure"));
    if (typeof answer === "object" && answer !== null && !Array.isArray(answer) && "error" in answer) {
      return Promise.resolve({ data: null, error: (answer as { error: unknown }).error });
    }
    if (single) {
      const first = Array.isArray(answer) ? (answer[0] ?? null) : answer;
      return Promise.resolve({ data: first ?? null, error: null });
    }
    return Promise.resolve({ data: answer ?? null, error: null });
  };

  const client = {
    from(table: string) {
      const call: Extract<FakeFoodCall, { kind: "query" }> = { kind: "query", table, op: "select", columns: "", filters: [], single: false };
      calls.push(call);
      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        update(patch: unknown) {
          call.op = "update";
          call.patch = patch;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push(["eq", column, value]);
          return builder;
        },
        gt(column: string, value: unknown) {
          call.filters.push(["gt", column, value]);
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          const next = { column, ascending: options?.ascending ?? true };
          if (call.order === undefined) {
            call.order = next;
          } else {
            call.orders = [...(call.orders ?? [call.order]), next];
          }
          return builder;
        },
        limit(count: number) {
          call.limit = count;
          return builder;
        },
        maybeSingle() {
          call.single = true;
          return answerFor(table, true);
        },
        // Awaiting the builder runs the "query", like the real PostgREST builder.
        then<R1 = unknown, R2 = never>(
          onFulfilled?: ((value: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
          onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
        ): Promise<R1 | R2> {
          return answerFor(table, false).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
    rpc(name: string, args: unknown) {
      calls.push({ kind: "rpc", name, args });
      const answer = Object.hasOwn(rpcs, name) ? rpcs[name] : { error: { message: "fake: rpc not configured" } };
      if (answer.error === "throw") return Promise.reject(new Error("fake: network failure"));
      return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}
