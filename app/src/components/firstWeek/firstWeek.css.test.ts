// Source lint for the First Week style sheet, read as text (no browser here). It guards what a screenshot would
// not show: logical properties (one sheet for Hebrew and English), no motion, no fixed bar, and that every class a
// component names really exists (a missing CSS-module class is `undefined`, silently).
// tests/design/tokens.test.ts separately scans this file for colors.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const APP = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(path, "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(read(join(here, "firstWeek.module.css")));

const PHYSICAL: RegExp[] = [
  /(?<![-\w])(?:margin|padding)-(?:left|right)\s*:/,
  /(?<![-\w])(?:left|right)\s*:/,
  /text-align\s*:\s*(?:left|right)/,
  /border-(?:left|right)(?:-[a-z]+)?\s*:/,
  /border-(?:top|bottom)-(?:left|right)-radius/,
  /(?<![-\w])float\s*:/,
  /row-reverse/,
];

/** The class names the sheet defines. */
const defined = new Set(Array.from(css.matchAll(/\.([A-Za-z_][\w-]*)/g), (match) => match[1]));

/** Every `styles.x` / `firstWeekStyles.x` a file that imports this sheet uses. */
function usedClasses(source: string): string[] {
  const names = Array.from(source.matchAll(/import\s+(\w+)\s+from\s+"[^"]*firstWeek\.module\.css"/g), (match) => match[1]);
  return names.flatMap((name) => Array.from(source.matchAll(new RegExp(`\\b${name}\\.([A-Za-z_]\\w*)`, "g")), (match) => match[1]));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

describe("firstWeek.module.css", () => {
  it("finds its classes", () => {
    expect(defined.size).toBeGreaterThan(10);
  });

  it("uses logical properties only", () => {
    const offenders = css.split("\n").filter((line) => PHYSICAL.some((pattern) => pattern.test(line)));
    expect(offenders).toEqual([]);
  });

  it("has no motion: no animation, no transition, no transform", () => {
    expect(css).not.toMatch(/animation|transition|@keyframes|transform\s*:/);
  });

  it("has no dark theme", () => {
    expect(css).not.toMatch(/prefers-color-scheme|data-theme/);
  });

  it("has no fixed or sticky bar", () => {
    expect(css).not.toMatch(/position\s*:\s*(?:fixed|sticky)/);
  });

  it("keeps the person's own words from widening the page", () => {
    expect(css).toMatch(/\.userText\s*\{[^}]*overflow-wrap\s*:\s*anywhere/);
  });

  it("styles the Home action column the Home view uses", () => {
    expect(defined.has("homeActions")).toBe(true);
  });

  it("defines every class that a component or the Home view names", () => {
    const files = [...sourceFiles(here), join(APP, "src", "app", "(app)", "_components", "HomeView.tsx")];
    const users = files.filter((file) => usedClasses(read(file)).length > 0);
    // The three components that style themselves, and the Home view.
    expect(users.length).toBeGreaterThanOrEqual(4);
    for (const file of users) {
      for (const name of usedClasses(read(file))) expect(defined.has(name), `${file}: ${name}`).toBe(true);
    }
  });

  it("styles nothing that no component uses", () => {
    const files = [...sourceFiles(here), join(APP, "src", "app", "(app)", "_components", "HomeView.tsx")];
    const used = new Set(files.flatMap((file) => usedClasses(read(file))));
    expect([...defined].filter((name) => !used.has(name))).toEqual([]);
  });
});
