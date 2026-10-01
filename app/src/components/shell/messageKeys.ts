import { REPORT_OPTIONS } from "./reportOptions";

/**
 * The copy the shell reads, as dotted keys. This is the contract with whoever writes the message
 * catalogs: the catalog test imports this list and demands every key in he.json and en.json.
 * The row labels come from REPORT_OPTIONS, so a new row cannot ship without a label.
 * (`app.shortName`, read by the header, already exists and is not part of this list.)
 */
export const SHELL_MESSAGE_KEYS: readonly string[] = [
  "nav.ariaLabel",
  "nav.home",
  "nav.progress",
  "nav.report",
  "nav.coach",
  "nav.me",
  "report.sheet.title",
  "report.sheet.close",
  "report.sheet.note",
  "report.sheet.orSimply",
  ...REPORT_OPTIONS.map((option) => `report.sheet.options.${option.id}`),
];
