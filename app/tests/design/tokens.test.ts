// Enforces "Personal Eating Coach — Brand & Color System.md" (repository root) as the only authority
// for visual design: the tokens match the document, components hard-code no colors, and text colors
// stay readable. To change the look, change the document first, then tokens.css, then this test.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP = fileURLToPath(new URL("../../", import.meta.url));
const DOC_PATH = join(APP, "..", "Personal Eating Coach — Brand & Color System.md");
const TOKENS_PATH = join(APP, "src", "styles", "tokens.css");
const BRAND_COLORS_PATH = join(APP, "src", "styles", "brandColors.ts");

// The document is saved with Windows line endings; normalize them before matching.
const doc = readFileSync(DOC_PATH, "utf8").replace(/\r\n/g, "\n");
const tokensCss = readFileSync(TOKENS_PATH, "utf8");

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseCustomProperties(css: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of stripCssComments(css).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1], match[2].trim().toLowerCase());
  }
  return map;
}

const tokens = parseCustomProperties(tokensCss);

function docSection(startHeading: string): string {
  const start = doc.indexOf(startHeading);
  if (start === -1) throw new Error(`Heading not found in the Brand document: ${startHeading}`);
  return doc.slice(start);
}

// --- contrast helpers (WCAG 2.x)
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const token = (name: string): string => {
  const value = tokens.get(name);
  if (!value) throw new Error(`Missing token ${name}`);
  return value;
};

describe("tokens.css matches the Brand & Color System document", () => {
  it("defines every token of section 10 with the same value", () => {
    const block = /```css\n([\s\S]*?)```/.exec(docSection("# 10. Design Tokens"))?.[1];
    expect(block, "section 10 should contain a css block").toBeTruthy();
    const docTokens = parseCustomProperties(block as string);
    expect(docTokens.size).toBeGreaterThan(15);
    for (const [name, value] of docTokens) {
      expect(tokens.get(name), name).toBe(value);
    }
  });

  it("defines the Light variants of the semantic colors of section 7", () => {
    const section = docSection("# 7. Semantic Colors");
    const found = [...section.matchAll(/(Success|Warning|Attention|Error) Light:\s*(#[0-9a-fA-F]{6})/g)];
    expect(found).toHaveLength(4);
    for (const [, name, hex] of found) {
      expect(tokens.get(`--color-${name.toLowerCase()}-light`), name).toBe(hex.toLowerCase());
    }
  });

  it("uses the radii of section 13", () => {
    const section = docSection("# 13. Rounded UI");
    const found = [...section.matchAll(/(Small|Medium|Large|XL|Pill):\s*(\d+)px/g)];
    expect(found).toHaveLength(5);
    const names: Record<string, string> = {
      Small: "sm",
      Medium: "md",
      Large: "lg",
      XL: "xl",
      Pill: "pill",
    };
    for (const [, label, px] of found) {
      expect(tokens.get(`--radius-${names[label]}`), label).toBe(`${px}px`);
    }
  });

  it("does not define a dark theme (section 9: not a Phase 1 priority)", () => {
    expect(tokensCss).not.toMatch(/prefers-color-scheme\s*:\s*dark/);
    expect(tokensCss).not.toMatch(/data-theme\s*=\s*["']?dark/);
  });

  it("keeps the manifest theme color equal to --color-background", () => {
    const source = readFileSync(BRAND_COLORS_PATH, "utf8");
    const literal = /THEME_COLOR\s*=\s*["'](#[0-9a-fA-F]{6})["']/.exec(source)?.[1];
    expect(literal?.toLowerCase()).toBe(token("--color-background"));
    const iconScript = readFileSync(join(APP, "scripts", "generate-icons.mjs"), "utf8").toLowerCase();
    expect(iconScript).toContain(token("--color-background"));
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(css|ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const ALLOWED_TO_HOLD_COLORS = new Set([TOKENS_PATH, BRAND_COLORS_PATH]);
const files = sourceFiles(join(APP, "src")).filter((f) => !ALLOWED_TO_HOLD_COLORS.has(f));
const cssFiles = files.filter((f) => f.endsWith(".css"));

describe("components use tokens only (sections 9, 10, 29)", () => {
  it("finds the source files to check", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(cssFiles.length).toBeGreaterThan(2);
  });

  it("has no hard-coded color in any CSS file", () => {
    const offenders: string[] = [];
    for (const file of cssFiles) {
      const css = stripCssComments(readFileSync(file, "utf8"));
      const hex = /#[0-9a-fA-F]{3,8}\b/.exec(css);
      const fn = /\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/.exec(css);
      const named =
        /(?<![-\w])(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke|outline-color)\s*:\s*(?:red|green|blue|white|black|gray|grey|orange|yellow|purple|pink)\b/.exec(
          css,
        );
      const hit = hex?.[0] ?? fn?.[0] ?? named?.[0];
      if (hit) offenders.push(`${relative(APP, file)}: ${hit}`);
    }
    expect(offenders, "use a --color-* token instead").toEqual([]);
  });

  it("has no hard-coded color in any TypeScript file", () => {
    const offenders: string[] = [];
    for (const file of files.filter((f) => !f.endsWith(".css"))) {
      const code = readFileSync(file, "utf8");
      const hit = /["'`]#[0-9a-fA-F]{3,8}["'`]|\b(?:rgb|rgba|hsl|hsla)\(/.exec(code);
      if (hit) offenders.push(`${relative(APP, file)}: ${hit[0]}`);
    }
    expect(offenders, "import THEME_COLOR from src/styles/brandColors.ts, or use a CSS token").toEqual([]);
  });

  it("uses only readable colors for text", () => {
    // The brand colors are too light to carry text: Primary 3.1:1, Accent 2.6:1, Secondary 1.9:1,
    // Error 3.6:1 and Text Muted 2.5:1 on white, below the 4.5:1 that WCAG AA asks for.
    // Backgrounds, borders and large buttons may use them; text may not.
    const allowed = /^(?:var\(--color-(?:text-primary|text-secondary|on-primary|primary-dark)\)|inherit|currentcolor)$/i;
    const offenders: string[] = [];
    for (const file of cssFiles) {
      const css = stripCssComments(readFileSync(file, "utf8"));
      for (const match of css.matchAll(/(?<![-\w])color\s*:\s*([^;}]+)/g)) {
        const value = match[1].trim();
        if (!allowed.test(value)) offenders.push(`${relative(APP, file)}: color: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the palette's readable pairs (WCAG)", () => {
  const AA = 4.5;
  const pairs: Array<[string, string, string]> = [
    ["--color-text-primary", "--color-background", "main text"],
    ["--color-text-primary", "--color-surface", "text on cards"],
    ["--color-text-secondary", "--color-background", "secondary text"],
    ["--color-text-secondary", "--color-surface", "secondary text on cards"],
    ["--color-primary-dark", "--color-surface", "links"],
    ["--color-on-primary", "--color-primary-dark", "button on hover"],
    ["--color-text-primary", "--color-primary-light", "text on soft positive backgrounds"],
    ["--color-text-primary", "--color-secondary-light", "text on food and context surfaces"],
    ["--color-text-primary", "--color-accent-light", "text in a difficult moment"],
    ["--color-text-primary", "--color-attention-light", "text on attention backgrounds"],
    ["--color-text-primary", "--color-error-light", "text in an error message"],
  ];

  it.each(pairs)("%s on %s reaches AA (%s)", (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(AA);
  });

  it("white on Primary Green only qualifies as large text (document section 15)", () => {
    const ratio = contrast(token("--color-on-primary"), token("--color-primary"));
    expect(ratio).toBeGreaterThanOrEqual(3); // large and bold text only
    expect(ratio).toBeLessThan(AA); // so the button label must stay Body Large and bold
  });
});
