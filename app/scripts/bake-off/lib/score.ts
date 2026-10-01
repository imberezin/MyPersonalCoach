import { formatLocalTime, type Portion, type UnderstoodMeal } from "@/domain/food";
import type { BakeCase, ExpectedFood, ExpectedPortion } from "./cases";

/**
 * Automatic scoring of one case. The question it answers is the product's own: would the person have
 * to correct this list? `edits = missing + extra + portionWrong`; a case passes with at most one edit.
 */

export const MAX_EDITS_TO_PASS = 1;

/** NFC, lower case, no niqqud, no punctuation, single spaces, a leading ה (the) removed. */
export function normalizeName(raw: string): string {
  let s = raw.normalize("NFC").toLowerCase();
  s = s.replace(/[֑-ׇ]/g, ""); // niqqud and cantillation marks
  s = s.replace(/['‘’׳"״]/g, ""); // apostrophes and gershayim vanish: צ'יפס -> ציפס
  s = s.replace(/[\p{P}\p{S}]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 2 && s.startsWith("ה")) s = s.slice(1);
  return s;
}

/** Equal, or one contains the other (a one-letter string only matches by equality). */
export function nameMatches(outputName: string, accepted: readonly string[]): boolean {
  const out = normalizeName(outputName);
  if (out === "") return false;
  return accepted.some((candidate) => {
    const exp = normalizeName(candidate);
    if (exp === "") return false;
    if (out === exp) return true;
    if (out.length < 2 || exp.length < 2) return false;
    return out.includes(exp) || exp.includes(out);
  });
}

function portionMatches(expected: ExpectedPortion, got: Portion | null): boolean {
  if (got === null) return false;
  if ("size" in expected) return got.kind === "size" && got.size === expected.size;
  return got.kind === "amount" && got.unit === expected.unit && Math.abs(got.amount - expected.amount) < 0.01;
}

export type CaseOutcome = { ok: true; meal: UnderstoodMeal } | { ok: false; reason: string };

export interface CaseScore {
  id: string;
  /** The model answered and the answer validated. */
  valid: boolean;
  missing: string[];
  extra: string[];
  portionWrong: string[];
  edits: number;
  contradiction: boolean;
  /** Reported only; does not decide the case. */
  hintsWrong: string[];
  pass: boolean;
}

function hintsWrongOf(c: BakeCase, meal: UnderstoodMeal): string[] {
  const wrong: string[] = [];
  if (!c.hints) return wrong;
  if (c.hints.mealType && meal.mealTypeHint !== c.hints.mealType) wrong.push(`meal type ${meal.mealTypeHint ?? "none"} (expected ${c.hints.mealType})`);
  if (c.hints.day && (meal.timeHint?.day ?? null) !== c.hints.day) wrong.push(`day ${meal.timeHint?.day ?? "none"} (expected ${c.hints.day})`);
  if (c.hints.time) {
    const got = meal.timeHint?.minuteOfDay;
    const gotText = typeof got === "number" ? formatLocalTime(got) : "none";
    if (gotText !== c.hints.time) wrong.push(`time ${gotText} (expected ${c.hints.time})`);
  }
  return wrong;
}

export function scoreCase(c: BakeCase, outcome: CaseOutcome): CaseScore {
  const base = { id: c.id, missing: [] as string[], extra: [] as string[], portionWrong: [] as string[], edits: 0, contradiction: false, hintsWrong: [] as string[] };
  if (!outcome.ok) {
    return { ...base, valid: false, missing: c.expected.map((e) => e.names[0]), edits: c.expected.length, pass: false };
  }
  const meal = outcome.meal;
  const hintsWrong = hintsWrongOf(c, meal);

  if (c.kind === "not_food") {
    const invented = meal.notFood ? [] : meal.items.map((i) => i.name);
    return { ...base, valid: true, hintsWrong, extra: invented, edits: invented.length, pass: invented.length === 0 };
  }
  if (c.kind === "nothing_expected") {
    // Vague input: items are acceptable only when the model itself marked them uncertain.
    const invented = meal.notFood ? [] : meal.items.filter((i) => !i.uncertain).map((i) => i.name);
    return { ...base, valid: true, hintsWrong, extra: invented, edits: invented.length, pass: invented.length === 0 };
  }

  const matched = new Set<number>();
  const portionChecked = new Set<number>();
  const extra: string[] = [];
  const portionWrong: string[] = [];
  for (const item of meal.items) {
    const index = c.expected.findIndex((e: ExpectedFood) => nameMatches(item.name, e.names));
    if (index === -1) {
      extra.push(item.name);
      continue;
    }
    matched.add(index);
    const wanted = c.expected[index].portion;
    if (wanted && !portionChecked.has(index)) {
      portionChecked.add(index);
      if (!portionMatches(wanted, item.portion)) portionWrong.push(c.expected[index].names[0]);
    }
  }
  const missing = c.expected.filter((_, i) => !matched.has(i)).map((e) => e.names[0]);
  const contradiction = meal.notFood && c.expected.length > 0;
  const edits = missing.length + extra.length + portionWrong.length;
  return { ...base, valid: true, missing, extra, portionWrong, edits, contradiction, hintsWrong, pass: edits <= MAX_EDITS_TO_PASS && !contradiction };
}
