// What the My meals page decides, with the gate and the repository mocked. The page returns an element
// tree; the async server components and the client components inside it are not rendered here (static
// markup cannot), so these tests read the elements' types and props: which state, and with what.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { MealsEmpty } from "@/components/meals/MealsEmpty";
import { MealsList } from "@/components/meals/MealsList";
import { MealsNotice } from "@/components/meals/MealsNotice";
import { MealsUnavailable } from "@/components/meals/MealsUnavailable";
import { ShowMoreLink } from "@/components/meals/ShowMoreLink";
import { ButtonLink } from "@/components/ui/Button";
import { MEALS_ROUTES, type MealEntrySummary } from "@/domain/food";
import he from "@/i18n/messages/he.json";
import MealsPage, { generateMetadata } from "./page";

const SUPABASE = { tag: "client" };
const NOW = new Date("2026-10-01T09:30:00Z");
const TOKEN = "5f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const OTHER_TOKEN = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const mocks = vi.hoisted(() => ({
  reportGate: vi.fn(),
  listMealEntries: vi.fn(),
  deleteMealAction: vi.fn(async () => {}),
  // Deleting is not reporting: the page must never ask about offline periods.
  loadOfflinePeriods: vi.fn(() => {
    throw new Error("OFFLINE_PERIODS_READ");
  }),
}));

vi.mock("@/app/(flow)/report/food/_lib/gate", () => ({ openReportGate: mocks.reportGate }));
vi.mock("@/lib/food/repo", () => ({ listMealEntries: mocks.listMealEntries }));
vi.mock("./actions", () => ({ deleteMealAction: mocks.deleteMealAction }));
vi.mock("@/lib/home/load", () => ({ loadOfflinePeriods: mocks.loadOfflinePeriods }));
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

const readyGate = () => ({
  kind: "ready",
  context: { kind: "ready", userId: "user-1", row: { lifecycle_state: "FIRST_WEEK", timezone: "Asia/Jerusalem" }, supabase: SUPABASE },
  now: NOW,
  timeZone: "Asia/Jerusalem",
});

function meal(n: number, over: Partial<MealEntrySummary> = {}): MealEntrySummary {
  return { id: `0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a${String(n).padStart(2, "0")}`, occurredAt: new Date(`2026-10-01T0${9 - (n % 9)}:00:00Z`), mealType: "lunch", foods: [`food ${n}`], ...over };
}

const listed = (entries: MealEntrySummary[], hasMore = false) => mocks.listMealEntries.mockResolvedValue({ ok: true, value: { entries, hasMore } });

type Query = Record<string, string | string[] | undefined>;
const props = (query: Query = {}) => ({ searchParams: Promise.resolve(query) }) as never;
const render = async (query: Query = {}) => (await MealsPage(props(query))) as ReactElement;

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

beforeEach(() => {
  mocks.reportGate.mockReset().mockResolvedValue(readyGate());
  mocks.listMealEntries.mockReset();
  mocks.loadOfflinePeriods.mockClear();
  listed([meal(1), meal(2)]);
});

describe("the title", () => {
  it("is 'My meals' from the catalog", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: he.meals.meta.title });
  });
});

describe("the gate", () => {
  it("shows only the setup notice when Supabase is not set up", async () => {
    mocks.reportGate.mockResolvedValue({ kind: "not_configured" });
    const page = await render();
    expect(page.type).toBe(SetupNotice);
    expect(mocks.listMealEntries).not.toHaveBeenCalled();
  });

  it("shows the unavailable card, under the one h1, when the context cannot be read, and loads nothing", async () => {
    mocks.reportGate.mockResolvedValue({ kind: "unavailable" });
    const page = await render();
    expect(ofType(page, "h1")).toHaveLength(1);
    expect(ofType(page, MealsUnavailable)).toHaveLength(1);
    expect(ofType(page, MealsEmpty)).toHaveLength(0);
    expect(ofType(page, MealsList)).toHaveLength(0);
    expect(mocks.listMealEntries).not.toHaveBeenCalled();
  });

  it("works while an offline period or Shabbat is on, because it never asks", async () => {
    const page = await render();
    expect(ofType(page, MealsList)).toHaveLength(1);
    expect(mocks.loadOfflinePeriods).not.toHaveBeenCalled();
  });
});

describe("the list", () => {
  it("has exactly one h1, and the section is named by it", async () => {
    const page = await render();
    const h1s = ofType(page, "h1");
    expect(h1s).toHaveLength(1);
    expect(textOf(h1s[0])).toBe(he.meals.title);
    expect((page.props as { "aria-labelledby": string })["aria-labelledby"]).toBe((h1s[0].props as { id: string }).id);
    expect(page.type).toBe("section");
  });

  it("gives the rows in the order the repository gave them (newest first), keyed by the entry id", async () => {
    const entries = [meal(3), meal(1), meal(2)];
    listed(entries);
    const [list] = ofType(await render(), MealsList) as ReactElement<{ rows: { entryId: string; summary: { id: string } }[]; pages: number; deleteAction: unknown }>[];
    expect(list.props.rows.map((row) => row.entryId)).toEqual(entries.map((entry) => entry.id));
    expect(list.props.rows.map((row) => row.summary.id)).toEqual(entries.map((entry) => `meal-${entry.id}`));
  });

  it("hands the list the shared delete action and the page size", async () => {
    const [list] = ofType(await render({ pages: "3" }), MealsList) as ReactElement<{ deleteAction: unknown; pages: number }>[];
    expect(list.props.deleteAction).toBe(mocks.deleteMealAction);
    expect(list.props.pages).toBe(3);
  });

  it("builds each row's summary in the person's zone", async () => {
    // 09:00Z on 1 Oct is 12:00 in Israel, and the same day as now.
    listed([meal(1, { occurredAt: new Date("2026-10-01T09:00:00Z") })]);
    const [list] = ofType(await render(), MealsList) as ReactElement<{ rows: { summary: { whenText: string } }[] }>[];
    expect(list.props.rows[0].summary.whenText).toContain("12:00");
    expect(list.props.rows[0].summary.whenText).toContain(he.food.day.today);
  });

  it("offers a way back to Me", async () => {
    const links = ofType(await render(), ButtonLink) as ReactElement<{ href: string }>[];
    expect(links.map((link) => link.props.href)).toEqual([MEALS_ROUTES.me]);
  });
});

describe("how many meals are loaded", () => {
  it.each([
    [{}, 1],
    [{ pages: "1" }, 1],
    [{ pages: "3" }, 3],
    [{ pages: ["4", "2"] }, 4],
    [{ pages: "99" }, 6],
    [{ pages: "0" }, 1],
    [{ pages: "-2" }, 1],
    [{ pages: "abc" }, 1],
    [{ pages: "2.7" }, 2],
  ] as [Query, number][])("asks for %j as %i page(s)", async (query, expected) => {
    await render(query);
    expect(mocks.listMealEntries).toHaveBeenCalledWith(SUPABASE, { pages: expected });
  });
});

describe("Show more", () => {
  it("is a link to the next size while there is more and the cap is not reached", async () => {
    listed([meal(1)], true);
    const links = ofType(await render({ pages: "2" }), ShowMoreLink) as ReactElement<{ href: string }>[];
    expect(links.map((link) => link.props.href)).toEqual(["/me/meals?pages=3"]);
  });

  it("goes from the first size to ?pages=2", async () => {
    listed([meal(1)], true);
    const links = ofType(await render(), ShowMoreLink) as ReactElement<{ href: string }>[];
    expect(links.map((link) => link.props.href)).toEqual(["/me/meals?pages=2"]);
  });

  it("is not there when nothing more is stored", async () => {
    listed([meal(1)], false);
    const page = await render({ pages: "2" });
    expect(ofType(page, ShowMoreLink)).toHaveLength(0);
    expect(elements(page).filter((element) => element.type === "p" && textOf(element) === he.meals.capNote)).toHaveLength(0);
  });

  it("is replaced by the hint at the cap, and ?pages=99 counts as the cap", async () => {
    listed([meal(1)], true);
    for (const query of [{ pages: "6" }, { pages: "99" }]) {
      const page = await render(query);
      expect(ofType(page, ShowMoreLink)).toHaveLength(0);
      expect(elements(page).filter((element) => element.type === "p" && textOf(element) === he.meals.capNote)).toHaveLength(1);
    }
  });

  it("is a ShowMoreLink, the link that keeps the person's place", async () => {
    listed([meal(1)], true);
    expect(ofType(await render(), ShowMoreLink)).toHaveLength(1);
    expect(ofType(await render(), "a")).toHaveLength(0);
  });
});

describe("when there are no meals, and when the list cannot be loaded", () => {
  it("shows the empty card, and no list", async () => {
    listed([]);
    const page = await render();
    expect(ofType(page, MealsEmpty)).toHaveLength(1);
    expect(ofType(page, MealsList)).toHaveLength(0);
    expect(ofType(page, MealsUnavailable)).toHaveLength(0);
    expect(ofType(page, "h1")).toHaveLength(1);
  });

  it("shows the unavailable card, and NEVER the empty card, when the load failed", async () => {
    mocks.listMealEntries.mockResolvedValue({ ok: false, code: "unavailable" });
    const page = await render();
    expect(ofType(page, MealsUnavailable)).toHaveLength(1);
    expect(ofType(page, MealsEmpty)).toHaveLength(0);
    expect(ofType(page, MealsList)).toHaveLength(0);
    expect(ofType(page, ShowMoreLink)).toHaveLength(0);
    expect(ofType(page, "h1")).toHaveLength(1);
  });
});

describe("the notice after a delete", () => {
  it.each(["deleted", "gone", "error"] as const)("shows the %s notice", async (notice) => {
    const notices = ofType(await render({ notice, n: TOKEN }), MealsNotice) as ReactElement<{ notice: string }>[];
    expect(notices.map((element) => element.props.notice)).toEqual([notice]);
  });

  it.each([{}, { notice: "weird" }, { notice: "" }, { notice: "DELETED" }, { n: TOKEN }])("shows no notice for %j", async (query) => {
    expect(ofType(await render(query), MealsNotice)).toHaveLength(0);
  });

  it("takes the first of a repeated notice", async () => {
    const [element] = ofType(await render({ notice: ["gone", "deleted"], n: TOKEN }), MealsNotice) as ReactElement<{ notice: string }>[];
    expect(element.props.notice).toBe("gone");
  });

  it("is keyed by the one-shot token, so two deletes in a row are two different notices", async () => {
    const first = ofType(await render({ notice: "deleted", n: TOKEN }), MealsNotice)[0];
    const second = ofType(await render({ notice: "deleted", n: OTHER_TOKEN }), MealsNotice)[0];
    expect(first.key).toBe(TOKEN);
    expect(second.key).toBe(OTHER_TOKEN);
    expect(first.key).not.toBe(second.key);
  });

  it.each([{}, { n: "not-a-uuid" }, { n: "" }, { n: "x".repeat(65) }, { n: ["not-a-uuid", TOKEN] }])("keys the notice by a fixed fallback for the token %j", async (extra) => {
    const [element] = ofType(await render({ notice: "deleted", ...extra }), MealsNotice);
    expect(element.key).toBe("no-token");
  });

  it("is shown above the list, the empty card and the unavailable card alike", async () => {
    const order = (page: ReactElement, state: unknown) => {
      const all = elements(page);
      return all.findIndex((element) => element.type === MealsNotice) < all.findIndex((element) => element.type === state);
    };
    expect(order(await render({ notice: "deleted", n: TOKEN }), MealsList)).toBe(true);

    listed([]);
    expect(order(await render({ notice: "deleted", n: TOKEN }), MealsEmpty)).toBe(true);

    mocks.listMealEntries.mockResolvedValue({ ok: false, code: "unavailable" });
    expect(order(await render({ notice: "deleted", n: TOKEN }), MealsUnavailable)).toBe(true);
  });
});
