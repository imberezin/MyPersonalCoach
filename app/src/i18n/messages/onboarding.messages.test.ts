import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import {
  ACTIVITY_BASELINE_KEYS,
  GOAL_FOCUS_KEYS,
  KASHRUT_CHOICES,
  NOTIFY_CHOICES,
  OFFLINE_CHOICES,
  STEP_ERROR_CODES,
} from "@/domain/onboarding";
import { PLACES } from "@/domain/places";

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

const catalogs = { he: he.onboarding as Tree, en: en.onboarding as Tree };

describe("onboarding message catalogs", () => {
  it("has the same keys in Hebrew and English", () => {
    expect(leafPaths(catalogs.en).sort()).toEqual(leafPaths(catalogs.he).sort());
  });

  it("has no empty text", () => {
    for (const [locale, tree] of Object.entries(catalogs)) {
      for (const path of leafPaths(tree)) expect(leaf(tree, path)?.trim(), `${locale}: ${path}`).toBeTruthy();
    }
  });

  const required: Array<[string, string[]]> = [
    ["errors", STEP_ERROR_CODES.map((code) => `errors.${code}`)],
    ["places", PLACES.map((place) => `places.${place.key}`)],
    ["goals", GOAL_FOCUS_KEYS.map((key) => `goals.options.${key}`)],
    ["movement", ACTIVITY_BASELINE_KEYS.map((key) => `movement.options.${key}`)],
    ["kashrut", KASHRUT_CHOICES.map((key) => `kashrut.options.${key}`)],
    ["offline", OFFLINE_CHOICES.map((key) => `offline.options.${key}`)],
    ["notifications", NOTIFY_CHOICES.map((key) => `notifications.options.${key}`)],
    // Read by the components directly, and the push keys by a computed name (`push.${status}`), so only a test sees them.
    ["common", ["back", "skip", "saving", "retry", "unavailableTitle", "unavailableBody"].map((key) => `common.${key}`)],
    [
      "push",
      [
        "enable", "enabling", "enabled", "checking", "denied", "unsupported", "notConfigured",
        "errorTimeout", "errorSubscribe", "errorSave", "ios.title", "ios.step1", "ios.step2", "ios.step3", "ios.step4", "ios.hint",
      ].map((key) => `push.${key}`),
    ],
    ["offline preview", ["label", "candle", "havdalah", "inProgress"].map((key) => `offline.preview.${key}`)],
  ];

  it.each(required)("has a label for every %s option in both languages", (_group, paths) => {
    for (const [locale, tree] of Object.entries(catalogs)) {
      for (const path of paths) expect(leaf(tree, path), `${locale}: ${path}`).toBeTruthy();
    }
  });

  it("gives the range error its two placeholders in both languages", () => {
    for (const [locale, tree] of Object.entries(catalogs)) {
      const text = leaf(tree, "errors.out_of_range");
      expect(text, locale).toContain("{min}");
      expect(text, locale).toContain("{max}");
    }
  });
});
