/**
 * The fallback that needs no AI: the user's own words, split into a list. It is the only code that
 * reads user text without a model, so it is bounded (text, items, name length) and cannot loop.
 */
import { sanitizeFoodName, sanitizeFreeText } from "./sanitize";
import { FOOD_LIMITS, type UnderstoodItem } from "./types";

// Newline, comma (Latin and Arabic), semicolon, "+" and "/"; the words "and" and "&" only between spaces.
// A Hebrew "ו" prefix belongs to the next word ("ולחם" is one food), so it is never a separator.
const SEPARATORS = /[\n,،;+/]|\s+(?:and|&)\s+/gi;

// A link would be torn apart by the "/" separator into harmless-looking pieces, so it is cut out whole first.
const LINK_LIKE = /\S*:\/\/\S*|\bwww\.\S*/gi;

/**
 * Split on newlines, commas (, and ،), semicolons, "+", "/", " and " and " & ". Names sanitized,
 * duplicates dropped (case-folded), at most itemsMax. portion null, uncertain false, confidence 1.
 * `truncated` is true when something was left out (too much text, or more foods than itemsMax).
 */
export function parseManualFoods(text: string): { items: UnderstoodItem[]; truncated: boolean } {
  const free = sanitizeFreeText(typeof text === "string" ? text : "", FOOD_LIMITS.textMax);
  let truncated = free.truncated;

  const items: UnderstoodItem[] = [];
  const seen = new Set<string>();
  for (const part of free.text.replace(LINK_LIKE, ",").split(SEPARATORS)) {
    const name = sanitizeFoodName(part);
    if (name === null) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (items.length >= FOOD_LIMITS.itemsMax) {
      truncated = true;
      break;
    }
    seen.add(key);
    items.push({ name, portion: null, uncertain: false, confidence: 1 });
  }
  return { items, truncated };
}
