import { SubmitButton } from "@/components/food/SubmitButton";
import type { Translator } from "@/i18n/server";
import { WEEKLY_FORM_FIELDS } from "./messageKeys";
import styles from "./weekly.module.css";

const QUESTION_ID = "weekly-pattern-question";

/** The three answers, in the order of the spec. Each one is its own tiny form with ONE closed hidden field. */
const ANSWERS = [
  ["confirm", "learned.confirm"],
  ["unsure", "learned.unsure"],
  ["reject", "learned.reject"],
] as const;

/**
 * The question about something the person's own reports showed ("does that sound right to you?"), asked inside "your week"
 * so that Home keeps one card. The three answers have the same weight: one variant, one size, none of them the right one.
 * Synchronous on purpose: it receives the words already translated by the view (`t` is scoped to `weekly`). The action
 * reads ONLY the field `answer`; the pattern, its level and the user come from the live data and the session.
 */
export function WeeklyPatternQuestion({
  answerAction,
  t,
  pendingLabel,
}: {
  answerAction: (formData: FormData) => Promise<void>;
  t: Translator;
  pendingLabel: string;
}) {
  return (
    <>
      <p id={QUESTION_ID}>{t("learned.patternQuestion")}</p>
      <div role="group" aria-labelledby={QUESTION_ID} className={styles.actions}>
        {ANSWERS.map(([answer, key]) => (
          <form key={answer} action={answerAction}>
            <input type="hidden" name={WEEKLY_FORM_FIELDS.answer} value={answer} />
            <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
              {t(key)}
            </SubmitButton>
          </form>
        ))}
      </div>
    </>
  );
}
