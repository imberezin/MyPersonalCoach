import { FOOD_ROUTES } from "@/domain/food/routes";
import { WEIGHT_ROUTES } from "@/domain/weight/routes";
import { WEIGHT_FLOW } from "@/domain/weight/types";

// The rows of the Report sheet, as data. Swapping a row for a real flow is a one-field change:
// set `href` to the route (for example "/report/food"), and nothing else in the sheet changes.

export type ReportOptionId = "food" | "activity" | "weight" | "sleep" | "feeling" | "photo" | "text";

export interface ReportOption {
  id: ReportOptionId;
  /** "category" = what to report about; "input" = how to say it, shown after "or simply". */
  group: "category" | "input";
  /** Brand document section 23. Decorative: rendered aria-hidden, the label carries the meaning. */
  emoji: string;
  /** null = the flow does not exist yet, the row is shown inactive. A path = the row is a link. */
  href: string | null;
}

// No voice entry on purpose: it comes later, and showing it would promise it.
export const REPORT_OPTIONS: readonly ReportOption[] = [
  { id: "food", group: "category", emoji: "🍽️", href: FOOD_ROUTES.chooser },
  { id: "activity", group: "category", emoji: "🚶", href: null },
  { id: "weight", group: "category", emoji: "⚖️", href: WEIGHT_FLOW.reportingEnabled ? WEIGHT_ROUTES.entry : null },
  { id: "sleep", group: "category", emoji: "😴", href: null },
  { id: "feeling", group: "category", emoji: "🧠", href: null },
  { id: "photo", group: "input", emoji: "📷", href: FOOD_ROUTES.photo },
  { id: "text", group: "input", emoji: "✍️", href: FOOD_ROUTES.text },
];
