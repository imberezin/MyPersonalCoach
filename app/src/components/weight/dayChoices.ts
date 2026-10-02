import type { DayOption } from "@/domain/weight/entry";
import { formatDayKeyLabel } from "@/domain/weight/format";
import type { DayChoice } from "./WeightForm";

/**
 * The "when" list in words. The domain decides WHICH days exist (and the values the action checks again); this only
 * names them: "Now" / "As saved" / "Yesterday" from the catalog, every other day as the weekday and date in the person's
 * zone and language. The year is left out: the list never reaches back further than two weeks, except an old entry's own
 * day in edit mode, which carries its year so it is not mistaken for a recent one.
 */
export function buildDayChoices(a: {
  options: readonly DayOption[];
  /** The `weight` namespace translator. */
  t: (key: string) => string;
  locale: string;
  timeZone: string;
  /** The local year of "now" (4 digits): a day of another year gets its year. */
  currentYear: string;
}): DayChoice[] {
  return a.options.map((option) => {
    switch (option.kind) {
      case "now":
        return { value: option.value, label: a.t("form.dayNow") };
      case "keep":
        return { value: option.value, label: a.t("form.dayKeep") };
      case "yesterday":
        return { value: option.value, label: a.t("form.dayYesterday") };
      default: {
        const key = option.dayKey ?? option.value;
        return { value: option.value, label: formatDayKeyLabel(key, a.locale, a.timeZone, key.slice(0, 4) !== a.currentYear) };
      }
    }
  });
}
