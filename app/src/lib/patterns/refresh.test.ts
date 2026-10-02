import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { createFakeWriteSupabase, type FakeRpcAnswer, type FakeWriteAnswer } from "./fakeWriteSupabase";
import { refreshPatternsAfterMealChange } from "./refresh";

const flow = vi.hoisted(() => ({ detectionEnabled: true, earlySignalEnabled: true, experimentEnabled: true, syncOnMealChange: true }));
vi.mock("@/domain/patterns/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/patterns/types")>()),
  PATTERN_FLOW: flow,
}));

const USER = "00000000-0000-4000-8000-000000000001";
const PATTERN_ID = "7b0c9f4e-1a2b-4c3d-8e5f-0a1b2c3d4e5f";
const NOW = new Date("2026-10-09T10:00:00Z");

const meal = (id: string, day: number, hh: number) => ({ id, occurred_at: new Date(Date.UTC(2026, 9, day, hh - 3, 10)).toISOString() });
const THREE_EVENINGS = [meal("m1", 5, 21), meal("m2", 6, 22), meal("m3", 7, 21)];
const patternRow = (over: Record<string, unknown> = {}) => ({ id: PATTERN_ID, status: "CANDIDATE", user_feedback: null, user_feedback_at: null, ...over });

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;

function setup(a: { patterns?: FakeWriteAnswer; meals?: FakeWriteAnswer; rpc?: FakeRpcAnswer }) {
  const fake = createFakeWriteSupabase({
    tables: {
      patterns: { select: a.patterns ?? { rows: [] } },
      meal_entries: { select: a.meals ?? { rows: THREE_EVENINGS } },
    },
    rpc: { sync_pattern_evidence: a.rpc ?? { data: PATTERN_ID } },
  });
  const context = { kind: "ready", userId: USER, supabase: fake.client, row: { timezone: "Asia/Jerusalem" } } as unknown as ReadyContext;
  return { ...fake, context };
}

beforeEach(() => {
  flow.detectionEnabled = true;
  flow.syncOnMealChange = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("refreshPatternsAfterMealChange: a person who never engaged with the signal", () => {
  it("reads one row and stops: ZERO writes, no further reads (the real-account guarantee)", async () => {
    const { context, calls } = setup({ patterns: { rows: [] } });
    await refreshPatternsAfterMealChange(context, NOW);

    expect(calls.filter((c) => c.kind === "rpc")).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "query", table: "patterns", op: "select", columns: "id, status", limit: 1 });
    expect(calls[0]).toMatchObject({
      filters: [
        ["eq", "user_id", USER],
        ["eq", "kind", "late_evening_meals"],
      ],
    });
  });

  it("a failed or unreadable first read also writes nothing", async () => {
    for (const patterns of [{ error: { code: "42501" } }, "throw"] as const) {
      const { context, rpcs } = setup({ patterns });
      await refreshPatternsAfterMealChange(context, NOW);
      expect(rpcs).toEqual([]);
    }
  });
});

describe("refreshPatternsAfterMealChange: a person who has a pattern row", () => {
  it("syncs exactly once with the live occurrences and the live level", async () => {
    const { context, rpcs } = setup({ patterns: { rows: [patternRow({ status: "OBSERVATION" })] } });
    await refreshPatternsAfterMealChange(context, NOW);

    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].name).toBe("sync_pattern_evidence");
    expect(rpcs[0].args).toEqual({
      p_kind: "late_evening_meals",
      p_status: "CANDIDATE",
      p_occurrences: THREE_EVENINGS.map((m) => ({ meal_id: m.id, observed_at: m.occurred_at })),
    });
  });

  it("a deleted meal shrinks the set and downgrades the stored status (the mirror follows the live meals)", async () => {
    const { context, rpcs } = setup({ patterns: { rows: [patternRow()] }, meals: { rows: THREE_EVENINGS.slice(0, 2) } });
    await refreshPatternsAfterMealChange(context, NOW);
    expect((rpcs[0].args as { p_status: string; p_occurrences: unknown[] }).p_status).toBe("OBSERVATION");
    expect((rpcs[0].args as { p_occurrences: unknown[] }).p_occurrences).toHaveLength(2);
  });

  it("syncs an empty set when no late evening is left (the row stays, the evidence goes)", async () => {
    const { context, rpcs } = setup({ patterns: { rows: [patternRow()] }, meals: { rows: [] } });
    await refreshPatternsAfterMealChange(context, NOW);
    expect(rpcs[0].args).toEqual({ p_kind: "late_evening_meals", p_status: "OBSERVATION", p_occurrences: [] });
  });

  it("leaves a REJECTED row alone: the person said 'not related'", async () => {
    const { context, calls, rpcs } = setup({ patterns: { rows: [patternRow({ status: "REJECTED", user_feedback: "reject", user_feedback_at: NOW.toISOString() })] } });
    await refreshPatternsAfterMealChange(context, NOW);
    expect(rpcs).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("an unknown signal (a truncated or failed read) syncs nothing", async () => {
    const truncated = Array.from({ length: 400 }, (_, i) => meal(`t${i}`, 5, 21));
    for (const meals of [{ rows: truncated }, { error: { code: "42501" } }, "throw"] as const) {
      const { context, rpcs } = setup({ patterns: { rows: [patternRow()] }, meals });
      await refreshPatternsAfterMealChange(context, NOW);
      expect(rpcs).toEqual([]);
    }
  });
});

describe("refreshPatternsAfterMealChange: switches, failures, side effects", () => {
  it.each(["syncOnMealChange", "detectionEnabled"] as const)("%s off: no query at all", async (name) => {
    flow[name] = false;
    const { context, calls } = setup({ patterns: { rows: [patternRow()] } });
    await refreshPatternsAfterMealChange(context, NOW);
    expect(calls).toEqual([]);
  });

  it("every failure path resolves and never throws", async () => {
    for (const rpc of [{ error: { code: "22023" } }, { error: "throw" as const }, { data: "not-a-uuid" }]) {
      const { context } = setup({ patterns: { rows: [patternRow()] }, rpc });
      await expect(refreshPatternsAfterMealChange(context, NOW)).resolves.toBeUndefined();
    }
    const broken = { kind: "ready", userId: USER, row: { timezone: "UTC" }, supabase: { from: () => { throw new Error("boom"); } } as unknown as SupabaseClient } as unknown as ReadyContext;
    await expect(refreshPatternsAfterMealChange(broken, NOW)).resolves.toBeUndefined();
  });

  it("returns nothing, emits no analytics and uses no admin client (a source scan)", async () => {
    const { context } = setup({ patterns: { rows: [patternRow()] } });
    expect(await refreshPatternsAfterMealChange(context, NOW)).toBeUndefined();
    const text = readFileSync(join(process.cwd(), "src", "lib", "patterns", "refresh.ts"), "utf8");
    expect(text).not.toMatch(/analytics|track\(|supabase\/admin|createAdminClient/);
  });
});
