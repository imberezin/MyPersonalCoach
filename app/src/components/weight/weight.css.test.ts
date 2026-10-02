// Source lint for the weight style sheet, read as text (no browser here). It guards what a screenshot would not show:
// logical properties (one sheet for Hebrew and English), hover only where a pointer exists, no fixed bar, no motion, the
// calm look of the delete question, that every class the components use exists, and that no color is a judgment.
// tests/design/tokens.test.ts separately scans this file for hard-coded colors.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const read = (relative: string) => readFileSync(here(relative), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(read("./weight.module.css"));

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
const classesDefined = new Set(Array.from(css.matchAll(/\.([A-Za-z_][\w-]*)/g), (match) => match[1]));

const PHYSICAL: RegExp[] = [
  /(?<![-\w])(?:margin|padding)-(?:left|right)\s*:/,
  /(?<![-\w])(?:left|right)\s*:/,
  /text-align\s*:\s*(?:left|right)/,
  /border-(?:left|right)(?:-[a-z]+)?\s*:/,
  /border-(?:top|bottom)-(?:left|right)-radius/,
  /(?<![-\w])float\s*:/,
  /row-reverse/,
];

describe("weight.module.css", () => {
  it("finds its rules", () => {
    expect(rules.length).toBeGreaterThan(25);
  });

  it("uses logical properties only", () => {
    const offenders = css.split("\n").filter((line) => PHYSICAL.some((pattern) => pattern.test(line)));
    expect(offenders).toEqual([]);
  });

  it("has no dark theme", () => {
    expect(css).not.toMatch(/prefers-color-scheme|data-theme/);
  });

  it("has no fixed or sticky element", () => {
    expect(css).not.toMatch(/position\s*:\s*(?:fixed|sticky)/);
  });

  it("adds no motion, so no reduced-motion block is needed", () => {
    expect(css).not.toMatch(/@keyframes|animation|transition/);
  });

  it("applies :hover only where a real pointer exists (it uses none)", () => {
    for (const rule of rules.filter((r) => r.selector.includes(":hover"))) {
      expect(rule.context.some((context) => /^@media\s*\(\s*hover\s*:\s*hover\s*\)$/.test(context)), rule.selector).toBe(true);
    }
  });

  it("never uses the Error, Accent, Attention or Warning colors: a color is a judgment when it changes with the number", () => {
    expect(css).not.toMatch(/--color-(?:error|accent|attention|warning)/);
  });

  it("uses only tokens for color (no hex, rgb or named color)", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
    for (const match of css.matchAll(/(?<![-\w])(?:background|border(?:-[a-z-]+)?|color|fill|stroke)\s*:\s*([^;}]+)/g)) {
      const value = match[1].trim();
      // Widths, styles and keywords are fine; a color must be a var(--color-*) token.
      const colors = value.split(/\s+/).filter((part) => /^[a-z]+$/.test(part) && !["solid", "none", "dashed", "transparent", "inherit", "currentcolor"].includes(part));
      expect(colors, value).toEqual([]);
    }
  });

  it("colors text only with the two readable text tokens", () => {
    for (const match of css.matchAll(/(?<![-\w])color\s*:\s*([^;}]+)/g)) {
      expect(["var(--color-text-primary)", "var(--color-text-secondary)"], match[1]).toContain(match[1].trim());
    }
  });

  it("keeps secondary text off the sand fill of the delete question (only primary text reaches AA there)", () => {
    const panel = ruleFor(".panel")?.body ?? "";
    expect(panel).toContain("background: var(--color-secondary-light)");
    expect(panel).toMatch(/color\s*:\s*var\(--color-text-primary\)/);
    expect(ruleFor(".panelBody")?.body).not.toMatch(/color\s*:/);
  });

  it("paints the delete question as a neutral sand inset with a sand border", () => {
    expect(ruleFor(".panel")?.body).toMatch(/border\s*:\s*1px solid var\(--color-secondary\)/);
  });

  it("stacks Keep and Delete with a gap, so one thumb slip cannot hit both", () => {
    const actions = ruleFor(".panelActions")?.body ?? "";
    expect(actions).toContain("display: grid");
    expect(actions).toMatch(/gap\s*:\s*var\(--space-3\)/);
    expect(actions).toContain("justify-items: stretch");
  });

  it("styles a row as the Brand cards: surface, a light border, a large radius, a very light shadow", () => {
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

  it("keeps text fields at the body size or larger, so iOS never zooms the page on focus, and full tap targets", () => {
    const fields = ruleFor(".input,\n.select")?.body ?? "";
    expect(fields).toMatch(/font-size\s*:\s*var\(--font-size-body\)/);
    expect(fields).toMatch(/min-block-size\s*:\s*var\(--tap-target\)/);
  });

  it("marks a field that needs a look by a thicker edge as well as by its words, never by color alone", () => {
    const invalid = rules.find((rule) => rule.selector.includes('[aria-invalid="true"]'))?.body ?? "";
    expect(invalid).toMatch(/border-width\s*:\s*2px/);
  });

  it("shows a focused heading, notice and replies block with no ring (they are not controls; the flow title is the food one)", () => {
    expect(ruleFor(".panelTitle:focus,\n.panelTitle:focus-visible")?.body).toMatch(/outline\s*:\s*none/);
    expect(ruleFor(".notice:focus,\n.notice:focus-visible")?.body).toMatch(/outline\s*:\s*none/);
    expect(ruleFor(".replies:focus,\n.replies:focus-visible")?.body).toMatch(/outline\s*:\s*none/);
  });

  it("defines every class the weight components use (a missing class is `undefined`, silently)", () => {
    const used = new Set<string>();
    const sources = readdirSync(here(".")).filter((file) => file.endsWith(".tsx")).map((file) => ({ file, source: read(`./${file}`) }));
    // The pages of this item use the same sheet.
    sources.push({ file: "me/weights/page.tsx", source: readFileSync(here("../../app/(app)/me/weights/page.tsx"), "utf8") });
    for (const { source } of sources) {
      for (const match of source.matchAll(/\b(?:styles|weightStyles)\.([A-Za-z_]\w*)/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(15);
    const missing = [...used].filter((name) => !classesDefined.has(name));
    expect(missing).toEqual([]);
  });

  it("defines no class that nothing uses", () => {
    const used = new Set<string>();
    const files = readdirSync(here(".")).filter((file) => file.endsWith(".tsx")).map((file) => read(`./${file}`));
    files.push(readFileSync(here("../../app/(app)/me/weights/page.tsx"), "utf8"));
    for (const source of files) for (const match of source.matchAll(/\b(?:styles|weightStyles)\.([A-Za-z_]\w*)/g)) used.add(match[1]);
    const unused = [...classesDefined].filter((name) => !used.has(name));
    expect(unused).toEqual([]);
  });
});
