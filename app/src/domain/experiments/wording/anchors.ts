import { NEGATORS, NUMBER_WORDS, QUANTIFIERS, UNIT_WORDS } from "./lint";
import { NEGATOR_REACH, canonicalContent, negatorOf, tokenizeSurface, variants } from "./validate";

/**
 * The words of an approved sentence that the AI wording must keep exactly (wording-v2).
 *
 * `verbatim`: quantity phrases ("כמה דקות", "10 שניות") and negation phrases ("בלי מסך", the negator and the word it
 * applies to). These are the two things the validator anchors: the quantity words and the units must stay exactly as
 * they are, and each negator must still apply to the same object. A model that swaps "בלי מסך" for "ללא מסכים" is
 * rejected, and it is rejected for the right reason, so the prompt names these phrases and asks for them unchanged.
 *
 * `actions`: the other content words (the ones `overlap` counts), as they stand in the approved sentence.
 *
 * Both lists are derived from the approved sentence ALONE, with the validator's own word lists, so no text a person
 * wrote can enter them; `assertWordingFacts` re-derives them and refuses anything that differs.
 */
export interface WordingAnchors {
  verbatim: string[];
  actions: string[];
}

/** Hard caps: a catalog sentence is far below them, they only keep a junk sentence from producing a long block. */
export const MAX_VERBATIM_ANCHORS = 6;
export const MAX_ACTION_ANCHORS = 12;

const QUANTITY_WORDS: readonly string[] = [...QUANTIFIERS.he, ...QUANTIFIERS.en, ...NUMBER_WORDS.he, ...NUMBER_WORDS.en];
const QUANTITY_SINGLE = new Set(QUANTITY_WORDS.filter((entry) => !entry.includes(" ")));
const QUANTITY_PHRASES = QUANTITY_WORDS.filter((entry) => entry.includes(" ")).map((entry) => entry.split(" "));
const UNIT_FORMS = new Set(
  [UNIT_WORDS.he, UNIT_WORDS.en].flatMap((group) => Object.values(group).flatMap((words) => [...words])),
);
const KNOWN_NEGATORS: ReadonlySet<string> = new Set([...NEGATORS.he, ...NEGATORS.en]);

/** How many tokens of a quantity word or phrase start at `i` (digits, a number word, a quantifier); 0 when none does. */
function quantityLengthAt(tokens: readonly string[], i: number): number {
  const token = tokens[i];
  if (/^\p{Nd}+$/u.test(token) || variants(token).some((form) => QUANTITY_SINGLE.has(form))) return 1;
  for (const words of QUANTITY_PHRASES) {
    if (i + words.length <= tokens.length && words.every((word, k) => variants(tokens[i + k]).includes(word))) return words.length;
  }
  return 0;
}

const isUnit = (token: string): boolean => variants(token).some((form) => UNIT_FORMS.has(form));

/**
 * Pure and total. Walks the tokens once: a negator takes the word it applies to (the first content word within
 * `NEGATOR_REACH`, as the validator pairs them); a run of quantity words and units forms one quantity phrase.
 * An approved sentence with neither gives an empty `verbatim`.
 */
export function extractWordingAnchors(approved: string): WordingAnchors {
  const surface = tokenizeSurface(typeof approved === "string" ? approved : "");
  const tokens = surface.map((token) => token.toLowerCase());
  const covered = new Array<boolean>(tokens.length).fill(false);
  const verbatim: string[] = [];
  const addVerbatim = (from: number, to: number) => {
    const phrase = surface.slice(from, to + 1).join(" ");
    for (let k = from; k <= to; k++) covered[k] = true;
    if (!verbatim.includes(phrase)) verbatim.push(phrase);
  };

  let i = 0;
  while (i < tokens.length) {
    if (negatorOf(tokens[i], KNOWN_NEGATORS) !== null) {
      let end = i;
      for (let k = i + 1; k <= i + NEGATOR_REACH && k < tokens.length; k++) {
        if (canonicalContent(tokens[k]) !== null && negatorOf(tokens[k], KNOWN_NEGATORS) === null) {
          end = k;
          break;
        }
      }
      addVerbatim(i, end);
      i = end + 1;
      continue;
    }
    if (quantityLengthAt(tokens, i) > 0 || isUnit(tokens[i])) {
      let j = i;
      while (j < tokens.length) {
        const length = quantityLengthAt(tokens, j);
        if (length > 0) j += length;
        else if (isUnit(tokens[j])) j += 1;
        else break;
      }
      addVerbatim(i, j - 1);
      i = j;
      continue;
    }
    i += 1;
  }

  const actions: string[] = [];
  tokens.forEach((token, index) => {
    if (!covered[index] && canonicalContent(token) !== null && !actions.includes(surface[index])) actions.push(surface[index]);
  });
  return { verbatim: verbatim.slice(0, MAX_VERBATIM_ANCHORS), actions: actions.slice(0, MAX_ACTION_ANCHORS) };
}

/**
 * The anchors as they travel in `InsightContext.facts` (whose values are primitives): the JSON text of
 * `extractWordingAnchors(approved)`. The prompt builder accepts this string only if it is byte-equal to that derivation.
 */
export function wordingAnchorsFact(approved: string): string {
  return JSON.stringify(extractWordingAnchors(approved));
}
