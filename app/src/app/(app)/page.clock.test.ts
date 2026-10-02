// The Home page takes its one clock read from the app's own clock (the real time, or the development clock), and
// the First Week screens never read a clock themselves. The page is rendered as an element tree (the gate, the
// loader and the view are mocked): which instant reaches the loader and the refresher is what matters here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  loadHomeFacts: vi.fn(),
  currentInstant: vi.fn(),
}));

vi.mock("./_lib/gate", () => ({ openAppGate: mocks.gate }));
vi.mock("@/lib/home/load", () => ({ loadHomeFacts: mocks.loadHomeFacts }));
vi.mock("@/lib/clock/now", () => ({ currentInstant: mocks.currentInstant }));
// An async server component, which static markup cannot render: only the props it receives matter here.
vi.mock("./_components/HomeView", () => ({ HomeView: () => null }));
vi.mock("./_components/SetupNotice", () => ({ SetupNotice: () => null }));

const CONTEXT = { kind: "ready", userId: "user-1", row: { lifecycle_state: "FIRST_WEEK" } };
// A development clock: a fixed instant in the past.
const FAKE_NOW = new Date("2026-09-16T06:00:00Z");

const facts = (now: Date) => ({
  now,
  timeZone: "Asia/Jerusalem",
  offlinePeriods: [],
  hasAnyReport: true,
  lifecycle: "WEEKLY_CYCLE",
  firstWeek: null,
  firstWeekSnoozed: { summary: false, welcomeBack: false },
  earlySignal: null,
  quietHours: null,
});

beforeEach(() => {
  mocks.gate.mockReset().mockResolvedValue({ kind: "open", context: CONTEXT });
  mocks.currentInstant.mockReset().mockReturnValue(FAKE_NOW);
  mocks.loadHomeFacts.mockReset().mockImplementation(async (_context: unknown, now: Date) => facts(now));
});

describe("the Home page and the clock", () => {
  it("asks the app's clock once and gives that instant to the loader and to the refresher", async () => {
    const element = (await HomePage()) as ReactElement<{ renderedAt: number; timeZone: string }>;

    expect(mocks.currentInstant).toHaveBeenCalledTimes(1);
    expect(mocks.loadHomeFacts).toHaveBeenCalledTimes(1);
    expect(mocks.loadHomeFacts).toHaveBeenCalledWith(CONTEXT, FAKE_NOW);
    expect(element.props.renderedAt).toBe(FAKE_NOW.getTime());
    expect(element.props.timeZone).toBe("Asia/Jerusalem");
  });

  it("decides from that same instant: a fake clock in the morning gives the morning card, whatever the real time is", async () => {
    // 06:00Z is 09:00 in Jerusalem in September: the morning window.
    const element = (await HomePage()) as ReactElement<{ decision: { state: { key: string } } }>;
    expect(element.props.decision.state.key).toBe("MORNING");

    mocks.currentInstant.mockReturnValue(new Date("2026-09-16T19:00:00Z")); // 22:00 local
    const evening = (await HomePage()) as ReactElement<{ decision: { state: { key: string } } }>;
    expect(evening.props.decision.state.key).toBe("EVENING");
  });

  it("reads no clock when Supabase is not set up", async () => {
    mocks.gate.mockResolvedValue({ kind: "not_configured" });
    await HomePage();
    expect(mocks.currentInstant).not.toHaveBeenCalled();
    expect(mocks.loadHomeFacts).not.toHaveBeenCalled();
  });
});

// The reviewer's cross-check (blueprint 14.1) as a test: these places take their clock from currentInstant() and
// nowhere else, so a development clock can never be bypassed by a stray `new Date()`.
const APP = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("no stray clock read", () => {
  const files = [
    join(APP, "src", "app", "(app)", "page.tsx"),
    ...sourceFiles(join(APP, "src", "app", "(flow)", "first-week")),
    ...sourceFiles(join(APP, "src", "components", "firstWeek")),
  ];

  it("finds the files to check", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it("has no Date.now and no new Date( in the Home page, the First Week pages and actions, and the First Week components", () => {
    const offenders = files.filter((file) => /Date\.now|new Date\(/.test(readFileSync(file, "utf8"))).map((file) => relative(APP, file));
    expect(offenders).toEqual([]);
  });

  it("takes the instant in the First Week pages and actions from currentInstant()", () => {
    const calling = ["page.tsx", "actions.ts", join("experiment", "page.tsx"), join("experiment", "actions.ts")];
    for (const name of calling) {
      const source = readFileSync(join(APP, "src", "app", "(flow)", "first-week", name), "utf8");
      expect(source, name).toContain("currentInstant()");
    }
  });
});
