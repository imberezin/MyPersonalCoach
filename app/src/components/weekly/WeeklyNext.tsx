import { SubmitButton } from "@/components/food/SubmitButton";
import type { OpeningMode, WeeklyExperimentDecision } from "@/domain/weekly";
import type { Translator } from "@/i18n/server";
import styles from "./weekly.module.css";

interface NextActions {
  propose: () => Promise<void>;
  start: () => Promise<void>;
  skip: () => Promise<void>;
}

interface ExperimentText {
  text: string;
  source: "ai" | "library";
}

/**
 * "What next", by the weekly experiment decision. Synchronous on purpose: it receives the words already translated by the
 * view (`t` is scoped to `weekly`, `offerText` is the fixed sentence the rationale chose). Every state says one true thing:
 *
 * - OFFER: one calm sentence ("or not") and one secondary button. Pressing it is the explicit choice that may call the AI, so
 *   it is a form post and not a link, it carries no hidden field (no value to forge), and it shows the shared pending label
 *   because the press may wait for the wording.
 * - PENDING: the idea that is waiting, the neutral frame line, "I'll try" (primary) and "Not this time" (secondary).
 * - ACTIVE: the experiment's sentence and the calm body. Nothing to report.
 * - RESULT_DUE: the result question is the first thing on the page; this only says what comes after it.
 * - NONE: "nothing new to suggest" (plainly, never as an empty state), or the "light" line for a returning or a quiet week.
 *
 * A quiet week that still has a pattern-led idea shows the "light" line above it: never as a task.
 */
export function WeeklyNext({
  mode,
  decision,
  experiment,
  offerText,
  weighInvite,
  actions,
  t,
  pendingLabel,
}: {
  mode: OpeningMode;
  decision: WeeklyExperimentDecision;
  /** The sentence of the open experiment, already in the current locale; null when its row could not be read. */
  experiment: ExperimentText | null;
  /** The fixed sentence of an OFFER's rationale; null for every other decision. */
  offerText: string | null;
  /** The soft weigh-in line (LEARN and CELEBRATE weeks only, decided by the story). */
  weighInvite: boolean;
  actions: NextActions;
  t: Translator;
  pendingLabel: string;
}) {
  const quiet = mode === "RECOVER" || mode === "RESET";
  return (
    <>
      <Decision decision={decision} quiet={quiet} experiment={experiment} offerText={offerText} actions={actions} t={t} pendingLabel={pendingLabel} />
      {weighInvite ? <p>{t("next.weighInvite")}</p> : null}
    </>
  );
}

function Decision({
  decision,
  quiet,
  experiment,
  offerText,
  actions,
  t,
  pendingLabel,
}: {
  decision: WeeklyExperimentDecision;
  quiet: boolean;
  experiment: ExperimentText | null;
  offerText: string | null;
  actions: NextActions;
  t: Translator;
  pendingLabel: string;
}) {
  switch (decision.kind) {
    case "NONE":
      return <p>{t(quiet ? "next.light" : "next.none")}</p>;
    case "OFFER":
      return (
        <>
          {quiet ? <p>{t("next.light")}</p> : null}
          {offerText !== null ? <p>{offerText}</p> : null}
          <form action={actions.propose} className={styles.actions}>
            <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
              {t("next.choose")}
            </SubmitButton>
          </form>
        </>
      );
    case "PENDING":
      // The idea's row could not be read (an odd row): there is nothing true to show or to press, so say the plain thing.
      if (experiment === null) return <p>{t(quiet ? "next.light" : "next.none")}</p>;
      return (
        <>
          <p>{t("next.pendingLead")}</p>
          <p className={styles.experimentText} data-wording-source={experiment.source}>
            {experiment.text}
          </p>
          <p>{t("next.frame")}</p>
          <p className={styles.note}>{t("next.note")}</p>
          <div className={styles.actions}>
            <form action={actions.start}>
              <SubmitButton pendingLabel={pendingLabel}>{t("next.try")}</SubmitButton>
            </form>
            <form action={actions.skip}>
              <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
                {t("next.notThisTime")}
              </SubmitButton>
            </form>
          </div>
        </>
      );
    case "ACTIVE":
      return (
        <>
          {experiment !== null ? (
            <>
              <p>{t("next.activeLead")}</p>
              <p className={styles.experimentText} data-wording-source={experiment.source}>
                {experiment.text}
              </p>
            </>
          ) : null}
          <p>{t("next.activeBody")}</p>
        </>
      );
    case "RESULT_DUE":
      return <p>{t("next.afterResult")}</p>;
    default: {
      const unhandled: never = decision;
      return unhandled;
    }
  }
}
