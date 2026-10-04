import type { WeeklyStory } from "./story";
import type { OpeningLineKey } from "./types";

/**
 * The stored AI opening line, as the loader validates it from `weekly_summaries.content.line` (src/lib/weekly/load.ts:
 * StoredLine is structurally this). Only a LEARN line is ever stored, so `mode` and `key` are those literals.
 */
export interface StoredWeeklyLine {
  text: string;
  locale: "he" | "en";
  mode: "LEARN";
  key: "learn";
}

/**
 * The stored AI line is used iff row.line exists AND line.mode === story.mode AND line.key === story.lineKey AND
 * line.locale === locale. Anything else (a deleted meal changed the mode, the person switched language, a malformed row, an
 * empty text) gives the catalog key of the live line. Pure and total.
 */
export function resolveOpeningLine(a: {
  story: Pick<WeeklyStory, "mode" | "lineKey">;
  row: { line: StoredWeeklyLine | null } | null;
  locale: "he" | "en";
}): { source: "ai"; text: string } | { source: "catalog"; messageKey: `weekly.line.${OpeningLineKey}` } {
  const line = a.row?.line ?? null;
  const usable =
    line !== null &&
    typeof line === "object" &&
    typeof line.text === "string" &&
    line.text.trim() !== "" &&
    line.mode === a.story.mode &&
    line.key === a.story.lineKey &&
    line.locale === a.locale;
  if (usable) return { source: "ai", text: line.text };
  return { source: "catalog", messageKey: `weekly.line.${a.story.lineKey}` };
}
