import { measureWording, tokenizeSurface, variants } from "../../experiments/wording/validate";

/**
 * Words the weekly opening line may NEVER gain over its approved sentence: a claim about the body or the weight, a
 * statement that the person got thinner or fatter, praise, and a verdict on the person. The First Week validator guards
 * an experiment instruction (numbers, foods, advice, negation) and has no list for these classes, so a model answer such
 * as "...and you lost weight" or "...well done" would pass it. They are the owner's direction made executable: weight
 * loss is never stated here, nothing judges (up or down), and the only weight line of the screen is the one derived
 * from the person's own entries.
 *
 * Pure data. Lowercase, Hebrew without niqqud. An entry with a space is a phrase (its words next to each other). Matched
 * on whole tokens with the Hebrew clitic forms ("וירדת" is "ירדת"), so the inflections are listed, not stemmed.
 * A word the approved sentence itself contains stays allowed (the callers compare against the approved sentence).
 */
export const WEEKLY_LINE_FORBIDDEN: { readonly he: readonly string[]; readonly en: readonly string[] } = {
  he: [
    // Weight and body: "went down", thin, fat, kilos, the scale.
    "ירד",
    "ירדה",
    "ירדת",
    "ירדתי",
    "ירדתם",
    "ירדנו",
    "רזה",
    "רזית",
    "רזים",
    "רזות",
    "הרזיה",
    "רזון",
    "שמן",
    "שמנה",
    "שמנים",
    "השמנה",
    "קילו",
    "קילוגרם",
    "קילוגרמים",
    "מאזניים",
    "מאזנים",
    // Praise and verdicts on the person.
    "כל הכבוד",
    "מצוין",
    "מעולה",
    "נהדר",
    "מדהים",
    "הצלחה",
    "הצלחת",
    "הצלחתי",
    "הצלחנו",
    "בהצלחה",
    "הישג",
    "הישגים",
    "עבודה טובה",
    "גאה",
    "גאים",
    "גאווה",
    "כושל",
    "כושלת",
    "כישלון",
    "נכשלת",
  ],
  en: [
    "slim",
    "slimmer",
    "slimmed",
    "slimming",
    "thin",
    "thinner",
    "skinny",
    "skinnier",
    "lost",
    "lose",
    "losing",
    "loss",
    "scale",
    "scales",
    "fat",
    "fatter",
    "pound",
    "pounds",
    "lbs",
    "kilo",
    "kilos",
    "kilogram",
    "kilograms",
    "kg",
    "well done",
    "great",
    "excellent",
    "amazing",
    "awesome",
    "fantastic",
    "congrats",
    "congratulations",
    "proud",
    "progress",
    "success",
    "successful",
    "achievement",
    "achieved",
    "keep it up",
    "doing well",
    "good job",
    "failure",
    "fail",
  ],
};

/**
 * The numbers of the weekly line, tighter than the shared ones: the sentence has only six or seven content tokens, so
 * the First Week's room of four new tokens is room for a whole new claim. One tone word at most, and at most one of the
 * original words may go.
 */
export const WEEKLY_LINE_LIMITS = { maxNewTokens: 1, minTokenOverlap: 0.85 } as const;

/** Which entries of `entries` appear in `tokens` (see WEEKLY_LINE_FORBIDDEN for the matching). */
function found(tokens: readonly string[], entries: readonly string[]): Set<string> {
  const hits = new Set<string>();
  for (const entry of entries) {
    const words = entry.split(" ");
    for (let i = 0; i + words.length <= tokens.length; i++) {
      if (words.every((word, k) => variants(tokens[i + k]).includes(word))) hits.add(entry);
    }
  }
  return hits;
}

const lowerTokens = (text: string): string[] => tokenizeSurface(text).map((token) => token.toLowerCase());

/**
 * The second check of the weekly opening line, run only after `validateWording` passed it. Pure and total. It fails when
 * the candidate holds a forbidden word the approved sentence does not (either language: a Hebrew line may not carry
 * an English "kg"), or when it adds more than one content token, or keeps less than 85% of the approved content tokens.
 * The First Week validator itself is untouched.
 */
export function weeklyLineExtraOk(input: { candidate: string; approved: string }): boolean {
  try {
    const candidate = lowerTokens(input.candidate);
    const approved = lowerTokens(input.approved);
    const entries = [...WEEKLY_LINE_FORBIDDEN.he, ...WEEKLY_LINE_FORBIDDEN.en];
    const allowed = found(approved, entries);
    for (const hit of found(candidate, entries)) if (!allowed.has(hit)) return false;

    const { overlap, newTokens } = measureWording(input);
    return overlap >= WEEKLY_LINE_LIMITS.minTokenOverlap && newTokens <= WEEKLY_LINE_LIMITS.maxNewTokens;
  } catch {
    return false;
  }
}
