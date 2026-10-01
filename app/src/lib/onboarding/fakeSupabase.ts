import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tiny stand-in for the Supabase client, for tests of code that writes through it. It records
 * every update and rpc call in order, and answers updates with whatever `respond` returns.
 * Only the calls the onboarding writers use are supported: from().update().eq()....select() and rpc().
 */

export type RecordedCall =
  | { kind: "update"; table: string; patch: unknown; filters: Array<[string, unknown]>; columns: string }
  | { kind: "rpc"; name: string; args: unknown };

export interface FakeResult {
  data: unknown[] | null;
  error: { code?: string } | null;
}

export function createFakeSupabase(options: {
  respond?: (call: Extract<RecordedCall, { kind: "update" }>) => FakeResult;
  rpcError?: { code?: string } | null;
}) {
  const calls: RecordedCall[] = [];
  const respond = options.respond ?? (() => ({ data: [{ user_id: "u" }], error: null }));

  const client = {
    from(table: string) {
      const call: Extract<RecordedCall, { kind: "update" }> = { kind: "update", table, patch: undefined, filters: [], columns: "" };
      const builder = {
        update(patch: unknown) {
          call.patch = patch;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        select(columns: string) {
          call.columns = columns;
          calls.push(call);
          return Promise.resolve(respond(call));
        },
      };
      return builder;
    },
    rpc(name: string, args: unknown) {
      calls.push({ kind: "rpc", name, args });
      return Promise.resolve({ data: null, error: options.rpcError ?? null });
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}
