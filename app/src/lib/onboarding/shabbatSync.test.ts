import { afterEach, describe, expect, it, vi } from "vitest";
import { computeShabbatSeries } from "@/lib/shabbat/series";
import { createFakeSupabase } from "./fakeSupabase";
import { syncShabbatPeriods } from "./shabbatSync";

// Wrap the real calculation so one test can make it return nothing.
vi.mock("@/lib/shabbat/series", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/shabbat/series")>();
  return { computeShabbatSeries: vi.fn(original.computeShabbatSeries) };
});

const NOW = new Date("2026-10-01T09:00:00Z");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncShabbatPeriods", () => {
  it("clears the upcoming automatic periods with an empty list", async () => {
    const { client, calls } = createFakeSupabase({});
    expect(await syncShabbatPeriods(client, "clear", NOW)).toBe("cleared");
    expect(calls).toEqual([{ kind: "rpc", name: "replace_future_auto_shabbat", args: { p_rows: [] } }]);
  });

  it("replaces the upcoming periods with eight weeks of rows for the chosen place", async () => {
    const { client, calls } = createFakeSupabase({});
    const result = await syncShabbatPeriods(client, { placeKey: "jerusalem", candleMinutes: 40 }, NOW);

    expect(result).toBe("synced");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call.kind !== "rpc") throw new Error("expected an rpc call");
    const rows = (call.args as { p_rows: Array<{ start_at: string; end_at: string; metadata: Record<string, unknown> }> }).p_rows;
    expect(rows).toHaveLength(8);
    // Known times: Jerusalem, 40 minutes, the Shabbat after 2026-10-01.
    expect(rows[0].start_at).toBe("2026-10-02T14:43:00.000Z");
    expect(rows[0].metadata).toMatchObject({ place_key: "jerusalem", candle_lighting_minutes: 40 });
    expect(rows.every((r) => r.start_at < r.end_at)).toBe(true);
    expect(rows.map((r) => r.start_at)).toEqual([...rows.map((r) => r.start_at)].sort());
  });

  it("leaves the stored periods alone when the place is not in the list", async () => {
    const { client, calls } = createFakeSupabase({});
    expect(await syncShabbatPeriods(client, { placeKey: "atlantis", candleMinutes: 18 }, NOW)).toBe("pending");
    expect(calls).toEqual([]);
  });

  it("treats an empty calculation as a failure and does not wipe the existing rows", async () => {
    vi.mocked(computeShabbatSeries).mockReturnValueOnce([]);
    const { client, calls } = createFakeSupabase({});
    expect(await syncShabbatPeriods(client, { placeKey: "jerusalem", candleMinutes: 40 }, NOW)).toBe("pending");
    expect(calls).toEqual([]);
  });

  it("reports pending when the database call fails, without throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createFakeSupabase({ rpcError: { code: "42501" } });
    expect(await syncShabbatPeriods(client, { placeKey: "jerusalem", candleMinutes: 40 }, NOW)).toBe("pending");
    expect(await syncShabbatPeriods(client, "clear", NOW)).toBe("pending");
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("never throws, even when the calculation does", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(computeShabbatSeries).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const { client } = createFakeSupabase({});
    await expect(syncShabbatPeriods(client, { placeKey: "jerusalem", candleMinutes: 40 }, NOW)).resolves.toBe("pending");
    expect(error).toHaveBeenCalled();
  });
});
