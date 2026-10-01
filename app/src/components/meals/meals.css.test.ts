// Source lint for the My meals style sheet, read as text (no browser here). It guards what a screenshot
// would not show: logical properties (one sheet for Hebrew and English), hover only where a pointer exists,
// no fixed bar, no motion, and the calm look of the delete question (sand, never an alarm color).
// tests/design/tokens.test.ts separately scans this file for colors.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(read("./meals.module.css"));

interface Rule {
  selector: string;
  body: string;
  /** The at-rules around the rule, outermost first, for example "@media (hover: hover)". */
  context: string[];
}

/** A small reader for the flat CSS this file uses: rules, and rules inside one level of @media. */
function parseRules(source: string): Rule[] {
  const rules: Rule[] = [];
  const stack: Array<{ prelude: string; start: number }> = [];
  let prelude = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "{") {
      stack.push({ prelude: prelude.trim(), start: i + 1 });
      prelude = "";
    } else if (char === "}") {
      const block = stack.pop();
      if (block && !block.prelude.startsWith("@")) {
        rules.push({ selector: block.prelude, body: source.slice(block.start, i), context: stack.map((b) => b.prelude) });
      }
      prelude = "";
    } else if (char === ";") {
      prelude = "";
    } else {
      prelude += char;
    }
  }
  return rules;
}

const rules = parseRules(css);
const ruleFor = (selector: string) => rules.find((rule) => rule.selector === selector && rule.context.length === 0);

const PHYSICAL: RegExp[] = [
  /(?<![-\w])(?:margin|padding)-(?:left|right)\s*:/,
  /(?<![-\w])(?:left|right)\s*:/,
  /text-align\s*:\s*(?:left|right)/,
  /border-(?:left|right)(?:-[a-z]+)?\s*:/,
  /border-(?:top|bottom)-(?:left|right)-radius/,
  /(?<![-\w])float\s*:/,
  /row-reverse/,
];

describe("meals.module.css", () => {
  it("finds its rules", () => {
    expect(rules.length).toBeGreaterThan(10);
  });

  it("uses logical properties only", () => {
    const offenders = css.split("\n").filter((line) => PHYSICAL.some((pattern) => pattern.test(line)));
    expect(offenders).toEqual([]);
  });

  it("has no dark theme", () => {
    expect(css).not.toMatch(/prefers-color-scheme|data-theme/);
  });

  it("has no fixed or sticky element: the bottom of the page belongs to the layout's navigation", () => {
    expect(css).not.toMatch(/position\s*:\s*(?:fixed|sticky)/);
  });

  it("applies :hover only where a real pointer exists", () => {
    for (const rule of rules.filter((r) => r.selector.includes(":hover"))) {
      expect(rule.context.some((context) => /^@media\s*\(\s*hover\s*:\s*hover\s*\)$/.test(context)), rule.selector).toBe(true);
    }
  });

  it("adds no motion, so no reduced-motion block is needed", () => {
    expect(css).not.toMatch(/@keyframes|animation|transition/);
  });

  it("never uses the Error, Attention or Accent colors: deleting your own meal is neither a mistake nor an alarm", () => {
    expect(css).not.toMatch(/--color-(?:error|attention|accent)/);
  });

  it("paints the delete question as a neutral sand inset with a sand border and the main text color", () => {
    const panel = ruleFor(".panel")?.body ?? "";
    expect(panel).toContain("background: var(--color-secondary-light)");
    expect(panel).toMatch(/border\s*:\s*1px solid var\(--color-secondary\)/);
    expect(panel).toMatch(/color\s*:\s*var\(--color-text-primary\)/);
  });

  it("stacks Keep and Delete with a gap, so one thumb slip cannot hit both", () => {
    const actions = ruleFor(".panelActions")?.body ?? "";
    expect(actions).toContain("display: grid");
    expect(actions).toMatch(/gap\s*:\s*var\(--space-3\)/);
    expect(actions).toContain("justify-items: stretch");
  });

  it("styles a meal row as the Brand cards: surface, a light border, a large radius, a very light shadow", () => {
    const row = ruleFor(".row")?.body ?? "";
    expect(row).toContain("var(--color-surface)");
    expect(row).toMatch(/border\s*:\s*1px solid var\(--color-border\)/);
    expect(row).toContain("var(--radius-lg)");
    expect(row).toContain("var(--shadow-1)");
  });

  it("separates the rows by a gap and shows no bullets", () => {
    const list = ruleFor(".list")?.body ?? "";
    expect(list).toMatch(/gap\s*:\s*var\(--space-3\)/);
    expect(list).toContain("list-style: none");
  });

  it("shows a focused heading and a focused notice with no ring (they are not controls)", () => {
    expect(ruleFor(".panelTitle:focus,\n.panelTitle:focus-visible")?.body).toMatch(/outline\s*:\s*none/);
    expect(ruleFor(".notice:focus,\n.notice:focus-visible")?.body).toMatch(/outline\s*:\s*none/);
  });

  it("colors text only with the main text token", () => {
    for (const match of css.matchAll(/(?<![-\w])color\s*:\s*([^;}]+)/g)) {
      expect(match[1].trim()).toBe("var(--color-text-primary)");
    }
  });
});
