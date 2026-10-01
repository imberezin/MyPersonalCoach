import { describe, expect, it } from "vitest";
import { SHELL_MESSAGE_KEYS } from "@/components/shell/messageKeys";
import { REPORT_OPTIONS } from "@/components/shell/reportOptions";
import { HOME_COPY_KEYS } from "@/domain/home";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";

type Tree = { [key: string]: string | Tree };

/** Every leaf as a dotted path, so the two catalogs can be compared key by key. */
function leafPaths(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leafPaths(value, `${prefix}${key}.`),
  );
}

function leaf(tree: Tree, path: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

const catalogs = { he: he as Tree, en: en as Tree };

describe("app message catalogs", () => {
  it("has the same keys in Hebrew and English", () => {
    expect(leafPaths(catalogs.en).sort()).toEqual(leafPaths(catalogs.he).sort());
  });

  it("has no empty text", () => {
    for (const [locale, tree] of Object.entries(catalogs)) {
      for (const path of leafPaths(tree)) expect(leaf(tree, path)?.trim(), `${locale}: ${path}`).toBeTruthy();
    }
  });

  // What the shell reads (nav, the Report sheet) is a contract written down as data by the shell.
  // This is the one test that opens the real catalogs and proves every one of those keys is there.
  const required: Array<[string, string[]]> = [
    ["shell contract", [...SHELL_MESSAGE_KEYS]],
    ["Report sheet row", REPORT_OPTIONS.map((option) => `report.sheet.options.${option.id}`)],
    ["Home copy key", HOME_COPY_KEYS.flatMap((key) => [`home.${key}.title`, `home.${key}.body`])],
    ["Home extra", [
        "home.firstReport.lead",
        "home.firstReport.cta",
        "home.firstWeekStart.lead",
        "home.firstWeekStart.cta",
        "home.degraded",
      ]],
    ["Progress", ["title", "lead", "body"].map((key) => `progress.${key}`)],
    ["Coach", ["title", "heading", "body"].map((key) => `coach.${key}`)],
    ["Me", ["title", "body"].map((key) => `me.${key}`)],
    ["not found", ["title", "body", "cta"].map((key) => `notFound.${key}`)],
    ["reused", ["app.shortName", "common.signOut"]],
  ];

  it.each(required)("has every %s key in both languages", (_group, paths) => {
    expect(paths.length).toBeGreaterThan(0);
    for (const [locale, tree] of Object.entries(catalogs)) {
      for (const path of paths) expect(leaf(tree, path), `${locale}: ${path}`).toBeTruthy();
    }
  });

  it("keeps the Before Shabbat time placeholder in both languages", () => {
    for (const [locale, tree] of Object.entries(catalogs)) {
      expect(leaf(tree, "home.beforeShabbat.body"), locale).toContain("{time}");
    }
  });

  // Brand voice (Brand document sections 24 and 28), for the namespaces of the app shell. The
  // catalog-wide test in interventions/library.test.ts covers the rest. Keys count too, so the
  // text under test is the whole namespace as JSON.
  describe("copy lint", () => {
    const NAMESPACES = ["nav", "report", "home", "progress", "coach", "me", "notFound"] as const;
    const forbidden = {
      he: ["!", "החמצת", "פספסת", "ציון", "אחוז", "רצף", "חרגת", "נכשל", "מתחילים מחדש", "להתחיל מחדש"],
      en: ["!", "missed", "score", "percent", "streak", "failed", "overdue", "behind", "start over"],
    };

    it.each(NAMESPACES)("keeps the %s namespace calm in both languages", (namespace) => {
      for (const locale of ["he", "en"] as const) {
        const text = JSON.stringify(catalogs[locale][namespace]).toLowerCase();
        for (const word of forbidden[locale]) {
          expect(text, `${locale}: ${namespace} contains "${word}"`).not.toContain(word.toLowerCase());
        }
      }
    });
  });
});
