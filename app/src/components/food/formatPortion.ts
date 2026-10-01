import type { Portion } from "@/domain/food/types";

/** A translator already scoped to the `food` namespace (server `getTranslations("food")` or client `useTranslations("food")`). */
export type FoodTranslator = (key: string, values?: Record<string, string | number>) => string;

/**
 * "about 1 cup", "2 slices", "half a cup", "medium portion", or null when there is no portion. Amounts
 * are digits plus a unit noun (never a gendered Hebrew number word). "About" marks an estimated AMOUNT;
 * a size word is already approximate, so it is never wrapped.
 */
export function formatPortion(portion: Portion | null, t: FoodTranslator): string | null {
  if (portion === null) return null;
  if (portion.kind === "size") return t(`portion.size.${portion.size}`);

  const isMetric = portion.unit === "gram" || portion.unit === "ml";
  const text =
    portion.amount === 0.5 && !isMetric
      ? t("portion.half", { unit: t(`unitOne.${portion.unit}`) })
      : t(`unit.${portion.unit}`, { count: portion.amount });
  return portion.estimated ? t("portion.about", { portion: text }) : text;
}

/** Wraps a clock time so a right-to-left sentence never reorders "13:30" (U+2066 ... U+2069). */
export function isolateTime(time: string): string {
  return `\u2066${time}\u2069`;
}

/** The first letter in capitals, for words kept in lower case inside a sentence ("today") that also label a control. */
export function capitalizeFirst(text: string): string {
  const [first = "", ...rest] = Array.from(text);
  return first.toLocaleUpperCase() + rest.join("");
}
