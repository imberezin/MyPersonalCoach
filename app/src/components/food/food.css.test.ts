// Source lint for the food screens' style sheet, read as text (no browser here). It guards what a
// screenshot would not show: logical properties (one sheet for Hebrew and English), hover only where a
// pointer exists, motion only for people who have not asked for less, the safe area at the bottom, and no
// fixed bar anywhere in the flow. tests/design/tokens.test.ts separately scans this file for colors.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(read("./food.module.css"));

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

describe("food.module.css", () => {
  it("finds its rules", () => {
    expect(rules.length).toBeGreaterThan(30);
  });

  it("uses logical properties only", () => {
    const offenders = css.split("\n").filter((line) => PHYSICAL.some((pattern) => pattern.test(line)));
    expect(offenders).toEqual([]);
  });

  it("has no dark theme", () => {
    expect(css).not.toMatch(/prefers-color-scheme|data-theme/);
  });

  it("has no fixed or sticky bar: the keyboard, the camera sheet and Save need the whole bottom of the screen", () => {
    expect(css).not.toMatch(/position\s*:\s*(?:fixed|sticky)/);
  });

  it("applies :hover only where a real pointer exists", () => {
    const hovered = rules.filter((rule) => rule.selector.includes(":hover"));
    expect(hovered.length).toBeGreaterThan(0);
    for (const rule of hovered) {
      expect(rule.context.some((context) => /^@media\s*\(\s*hover\s*:\s*hover\s*\)$/.test(context)), rule.selector).toBe(true);
    }
  });

  it("keeps the page clear of the home indicator and fills the dynamic viewport", () => {
    const main = ruleFor(".main")?.body ?? "";
    expect(main).toContain("min-block-size: 100dvh");
    expect(main).toContain("safe-area-inset-bottom");
    expect(main).toMatch(/padding-block\s*:\s*[^;]*calc\(var\(--space-6\) \+ env\(safe-area-inset-bottom/);
  });

  it("animates only for people who have not asked for less motion, and stops it for those who have", () => {
    const animated = rules.filter((rule) => /animation\s*:/.test(rule.body) && !/animation\s*:\s*none/.test(rule.body));
    expect(animated.length).toBeGreaterThan(0);
    for (const rule of animated) {
      expect(rule.context.some((context) => /prefers-reduced-motion\s*:\s*no-preference/.test(context)), rule.selector).toBe(true);
    }
    const quiet = rules.filter((rule) => rule.context.some((context) => /prefers-reduced-motion\s*:\s*reduce/.test(context)));
    expect(quiet.some((rule) => rule.selector === ".dot" && /animation\s*:\s*none/.test(rule.body))).toBe(true);
  });

  it("keeps text fields at the body size or larger, so iOS never zooms the page on focus", () => {
    const fields = ruleFor(".input,\n.select,\n.textarea")?.body ?? "";
    expect(fields).toMatch(/font-size\s*:\s*var\(--font-size-body\)/);
    expect(fields).toMatch(/min-block-size\s*:\s*var\(--tap-target\)/);
  });

  it("gives the tiles a full-size tap target and a border, not just a color", () => {
    const tile = ruleFor(".tile")?.body ?? "";
    expect(tile).toMatch(/min-block-size\s*:\s*var\(--tap-target\)/);
    expect(tile).toMatch(/border\s*:\s*1px solid/);
  });

  it("keeps to text and background pairs that tokens.test.ts validates (AA) on the soft fills", () => {
    // Secondary text and the link color do not reach 4.5:1 on these fills; primary text does.
    expect(ruleFor(".foodPortion")?.body).toMatch(/color\s*:\s*var\(--color-text-primary\)/);
    expect(ruleFor(".errorSummary a")?.body).toMatch(/color\s*:\s*var\(--color-text-primary\)/);
    // The resume card holds a primary-dark button: that pair is validated on the surface only.
    expect(ruleFor(".resume")?.body).toMatch(/background\s*:\s*var\(--color-surface\)/);
    // The tile hint is secondary text: the hover state changes the border and leaves the fill alone.
    const hover = parseRules(css).find((rule) => rule.selector === ".tile:hover:not(.tileOff)");
    expect(hover?.body).not.toMatch(/background/);
  });

  it("marks the tile that cannot be used yet by a dashed edge as well as by words", () => {
    expect(ruleFor(".tileOff")?.body).toMatch(/border-style\s*:\s*dashed/);
  });

  it("marks the 'Maybe' word with a border, not only a fill, and never in a verdict color", () => {
    const maybe = ruleFor(".maybe")?.body ?? "";
    expect(maybe).toMatch(/border\s*:\s*1px solid/);
    expect(maybe).not.toMatch(/color-(?:error|attention|accent)/);
  });

  it("styles the photo preview with the frame and radius the Brand document names", () => {
    expect(ruleFor(".previewFrame")?.body).toContain("var(--color-secondary-light)");
    const image = ruleFor(".previewImage")?.body ?? "";
    expect(image).toContain("var(--radius-xl)");
    expect(image).toContain("object-fit: contain");
  });

  it("shows a focused title with no ring (it is not a control)", () => {
    expect(ruleFor(".title:focus,\n.title:focus-visible")?.body).toMatch(/outline\s*:\s*none/);
  });
});
