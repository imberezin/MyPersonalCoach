// Source lint for the sign-in style sheet, read as text. The show-password button is the part with something to guard:
// it sits at the end of the line in both languages, it is a full tap target, and the text never runs under it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(read("./login.module.css"));

/** The body of the first rule with exactly this selector (flat CSS: no nesting; the one @media is read separately). */
const body = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
};

describe("login.module.css", () => {
  it("uses logical properties only", () => {
    const physical = [
      /(?<![-\w])(?:margin|padding)-(?:left|right)\s*:/,
      /(?<![-\w])(?:left|right)\s*:/,
      /text-align\s*:\s*(?:left|right)/,
      /border-(?:left|right)(?:-[a-z]+)?\s*:/,
    ];
    const offenders = css.split("\n").filter((line) => physical.some((pattern) => pattern.test(line)));
    expect(offenders).toEqual([]);
  });

  it("puts the show-password button at the end of the line, a full tap target, over the input's own padding", () => {
    const reveal = body(".reveal");
    expect(reveal).toMatch(/position\s*:\s*absolute/);
    expect(reveal).toMatch(/inset-inline-end\s*:\s*0/);
    expect(reveal).toMatch(/inline-size\s*:\s*var\(--tap-target\)/);
    expect(body(".passwordBox")).toMatch(/position\s*:\s*relative/);
    // The password is read left to right but the button is at the end of the PAGE's line, so room is kept on BOTH sides:
    // the text never runs under the button, whichever side it is on.
    expect(body(".passwordBox input")).toMatch(/padding-inline\s*:\s*var\(--tap-target\)/);
  });

  it("lets the password box's padding win over the general field padding (it comes later, with the same weight)", () => {
    const general = css.indexOf(".field input {");
    const password = css.indexOf(".passwordBox input {");
    expect(general).toBeGreaterThan(-1);
    expect(password).toBeGreaterThan(general);
  });

  it("hides the browser's own reveal button in Edge, so there are not two eyes", () => {
    const rule = body(".passwordBox input::-ms-reveal,\n.passwordBox input::-ms-clear");
    expect(rule).toMatch(/display\s*:\s*none/);
  });

  it("draws the icon in the button's own color, with a token, and no color of its own", () => {
    expect(body(".reveal")).toMatch(/color\s*:\s*var\(--color-text-secondary\)/);
    expect(body(".reveal svg")).toMatch(/stroke\s*:\s*currentColor/);
  });

  it("changes the icon on hover only where a real pointer exists", () => {
    const hover = /@media\s*\(\s*hover\s*:\s*hover\s*\)\s*\{\s*\.reveal:hover\s*\{[^}]*\}\s*\}/.test(css);
    expect(hover).toBe(true);
    expect(css.replace(/@media\s*\(\s*hover\s*:\s*hover\s*\)\s*\{[^{}]*\{[^}]*\}\s*\}/, "")).not.toMatch(/\.reveal:hover/);
  });
});
