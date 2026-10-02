// What each weight flow page decides, with the gates and the repository mocked. The pages return an element tree; the
// async server components inside it are not rendered here (static markup cannot), so these tests read the element's
// type and props: which screen, and with what.
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { FlowUnavailable } from "@/components/food/FlowUnavailable";
import { QuietNotice } from "@/components/food/QuietNotice";
import { WeightForm } from "@/components/weight/WeightForm";
import { WeightSavedView } from "@/components/weight/WeightSavedView";
import { formatDayKeyLabel, formatDayLabel } from "@/domain/weight";
import he from "@/i18n/messages/he.json";
import EditPage, { generateMetadata as editMetadata } from "./[id]/edit/page";
import SavedPage, { generateMetadata as savedMetadata } from "./[id]/saved/page";
import EntryPage, { generateMetadata as entryMetadata } from "./page";

const ID = "0b3b6c52-3c1e-4d8e-8b53-6f0e9d3f2a10";
const NEW_ID = "5f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const SUPABASE = { tag: "client" };
const NOW = new Date("2026-10-01T09:30:00Z"); // Thursday 12:30 in Jerusalem
const ZONE = "Asia/Jerusalem";

const mocks = vi.hoisted(() => ({
  entryGate: vi.fn(),
  readGate: vi.fn(),
  loadWeightEntry: vi.fn(),
  loadSavedWeight: vi.fn(),
  saveWeightAction: vi.fn(async () => null),
  editWeightAction: vi.fn(async () => null),
  deleteWeightAction: vi.fn(async () => {}),
  flow: { reportingEnabled: true, progressEnabled: true, milestoneMomentEnabled: true },
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
vi.mock("./_lib/gate", () => ({ openWeightEntryGate: mocks.entryGate, openWeightReadGate: mocks.readGate }));
vi.mock("./actions", () => ({ saveWeightAction: mocks.saveWeightAction, editWeightAction: mocks.editWeightAction }));
// The Saved screen hands this action to the delete control; here only that it is the very function matters.
vi.mock("@/app/(app)/me/weights/actions", () => ({ deleteWeightAction: mocks.deleteWeightAction }));
vi.mock("@/lib/weight/repo", () => ({ loadWeightEntry: mocks.loadWeightEntry, loadSavedWeight: mocks.loadSavedWeight }));
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

const readyGate = () => ({
  kind: "ready",
  context: { kind: "ready", userId: "user-1", row: { lifecycle_state: "FIRST_WEEK", timezone: ZONE, start_weight_kg: 118.7 }, supabase: SUPABASE },
  now: NOW,
  timeZone: ZONE,
});

const row = (over: Record<string, unknown> = {}) => ({
  ok: true,
  value: { id: ID, weightKg: 118.7, measuredAt: new Date("2026-09-29T09:00:00Z"), note: "after a walk", ...over },
});

const idProps = (query: Record<string, string | string[] | undefined> = {}, id = ID) =>
  ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) }) as never;

async function outcome(run: () => Promise<unknown>): Promise<ReactElement | string> {
  try {
    return (await run()) as ReactElement;
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN";
  }
}

type FormProps = {
  mode: string;
  id: string;
  options: { value: string; label: string }[];
  initial: { weight: string; day: string; note: string };
  action: unknown;
  backHref: string;
};

beforeEach(() => {
  mocks.flow.reportingEnabled = true;
  mocks.entryGate.mockReset().mockResolvedValue(readyGate());
  mocks.readGate.mockReset().mockResolvedValue(readyGate());
  mocks.loadWeightEntry.mockReset().mockResolvedValue(row());
  mocks.loadSavedWeight.mockReset().mockResolvedValue(row({ note: undefined }));
  vi.stubGlobal("crypto", { randomUUID: () => NEW_ID });
});

describe("titles", () => {
  it("every weight flow page is titled 'Weight report' from the catalog", async () => {
    await expect(entryMetadata()).resolves.toEqual({ title: he.weight.meta.title });
    await expect(editMetadata()).resolves.toEqual({ title: he.weight.meta.title });
    await expect(savedMetadata()).resolves.toEqual({ title: he.weight.meta.title });
  });
});

describe("the entry page", () => {
  it("shows the setup notice, the unavailable card and the quiet screen for those gates", async () => {
    mocks.entryGate.mockResolvedValue({ kind: "not_configured" });
    expect(((await EntryPage()) as ReactElement).type).toBe(SetupNotice);
    mocks.entryGate.mockResolvedValue({ kind: "unavailable" });
    expect(((await EntryPage()) as ReactElement).type).toBe(FlowUnavailable);
    mocks.entryGate.mockResolvedValue({ kind: "quiet" });
    expect(((await EntryPage()) as ReactElement).type).toBe(QuietNotice);
  });

  it("lets the gate's redirect through (the switch off sends the person Home)", async () => {
    mocks.entryGate.mockRejectedValue(new Error("REDIRECT:/"));
    await expect(outcome(() => EntryPage())).resolves.toBe("REDIRECT:/");
  });

  it("shows the form for a new weight with a fresh id, 'now' selected and the save action", async () => {
    const page = (await EntryPage()) as ReactElement<FormProps>;
    expect(page.type).toBe(WeightForm);
    expect(page.props.mode).toBe("new");
    expect(page.props.id).toBe(NEW_ID);
    expect(page.props.initial).toEqual({ weight: "", day: "now", note: "" });
    expect(page.props.action).toBe(mocks.saveWeightAction);
    expect(page.props.backHref).toBe("/");
  });

  it("offers 'now', then yesterday, then the 13 days before, with words in the person's language and zone", async () => {
    const page = (await EntryPage()) as ReactElement<FormProps>;
    const { options } = page.props;
    expect(options).toHaveLength(15);
    expect(options[0]).toEqual({ value: "now", label: he.weight.form.dayNow });
    expect(options[1]).toEqual({ value: "2026-09-30", label: he.weight.form.dayYesterday });
    expect(options[2]).toEqual({ value: "2026-09-29", label: formatDayKeyLabel("2026-09-29", "he", ZONE, false) });
    expect(options[14].value).toBe("2026-09-17");
    expect(new Set(options.map((option) => option.value)).size).toBe(15);
  });

  it("gives a day of another year its year", async () => {
    mocks.entryGate.mockResolvedValue({ ...readyGate(), now: new Date("2027-01-03T09:30:00Z") });
    const page = (await EntryPage()) as ReactElement<FormProps>;
    const december = page.props.options.find((option) => option.value === "2026-12-30");
    expect(december?.label).toBe(formatDayKeyLabel("2026-12-30", "he", ZONE, true));
    const january = page.props.options.find((option) => option.value === "2027-01-01");
    expect(january?.label).toBe(formatDayKeyLabel("2027-01-01", "he", ZONE, false));
  });
});

describe("the edit page", () => {
  it("answers 404 for a malformed id before any gate or query", async () => {
    await expect(outcome(() => EditPage(idProps({}, "nope")))).resolves.toBe("NOT_FOUND");
    expect(mocks.entryGate).not.toHaveBeenCalled();
    expect(mocks.loadWeightEntry).not.toHaveBeenCalled();
  });

  it("shows the setup notice, the unavailable card and the quiet screen for those gates, loading nothing", async () => {
    mocks.entryGate.mockResolvedValue({ kind: "not_configured" });
    expect(((await EditPage(idProps())) as ReactElement).type).toBe(SetupNotice);
    mocks.entryGate.mockResolvedValue({ kind: "unavailable" });
    expect(((await EditPage(idProps())) as ReactElement).type).toBe(FlowUnavailable);
    mocks.entryGate.mockResolvedValue({ kind: "quiet" });
    expect(((await EditPage(idProps())) as ReactElement).type).toBe(QuietNotice);
    expect(mocks.loadWeightEntry).not.toHaveBeenCalled();
  });

  it("lets the gate's redirect through", async () => {
    mocks.entryGate.mockRejectedValue(new Error("REDIRECT:/"));
    await expect(outcome(() => EditPage(idProps()))).resolves.toBe("REDIRECT:/");
  });

  it("answers 404 for another person's id and for a missing one: both are 'not found' through Row Level Security", async () => {
    mocks.loadWeightEntry.mockResolvedValue({ ok: false, code: "not_found" });
    await expect(outcome(() => EditPage(idProps()))).resolves.toBe("NOT_FOUND");
  });

  it("shows the unavailable card when the entry could not be read", async () => {
    mocks.loadWeightEntry.mockResolvedValue({ ok: false, code: "unavailable" });
    expect(((await EditPage(idProps())) as ReactElement).type).toBe(FlowUnavailable);
  });

  it("shows the form with the saved values, 'As saved' first, and the edit action", async () => {
    const page = (await EditPage(idProps())) as ReactElement<FormProps>;
    expect(page.type).toBe(WeightForm);
    expect(mocks.loadWeightEntry).toHaveBeenCalledWith(SUPABASE, ID);
    expect(page.props.mode).toBe("edit");
    expect(page.props.id).toBe(ID);
    expect(page.props.initial).toEqual({ weight: "118.7", day: "keep", note: "after a walk" });
    expect(page.props.action).toBe(mocks.editWeightAction);
    expect(page.props.backHref).toBe("/me/weights");
    expect(page.props.options[0]).toEqual({ value: "keep", label: he.weight.form.dayKeep });
    expect(page.props.options.map((option) => option.value)).not.toContain("now");
    expect(page.props.options).toHaveLength(15);
  });

  it("shows one decimal and an empty note for a weight stored without one", async () => {
    mocks.loadWeightEntry.mockResolvedValue(row({ weightKg: 118, note: null }));
    const page = (await EditPage(idProps())) as ReactElement<FormProps>;
    expect(page.props.initial).toEqual({ weight: "118.0", day: "keep", note: "" });
  });

  it("adds the entry's own day, with its year, when it is older than the list reaches", async () => {
    mocks.loadWeightEntry.mockResolvedValue(row({ measuredAt: new Date("2025-06-10T09:00:00Z") }));
    const page = (await EditPage(idProps())) as ReactElement<FormProps>;
    expect(page.props.options).toHaveLength(16);
    expect(page.props.options[15]).toEqual({ value: "2025-06-10", label: formatDayKeyLabel("2025-06-10", "he", ZONE, true) });
  });
});

describe("the Saved page", () => {
  it("answers 404 for a malformed id, before anything else", async () => {
    await expect(outcome(() => SavedPage(idProps({}, "nope")))).resolves.toBe("NOT_FOUND");
    expect(mocks.readGate).not.toHaveBeenCalled();
    expect(mocks.loadSavedWeight).not.toHaveBeenCalled();
  });

  it("shows the setup notice and the unavailable card for those gates, loading nothing", async () => {
    mocks.readGate.mockResolvedValue({ kind: "not_configured" });
    expect(((await SavedPage(idProps())) as ReactElement).type).toBe(SetupNotice);
    mocks.readGate.mockResolvedValue({ kind: "unavailable" });
    expect(((await SavedPage(idProps())) as ReactElement).type).toBe(FlowUnavailable);
    expect(mocks.loadSavedWeight).not.toHaveBeenCalled();
  });

  it("answers 404 for another person's id and for a missing one", async () => {
    mocks.loadSavedWeight.mockResolvedValue({ ok: false, code: "not_found" });
    await expect(outcome(() => SavedPage(idProps()))).resolves.toBe("NOT_FOUND");
  });

  it("shows the unavailable card when the weight could not be read", async () => {
    mocks.loadSavedWeight.mockResolvedValue({ ok: false, code: "unavailable" });
    expect(((await SavedPage(idProps())) as ReactElement).type).toBe(FlowUnavailable);
  });

  it("is never quiet: it uses the read gate, so finishing and deleting are not blocked", async () => {
    mocks.entryGate.mockRejectedValue(new Error("ENTRY_GATE_USED"));
    const page = (await SavedPage(idProps())) as ReactElement;
    expect(page.type).toBe(WeightSavedView);
    expect(mocks.entryGate).not.toHaveBeenCalled();
  });

  it("shows the number and the day in words, the shared delete action, and 'added' by default", async () => {
    const page = (await SavedPage(idProps())) as ReactElement<{
      entryId: string;
      kgText: string;
      unit: string;
      dayText: string;
      edited: boolean;
      canEdit: boolean;
      deleteAction: unknown;
    }>;
    expect(mocks.loadSavedWeight).toHaveBeenCalledWith(SUPABASE, ID);
    expect(page.props).toMatchObject({
      entryId: ID,
      kgText: "118.7",
      unit: he.weight.form.unit,
      edited: false,
      canEdit: true,
      deleteAction: mocks.deleteWeightAction,
    });
    expect(page.props.dayText).toBe(formatDayLabel({ instant: new Date("2026-09-29T09:00:00Z"), locale: "he", timeZone: ZONE, includeYear: false }));
  });

  it("carries no comparison: nothing about the previous weight, a change or a total", async () => {
    const page = (await SavedPage(idProps())) as ReactElement;
    expect(Object.keys(page.props as object).sort()).toEqual(["canEdit", "dayText", "deleteAction", "edited", "entryId", "kgText", "unit"]);
  });

  it("says 'updated' for ?edited=1 and only for that", async () => {
    expect(((await SavedPage(idProps({ edited: "1" }))) as ReactElement<{ edited: boolean }>).props.edited).toBe(true);
    expect(((await SavedPage(idProps({ edited: ["1", "0"] }))) as ReactElement<{ edited: boolean }>).props.edited).toBe(true);
    for (const edited of ["0", "", "true", "yes"]) {
      expect(((await SavedPage(idProps({ edited }))) as ReactElement<{ edited: boolean }>).props.edited, edited).toBe(false);
    }
  });

  it("adds the year to a day of another year", async () => {
    mocks.loadSavedWeight.mockResolvedValue(row({ measuredAt: new Date("2025-06-10T09:00:00Z") }));
    const page = (await SavedPage(idProps())) as ReactElement<{ dayText: string }>;
    expect(page.props.dayText).toBe(formatDayLabel({ instant: new Date("2025-06-10T09:00:00Z"), locale: "he", timeZone: ZONE, includeYear: true }));
  });

  it("drops the Edit link while weight reporting is switched off (reading and deleting stay)", async () => {
    mocks.flow.reportingEnabled = false;
    const page = (await SavedPage(idProps())) as ReactElement<{ canEdit: boolean; deleteAction: unknown }>;
    expect(page.props.canEdit).toBe(false);
    expect(page.props.deleteAction).toBe(mocks.deleteWeightAction);
  });
});
