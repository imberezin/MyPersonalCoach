// What the My weights page decides, with the gate and the repository mocked. The page returns an element tree; the async
// server components and the client components inside it are not rendered here (static markup cannot), so these tests read
// the elements' types and props: which state, and with what.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { ButtonLink } from "@/components/ui/Button";
import { WeightsEmpty } from "@/components/weight/WeightsEmpty";
import { WeightsList } from "@/components/weight/WeightsList";
import { WeightsNotice } from "@/components/weight/WeightsNotice";
import { WeightsUnavailable } from "@/components/weight/WeightsUnavailable";
import { WEIGHT_ROUTES, formatDayLabel, type WeightRow } from "@/domain/weight";
import he from "@/i18n/messages/he.json";
import WeightsPage, { generateMetadata } from "./page";

const SUPABASE = { tag: "client" };
const NOW = new Date("2026-10-01T09:30:00Z");
const ZONE = "Asia/Jerusalem";
const TOKEN = "5f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const OTHER_TOKEN = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const CURSOR = "0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a77";

const mocks = vi.hoisted(() => ({
  readGate: vi.fn(),
  listWeightEntries: vi.fn(),
  deleteWeightAction: vi.fn(async () => {}),
  flow: { reportingEnabled: true, progressEnabled: true, milestoneMomentEnabled: true },
  // Deleting and reading are not reporting: the page must never ask about offline periods.
  loadOfflinePeriods: vi.fn(() => {
    throw new Error("OFFLINE_PERIODS_READ");
  }),
}));

vi.mock("@/app/(flow)/report/weight/_lib/gate", () => ({ openWeightReadGate: mocks.readGate }));
vi.mock("@/lib/weight/repo", () => ({ listWeightEntries: mocks.listWeightEntries }));
vi.mock("./actions", () => ({ deleteWeightAction: mocks.deleteWeightAction }));
vi.mock("@/lib/home/load", () => ({ loadOfflinePeriods: mocks.loadOfflinePeriods }));
vi.mock("@/domain/weight", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domain/weight")>();
  return { ...original, WEIGHT_FLOW: mocks.flow };
});
vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("use-intl/core");
  const messages = (await import("@/i18n/messages/he.json")).default;
  return {
    getLocale: async () => "he",
    getTranslations: async (namespace?: string) => {
      const t = createTranslator({ locale: "he", messages: messages as never, namespace: namespace as never, timeZone: "UTC" });
      return (key: string, values?: Record<string, unknown>) => t(key as never, values as never);
    },
  };
});

const readyGate = (startWeight: number | null = 118.7) => ({
  kind: "ready",
  context: { kind: "ready", userId: "user-1", row: { lifecycle_state: "WEEKLY_CYCLE", timezone: ZONE, start_weight_kg: startWeight }, supabase: SUPABASE },
  now: NOW,
  timeZone: ZONE,
});

function weight(n: number, over: Partial<WeightRow> = {}): WeightRow {
  return {
    id: `0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a${String(n).padStart(2, "0")}`,
    weightKg: 118 - n / 10,
    measuredAt: new Date(`2026-09-${String(30 - n).padStart(2, "0")}T06:00:00Z`),
    note: null,
    ...over,
  };
}

const listed = (entries: WeightRow[], hasMore = false) => mocks.listWeightEntries.mockResolvedValue({ ok: true, value: { entries, hasMore } });

type Query = Record<string, string | string[] | undefined>;
const props = (query: Query = {}) => ({ searchParams: Promise.resolve(query) }) as never;
const render = async (query: Query = {}) => (await WeightsPage(props(query))) as ReactElement;

/** Every element of the tree, depth first. Components are not expanded: only what the page itself puts in. */
function elements(node: ReactNode, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found);
  } else if (isValidElement(node)) {
    found.push(node);
    elements((node.props as { children?: ReactNode }).children, found);
  }
  return found;
}
const ofType = (root: ReactElement, type: unknown) => elements(root).filter((element) => element.type === type);
const textOf = (element: ReactElement): string =>
  elements(element)
    .flatMap((child) => [(child.props as { children?: ReactNode }).children])
    .filter((child): child is string => typeof child === "string")
    .join("");
const startLines = (page: ReactElement) => elements(page).filter((element) => element.type === "p" && textOf(element).includes(he.weight.list.start));
const links = (page: ReactElement) => ofType(page, ButtonLink) as ReactElement<{ href: string; variant: string; children: string }>[];

beforeEach(() => {
  mocks.flow.reportingEnabled = true;
  mocks.readGate.mockReset().mockResolvedValue(readyGate());
  mocks.listWeightEntries.mockReset();
  mocks.loadOfflinePeriods.mockClear();
  listed([weight(1), weight(2)]);
});

describe("the title", () => {
  it("is 'My weights' from the catalog", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: he.weight.list.title });
  });
});

describe("the gate", () => {
  it("shows only the setup notice when Supabase is not set up", async () => {
    mocks.readGate.mockResolvedValue({ kind: "not_configured" });
    const page = await render();
    expect(page.type).toBe(SetupNotice);
    expect(mocks.listWeightEntries).not.toHaveBeenCalled();
  });

  it("shows the unavailable card, under the one h1, when the context cannot be read, and loads nothing", async () => {
    mocks.readGate.mockResolvedValue({ kind: "unavailable" });
    const page = await render();
    expect(ofType(page, "h1")).toHaveLength(1);
    expect(ofType(page, WeightsUnavailable)).toHaveLength(1);
    expect(ofType(page, WeightsEmpty)).toHaveLength(0);
    expect(ofType(page, WeightsList)).toHaveLength(0);
    expect(startLines(page)).toHaveLength(0);
    expect(mocks.listWeightEntries).not.toHaveBeenCalled();
  });

  it("works while an offline period or Shabbat is on, because it never asks", async () => {
    const page = await render();
    expect(ofType(page, WeightsList)).toHaveLength(1);
    expect(mocks.loadOfflinePeriods).not.toHaveBeenCalled();
  });
});

describe("the list", () => {
  it("has exactly one h1, and the section is named by it", async () => {
    const page = await render();
    const h1s = ofType(page, "h1");
    expect(h1s).toHaveLength(1);
    expect(textOf(h1s[0])).toBe(he.weight.list.title);
    expect((page.props as { "aria-labelledby": string })["aria-labelledby"]).toBe((h1s[0].props as { id: string }).id);
    expect(page.type).toBe("section");
  });

  it("gives the rows in the order the repository gave them (newest first), as words, keyed by the entry id", async () => {
    const entries = [weight(3), weight(1, { note: "after a walk" }), weight(2)];
    listed(entries);
    const [list] = ofType(await render(), WeightsList) as ReactElement<{
      rows: { entryId: string; dayText: string; kgText: string; unit: string; note: string | null; editHref: string | null }[];
      deleteAction: unknown;
      label: string;
      editLabel: string;
    }>[];
    expect(list.props.rows.map((row) => row.entryId)).toEqual(entries.map((entry) => entry.id));
    expect(list.props.rows[0]).toEqual({
      entryId: entries[0].id,
      dayText: formatDayLabel({ instant: entries[0].measuredAt, locale: "he", timeZone: ZONE, includeYear: false }),
      kgText: "117.7",
      unit: he.weight.form.unit,
      note: null,
      editHref: WEIGHT_ROUTES.edit(entries[0].id),
    });
    expect(list.props.rows[1].note).toBe("after a walk");
    expect(list.props.deleteAction).toBe(mocks.deleteWeightAction);
    expect(list.props.label).toBe(he.weight.list.label);
    expect(list.props.editLabel).toBe(he.weight.row.edit);
  });

  it("shows one decimal for a whole number", async () => {
    listed([weight(1, { weightKg: 118 })]);
    const [list] = ofType(await render(), WeightsList) as ReactElement<{ rows: { kgText: string }[] }>[];
    expect(list.props.rows[0].kgText).toBe("118.0");
  });

  it("names the day in the person's zone, with the year only when it is not this year", async () => {
    listed([weight(1, { measuredAt: new Date("2025-06-10T21:30:00Z") }), weight(2, { measuredAt: new Date("2026-09-28T21:30:00Z") })]);
    const [list] = ofType(await render(), WeightsList) as ReactElement<{ rows: { dayText: string }[] }>[];
    // 21:30Z is already the next local day in Jerusalem.
    expect(list.props.rows[0].dayText).toBe(formatDayLabel({ instant: new Date("2025-06-10T21:30:00Z"), locale: "he", timeZone: ZONE, includeYear: true }));
    expect(list.props.rows[0].dayText).toContain("2025");
    expect(list.props.rows[1].dayText).not.toContain("2026");
  });

  it("drops the Edit links while weight reporting is switched off (reading and deleting stay)", async () => {
    mocks.flow.reportingEnabled = false;
    const [list] = ofType(await render(), WeightsList) as ReactElement<{ rows: { editHref: string | null }[] }>[];
    expect(list.props.rows.map((row) => row.editHref)).toEqual([null, null]);
  });

  it("offers a way back to Me", async () => {
    expect(links(await render()).map((link) => link.props.href)).toEqual([WEIGHT_ROUTES.me]);
  });
});

describe("the cursor", () => {
  it("asks for the newest page with no cursor", async () => {
    await render();
    expect(mocks.listWeightEntries).toHaveBeenCalledWith(SUPABASE, { after: null });
  });

  it("asks for the page after a UUID cursor, passes it to every delete form, and offers the way back to the newest", async () => {
    const page = await render({ after: CURSOR });
    expect(mocks.listWeightEntries).toHaveBeenCalledWith(SUPABASE, { after: CURSOR });
    const [list] = ofType(page, WeightsList) as ReactElement<{ after: string | null }>[];
    expect(list.props.after).toBe(CURSOR);
    expect(links(page).map((link) => [link.props.href, link.props.children])).toEqual([
      [WEIGHT_ROUTES.list, he.weight.list.newest],
      [WEIGHT_ROUTES.me, he.weight.list.back],
    ]);
  });

  it.each([["abc"], [""], ["2026-10-01"], ["0"], [["x", CURSOR]], [[CURSOR]]] as [string | string[]][])(
    "falls back to the newest page for the cursor %j",
    async (after) => {
      const page = await render({ after });
      expect(mocks.listWeightEntries).toHaveBeenCalledWith(SUPABASE, { after: null });
      expect(links(page).map((link) => link.props.href)).toEqual([WEIGHT_ROUTES.me]);
    },
  );
});

describe("Show older", () => {
  it("is a link to the page after the last row shown, by its id", async () => {
    listed([weight(1), weight(2)], true);
    const older = links(await render()).filter((link) => link.props.children === he.weight.list.more);
    expect(older.map((link) => link.props.href)).toEqual([WEIGHT_ROUTES.listAfter(weight(2).id)]);
    expect(older[0].props.variant).toBe("secondary");
  });

  it("is not there when nothing more is stored", async () => {
    expect(links(await render()).filter((link) => link.props.children === he.weight.list.more)).toHaveLength(0);
  });

  it("carries only an id, never a date or a weight", async () => {
    listed([weight(1)], true);
    const [older] = links(await render()).filter((link) => link.props.children === he.weight.list.more);
    expect(older.props.href).toMatch(/^\/me\/weights\?after=[0-9a-f-]{36}$/);
  });
});

describe("where we started", () => {
  it("is a quiet last line of the oldest page, with the profile's number", async () => {
    const lines = startLines(await render());
    expect(lines).toHaveLength(1);
    expect(textOf(lines[0])).toContain("118.7");
    expect(textOf(lines[0])).toContain(he.weight.form.unit);
  });

  it("has no buttons", async () => {
    const [line] = startLines(await render());
    expect(ofType(line, ButtonLink)).toHaveLength(0);
    expect(ofType(line, "button")).toHaveLength(0);
  });

  it("is not there while older entries remain", async () => {
    listed([weight(1)], true);
    expect(startLines(await render())).toHaveLength(0);
  });

  it("is on the last page of a cursor too", async () => {
    expect(startLines(await render({ after: CURSOR }))).toHaveLength(1);
  });

  it("is not there when the profile has no starting weight", async () => {
    mocks.readGate.mockResolvedValue(readyGate(null));
    expect(startLines(await render())).toHaveLength(0);
  });

  it("is shown under the empty card, because the profile's number still exists", async () => {
    listed([]);
    expect(startLines(await render())).toHaveLength(1);
  });
});

describe("when there are no weights, and when the list cannot be loaded", () => {
  it("shows the empty card, and no list", async () => {
    listed([]);
    const page = await render();
    expect(ofType(page, WeightsEmpty)).toHaveLength(1);
    expect(ofType(page, WeightsList)).toHaveLength(0);
    expect(ofType(page, WeightsUnavailable)).toHaveLength(0);
    expect(ofType(page, "h1")).toHaveLength(1);
  });

  it("shows the unavailable card, and NEVER the empty card, when the load failed", async () => {
    mocks.listWeightEntries.mockResolvedValue({ ok: false, code: "unavailable" });
    const page = await render();
    expect(ofType(page, WeightsUnavailable)).toHaveLength(1);
    expect(ofType(page, WeightsEmpty)).toHaveLength(0);
    expect(ofType(page, WeightsList)).toHaveLength(0);
    expect(startLines(page)).toHaveLength(0);
    expect(links(page)).toHaveLength(0);
    expect(ofType(page, "h1")).toHaveLength(1);
  });
});

describe("the notice after a delete", () => {
  it.each(["deleted", "gone", "error"] as const)("shows the %s notice", async (notice) => {
    const notices = ofType(await render({ notice, n: TOKEN }), WeightsNotice) as ReactElement<{ notice: string }>[];
    expect(notices.map((element) => element.props.notice)).toEqual([notice]);
  });

  it.each([{}, { notice: "weird" }, { notice: "" }, { notice: "DELETED" }, { n: TOKEN }])("shows no notice for %j", async (query) => {
    expect(ofType(await render(query), WeightsNotice)).toHaveLength(0);
  });

  it("takes the first of a repeated notice", async () => {
    const [element] = ofType(await render({ notice: ["gone", "deleted"], n: TOKEN }), WeightsNotice) as ReactElement<{ notice: string }>[];
    expect(element.props.notice).toBe("gone");
  });

  it("is keyed by the one-shot token, so two deletes in a row are two different notices", async () => {
    const first = ofType(await render({ notice: "deleted", n: TOKEN }), WeightsNotice)[0];
    const second = ofType(await render({ notice: "deleted", n: OTHER_TOKEN }), WeightsNotice)[0];
    expect(first.key).toBe(TOKEN);
    expect(second.key).toBe(OTHER_TOKEN);
  });

  it.each([{}, { n: "not-a-uuid" }, { n: "" }, { n: ["not-a-uuid", TOKEN] }])("keys the notice by a fixed fallback for the token %j", async (extra) => {
    const [element] = ofType(await render({ notice: "deleted", ...extra }), WeightsNotice);
    expect(element.key).toBe("no-token");
  });

  it("is shown above the list, the empty card and the unavailable card alike", async () => {
    const order = (page: ReactElement, state: unknown) => {
      const all = elements(page);
      return all.findIndex((element) => element.type === WeightsNotice) < all.findIndex((element) => element.type === state);
    };
    expect(order(await render({ notice: "deleted", n: TOKEN }), WeightsList)).toBe(true);

    listed([]);
    expect(order(await render({ notice: "deleted", n: TOKEN }), WeightsEmpty)).toBe(true);

    mocks.listWeightEntries.mockResolvedValue({ ok: false, code: "unavailable" });
    expect(order(await render({ notice: "deleted", n: TOKEN }), WeightsUnavailable)).toBe(true);
  });
});
