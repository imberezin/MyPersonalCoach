/**
 * Cleaning text that a user (or a model) wrote before it is stored, shown or sent on. Pure, never
 * throws. Lengths are counted in code points, so an emoji or a letter with niqqud is not cut in half.
 * The character tests are written as code point ranges, not regular expressions, so the invisible
 * characters being removed stay readable in the source.
 */
import { FOOD_LIMITS } from "./types";

/** Bidi overrides, embeddings and isolates, direction marks, and the invisible characters that hide text. */
function isBidiOrInvisible(cp: number): boolean {
  return (
    cp === 0x061c || // Arabic letter mark
    cp === 0x200b || // zero width space
    cp === 0x200e || // LRM
    cp === 0x200f || // RLM
    (cp >= 0x202a && cp <= 0x202e) || // embeddings and overrides
    (cp >= 0x2066 && cp <= 0x2069) || // isolates
    cp === 0xfeff // BOM / zero width no-break space
  );
}

function isControl(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
}

/** Cuts to `max` code points, reporting whether anything was cut. */
function takeCodePoints(text: string, max: number): { text: string; truncated: boolean } {
  let count = 0;
  let end = 0;
  for (const ch of text) {
    if (count === max) return { text: text.slice(0, end), truncated: true };
    count += 1;
    end += ch.length;
  }
  return { text, truncated: false };
}

/** A paste of megabytes must not be normalized in full: look at a generous multiple of the cap. */
function boundedInput(raw: string, maxCodePoints: number): { value: string; cut: boolean } {
  const limit = Math.max(1, maxCodePoints) * 8;
  return raw.length > limit ? { value: raw.slice(0, limit), cut: true } : { value: raw, cut: false };
}

/** NFC, every whitespace run becomes one space, control and bidi characters go, ends trimmed. No length cap. */
function cleanOneLine(raw: string, maxCodePoints: number): string {
  const { value } = boundedInput(raw, maxCodePoints);
  const spaced = value.normalize("NFC").replace(/\s+/g, " ");
  let kept = "";
  for (const ch of spaced) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!isControl(cp) && !isBidiOrInvisible(cp)) kept += ch;
  }
  return kept.replace(/ {2,}/g, " ").trim();
}

/** A name that is really a link, markup or a template is not a food. */
const NOT_A_NAME = /:\/\/|www\.|[<>{}`]/i;

/**
 * The cleaned name before the length cap, or null when nothing is left or it looks like a URL,
 * markup or a template. Lets the edit form tell "too long" from "empty".
 */
export function cleanFoodNameText(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const text = cleanOneLine(raw, FOOD_LIMITS.nameMax);
  if (text === "" || NOT_A_NAME.test(text)) return null;
  return text;
}

function sanitizeShort(raw: string, maxCodePoints: number): string | null {
  const cleaned = cleanFoodNameText(raw);
  if (cleaned === null) return null;
  const capped = takeCodePoints(cleaned, maxCodePoints).text.trim();
  return capped === "" ? null : capped;
}

/**
 * NFC, strip control and bidi-override/isolate characters, collapse spaces, trim, cap at nameMax
 * code points. null when nothing is left or the text looks like a URL, markup or a template
 * (`://`, `www.`, `<`, `>`, `{`, `}`, a backtick).
 */
export function sanitizeFoodName(raw: string): string | null {
  return sanitizeShort(raw, FOOD_LIMITS.nameMax);
}

/** The same rules for a part of the input the AI could not understand, capped at unclearTextMax. */
export function sanitizeUnclear(raw: string): string | null {
  return sanitizeShort(raw, FOOD_LIMITS.unclearTextMax);
}

/**
 * For text a user typed: NFC, strip control characters except the line break, strip bidi overrides,
 * collapse three or more line breaks to two, trim, cap at `maxCodePoints`. `truncated` is true when
 * the cap (or an absurdly long paste) cut something off, so a caller can refuse instead of cutting silently.
 */
export function sanitizeFreeText(raw: string, maxCodePoints: number): { text: string; truncated: boolean } {
  if (typeof raw !== "string") return { text: "", truncated: false };
  const { value, cut } = boundedInput(raw, maxCodePoints);
  const normalized = value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\v\f]/g, " ");
  let kept = "";
  for (const ch of normalized) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x2028 || cp === 0x2029) kept += "\n"; // Unicode line and paragraph separators are line breaks
    else if (cp === 0x0a || (!isControl(cp) && !isBidiOrInvisible(cp))) kept += ch;
  }
  const trimmed = kept.replace(/\n{3,}/g, "\n\n").trim();
  const capped = takeCodePoints(trimmed, maxCodePoints);
  return { text: capped.text.trim(), truncated: capped.truncated || cut };
}
