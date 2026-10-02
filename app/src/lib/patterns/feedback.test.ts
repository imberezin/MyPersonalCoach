import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeWriteSupabase } from "./fakeWriteSupabase";
import { recordPatternFeedback } from "./feedback";

const PATTERN_ID = "7b0c9f4e-1a2b-4c3d-8e5f-0a1b2c3d4e5f";
const NOW = new Date("2026-10-09T10:00:00.000Z");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const withRows = (rows: unknown[]) => createFakeWriteSupabase({ tables: { patterns: { update: { rows } } } });

describe("recordPatternFeedback: the one conditional update", () => {
  it.each(["confirm", "unsure"] as const)("%s writes the answer and its time, and nothing else", async (feedback) => {
    const { client, queries } = withRows([{ id: PATTERN_ID }]);
    await recordPatternFeedback(client, { patternId: PATTERN_ID, feedback, now: NOW });

    expect(queries).toEqual([
      {
        kind: "query",
        table: "patterns",
        op: "update",
        columns: "id",
        payload: { user_feedback: feedback, user_feedback_at: NOW.toISOString() },
        filters: [
          ["eq", "id", PATTERN_ID],
          ["neq", "status", "REJECTED"],
        ],
      },
    ]);
  });

  it("reject also marks the row REJECTED", async () => {
    const { client, queries } = withRows([{ id: PATTERN_ID }]);
    await recordPatternFeedback(client, { patternId: PATTERN_ID, feedback: "reject", now: NOW });
    expect(queries[0].payload).toEqual({ user_feedback: "reject", user_feedback_at: NOW.toISOString(), status: "REJECTED" });
  });

  it("never touches a row the person already rejected (the filter), and never writes the status for the other answers", async () => {
    const { client, queries } = withRows([{ id: PATTERN_ID }]);
    await recordPatternFeedback(client, { patternId: PATTERN_ID, feedback: "unsure", now: NOW });
    expect(queries[0].filters).toContainEqual(["neq", "status", "REJECTED"]);
    expect(queries[0].payload).not.toHaveProperty("status");
  });

  it("one row changed is ok", async () => {
    const { client } = withRows([{ id: PATTERN_ID }]);
    expect(await recordPatternFeedback(client, { patternId: PATTERN_ID, feedback: "confirm", now: NOW })).toEqual({ ok: true });
  });

  it("no row changed (gone, or already rejected) is not ok", async () => {
    const { client } = withRows([]);
    expect(await recordPatternFeedback(client, { patternId: PATTERN_ID, feedback: "confirm", now: NOW })).toEqual({ ok: false });
  });

  it("an error and a network failure are not ok, and never throw", async () => {
    const failing = createFakeWriteSupabase({ tables: { patterns: { update: { error: { code: "42501" } } } } });
    expect(await recordPatternFeedback(failing.client, { patternId: PATTERN_ID, feedback: "confirm", now: NOW })).toEqual({ ok: false });
    const throwing = createFakeWriteSupabase({ tables: { patterns: { update: "throw" } } });
    await expect(recordPatternFeedback(throwing.client, { patternId: PATTERN_ID, feedback: "confirm", now: NOW })).resolves.toEqual({ ok: false });
    const broken = {
      from() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    await expect(recordPatternFeedback(broken, { patternId: PATTERN_ID, feedback: "confirm", now: NOW })).resolves.toEqual({ ok: false });
  });
});
