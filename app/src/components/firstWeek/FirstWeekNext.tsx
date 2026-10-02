import { SubmitButton } from "@/components/food/SubmitButton";
import { ButtonLink } from "@/components/ui/Button";
import type { FirstWeekSummary } from "@/domain/firstWeekFlow";
import type { Translator } from "@/i18n/server";
import styles from "./firstWeek.module.css";

/** Where the open experiment is shown. */
export const EXPERIMENT_PATH = "/first-week/experiment";

/**
 * The four states of "And what now?". Synchronous on purpose: it receives the words already translated by the
 * summary view (`t` is scoped to `firstWeek`), so the whole page renders as one tree.
 *
 * NO_EXPERIMENT says plainly that there is nothing to suggest. OFFER is one form with one secondary button: pressing
 * it is the explicit choice that may call the AI, so it is a form post and not a link, it carries no hidden field (no
 * value to forge), and it shows the shared pending label because the press may wait for the wording. PENDING links
 * to the idea. ACTIVE shows the stored sentence as plain text.
 */
export function FirstWeekNext({
  next,
  proposeAction,
  text,
  t,
  pendingLabel,
}: {
  next: FirstWeekSummary["next"];
  proposeAction: () => Promise<void>;
  /** The active experiment's sentence, already in the current locale; null when it could not be read. */
  text: string | null;
  t: Translator;
  pendingLabel: string;
}) {
  switch (next.kind) {
    case "NO_EXPERIMENT":
      return <p>{t("summary.next.none")}</p>;
    case "OFFER":
      return (
        <>
          <p>{t("summary.next.offer")}</p>
          <form action={proposeAction} className={styles.actions}>
            <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
              {t("summary.next.choose")}
            </SubmitButton>
          </form>
        </>
      );
    case "PENDING":
      return (
        <>
          <p>{t("summary.next.pending")}</p>
          <div className={styles.actions}>
            <ButtonLink href={EXPERIMENT_PATH} variant="secondary">
              {t("summary.next.see")}
            </ButtonLink>
          </div>
        </>
      );
    case "ACTIVE":
      // The row's wording could not be read (an odd row): say only the true thing, that an experiment was started.
      return text === null ? (
        <p>{t("summary.did.experiment")}</p>
      ) : (
        <>
          <p>{t("summary.next.active")}</p>
          <p className={styles.experimentText}>{text}</p>
        </>
      );
    default: {
      const unhandled: never = next;
      return unhandled;
    }
  }
}
