import { WEIGHT_NOTICES } from "@/domain/weight/routes";
import type { WeightErrorCode } from "@/domain/weight/entry";

const leaves = (prefix: string, names: readonly string[]) => names.map((name) => `${prefix}.${name}`);

/** One message per error code of the entry form (`WeightErrorCode` of the domain): a new code cannot ship without its words. */
export const WEIGHT_ERROR_CODES: readonly WeightErrorCode[] = ["required", "invalid_number", "out_of_range", "note_too_long", "invalid_day", "not_saved"];

/**
 * The copy the weight screens read, as dotted keys from the catalog root, plus the two lines the Me page adds. This is
 * the contract with whoever renders it: weight.messages.test.ts demands every key in he.json and en.json, and refuses a
 * key in the `weight` namespace that nothing here lists. The notices and the error codes come from the domain, so a new
 * one cannot ship without its words.
 */
export const WEIGHT_MESSAGE_KEYS: readonly string[] = [
  "weight.meta.title",
  ...leaves("weight.entry", ["title", "lead"]),
  ...leaves("weight.form", ["weightLabel", "unit", "dayLabel", "dayNow", "dayKeep", "dayYesterday", "noteLabel", "saving"]),
  ...leaves("weight.check", ["body", "confirm", "fix"]),
  ...WEIGHT_ERROR_CODES.map((code) => `weight.errors.${code}`),
  ...leaves("weight.edit", ["title", "lead", "back"]),
  ...leaves("weight.saved", ["title", "body", "edited", "note", "progress", "edit", "back"]),
  ...leaves("weight.list", ["title", "lead", "label", "more", "newest", "back", "add", "start"]),
  ...leaves("weight.row", ["edit", "delete", "deleteThis"]),
  ...leaves("weight.confirm", ["title", "body", "keep", "delete", "deleting"]),
  ...WEIGHT_NOTICES.map((notice) => `weight.notice.${notice}`),
  ...leaves("weight.empty", ["title", "body"]),
  ...leaves("weight.unavailable", ["title", "body", "retry"]),
  ...leaves("me", ["weightsLink", "weightsHint"]),
];
