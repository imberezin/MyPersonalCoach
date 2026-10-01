// What each flow page decides, with the loaders mocked. The pages return an element tree; the async
// server components inside it are not rendered here (static markup cannot), so these tests read the
// element's type and props: which screen, and with what.
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { ConfirmScreen } from "@/components/food/ConfirmScreen";
import { EditForm } from "@/components/food/EditForm";
import { FlowUnavailable } from "@/components/food/FlowUnavailable";
import { FoodChooser } from "@/components/food/FoodChooser";
import { PhotoReport } from "@/components/food/PhotoReport";
import { PhotoUnavailable } from "@/components/food/PhotoUnavailable";
import { QuietNotice } from "@/components/food/QuietNotice";
import { SavedView } from "@/components/food/SavedView";
import { TextReport } from "@/components/food/TextReport";
import { FOOD_ROUTES, mealOf, revisionOf, type Understanding } from "@/domain/food";
import ConfirmPage, { generateMetadata as confirmMetadata } from "./[id]/page";
import EditPage from "./[id]/edit/page";
import SavedPage from "./[id]/saved/page";
import ChooserPage, { generateMetadata as chooserMetadata } from "./page";
import PhotoPage from "./photo/page";
import TextPage from "./text/page";

const ID = "0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a10";
const SUPABASE = { tag: "client" };

const mocks = vi.hoisted(() => ({
  entryGate: vi.fn(),
  reportGate: vi.fn(),
  isAiConfigured: vi.fn(),
  findResumable: vi.fn(),
  loadUnderstanding: vi.fn(),
  loadSavedMeal: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string, type?: string) => {
    throw new Error(`REDIRECT:${to}:${type ?? "default"}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  RedirectType: { replace: "replace", push: "push" },
}));
vi.mock("./_lib/gate", () => ({ openFoodEntryGate: mocks.entryGate, openReportGate: mocks.reportGate }));
vi.mock("./actions", () => ({
  confirmMealAction: async () => {},
  discardAction: async () => {},
  saveEditAction: async () => null,
}));
vi.mock("@/lib/ai/factory", () => ({ isAiConfigured: mocks.isAiConfigured }));
vi.mock("@/lib/food/repo", () => ({
  findResumable: mocks.findResumable,
  loadUnderstanding: mocks.loadUnderstanding,
  loadSavedMeal: mocks.loadSavedMeal,
}));
vi.mock("@/i18n/server", async () => {
  const { createTranslator } = await import("use-intl/core");
  const he = (await import("@/i18n/messages/he.json")).default;
  return {
    getLocale: async () => "he",
    getTranslations: async (namespace?: string) => {
      const t = createTranslator({ locale: "he", messages: he as never, namespace: namespace as never, timeZone: "UTC" });
      return (key: string, values?: Record<string, unknown>) => t(key as never, values as never);
    },
  };
});

const NOW = new Date("2026-10-01T09:30:00Z");

const readyGate = (lifecycle_state = "FIRST_WEEK") => ({
  kind: "ready",
  context: { kind: "ready", userId: "user-1", row: { lifecycle_state, timezone: "Asia/Jerusalem" }, supabase: SUPABASE },
  now: NOW,
  timeZone: "Asia/Jerusalem",
});

function understanding(over: Partial<Understanding> = {}): Understanding {
  return {
    id: ID,
    kind: "text",
    provider: "gemini",
    model: "m",
    promptVersion: "meal-v1",
    status: "pending",
    items: [{ name: "schnitzel", portion: null, uncertain: false, confidence: 0.9 }],
    unclear: [],
    overallConfidence: 0.8,
    proposed: { mealType: "lunch", occurredAt: new Date("2026-10-01T09:00:00Z") },
    draft: null,
    createdAt: new Date("2026-10-01T09:20:00Z"),
    ...over,
  };
}

const idProps = (query: Record<string, string | string[] | undefined> = {}, id = ID) =>
  ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) }) as never;

async function outcome(run: () => Promise<unknown>): Promise<ReactElement | string> {
  try {
    return (await run()) as ReactElement;
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN";
  }
}

beforeEach(() => {
  mocks.entryGate.mockReset().mockResolvedValue(readyGate());
  mocks.reportGate.mockReset().mockResolvedValue(readyGate());
  mocks.isAiConfigured.mockReset().mockReturnValue(true);
  mocks.findResumable.mockReset().mockResolvedValue(null);
  mocks.loadUnderstanding.mockReset().mockResolvedValue({ ok: true, value: understanding() });
  mocks.loadSavedMeal.mockReset().mockResolvedValue({ ok: true, value: { entryId: "entry-1", confirmedAt: NOW, isFirstMeal: true } });
});

describe("titles", () => {
  it("every flow page is titled 'Report food' from the catalog", async () => {
    await expect(chooserMetadata()).resolves.toEqual({ title: "דיווח על אוכל" });
    await expect(confirmMetadata()).resolves.toEqual({ title: "דיווח על אוכל" });
  });
});

describe("the entry pages (D1, D2, D3) share the entry gate", () => {
  const pages = [
    ["D1 chooser", () => ChooserPage()],
    ["D2 photo", () => PhotoPage()],
    ["D3 text", () => TextPage()],
  ] as const;

  it.each(pages)("%s shows the setup notice, the unavailable card and the quiet screen for those gates", async (_name, page) => {
    mocks.entryGate.mockResolvedValue({ kind: "not_configured" });
    expect(((await page()) as ReactElement).type).toBe(SetupNotice);
    mocks.entryGate.mockResolvedValue({ kind: "unavailable" });
    expect(((await page()) as ReactElement).type).toBe(FlowUnavailable);
    mocks.entryGate.mockResolvedValue({ kind: "quiet" });
    expect(((await page()) as ReactElement).type).toBe(QuietNotice);
    expect(mocks.findResumable).not.toHaveBeenCalled();
  });
});

describe("D1 /report/food", () => {
  it("offers the photo tile when AI is configured, with no report to resume", async () => {
    const element = (await ChooserPage()) as ReactElement<{ photoEnabled: boolean; resume: unknown }>;
    expect(element.type).toBe(FoodChooser);
    expect(element.props.photoEnabled).toBe(true);
    expect(element.props.resume).toBeNull();
    expect(mocks.findResumable).toHaveBeenCalledWith(SUPABASE, NOW);
  });

  it("hides the photo tile when AI is off", async () => {
    mocks.isAiConfigured.mockReturnValue(false);
    const element = (await ChooserPage()) as ReactElement<{ photoEnabled: boolean }>;
    expect(element.props.photoEnabled).toBe(false);
  });

  it("passes the unfinished report, and only its id", async () => {
    mocks.findResumable.mockResolvedValue({ id: ID, createdAt: NOW });
    const element = (await ChooserPage()) as ReactElement<{ resume: unknown }>;
    expect(element.props.resume).toEqual({ id: ID });
  });
});

describe("D2 /report/food/photo and D3 /report/food/text", () => {
  it("D2 shows the photo form when AI is configured and the calm sentence when not", async () => {
    expect(((await PhotoPage()) as ReactElement).type).toBe(PhotoReport);
    mocks.isAiConfigured.mockReturnValue(false);
    expect(((await PhotoPage()) as ReactElement).type).toBe(PhotoUnavailable);
  });

  it("D3 always shows the writing form, telling it whether AI is there", async () => {
    const on = (await TextPage()) as ReactElement<{ aiAvailable: boolean }>;
    expect(on.type).toBe(TextReport);
    expect(on.props.aiAvailable).toBe(true);
    mocks.isAiConfigured.mockReturnValue(false);
    expect(((await TextPage()) as ReactElement<{ aiAvailable: boolean }>).props.aiAvailable).toBe(false);
  });
});

describe("D6 /report/food/[id]", () => {
  it("is a 404 for an id that is not a UUID, before anything is loaded", async () => {
    await expect(outcome(() => ConfirmPage(idProps({}, "nope")))).resolves.toBe("NOT_FOUND");
    expect(mocks.loadUnderstanding).not.toHaveBeenCalled();
    expect(mocks.reportGate).not.toHaveBeenCalled();
  });

  it("is a 404 for a report that does not exist or belongs to someone else", async () => {
    mocks.loadUnderstanding.mockResolvedValue({ ok: false, code: "not_found" });
    await expect(outcome(() => ConfirmPage(idProps()))).resolves.toBe("NOT_FOUND");
  });

  it("shows the calm unavailable card when the report cannot be read", async () => {
    mocks.loadUnderstanding.mockResolvedValue({ ok: false, code: "unavailable" });
    expect(((await ConfirmPage(idProps())) as ReactElement).type).toBe(FlowUnavailable);
    mocks.reportGate.mockResolvedValue({ kind: "unavailable" });
    expect(((await ConfirmPage(idProps())) as ReactElement).type).toBe(FlowUnavailable);
    mocks.reportGate.mockResolvedValue({ kind: "not_configured" });
    expect(((await ConfirmPage(idProps())) as ReactElement).type).toBe(SetupNotice);
  });

  it.each(["accepted", "edited"] as const)("redirects a report that is %s to the saved screen by replace", async (status) => {
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: understanding({ status }) });
    await expect(outcome(() => ConfirmPage(idProps()))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.saved(ID)}:replace`);
  });

  it("is a 404 for a rejected report", async () => {
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: understanding({ status: "rejected" }) });
    await expect(outcome(() => ConfirmPage(idProps()))).resolves.toBe("NOT_FOUND");
  });

  it("shows the confirm screen for a pending report, with the view built from the stored one", async () => {
    const u = understanding();
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: u });
    const element = (await ConfirmPage(idProps())) as ReactElement<{ view: { id: string; revision: string; items: { name: string }[] }; refreshed: boolean; failed: boolean }>;
    expect(element.type).toBe(ConfirmScreen);
    expect(element.props.view.id).toBe(ID);
    expect(element.props.view.revision).toBe(revisionOf(mealOf(u)));
    expect(element.props.view.items.map((item) => item.name)).toEqual(["schnitzel"]);
    expect(element.props.refreshed).toBe(false);
    expect(element.props.failed).toBe(false);
  });

  it.each([
    [{ failed: "1" }, true],
    [{ failed: ["1", "0"] }, true],
    [{ failed: "0" }, false],
    [{ failed: "true" }, false],
    [{}, false],
  ])("shows the save problem only for ?failed=1 (%j -> %s)", async (query, expected) => {
    const element = (await ConfirmPage(idProps(query))) as ReactElement<{ failed: boolean }>;
    expect(element.props.failed).toBe(expected);
  });

  it.each([
    [{ refreshed: "1" }, true],
    [{ refreshed: ["1", "0"] }, true],
    [{ refreshed: "0" }, false],
    [{ refreshed: "yes" }, false],
    [{ other: "1" }, false],
    [{}, false],
  ])("shows the refreshed note only for ?refreshed=1 (%j -> %s)", async (query, expected) => {
    const element = (await ConfirmPage(idProps(query))) as ReactElement<{ refreshed: boolean; failed: boolean }>;
    expect(element.props.refreshed).toBe(expected);
  });
});

describe("D7 /report/food/[id]/edit", () => {
  it("is a 404 for an id that is not a UUID or a report that is not there", async () => {
    await expect(outcome(() => EditPage(idProps({}, "nope")))).resolves.toBe("NOT_FOUND");
    mocks.loadUnderstanding.mockResolvedValue({ ok: false, code: "not_found" });
    await expect(outcome(() => EditPage(idProps()))).resolves.toBe("NOT_FOUND");
  });

  it.each(["accepted", "edited", "rejected"] as const)("sends a report that is %s to the confirm screen", async (status) => {
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: understanding({ status }) });
    await expect(outcome(() => EditPage(idProps()))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.confirm(ID)}:replace`);
  });

  it("prefills the form from the draft when there is one, and goes back to the confirm screen on cancel", async () => {
    const base = understanding();
    const draft = { ...mealOf(base), items: [{ name: "chicken", portion: null, uncertain: false }] };
    mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: understanding({ draft }) });
    const element = (await EditPage(idProps())) as ReactElement<{ id: string; backHref: string; initial: { rows: { name: string }[] } }>;
    expect(element.type).toBe(EditForm);
    expect(element.props.id).toBe(ID);
    expect(element.props.backHref).toBe(FOOD_ROUTES.confirm(ID));
    expect(element.props.initial.rows.map((row) => row.name)).toEqual(["chicken"]);
  });

  it("prefills from the AI proposal when there is no draft", async () => {
    const element = (await EditPage(idProps())) as ReactElement<{ initial: { rows: { name: string }[]; mealType: string } }>;
    expect(element.props.initial.rows.map((row) => row.name)).toEqual(["schnitzel"]);
    expect(element.props.initial.mealType).toBe("lunch");
  });
});

describe("D8 /report/food/[id]/saved", () => {
  const saved = (status: Understanding["status"] = "accepted") => mocks.loadUnderstanding.mockResolvedValue({ ok: true, value: understanding({ status }) });

  it("is a 404 for an id that is not a UUID or a report that is not there", async () => {
    await expect(outcome(() => SavedPage(idProps({}, "nope")))).resolves.toBe("NOT_FOUND");
    mocks.loadUnderstanding.mockResolvedValue({ ok: false, code: "not_found" });
    await expect(outcome(() => SavedPage(idProps()))).resolves.toBe("NOT_FOUND");
  });

  it("sends a report that is not saved to the confirm screen", async () => {
    await expect(outcome(() => SavedPage(idProps()))).resolves.toBe(`REDIRECT:${FOOD_ROUTES.confirm(ID)}:replace`);
    expect(mocks.loadSavedMeal).not.toHaveBeenCalled();
  });

  it.each(["accepted", "edited"] as const)("shows the saved view for a report that is %s", async (status) => {
    saved(status);
    const element = (await SavedPage(idProps())) as ReactElement<{ firstReport: boolean; followUp: unknown }>;
    expect(element.type).toBe(SavedView);
    expect(element.props.followUp).toEqual({ kind: "none" });
  });

  it("adds the acknowledging line for the very first meal during the First Week", async () => {
    saved();
    const element = (await SavedPage(idProps())) as ReactElement<{ firstReport: boolean }>;
    expect(element.props.firstReport).toBe(true);
  });

  it("does not add it when it is not the first meal", async () => {
    saved();
    mocks.loadSavedMeal.mockResolvedValue({ ok: true, value: { entryId: "entry-2", confirmedAt: NOW, isFirstMeal: false } });
    expect(((await SavedPage(idProps())) as ReactElement<{ firstReport: boolean }>).props.firstReport).toBe(false);
  });

  it("does not add it outside the First Week", async () => {
    saved();
    mocks.reportGate.mockResolvedValue(readyGate("WEEKLY_CYCLE"));
    expect(((await SavedPage(idProps())) as ReactElement<{ firstReport: boolean }>).props.firstReport).toBe(false);
  });

  it("shows the unavailable card when the saved meal cannot be read", async () => {
    saved();
    mocks.loadSavedMeal.mockResolvedValue({ ok: false, code: "unavailable" });
    expect(((await SavedPage(idProps())) as ReactElement).type).toBe(FlowUnavailable);
  });
});
