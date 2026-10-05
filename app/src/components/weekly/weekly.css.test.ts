// Source lint for the "your week" style sheet, read as text (no browser here). It guards what a screenshot would not show:
// logical properties (one sheet for Hebrew and English), no motion, no fixed bar, no color of its own for the weight, and that
// every class a component names really exists (a missing CSS-module class is `undefined`, silently).
// tests/design/tokens.test.ts separately scans this file for colors.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const APP = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(path, "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(read(join(here, "weekly.module.css")));

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

/** Every `styles.x` / `weeklyStyles.x` a file that imports this sheet uses. */
function usedClasses(source: string): string[] {
  const names = Array.from(source.matchAll(/import\s+(\w+)\s+from\s+"[^"]*weekly\.module\.css"/g), (match) => match[1]);
  return names.flatMap((name) => Array.from(source.matchAll(new RegExp(`\\b${name}\\.([A-Za-z_]\\w*)`, "g")), (match) => match[1]));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

const USERS = [...sourceFiles(here), join(APP, "src", "app", "(app)", "_components", "HomeView.tsx")];

describe("weekly.module.css", () => {
  it("finds its classes", () => {
    expect(defined.size).toBeGreaterThan(8);
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

  it("uses color tokens only, and only the readable text tokens for text: nothing here is a literal, and nothing is colored by what the weight did", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    const textColors = Array.from(css.matchAll(/(?<![-\w])color\s*:\s*([^;]+);/g), (match) => match[1].trim());
    for (const value of textColors) expect(value, value).toMatch(/^var\(--color-text-(?:primary|secondary)\)$/);
    // The weight line has no class of its own: every weight sentence is a plain paragraph in the same part.
    for (const name of defined) expect(name, name).not.toMatch(/weight|up|down|steady|trend|good|bad/i);
  });

  it("keeps stored or AI text from widening the page", () => {
    expect(css).toMatch(/\.lead\s*\{[^}]*overflow-wrap\s*:\s*anywhere/);
    expect(css).toMatch(/\.experimentText\s*\{[^}]*overflow-wrap\s*:\s*anywhere/);
  });

  it("styles the Home link the Home view uses", () => {
    expect(defined.has("homeLink")).toBe(true);
  });

  it("defines every class that a component or the Home view names", () => {
    const users = USERS.filter((file) => usedClasses(read(file)).length > 0);
    // The five components that style themselves (the view, the next part, the result, the pattern question), and the Home view.
    expect(users.length).toBeGreaterThanOrEqual(4);
    for (const file of users) {
      for (const name of usedClasses(read(file))) expect(defined.has(name), `${file}: ${name}`).toBe(true);
    }
  });

  it("styles nothing that no component uses", () => {
    const used = new Set(USERS.flatMap((file) => usedClasses(read(file))));
    expect([...defined].filter((name) => !used.has(name))).toEqual([]);
  });
});
