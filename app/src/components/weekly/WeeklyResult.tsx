import { SubmitButton } from "@/components/food/SubmitButton";
import type { ExperimentResult } from "@/domain/weekly";
import type { Translator } from "@/i18n/server";
import { WEEKLY_FORM_FIELDS } from "./messageKeys";
import styles from "./weekly.module.css";

const TITLE_ID = "weekly-result-title";

/** The five answers, in the order of the spec. "I did not get to try" is an answer like the others, never a failure. */
const ANSWERS: readonly (readonly [ExperimentResult, string])[] = [
  ["helpful", "result.helpful"],
  ["somewhat", "result.somewhat"],
  ["not_really", "result.notReally"],
  ["unknown", "result.unknown"],
  ["not_tried", "result.notTried"],
];

/**
 * The result question: how the small experiment went, asked once it has run for a few days, at the next "your week". It
 * comes FIRST on the page. The five answers have equal weight (one variant, one size, none is "the right one", none is
 * red); each is its own tiny form with ONE closed hidden field, and the action re-checks the live decision. Synchronous: it
 * receives the words already translated by the view (`t` is scoped to `weekly`).
 */
export function WeeklyResult({
  text,
  source,
  answerAction,
  t,
  pendingLabel,
}: {
  /** The experiment's sentence, already in the current locale; null when its row could not be read (the question still works). */
  text: string | null;
  source: "ai" | "library";
  answerAction: (formData: FormData) => Promise<void>;
  t: Translator;
  pendingLabel: string;
}) {
  return (
    <section aria-labelledby={TITLE_ID} className={styles.part}>
      <h2 id={TITLE_ID} className={styles.partTitle}>
        {t("result.title")}
      </h2>
      {text !== null ? (
        <>
          <p>{t("result.reminder")}</p>
          <p className={styles.experimentText} data-wording-source={source}>
            {text}
          </p>
        </>
      ) : null}
      <p className={styles.note}>{t("result.lead")}</p>
      <div role="group" aria-labelledby={TITLE_ID} className={styles.actions}>
        {ANSWERS.map(([result, key]) => (
          <form key={result} action={answerAction}>
            <input type="hidden" name={WEEKLY_FORM_FIELDS.result} value={result} />
            <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
              {t(key)}
            </SubmitButton>
          </form>
        ))}
      </div>
    </section>
  );
}
