// "Thanks" on the landmark card: what it reads, what it writes, and that it always ends at Home. The gate, the clock and
// the event writer are mocked, so the test reads the calls; the writer's own rules are in analytics.test.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgeMilestoneAction } from "./actions";

const mocks = vi.hoisted(() => ({
  openContext: vi.fn(),
  track: vi.fn(),
  sinkFor: vi.fn(),
  revalidatePath: vi.fn(),
  currentInstant: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/app/(flow)/report/weight/_lib/gate", () => ({ openWeightActionContext: mocks.openContext }));
vi.mock("@/lib/analytics/track", () => ({
  SupabaseEventsSink: class {
    constructor(client: unknown) {
      mocks.sinkFor(client);
    }
  },
  track: mocks.track,
}));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));

const NOW = new Date("2026-10-28T09:00:00+02:00");
const SUPABASE = { tag: "client" };

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "RETURNED";
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN";
  }
}

beforeEach(() => {
  mocks.openContext.mockReset().mockResolvedValue({ kind: "ready", context: { kind: "ready", userId: "user-1", supabase: SUPABASE, row: {} } });
  mocks.track.mockReset().mockResolvedValue(undefined);
  mocks.sinkFor.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.currentInstant.mockReset().mockReturnValue(NOW);
});

describe("acknowledgeMilestoneAction", () => {
  it("writes one event with the confirming week and nothing else, stamped with the action's own clock", async () => {
    await expect(outcome(() => acknowledgeMilestoneAction(form({ week: "2026-10-18" })))).resolves.toBe("REDIRECT:/");

    expect(mocks.track).toHaveBeenCalledTimes(1);
    const [sink, name, payload, at] = mocks.track.mock.calls[0];
    expect(name).toBe("milestone_acknowledged");
    expect(payload).toEqual({ week: "2026-10-18" });
    expect(Object.keys(payload)).toEqual(["week"]);
    expect(at).toBe(NOW);
    // The sink writes as the signed-in person (RLS), through the verified session's client.
    expect(sink).toBeDefined();
    expect(mocks.sinkFor).toHaveBeenCalledWith(SUPABASE);
  });

  it("revalidates every page that showed the card, then ends at Home", async () => {
    await outcome(() => acknowledgeMilestoneAction(form({ week: "2026-10-18" })));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("reads only the field `week`: anything else the form carries is ignored", async () => {
    await outcome(() => acknowledgeMilestoneAction(form({ week: "2026-10-18", userId: "someone-else", weight: "118.7", kg: "75", milestone: "2" })));
    expect(mocks.track.mock.calls[0][2]).toEqual({ week: "2026-10-18" });
    expect(mocks.sinkFor).toHaveBeenCalledWith(SUPABASE);
  });

  it("accepts any real calendar day as the key, since a forged week only appends a harmless event", async () => {
    for (const week of ["2026-10-18", "2026-10-21", "2024-02-29"]) {
      mocks.track.mockClear();
      await outcome(() => acknowledgeMilestoneAction(form({ week })));
      expect(mocks.track, week).toHaveBeenCalledTimes(1);
    }
  });

  describe("a week that is not a calendar-valid YYYY-MM-DD key writes nothing and ends at Home", () => {
    const bad: Array<[string, FormData]> = [
      ["a day that does not exist", form({ week: "2026-02-30" })],
      ["a month that does not exist", form({ week: "2026-13-01" })],
      ["garbage", form({ week: "next week" })],
      ["an empty value", form({ week: "" })],
      ["a missing field", form({})],
      ["a date with a time", form({ week: "2026-10-18T00:00:00Z" })],
      ["a date with spaces around it", form({ week: " 2026-10-18 " })],
      ["a file", form({ week: new File(["2026-10-18"], "week.txt") })],
      ["a weight", form({ week: "118.7" })],
    ];

    it.each(bad)("%s", async (_name, data) => {
      await expect(outcome(() => acknowledgeMilestoneAction(data))).resolves.toBe("REDIRECT:/");
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      // And it does not even open the session: nothing to do for a value that cannot be a week.
      expect(mocks.openContext).not.toHaveBeenCalled();
    });
  });

  it("sends a signed-out visitor to sign in, writing nothing", async () => {
    mocks.openContext.mockImplementation(async () => {
      throw new Error("REDIRECT:/login");
    });
    await expect(outcome(() => acknowledgeMilestoneAction(form({ week: "2026-10-18" })))).resolves.toBe("REDIRECT:/login");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("ends at Home, writing nothing, when the database cannot be reached", async () => {
    mocks.openContext.mockResolvedValue({ kind: "unavailable" });
    await expect(outcome(() => acknowledgeMilestoneAction(form({ week: "2026-10-18" })))).resolves.toBe("REDIRECT:/");
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.sinkFor).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("still ends at Home when the event cannot be written: the card simply stays", async () => {
    mocks.track.mockRejectedValue(new Error("down"));
    await expect(outcome(() => acknowledgeMilestoneAction(form({ week: "2026-10-18" })))).resolves.toBe("REDIRECT:/");
  });

  it("never returns: every path ends in a redirect", async () => {
    for (const data of [form({ week: "2026-10-18" }), form({}), form({ week: "x" })]) {
      expect(await outcome(() => acknowledgeMilestoneAction(data))).toMatch(/^REDIRECT:/);
    }
  });

  it("uses the app's clock and never the real one, and is a Server Action file with only async exports", () => {
    const source = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/new Date\(/);
    expect(source).toMatch(/^"use server";/);
    expect(source.match(/^export (?!async function)/gm)).toBeNull();
  });

  it("puts no weight, landmark value or note in the event: the payload is the week alone", () => {
    const source = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");
    expect(source).toMatch(/\{ week \}, currentInstant\(\)/);
    expect(source).not.toMatch(/\{ week[^}]*,/);
  });
});
