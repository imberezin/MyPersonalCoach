import { GOAL_FOCUS_KEYS, type GoalFocusKey } from "../onboarding/model";
import { FIRST_WEEK_LIMITS, type FirstWeekSummary } from "./types";

/**
 * "Why we started" (B6). Pure and deterministic: no clock, no I/O, no AI. The motivation is the person's own text:
 * it is only ever displayed (escaped by the view), never sent to a prompt and never logged, and nothing here
 * rewrites its words; it only tidies, trims and shortens it.
 */

const ELLIPSIS = "…";

/** What may sit at the end of a shortened text before the ellipsis: spaces and the punctuation that would dangle. */
const DANGLING_END = /[\s,;:.\-–—\u200D]+$/u;

/** A text is worth quoting only if it holds a letter, a digit or a pictograph (not just spaces, marks or zero-width characters). */
const SAYS_SOMETHING = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

/**
 * The person's words, made safe to show: every run of whitespace (newlines included) becomes one space, then control
 * characters and the bidi embeddings, overrides and isolates (which can reorder the text around them) are removed.
 * Letters, digits, emoji and the left-to-right / right-to-left marks stay. null = nothing left worth quoting.
 */
function tidy(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, "")
    .trim();
  return SAYS_SOMETHING.test(text) ? text : null;
}

/**
 * At most `max` code points INCLUDING the closing ellipsis (an emoji is one), so a shortened text is never shortened
 * again. Cut at the last space when there is one in the second half of the room, otherwise (one very long word) at
 * the room's edge. A text that fits comes back as the very same string.
 */
export function truncateAtWord(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;

  const room = max - ELLIPSIS.length;
  let cut = chars.slice(0, room);
  // The next character being a space means the slice already ends on a word boundary.
  if (!/\s/u.test(chars[room])) {
    let lastSpace = -1;
    for (let i = cut.length - 1; i >= 0; i--) {
      if (/\s/u.test(cut[i])) {
        lastSpace = i;
        break;
      }
    }
    if (lastSpace >= Math.floor(room / 2)) cut = cut.slice(0, lastSpace);
  }
  const body = cut.join("").replace(DANGLING_END, "");
  return body === "" ? "" : `${body}${ELLIPSIS}`;
}

export function buildWhy(goal: {
  focus: readonly string[];
  motivation: string | null;
  /** True iff the person set a numeric goal (goal_type 'numeric'). Only its existence is read: no number comes through here. */
  numericGoal: boolean;
}): FirstWeekSummary["why"] {
  const chosen = new Set(Array.isArray(goal.focus) ? goal.focus : []);
  const focus: GoalFocusKey[] = GOAL_FOCUS_KEYS.filter((key) => key !== "not_sure" && chosen.has(key));
  // `not_sure` is an answer in its own right; next to a real goal it says nothing more (the database forbids the mix).
  const notSure = focus.length === 0 && chosen.has("not_sure");

  const tidied = tidy(goal.motivation);
  const motivation = tidied === null ? null : truncateAtWord(tidied, FIRST_WEEK_LIMITS.motivationChars) || null;

  const answered = focus.length > 0 || notSure || motivation !== null || goal.numericGoal === true;
  return answered ? { kind: "SOME", focus, notSure, motivation } : { kind: "NONE" };
}
