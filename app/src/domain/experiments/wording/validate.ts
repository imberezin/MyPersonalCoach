import { AI_WORDING } from "./constants";
import {
  ADVICE_MARKERS,
  FOOD_WORDS,
  JUDGMENT_WORDS,
  NEGATIVE_CONTRACTION,
  NEGATORS,
  NUMBER_WORDS,
  QUANTIFIERS,
  UNIT_WORDS,
  copyLintHits,
} from "./lint";

/** The checks, in the order they run. The FIRST failure is the one reported. */
export const WORDING_CHECKS = [
  "empty",
  "markup",
  "language",
  "length",
  "digits",
  "number_words",
  "units",
  "foods",
  "advice",
  "lint",
  "judgment",
  "negation",
  "overlap",
  "new_tokens",
] as const;

export type WordingCheck = (typeof WORDING_CHECKS)[number];

export type WordingVerdict = { ok: true; text: string } | { ok: false; check: WordingCheck };

/**
 * The deterministic validator of an AI reworded experiment sentence. Pure and total: it never throws and never
 * mutates its input. The principle: the library's own words are the allow-list. A digit run, a number word, a
 * unit, a food word or an advice marker is acceptable if and only if the APPROVED sentence itself contains it.
 * `negation` protects the action itself ("without a screen" must not become "with a screen", no "do not" may
 * appear, and each negator must still apply to the same object), `number_words` also holds the quantity words
 * ("a few minutes" stays "a few minutes"), and `overlap` / `new_tokens` (which also counts the sentences) stop a
 * fluent but different instruction.
 *
 * `approved` is the library sentence with its parameters already substituted. The candidate is normalised (NFC,
 * runs of whitespace collapsed, trimmed) and the normalised text is what `ok: true` returns.
 */
export function validateWording(input: { candidate: string; approved: string; locale: "he" | "en" }): WordingVerdict {
  try {
    return run(input);
  } catch {
    // Unreachable for any string input; a verdict is still better than a throw into the caller.
    return { ok: false, check: "markup" };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Text helpers

/** Hebrew points, cantillation and the other combining marks that must not hide a word from the lists. */
const HEBREW_MARKS = /[֑-ׇֽֿׁׂׅׄ]/g;
/** The clitic letters a Hebrew word may carry in front of it (and, the, in, like, to, from, that). */
const HEBREW_CLITICS = "ובהכלמש";

function normalizeText(raw: string): string {
  return raw.normalize("NFC").replace(/[\p{Zs}\t]+/gu, " ").trim();
}

const WORD_PATTERN = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;

/** Lowercase words (letters and digits, one inner apostrophe allowed), Hebrew points removed. */
function tokenize(text: string): string[] {
  const plain = text.normalize("NFC").replace(HEBREW_MARKS, "").replace(/[’׳]/g, "'").toLowerCase();
  return plain.match(WORD_PATTERN) ?? [];
}

/**
 * The same words as `tokenize`, in their original letter case (for showing an anchor phrase to the model).
 * `tokenizeSurface(x).map(lowercase)` is `tokenize(x)`.
 */
export function tokenizeSurface(text: string): string[] {
  const plain = text.normalize("NFC").replace(HEBREW_MARKS, "").replace(/[’׳]/g, "'");
  return plain.match(WORD_PATTERN) ?? [];
}

/** The token itself and, for a Hebrew word, the forms without one or two leading clitic letters (never leaving fewer than two letters). */
export function variants(token: string): string[] {
  const out = [token];
  let rest = token;
  for (let i = 0; i < 2 && rest.length > 2 && HEBREW_CLITICS.includes(rest[0]); i++) {
    rest = rest.slice(1);
    out.push(rest);
  }
  return out;
}

const both = (lists: { he: readonly string[]; en: readonly string[] }): string[] => [...lists.he, ...lists.en];

/**
 * Which entries of `entries` appear in `tokens`. An entry with a space is a phrase (its words next to each other).
 * Every list is applied to both languages: a Hebrew sentence may not sneak in an English food word either, and
 * the approved sentence's own words stay allowed because the callers compare against what it contains.
 */
function findEntries(tokens: readonly string[], entries: readonly string[]): Set<string> {
  const hits = new Set<string>();
  const phrases = entries.map((entry) => ({ entry, words: entry.split(" ") }));
  for (let i = 0; i < tokens.length; i++) {
    for (const { entry, words } of phrases) {
      if (i + words.length > tokens.length) continue;
      if (words.every((word, k) => variants(tokens[i + k]).includes(word))) hits.add(entry);
    }
  }
  return hits;
}

/** Entries that appear in the candidate and not in the approved sentence. */
function addedEntries(candidate: readonly string[], approved: readonly string[], entries: readonly string[]): string[] {
  const allowed = findEntries(approved, entries);
  return [...findEntries(candidate, entries)].filter((entry) => !allowed.has(entry));
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, i) => value === right[i]);
}

/** The canonical names of the units (seconds, minutes, ...) a text mentions, in either language. */
function unitsOf(tokens: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const token of tokens) {
    const forms = variants(token);
    for (const group of [UNIT_WORDS.he, UNIT_WORDS.en]) {
      for (const [canonical, words] of Object.entries(group)) {
        if (words.some((word) => forms.includes(word))) found.add(canonical);
      }
    }
  }
  return found;
}

/** The canonical negator a token is, or null: whole token, after dropping a leading ו and/or ש; an English "...n't" counts as one. */
export function negatorOf(token: string, known: ReadonlySet<string>): string | null {
  if (known.has(token)) return token;
  if (NEGATIVE_CONTRACTION.test(token)) return token;
  let rest = token;
  for (let i = 0; i < 2 && rest.length > 1 && (rest[0] === "ו" || rest[0] === "ש"); i++) {
    rest = rest.slice(1);
    if (known.has(rest)) return rest;
  }
  return null;
}

/** The negators a text contains. */
function negatorsOf(tokens: readonly string[]): Set<string> {
  const known = new Set(both(NEGATORS));
  const found = new Set<string>();
  for (const token of tokens) {
    const negator = negatorOf(token, known);
    if (negator !== null) found.add(negator);
  }
  return found;
}

/** How far after a negator its object may sit ("without a screen": the object is two tokens on). */
export const NEGATOR_REACH = 3;

/** The canonical form `contentTokens` uses for one token, or null when the token is too short to count. */
export function canonicalContent(token: string): string | null {
  const canonical = token.length > 3 && HEBREW_CLITICS.includes(token[0]) ? token.slice(1) : token;
  return canonical.length >= 3 ? canonical : null;
}

/** Each negator of the text with the first content token after it (what it applies to); a negator with nothing after it is left out. */
function negatedPairs(tokens: readonly string[]): { negator: string; object: string }[] {
  const known = new Set(both(NEGATORS));
  const pairs: { negator: string; object: string }[] = [];
  tokens.forEach((token, i) => {
    const negator = negatorOf(token, known);
    if (negator === null) return;
    for (let k = i + 1; k <= i + NEGATOR_REACH && k < tokens.length; k++) {
      const object = canonicalContent(tokens[k]);
      if (object !== null && negatorOf(tokens[k], known) === null) {
        pairs.push({ negator, object });
        return;
      }
    }
  });
  return pairs;
}

/** True when every (negator, object) of the approved sentence still occurs in the candidate: the negator within reach of the same object. */
function keepsNegatedObjects(tokens: readonly string[], approvedTokens: readonly string[]): boolean {
  const known = new Set(both(NEGATORS));
  return negatedPairs(approvedTokens).every(({ negator, object }) =>
    tokens.some((token, i) => {
      if (negatorOf(token, known) !== negator) return false;
      for (let k = i + 1; k <= i + NEGATOR_REACH && k < tokens.length; k++) {
        if (canonicalContent(tokens[k]) === object) return true;
      }
      return false;
    }),
  );
}

/** Sentence boundaries (. ? ; and the dashes): a reworded text may have no more sentences than the approved one. */
function sentenceCount(text: string): number {
  return text.split(/[.?;—–]+/u).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}

/**
 * Content tokens: a Hebrew word without its one leading clitic letter (only when at least three letters remain,
 * so "שים" and "בלי" are not mangled), kept when it is at least three characters long.
 */
function contentTokens(tokens: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const token of tokens) {
    const canonical = token.length > 3 && HEBREW_CLITICS.includes(token[0]) ? token.slice(1) : token;
    if (canonical.length >= 3) out.add(canonical);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Check helpers

const CONTROL_OR_ODD = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;
const MARKUP_CHARACTERS = /[!<>{}[\]*_#`\\|@]/;
const URL_LIKE = /(?:https?:|www\.|\/\/|\b[\p{L}\d-]+\.(?:com|org|net|io|co|il|app|dev|me)\b)/iu;
const EMOJI = /\p{Extended_Pictographic}/u;

function hasMarkup(text: string): boolean {
  return CONTROL_OR_ODD.test(text) || MARKUP_CHARACTERS.test(text) || URL_LIKE.test(text) || EMOJI.test(text);
}

function languageOk(text: string, locale: "he" | "en"): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const wanted = locale === "he" ? /\p{Script=Hebrew}/u : /\p{Script=Latin}/u;
  const share = letters.filter((letter) => wanted.test(letter)).length / letters.length;
  return share >= (locale === "he" ? 0.8 : 0.9);
}

const fail = (check: WordingCheck): WordingVerdict => ({ ok: false, check });

function run(input: { candidate: string; approved: string; locale: "he" | "en" }): WordingVerdict {
  const { locale } = input;
  const text = typeof input.candidate === "string" ? normalizeText(input.candidate) : "";
  const approvedText = typeof input.approved === "string" ? normalizeText(input.approved) : "";

  if (text === "") return fail("empty");
  if (hasMarkup(text)) return fail("markup");
  if (!languageOk(text, locale)) return fail("language");
  if ([...text].length > AI_WORDING.maxChars[locale]) return fail("length");

  // From here on the text is short (at most maxChars), so the token work below is cheap.
  if (!sameMultiset(text.match(/\p{Nd}+/gu) ?? [], approvedText.match(/\p{Nd}+/gu) ?? [])) return fail("digits");

  const tokens = tokenize(text);
  const approvedTokens = tokenize(approvedText);

  if (addedEntries(tokens, approvedTokens, both(NUMBER_WORDS)).length > 0) return fail("number_words");
  // "a few minutes" fixes a quantity with no digit and no number word: the quantity words must stay exactly as they are.
  if (!sameSet(findEntries(tokens, both(QUANTIFIERS)), findEntries(approvedTokens, both(QUANTIFIERS)))) return fail("number_words");
  if (!sameSet(unitsOf(tokens), unitsOf(approvedTokens))) return fail("units");
  if (addedEntries(tokens, approvedTokens, both(FOOD_WORDS)).length > 0) return fail("foods");
  if (addedEntries(tokens, approvedTokens, both(ADVICE_MARKERS)).length > 0) return fail("advice");
  if (copyLintHits(text, "he").length > 0 || copyLintHits(text, "en").length > 0) return fail("lint");
  if (findEntries(tokens, both(JUDGMENT_WORDS)).size > 0) return fail("judgment");
  if (!sameSet(negatorsOf(tokens), negatorsOf(approvedTokens))) return fail("negation");
  if (!keepsNegatedObjects(tokens, approvedTokens)) return fail("negation");

  const { overlap, newTokens } = measureOverlap(tokens, approvedTokens);
  if (overlap < AI_WORDING.minTokenOverlap) return fail("overlap");
  if (newTokens > AI_WORDING.maxNewTokens) return fail("new_tokens");
  // An appended sentence is new content however few words it has; reported as new_tokens.
  if (sentenceCount(text) > sentenceCount(approvedText)) return fail("new_tokens");

  return { ok: true, text };
}

/** The two numbers behind `overlap` and `new_tokens`, on tokens. An approved sentence with no content tokens has nothing to keep (overlap 1). */
function measureOverlap(tokens: readonly string[], approvedTokens: readonly string[]): { overlap: number; newTokens: number } {
  const wanted = contentTokens(approvedTokens);
  const present = contentTokens(tokens);
  const survived = [...wanted].filter((token) => present.has(token)).length;
  return {
    overlap: wanted.size === 0 ? 1 : survived / wanted.size,
    newTokens: [...present].filter((token) => !wanted.has(token)).length,
  };
}

/**
 * The share of the approved sentence's content tokens that survive in the candidate, and how many content tokens the
 * candidate adds: the numbers the `overlap` and `new_tokens` checks compare. Exposed so a test can show that a
 * one-word reversal passes both (which is why `negation` exists).
 */
export function measureWording(input: { candidate: string; approved: string }): { overlap: number; newTokens: number } {
  return measureOverlap(tokenize(normalizeText(input.candidate)), tokenize(normalizeText(input.approved)));
}
