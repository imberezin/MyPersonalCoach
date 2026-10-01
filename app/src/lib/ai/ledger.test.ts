import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, isAdminConfigured, logAppError } from "./ledger";
import type { AiCallRecord } from "./types";

interface Insert {
  table: string;
  row: Record<string, unknown>;
}

function adminDouble(options: { error?: boolean; throws?: boolean } = {}) {
  const inserts: Insert[] = [];
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          if (options.throws) throw new Error("boom");
          inserts.push({ table, row });
          return Promise.resolve({ error: options.error ? { message: "nope" } : null });
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, inserts };
}

const record = (over: Partial<AiCallRecord> = {}): AiCallRecord => ({
  operation: "analyzeText",
  provider: "gemini",
  model: "gemini-3.1-flash-lite",
  latencyMs: 812.4,
  inputTokens: 300,
  outputTokens: 80,
  outcome: "ok",
  errorKind: null,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("isAdminConfigured", () => {
  const URL = "http://127.0.0.1:54321";
  it.each([
    [{ NEXT_PUBLIC_SUPABASE_URL: URL, SUPABASE_SECRET_KEY: "k" }, true],
    [{ NEXT_PUBLIC_SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: "k" }, true],
    [{ NEXT_PUBLIC_SUPABASE_URL: URL }, false],
    [{ SUPABASE_SECRET_KEY: "k" }, false],
    [{}, false],
    [{ NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "k" }, false],
    [{ NEXT_PUBLIC_SUPABASE_URL: URL, SUPABASE_SECRET_KEY: "" }, false],
    [{ NEXT_PUBLIC_SUPABASE_URL: URL, SUPABASE_SECRET_KEY: "   " }, false],
    // Same as createAdminClient: an empty secret key is not replaced by the service-role alias.
    [{ NEXT_PUBLIC_SUPABASE_URL: URL, SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "k" }, false],
  ])("%j -> %s", (env, expected) => {
    expect(isAdminConfigured(env)).toBe(expected);
  });

  it("never builds a client", () => {
    expect(() => isAdminConfigured({})).not.toThrow();
  });
});

describe("createSupabaseRecorder", () => {
  it("inserts one ai_requests row with whole numbers and the session user id", async () => {
    const { client, inserts } = adminDouble();
    await createSupabaseRecorder({ userId: "user-1", admin: client }).record(record());
    expect(inserts).toEqual([
      {
        table: "ai_requests",
        row: {
          user_id: "user-1",
          operation: "analyzeText",
          provider: "gemini",
          model: "gemini-3.1-flash-lite",
          latency_ms: 812,
          input_tokens: 300,
          output_tokens: 80,
          outcome: "ok",
        },
      },
    ]);
  });

  it("writes null tokens as null", async () => {
    const { client, inserts } = adminDouble();
    await createSupabaseRecorder({ userId: "u", admin: client }).record(record({ inputTokens: null, outputTokens: null, model: null }));
    expect(inserts[0].row).toMatchObject({ input_tokens: null, output_tokens: null, model: null });
  });

  it.each([
    ["auth", "provider_auth"],
    ["bad_request", "provider_bad_request"],
    ["blocked", "provider_blocked"],
  ] as const)("a %s failure also writes an app_errors row with the code %s and no content", async (errorKind, code) => {
    const { client, inserts } = adminDouble();
    await createSupabaseRecorder({ userId: "user-1", admin: client }).record(record({ outcome: "error", errorKind }));
    expect(inserts.map((i) => i.table)).toEqual(["ai_requests", "app_errors"]);
    expect(inserts[1].row).toEqual({
      user_id: "user-1",
      area: "ai",
      message: code,
      context: { provider: "gemini", model: "gemini-3.1-flash-lite", operation: "analyzeText" },
    });
  });

  it.each(["rate_limited", "server", "network", null] as const)("a %s attempt writes the ledger row only", async (errorKind) => {
    const { client, inserts } = adminDouble();
    await createSupabaseRecorder({ userId: "u", admin: client }).record(record({ outcome: errorKind ? "error" : "ok", errorKind }));
    expect(inserts.map((i) => i.table)).toEqual(["ai_requests"]);
  });

  it("never throws: an insert error, a thrown client and a missing admin key all resolve", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(createSupabaseRecorder({ userId: "u", admin: adminDouble({ error: true }).client }).record(record())).resolves.toBeUndefined();
    await expect(createSupabaseRecorder({ userId: "u", admin: adminDouble({ throws: true }).client }).record(record())).resolves.toBeUndefined();
  });

  it("constructing a recorder without the admin key does not throw, and record resolves as a no-op", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, a: process.env.SUPABASE_SECRET_KEY, b: process.env.SUPABASE_SERVICE_ROLE_KEY };
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      let recorder: ReturnType<typeof createSupabaseRecorder> | undefined;
      expect(() => (recorder = createSupabaseRecorder({ userId: "u" }))).not.toThrow();
      await expect(recorder?.record(record())).resolves.toBeUndefined();
    } finally {
      if (saved.url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
      if (saved.a !== undefined) process.env.SUPABASE_SECRET_KEY = saved.a;
      if (saved.b !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.b;
    }
  });
});

describe("logAppError", () => {
  it("inserts area, a short code and small context", async () => {
    const { client, inserts } = adminDouble();
    await logAppError({ userId: "u", area: "food", message: "save_error", context: { mode: "text", pg_code: "23505", attempts: 2, ok: false, none: null }, admin: client });
    expect(inserts).toEqual([
      { table: "app_errors", row: { user_id: "u", area: "food", message: "save_error", context: { mode: "text", pg_code: "23505", attempts: 2, ok: false, none: null } } },
    ]);
  });

  it("accepts a null user and drops context strings that look like content", async () => {
    const { client, inserts } = adminDouble();
    await logAppError({ userId: null, area: "ledger", message: "ledger_unavailable", context: { note: "x".repeat(65), keep: "y".repeat(64) }, admin: client });
    expect(inserts[0].row.user_id).toBeNull();
    expect(inserts[0].row.context).toEqual({ keep: "y".repeat(64) });
  });

  it("caps the message length", async () => {
    const { client, inserts } = adminDouble();
    await logAppError({ userId: "u", area: "ai", message: "m".repeat(500), admin: client });
    expect((inserts[0].row.message as string).length).toBe(64);
  });

  it("never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(logAppError({ userId: "u", area: "ai", message: "x", admin: adminDouble({ throws: true }).client })).resolves.toBeUndefined();
    await expect(logAppError({ userId: "u", area: "ai", message: "x", admin: adminDouble({ error: true }).client })).resolves.toBeUndefined();
  });
});
