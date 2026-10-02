import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tiny stand-in for the Supabase client, for tests of code that reads through it (the read twin of
 * ../onboarding/fakeSupabase.ts). It records every query and answers with whatever the test
 * configured for that table. It does not filter, order or limit: it returns the configured rows and
 * the test checks what was asked from the recorded query.
 * Only the calls the Home and First Week loaders use are supported:
 * from().select().eq().neq().gt().gte().lte().order().limit(), awaited.
 */

export type RecordedQuery = {
  table: string;
  columns: string;
  filters: Array<["eq" | "neq" | "gt" | "gte" | "lte", string, unknown]>;
  order?: { column: string; ascending: boolean };
  limit?: number;
};

/**
 * rows: the query succeeds with these rows. error: it answers with a Supabase error object.
 * "throw": awaiting it rejects, like a network failure that escapes the client.
 */
export type FakeTable = { rows: unknown[] } | { error: { message?: string; code?: string } } | "throw";

/** from(t).select(c).eq().neq().gt().gte().lte().order().limit() is awaitable and answers { data, error }. */
export function createFakeReadSupabase(tables: Record<string, FakeTable>): {
  client: SupabaseClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];

  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, columns: "", filters: [] };
      const answer = Object.hasOwn(tables, table) ? tables[table] : { error: { message: "fake: table not configured" } };

      const builder = {
        select(columns: string) {
          query.columns = columns;
          queries.push(query);
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push(["eq", column, value]);
          return builder;
        },
        neq(column: string, value: unknown) {
          query.filters.push(["neq", column, value]);
          return builder;
        },
        gt(column: string, value: unknown) {
          query.filters.push(["gt", column, value]);
          return builder;
        },
        gte(column: string, value: unknown) {
          query.filters.push(["gte", column, value]);
          return builder;
        },
        lte(column: string, value: unknown) {
          query.filters.push(["lte", column, value]);
          return builder;
        },
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
          const settled =
            answer === "throw"
              ? Promise.reject(new Error("fake: network failure"))
              : Promise.resolve("rows" in answer ? { data: answer.rows, error: null } : { data: null, error: answer.error });
          return settled.then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, queries };
}
