import { PORTION_SIZES, PORTION_UNITS, type PortionSize, type PortionUnit } from "@/domain/food";

/** What a case expects of the model. Shared by the text cases (committed) and the photo labels (the user's, gitignored). */

export type ExpectedPortion = { size: PortionSize } | { amount: number; unit: PortionUnit };

export interface ExpectedFood {
  /** Accepted names, the first is the one shown in reports. */
  names: string[];
  /** Only text cases state portions. */
  portion?: ExpectedPortion;
}

/** foods: a normal case. not_food: the input is not food. nothing_expected: vague input, the model must not invent. */
export type CaseKind = "foods" | "not_food" | "nothing_expected";

export interface BakeCase {
  id: string;
  modality: "text" | "photo";
  kind: CaseKind;
  expected: ExpectedFood[];
  /** Hints are reported but do not decide pass or fail. */
  hints?: { mealType?: string; day?: string; time?: string };
  note?: string;
  /** text cases */
  text?: string;
  /** photo cases */
  file?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parsePortion(value: unknown, where: string): ExpectedPortion {
  if (!isRecord(value)) throw new Error(`${where}: portion must be an object`);
  if (typeof value.size === "string") {
    if (!(PORTION_SIZES as readonly string[]).includes(value.size)) throw new Error(`${where}: unknown size`);
    return { size: value.size as PortionSize };
  }
  if (typeof value.amount === "number" && value.amount > 0 && typeof value.unit === "string") {
    if (!(PORTION_UNITS as readonly string[]).includes(value.unit)) throw new Error(`${where}: unknown unit`);
    return { amount: value.amount, unit: value.unit as PortionUnit };
  }
  throw new Error(`${where}: portion needs a size, or an amount and a unit`);
}

/** "a|b" -> ["a","b"]. */
export function splitAlternatives(value: string): string[] {
  return value
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * Reads `bake-off/text-cases.json`:
 * [{ "id": "T01", "text": "...", "kind"?: "foods"|"not_food"|"nothing_expected",
 *    "expect": [{ "name": "a|b", "portion"?: { "size": "medium" } | { "amount": 2, "unit": "slice" } }],
 *    "hints"?: { "mealType"?, "day"?, "time"? }, "note"? }]
 * Throws a plain Error with the case id when something is malformed.
 */
export function parseTextCases(json: unknown): BakeCase[] {
  if (!Array.isArray(json)) throw new Error("text-cases.json must be an array");
  const seen = new Set<string>();
  return json.map((entry, index) => {
    const where = `text case #${index + 1}`;
    if (!isRecord(entry)) throw new Error(`${where}: must be an object`);
    const { id, text } = entry;
    if (typeof id !== "string" || !/^T\d{2,3}$/.test(id)) throw new Error(`${where}: id must look like T01`);
    if (seen.has(id)) throw new Error(`${id}: duplicate id`);
    seen.add(id);
    if (typeof text !== "string" || text.trim() === "" || text.length > 500) throw new Error(`${id}: text must be 1 to 500 characters`);

    const kind = entry.kind === undefined ? "foods" : entry.kind;
    if (kind !== "foods" && kind !== "not_food" && kind !== "nothing_expected") throw new Error(`${id}: unknown kind`);

    const rawExpect = entry.expect === undefined ? [] : entry.expect;
    if (!Array.isArray(rawExpect)) throw new Error(`${id}: expect must be an array`);
    const expected: ExpectedFood[] = rawExpect.map((e, i) => {
      if (!isRecord(e) || typeof e.name !== "string") throw new Error(`${id}: expect[${i}] needs a name`);
      const names = splitAlternatives(e.name);
      if (names.length === 0) throw new Error(`${id}: expect[${i}] has an empty name`);
      return e.portion === undefined ? { names } : { names, portion: parsePortion(e.portion, `${id}: expect[${i}]`) };
    });
    if (kind === "foods" && expected.length === 0) throw new Error(`${id}: a foods case needs at least one expected food`);
    if (kind !== "foods" && expected.length > 0) throw new Error(`${id}: only a foods case lists expected foods`);

    const hints = isRecord(entry.hints)
      ? {
          mealType: typeof entry.hints.mealType === "string" ? entry.hints.mealType : undefined,
          day: typeof entry.hints.day === "string" ? entry.hints.day : undefined,
          time: typeof entry.hints.time === "string" ? entry.hints.time : undefined,
        }
      : undefined;
    return { id, modality: "text", kind, expected, text, hints, note: typeof entry.note === "string" ? entry.note : undefined } satisfies BakeCase;
  });
}

export interface LabelEntry {
  file: string;
  /** One list of accepted names per food. Empty: the photo is not food. */
  foods: string[][];
  note?: string;
}

/**
 * `labels.txt`: `file-name.jpg: food one, food two|other word, food three  # optional note`
 * (a plain comma or the Arabic comma separates foods, `|` separates acceptable names, a line that
 * starts with `#` is a comment, a line with no foods means "this is not food"). Bad lines are
 * reported, not thrown, so a non-technical user gets a list of what to fix.
 */
export function parseLabels(text: string): { entries: LabelEntry[]; errors: string[] } {
  const entries: LabelEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNo = index + 1;
    const trimmed = rawLine.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      errors.push(`line ${lineNo}: missing ":" after the file name`);
      return;
    }
    const file = trimmed.slice(0, colon).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.jpe?g$/i.test(file)) {
      errors.push(`line ${lineNo}: "${file.slice(0, 40)}" is not a .jpg file name`);
      return;
    }
    if (seen.has(file.toLowerCase())) {
      errors.push(`line ${lineNo}: ${file} is listed twice`);
      return;
    }
    seen.add(file.toLowerCase());

    let rest = trimmed.slice(colon + 1);
    let note: string | undefined;
    const hash = rest.indexOf("#");
    if (hash !== -1) {
      note = rest.slice(hash + 1).trim() || undefined;
      rest = rest.slice(0, hash);
    }
    const foods = rest
      .split(/[,،]/)
      .map((part) => splitAlternatives(part))
      .filter((names) => names.length > 0);
    entries.push({ file, foods, note });
  });
  return { entries, errors };
}

/** Photo cases from parsed labels; ids follow the order of the file (P01, P02, ...). */
export function photoCasesFromLabels(entries: readonly LabelEntry[]): BakeCase[] {
  return entries.map((entry, index) => ({
    id: `P${String(index + 1).padStart(2, "0")}`,
    modality: "photo",
    kind: entry.foods.length === 0 ? "not_food" : "foods",
    expected: entry.foods.map((names) => ({ names })),
    file: entry.file,
    note: entry.note,
  }));
}

export interface Candidate {
  provider: "gemini" | "groq";
  model: string;
  responseFormat?: "json_object" | "json_schema";
}

/** `bake-off/candidates.json`: the models to compare. Throws a plain Error when malformed. */
export function parseCandidates(json: unknown): Candidate[] {
  if (!Array.isArray(json) || json.length === 0) throw new Error("candidates.json must be a non-empty array");
  return json.map((entry, index) => {
    const where = `candidate #${index + 1}`;
    if (!isRecord(entry)) throw new Error(`${where}: must be an object`);
    if (entry.provider !== "gemini" && entry.provider !== "groq") throw new Error(`${where}: provider must be gemini or groq`);
    if (typeof entry.model !== "string" || !/^[A-Za-z0-9._/:-]{1,100}$/.test(entry.model)) throw new Error(`${where}: invalid model id`);
    if (entry.responseFormat !== undefined) {
      if (entry.responseFormat !== "json_object" && entry.responseFormat !== "json_schema") throw new Error(`${where}: invalid responseFormat`);
      if (entry.provider !== "groq") throw new Error(`${where}: responseFormat applies to groq only`);
    }
    return { provider: entry.provider, model: entry.model, responseFormat: entry.responseFormat };
  });
}
