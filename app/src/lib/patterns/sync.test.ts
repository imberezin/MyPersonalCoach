import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Occurrence } from "@/domain/patterns";
import { createFakeWriteSupabase } from "./fakeWriteSupabase";
import { syncPatternEvidence } from "./sync";

const PATTERN_ID = "7b0c9f4e-1a2b-4c3d-8e5f-0a1b2c3d4e5f";
const MEAL_1 = "11111111-1111-4111-8111-aaaaaaaaaaa1";
const MEAL_2 = "11111111-1111-4111-8111-aaaaaaaaaaa2";

const occurrence = (mealId: string, iso: string): Occurrence => ({ mealId, occurredAt: new Date(iso), localDay: iso.slice(0, 10) });
const OCCURRENCES = [occurrence(MEAL_1, "2026-10-01T18:40:00Z"), occurrence(MEAL_2, "2026-10-02T19:05:00Z")];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncPatternEvidence: the exact call", () => {
  it("names the function, the kind, the stored status and the occurrences, and nothing else", async () => {
    const { client, rpcs } = createFakeWriteSupabase({ rpc: { sync_pattern_evidence: { data: PATTERN_ID } } });
    const result = await syncPatternEvidence(client, { occurrences: OCCURRENCES, view: "CANDIDATE" });

    expect(result).toEqual({ ok: true, patternId: PATTERN_ID });
    expect(rpcs).toEqual([
      {
        kind: "rpc",
        name: "sync_pattern_evidence",
        args: {
          p_kind: "late_evening_meals",
          p_status: "CANDIDATE",
          p_occurrences: [
            { meal_id: MEAL_1, observed_at: "2026-10-01T18:40:00.000Z" },
            { meal_id: MEAL_2, observed_at: "2026-10-02T19:05:00.000Z" },
          ],
        },
      },
    ]);
  });

  it.each([
    ["NONE", "OBSERVATION"],
    ["EARLY_SIGNAL", "OBSERVATION"],
    ["CANDIDATE", "CANDIDATE"],
    ["VALIDATED", "VALIDATED"],
  ] as const)("sends the level %s as the stored status %s (the column has no EARLY_SIGNAL)", async (view, stored) => {
    const { client, rpcs } = createFakeWriteSupabase({ rpc: { sync_pattern_evidence: { data: PATTERN_ID } } });
    await syncPatternEvidence(client, { occurrences: [], view });
    expect((rpcs[0].args as { p_status: string }).p_status).toBe(stored);
  });

  it("an empty occurrence list is sent as an empty array (the 'not related' sequence relies on it)", async () => {
    const { client, rpcs } = createFakeWriteSupabase({ rpc: { sync_pattern_evidence: { data: PATTERN_ID } } });
    await syncPatternEvidence(client, { occurrences: [], view: "NONE" });
    expect((rpcs[0].args as { p_occurrences: unknown }).p_occurrences).toEqual([]);
  });
});

describe("syncPatternEvidence: failures are { ok: false }, never a throw", () => {
  it.each([
    ["an error", { error: { code: "42501" } }],
    ["a network failure", { error: "throw" as const }],
    ["no id", { data: null }],
    ["a number", { data: 7 }],
    ["a string that is not a uuid", { data: "not-a-uuid" }],
    ["an object", { data: { id: PATTERN_ID } }],
  ])("%s", async (_name, answer) => {
    const { client } = createFakeWriteSupabase({ rpc: { sync_pattern_evidence: answer } });
    await expect(syncPatternEvidence(client, { occurrences: OCCURRENCES, view: "CANDIDATE" })).resolves.toEqual({ ok: false });
  });

  it("a client that throws on first use", async () => {
    const broken = {
      rpc() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    await expect(syncPatternEvidence(broken, { occurrences: [], view: "NONE" })).resolves.toEqual({ ok: false });
  });

  it("logs the error code only", async () => {
    const { client } = createFakeWriteSupabase({ rpc: { sync_pattern_evidence: { error: { code: "22023", message: `bad_status ${MEAL_1}` } } } });
    await syncPatternEvidence(client, { occurrences: OCCURRENCES, view: "CANDIDATE" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(MEAL_1);
  });
});

describe("the only caller of the evidence writer", () => {
  it("no other file under src/ names the SQL function", () => {
    const named: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) && readFileSync(path, "utf8").includes("sync_pattern_evidence")) {
          named.push(relative(process.cwd(), path).replaceAll("\\", "/"));
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(named).toEqual(["src/lib/patterns/sync.ts"]);
  });
});
