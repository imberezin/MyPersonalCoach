import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRow } from "@/domain/onboarding";
import type { PatternView } from "@/domain/patterns";
import type { OnboardingContext } from "@/lib/onboarding/context";
import type { OpenExperiment } from "@/lib/experiments/repo";
import { loadNoticed } from "./noticed";

// The two First Week loaders are mocked: this file only decides what Progress keeps of their answers.
const loaders = vi.hoisted(() => ({
  signal: vi.fn(),
  experiments: vi.fn(),
}));
vi.mock("@/lib/patterns/load", () => ({ loadLateEveningSignal: loaders.signal }));
vi.mock("@/lib/experiments/repo", () => ({ loadExperiments: loaders.experiments }));

const USER = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-14T06:00:00Z");
const SUPABASE = {} as SupabaseClient;

function ready(): OnboardingContext {
  const row = normalizeRow({ lifecycle_state: "WEEKLY_CYCLE", timezone: "Asia/Jerusalem" }, null);
  if (!row) throw new Error("the fixture row did not normalize");
  return { kind: "ready", userId: USER, row, supabase: SUPABASE };
}

const signal = (view: PatternView) => ({ occurrences: [], row: null, view });
const experiment = (status: OpenExperiment["status"]): OpenExperiment => ({
  id: "e1",
  status,
  key: "eat_intentionally",
  variantId: "v1",
  wording: "A sentence the person saw",
  source: "library",
  locale: "en",
});
const experiments = (open: OpenExperiment | null) => ({ facts: [], open });

beforeEach(() => {
  loaders.signal.mockReset().mockResolvedValue(null);
  loaders.experiments.mockReset().mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadNoticed: the pattern", () => {
  it.each(["EARLY_SIGNAL", "CANDIDATE", "VALIDATED"] as const)("keeps the %s level, with its kind", async (view) => {
    loaders.signal.mockResolvedValue(signal(view));
    const noticed = await loadNoticed(ready(), NOW);
    expect(noticed.patterns).toEqual([{ kind: "late_evening_meals", view }]);
  });

  it.each(["NONE", "REJECTED"] as const)("says nothing at the %s level", async (view) => {
    loaders.signal.mockResolvedValue(signal(view));
    expect((await loadNoticed(ready(), NOW)).patterns).toEqual([]);
  });

  it("asks the loader with the person's id, zone and the given instant, and the experiments loader with the person's id", async () => {
    await loadNoticed(ready(), NOW);
    expect(loaders.signal).toHaveBeenCalledWith(SUPABASE, USER, "Asia/Jerusalem", NOW);
    expect(loaders.experiments).toHaveBeenCalledWith(SUPABASE, USER);
  });
});

describe("loadNoticed: the experiment", () => {
  it("keeps an ACTIVE experiment", async () => {
    const active = experiment("ACTIVE");
    loaders.experiments.mockResolvedValue(experiments(active));
    expect((await loadNoticed(ready(), NOW)).activeExperiment).toEqual(active);
  });

  it("does not keep an OFFERED one (a question, not something the person chose)", async () => {
    loaders.experiments.mockResolvedValue(experiments(experiment("OFFERED")));
    expect((await loadNoticed(ready(), NOW)).activeExperiment).toBeNull();
  });

  it("an experiment row with no open experiment (DONE, SKIPPED) is nothing", async () => {
    loaders.experiments.mockResolvedValue({ facts: [{ id: "e1", status: "DONE", sourcePatternId: null, endedAt: NOW }, { id: "e2", status: "SKIPPED", sourcePatternId: null, endedAt: NOW }], open: null });
    expect((await loadNoticed(ready(), NOW)).activeExperiment).toBeNull();
  });
});

describe("loadNoticed: unknown and failure", () => {
  it("null answers (unknown, a switch off) are simply nothing", async () => {
    expect(await loadNoticed(ready(), NOW)).toEqual({ patterns: [], activeExperiment: null });
  });

  it.each(["not_configured", "signed_out", "unavailable", "profile_missing"] as const)("%s: nothing, and neither loader is called", async (kind) => {
    const ctx = { kind, supabase: SUPABASE, userId: USER } as unknown as OnboardingContext;
    expect(await loadNoticed(ctx, NOW)).toEqual({ patterns: [], activeExperiment: null });
    expect(loaders.signal).not.toHaveBeenCalled();
    expect(loaders.experiments).not.toHaveBeenCalled();
  });

  it("never throws when a loader throws, and gives each call a fresh empty result", async () => {
    loaders.signal.mockRejectedValue(new Error("boom"));
    loaders.experiments.mockRejectedValue(new Error("boom"));
    const first = await loadNoticed(ready(), NOW);
    expect(first).toEqual({ patterns: [], activeExperiment: null });
    const second = await loadNoticed({ kind: "signed_out" }, NOW);
    expect(second).not.toBe(first);
  });

  it("an unknown answer from one loader leaves the other's answer intact", async () => {
    loaders.signal.mockResolvedValue(null);
    loaders.experiments.mockResolvedValue(experiments(experiment("ACTIVE")));
    const noticed = await loadNoticed(ready(), NOW);
    expect(noticed.patterns).toEqual([]);
    expect(noticed.activeExperiment).not.toBeNull();
  });
});
