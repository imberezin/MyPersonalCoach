// Source lint for the shell's two style sheets, read as text (no browser here). It guards the rules that
// a screenshot would not show: logical properties (so Hebrew and English share one sheet), the safe
// areas, reduced motion for the backdrop, hover only where a pointer exists, and the dialog resets.
// tests/design/tokens.test.ts separately scans these files for hard-coded colors.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const files = {
  "shell.module.css": stripComments(read("./shell.module.css")),
  "reportSheet.module.css": stripComments(read("./reportSheet.module.css")),
};
const tokensCss = stripComments(read("../../styles/tokens.css"));

interface Rule {
  selector: string;
  body: string;
  /** The at-rules around the rule, outermost first, for example "@media (hover: hover)". */
  context: string[];
}

/** A small reader for the flat CSS these files use: rules, and rules inside one level of @media. */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const stack: Array<{ prelude: string; start: number }> = [];
  let prelude = "";
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === "{") {
      stack.push({ prelude: prelude.trim(), start: i + 1 });
      prelude = "";
    } else if (char === "}") {
      const block = stack.pop();
      if (block && !block.prelude.startsWith("@")) {
        rules.push({ selector: block.prelude, body: css.slice(block.start, i), context: stack.map((b) => b.prelude) });
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

const rulesOf = Object.fromEntries(Object.entries(files).map(([name, css]) => [name, parseRules(css)]));
const ruleFor = (file: keyof typeof files, selector: string) =>
  rulesOf[file].find((rule) => rule.selector === selector && rule.context.length === 0);

// The env() insets are named by physical side, so the bar's side paddings are the one exception.
const PHYSICAL: RegExp[] = [
  /(?<![-\w])(?:margin|padding)-(?:left|right)\s*:/,
  /(?<![-\w])(?:left|right)\s*:/,
  /text-align\s*:\s*(?:left|right)/,
  /border-(?:left|right)(?:-[a-z]+)?\s*:/,
  /border-(?:top|bottom)-(?:left|right)-radius/,
  /(?<![-\w])float\s*:/,
  /row-reverse/,
];

describe.each(Object.entries(files))("%s", (name, css) => {
  it("uses logical properties only", () => {
    const offenders = css
      .split("\n")
      .filter((line) => !/safe-area-inset-(?:left|right)/.test(line))
      .filter((line) => PHYSICAL.some((pattern) => pattern.test(line)));
    expect(offenders).toEqual([]);
  });

  it("has no dark theme", () => {
    expect(css).not.toMatch(/prefers-color-scheme|data-theme/);
  });

  it("applies :hover only where a real pointer exists", () => {
    const hovered = rulesOf[name].filter((rule) => rule.selector.includes(":hover"));
    expect(hovered.length).toBeGreaterThan(0);
    for (const rule of hovered) {
      expect(rule.context.some((context) => /^@media\s*\(\s*hover\s*:\s*hover\s*\)$/.test(context)), rule.selector).toBe(true);
    }
  });
});

describe("shell.module.css", () => {
  it("keeps the bar and the content clear of the safe area", () => {
    expect(ruleFor("shell.module.css", ".nav")?.body).toContain("safe-area-inset-bottom");
    const content = ruleFor("shell.module.css", ".content")?.body ?? "";
    expect(content).toContain("safe-area-inset-bottom");
    expect(content).toContain("--nav-height");
    expect(content).toContain("--nav-lift");
  });

  it("pads the fixed bar by the side insets", () => {
    const nav = ruleFor("shell.module.css", ".nav")?.body ?? "";
    expect(nav).toContain("safe-area-inset-left");
    expect(nav).toContain("safe-area-inset-right");
  });

  it("paints hover on the icon shape only, never on an item", () => {
    for (const rule of rulesOf["shell.module.css"].filter((r) => r.selector.includes(":hover"))) {
      for (const selector of rule.selector.split(",")) {
        const subject = selector.trim().split(/\s+/).pop() ?? "";
        expect(subject, selector).not.toMatch(/^\.item(?::hover)?$/);
      }
    }
  });

  it("never lets a label sit on the soft green (the item itself stays transparent over the surface)", () => {
    expect(ruleFor("shell.module.css", ".item")?.body).toMatch(/background\s*:\s*transparent/);
    expect(ruleFor("shell.module.css", ".nav")?.body).toContain("background: var(--color-surface)");
  });

  it("marks the current page by more than color: a bolder label and a pill behind the icon", () => {
    expect(ruleFor("shell.module.css", ".itemActive")?.body).toMatch(/font-weight\s*:\s*700/);
    expect(ruleFor("shell.module.css", ".itemActive .iconWrap")?.body).toContain("var(--color-primary-light)");
  });

  it("keeps a visible focus ring on the Report button, around the disc", () => {
    expect(ruleFor("shell.module.css", ".report:focus-visible .reportDisc")?.body).toMatch(/outline\s*:\s*\d+px solid/);
  });
});

describe("reportSheet.module.css", () => {
  it("resets the browser's dialog border and padding", () => {
    const sheet = ruleFor("reportSheet.module.css", ".sheet")?.body ?? "";
    expect(sheet).toMatch(/border\s*:\s*0\s*(?:;|$)/);
    expect(sheet).toMatch(/padding\s*:\s*0\s*(?:;|$)/);
  });

  it("never sets display on the closed dialog (a display rule belongs on .sheet[open])", () => {
    const bare = rulesOf["reportSheet.module.css"].filter((rule) => rule.selector === ".sheet");
    expect(bare.length).toBeGreaterThan(0);
    for (const rule of bare) expect(rule.body).not.toMatch(/(?<![-\w])display\s*:/);
  });

  it("stops the sheet and its backdrop animating under reduced motion (the global rule misses ::backdrop)", () => {
    const quiet = rulesOf["reportSheet.module.css"].filter((rule) =>
      rule.context.some((context) => /prefers-reduced-motion\s*:\s*reduce/.test(context)),
    );
    expect(quiet.some((rule) => rule.selector.includes("::backdrop"))).toBe(true);
    expect(quiet.some((rule) => rule.selector.includes(".sheet[open]"))).toBe(true);
    for (const rule of quiet) expect(rule.body).toMatch(/animation\s*:\s*none/);
  });

  it("builds the scrim from an existing token instead of a new color", () => {
    const backdrop = ruleFor("reportSheet.module.css", ".sheet::backdrop")?.body ?? "";
    expect(backdrop).toContain("color-mix(");
    expect(backdrop).toContain("var(--color-text-primary)");
  });

  it("keeps the sheet's bottom padding clear of the home indicator", () => {
    expect(ruleFor("reportSheet.module.css", ".panel")?.body).toContain("safe-area-inset-bottom");
  });

  it("sits above the bar", () => {
    expect(ruleFor("reportSheet.module.css", ".sheet")?.body).toContain("z-index: var(--z-sheet)");
  });

  it("paints the sheet on the surface, where the dark text color is readable", () => {
    const sheet = ruleFor("reportSheet.module.css", ".sheet")?.body ?? "";
    expect(sheet).toContain("background: var(--color-surface)");
    expect(sheet).toContain("color: var(--color-text-primary)");
  });

  it("marks a row whose flow does not exist yet by more than color: a dashed edge", () => {
    expect(ruleFor("reportSheet.module.css", ".option")?.body).toMatch(/border\s*:\s*1px dashed/);
  });
});

describe("tokens.css layout geometry", () => {
  it.each(["--nav-height", "--nav-lift", "--z-nav", "--z-sheet"])("defines %s", (name) => {
    expect(tokensCss).toMatch(new RegExp(`${name}\\s*:`));
  });

  it("adds no visual token for overlays (the Brand document is the authority for those)", () => {
    expect(tokensCss).not.toMatch(/--shadow-2\b|--color-scrim\b|--color-overlay\b/);
  });

  it("stays a light-only sheet", () => {
    expect(tokensCss).not.toMatch(/prefers-color-scheme|data-theme/);
  });
});
