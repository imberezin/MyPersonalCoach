// Sign-out must stay reachable whatever else failed to load: the page opens for every gate outcome
// except "not configured", and always carries the sign-out form.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppGate } from "../_lib/gate";
import MePage from "./page";

const gate = vi.hoisted(() => ({ result: { kind: "not_configured" } as unknown }));
vi.mock("../_lib/gate", () => ({ openAppGate: async () => gate.result }));
vi.mock("@/app/actions", () => ({ signOut: async () => {}, replayOnboardingForDev: async () => {} }));
vi.mock("./_components/DevStatus", () => ({ DevStatus: () => null }));
// An async server component, which static markup cannot render: only that the page shows it matters here.
vi.mock("../_components/SetupNotice", () => ({ SetupNotice: () => createElement("p", null, "setup") }));
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

const open = (context: unknown): AppGate => ({ kind: "open", context: context as never });
const render = async () => renderToStaticMarkup(createElement("div", null, await MePage()));

describe("Me page", () => {
  beforeEach(() => {
    gate.result = open({ kind: "unavailable" });
  });

  it.each([
    ["Supabase could not be reached", open({ kind: "unavailable" })],
    ["nobody is signed in", open({ kind: "signed_out" })],
    ["there is no profile", open({ kind: "profile_missing" })],
  ])("offers sign-out when %s", async (_name, result) => {
    gate.result = result;
    const html = await render();
    expect(html).toMatch(/<form\b[^>]*\saction=/);
    expect(html).toMatch(/<button\b[^>]*type="submit"/);
  });

  it("shows only the setup notice, with no sign-out, when Supabase is not configured", async () => {
    gate.result = { kind: "not_configured" } satisfies AppGate;
    const html = await render();
    expect(html).toContain("setup");
    expect(html).not.toContain("<form");
  });
});
