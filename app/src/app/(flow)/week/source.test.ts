// Source scans for "your week", read as text: the guarantees that no behavior test can show because they are about what is NOT
// there. One clock (currentInstant), no admin client, no AI code on any render path, and exactly one place where an AI wording
// is ever requested.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../../", import.meta.url));
const HERE = fileURLToPath(new URL(".", import.meta.url));

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return files(full, pattern);
    return pattern.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

const SOURCE = /\.(ts|tsx)$/;
const rel = (file: string) => relative(SRC, file).replace(/\\/g, "/");
const read = (file: string) => readFileSync(file, "utf8");
/** Code only: the comments explain the rules and may name what is forbidden. */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PAGE_AND_ACTIONS = files(HERE, SOURCE);
const COMPONENTS = files(join(SRC, "components", "weekly"), SOURCE);
const WEEKLY_LIB = files(join(SRC, "lib", "weekly"), SOURCE);
const WEEKLY_DOMAIN = files(join(SRC, "domain", "weekly"), SOURCE);
const HOME_VIEW = [join(SRC, "app", "(app)", "_components", "HomeView.tsx"), join(SRC, "app", "(app)", "_components", "homeCopy.ts")];
/** Every file of the weekly feature that renders or decides something. */
const WEEKLY_FILES = [...PAGE_AND_ACTIONS, ...COMPONENTS, ...WEEKLY_LIB, ...WEEKLY_DOMAIN, ...HOME_VIEW];

describe("the weekly files", () => {
  it("finds the files it scans", () => {
    expect(PAGE_AND_ACTIONS.map(rel)).toEqual(expect.arrayContaining(["app/(flow)/week/page.tsx", "app/(flow)/week/actions.ts", "app/(flow)/week/_lib/gate.ts"]));
    expect(COMPONENTS.length).toBeGreaterThanOrEqual(6);
    expect(WEEKLY_LIB.length).toBeGreaterThanOrEqual(6);
    expect(WEEKLY_DOMAIN.length).toBeGreaterThanOrEqual(8);
  });

  it("reads no clock of its own in the page, the actions or the components: the one clock is currentInstant()", () => {
    for (const file of [...PAGE_AND_ACTIONS, ...COMPONENTS, ...HOME_VIEW]) {
      expect(code(file), rel(file)).not.toMatch(/new Date\(\s*\)|Date\.now\s*\(|performance\.now/);
    }
  });

  it("makes no Date at all in the page, the actions or the components (the dates of the range come from Intl, the instants from currentInstant)", () => {
    for (const file of [...PAGE_AND_ACTIONS, ...COMPONENTS]) expect(code(file), rel(file)).not.toMatch(/new Date\(/);
  });

  it("never uses the admin client", () => {
    for (const file of WEEKLY_FILES) expect(code(file), rel(file)).not.toMatch(/createAdminClient|SERVICE_ROLE|service_role/);
  });

  it("never opens or names an environment file or a key", () => {
    for (const file of WEEKLY_FILES) expect(code(file), rel(file)).not.toMatch(/process\.env|\.env\b|API_KEY|GEMINI|GROQ/);
  });

  it("imports no AI gateway and no provider from any render path (the page, the components, Home)", () => {
    for (const file of [join(HERE, "page.tsx"), ...COMPONENTS, ...HOME_VIEW]) {
      expect(code(file), rel(file)).not.toMatch(/lib\/ai\/(gateway|providers)|produce(Weekly|Experiment)|wordWeeklyLine|wordExperiment|generateInsight/);
    }
  });

  it("imports no writer from a render path: the page and the components read only", () => {
    for (const file of [join(HERE, "page.tsx"), ...COMPONENTS]) {
      expect(code(file), rel(file)).not.toMatch(/lib\/weekly\/(open|result)|lib\/experiments\/repo|lib\/patterns\/(sync|feedback)|lib\/analytics\/track/);
    }
  });

  it("requests an AI wording from exactly one place: the Server Actions file", () => {
    const importers = WEEKLY_FILES.filter((file) => /\b(produceWeeklyLineWording|produceExperimentWording)\b/.test(code(file)))
      // The orchestrators are defined in their own files; the scan is about who calls them.
      .filter((file) => !/lib\/weekly\/word\.ts$/.test(rel(file)))
      .map(rel);
    expect(importers).toEqual(["app/(flow)/week/actions.ts"]);
  });

  it("calls the weekly-line orchestrator and the experiment orchestrator only after a row was written by the same press", () => {
    const source = code(join(HERE, "actions.ts"));
    const open = source.slice(source.indexOf("export async function openWeeklyStoryAction"));
    expect(open.indexOf("openWeeklyStory(")).toBeGreaterThan(-1);
    expect(open.indexOf("openWeeklyStory(")).toBeLessThan(open.indexOf("produceWeeklyLineWording("));
    const propose = source.slice(source.indexOf("export async function proposeWeeklyExperimentAction"));
    expect(propose.indexOf("insertOfferedExperiment(")).toBeGreaterThan(-1);
    expect(propose.indexOf("insertOfferedExperiment(")).toBeLessThan(propose.indexOf("produceExperimentWording("));
  });

  it("keeps the action file a pure Server Action file: only async functions are exported", () => {
    const source = code(join(HERE, "actions.ts"));
    expect(source.startsWith('"use server";')).toBe(true);
    const exports = Array.from(source.matchAll(/^export\s+(.*)$/gm), (match) => match[1]);
    expect(exports.length).toBe(7);
    for (const line of exports) expect(line, line).toMatch(/^async function \w+Action\(/);
  });

  it("keeps the action names the Home view and the page import", () => {
    const actions = code(join(HERE, "actions.ts"));
    for (const name of [
      "openWeeklyStoryAction",
      "snoozeWeeklyCardAction",
      "answerWeeklyPatternAction",
      "answerExperimentResultAction",
      "proposeWeeklyExperimentAction",
      "startWeeklyExperimentAction",
      "skipWeeklyExperimentAction",
    ]) {
      expect(actions, name).toContain(`export async function ${name}(`);
    }
  });

  it("writes no sentence of its own into the components: every word comes from the catalog (no Hebrew or English literal in a component)", () => {
    for (const file of COMPONENTS.filter((f) => f.endsWith(".tsx"))) {
      const source = code(file);
      expect(source, rel(file)).not.toMatch(/[֐-׿]/);
      // Quoted words that look like a sentence (two or more words with spaces and a letter case) are copy.
      expect(source, rel(file)).not.toMatch(/>\s*[A-Z][a-z]+(?: [a-z]+)+[.?]?\s*</);
    }
  });
});
