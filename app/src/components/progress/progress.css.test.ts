// Source lint for the Progress style sheet, read as text (no browser here). It guards what a screenshot would not show:
// logical properties (one sheet for Hebrew and English), no motion, no dark theme, no fixed bar, that a color never
// depends on the number (the sheets name no token of the error, accent, attention or warning families, so an increase
// cannot be styled like a problem), and that every class a component names really exists (a missing CSS-module class is
// `undefined`, silently). tests/design/tokens.test.ts separately scans these files for hard-coded colors.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const APP = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(path, "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(read(join(here, "progress.module.css")));

const PHYSICAL: RegExp[] = [
  /(?<![-\w])(?:margin|padding)-(?:left|right)\s*:/,
  /(?<![-\w])(?:left|right)\s*:/,
  /text-align\s*:\s*(?:left|right)/,
  /border-(?:left|right)(?:-[a-z]+)?\s*:/,
  /border-(?:top|bottom)-(?:left|right)-radius/,
  /(?<![-\w])float\s*:/,
  /row-reverse/,
];

// Colors that mean "something is wrong" or "look here": never referenced by the weight sheets, whatever the value.
const JUDGING_TOKENS = ["--color-error", "--color-accent", "--color-attention", "--color-warning"];

/** The class names the sheet defines. */
const defined = new Set(Array.from(css.matchAll(/\.([A-Za-z_][\w-]*)/g), (match) => match[1]));

/** Every `styles.x` / `progressStyles.x` a file that imports this sheet uses. */
function usedClasses(source: string): string[] {
  const names = Array.from(source.matchAll(/import\s+(\w+)\s+from\s+"[^"]*progress\.module\.css"/g), (match) => match[1]);
  return names.flatMap((name) => Array.from(source.matchAll(new RegExp(`\\b${name}\\.([A-Za-z_]\\w*)`, "g")), (match) => match[1]));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

const HOME_VIEW = join(APP, "src", "app", "(app)", "_components", "HomeView.tsx");
const files = [...sourceFiles(here), HOME_VIEW];

describe("progress.module.css", () => {
  it("finds its classes", () => {
    expect(defined.size).toBeGreaterThan(20);
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

  it("names no color token that judges, in this sheet or in the weight sheet", () => {
    const sheets = [join(here, "progress.module.css"), join(APP, "src", "components", "weight", "weight.module.css")];
    const found = sheets.filter((path) => existsSync(path));
    expect(found.length).toBeGreaterThanOrEqual(1);
    for (const path of found) {
      // Comments are read too: a sheet that says it only in a comment is still one grep away from using it.
      const source = read(path);
      for (const token of JUDGING_TOKENS) expect(source, `${path}: ${token}`).not.toContain(token);
    }
  });

  it("draws the chart from tokens only, with the same strokes whatever the data", () => {
    for (const name of ["line", "dot", "baseline", "axis"]) {
      const rule = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(rule, name).toBeTruthy();
      for (const value of rule.matchAll(/(?:fill|stroke)\s*:\s*([^;]+);/g)) {
        expect(value[1].trim(), `${name}: ${value[1]}`).toMatch(/^(?:none|var\(--color-[a-z-]+\))$/);
      }
    }
    // The line and the dots are the primary color; nothing else is a candidate for "the data".
    expect(/\.line\s*\{[^}]*stroke\s*:\s*var\(--color-primary\)/.test(css)).toBe(true);
    expect(/\.dot\s*\{[^}]*fill\s*:\s*var\(--color-primary\)/.test(css)).toBe(true);
  });

  it("keeps the landmark marks distinct by shape, not by color alone", () => {
    const border = (name: string) => new RegExp(`\\.${name}\\s*\\{[^}]*border\\s*:\\s*([^;]+);`).exec(css)?.[1].trim();
    // Filled, a bold outline, a thin outline: the next landmark and those ahead differ in the weight of the line.
    expect(border("markNext")).not.toBe(border("markAhead"));
    // Reached is the only one that is filled.
    expect(/\.markReached\s*\{[^}]*background\s*:\s*var\(--color-primary\)/.test(css)).toBe(true);
    expect(/\.markNext\s*\{[^}]*background\s*:\s*transparent/.test(css)).toBe(true);
    expect(/\.markAhead\s*\{[^}]*background\s*:\s*transparent/.test(css)).toBe(true);
  });

  it("styles the Home action column the landmark card uses", () => {
    expect(defined.has("homeActions")).toBe(true);
  });

  it("defines every class that a component or the Home view names", () => {
    const users = files.filter((file) => usedClasses(read(file)).length > 0);
    // The components that style themselves, and the Home view.
    expect(users.length).toBeGreaterThanOrEqual(5);
    for (const file of users) {
      for (const name of usedClasses(read(file))) expect(defined.has(name), `${file}: ${name}`).toBe(true);
    }
  });

  it("styles nothing that no component uses", () => {
    const used = new Set(files.flatMap((file) => usedClasses(read(file))));
    expect([...defined].filter((name) => !used.has(name))).toEqual([]);
  });
});
