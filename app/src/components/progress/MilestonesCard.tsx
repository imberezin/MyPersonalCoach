import { Card } from "@/components/ui/Card";
import { formatKg, type MilestoneProgress, type MilestoneStep, type MilestoneStepState } from "@/domain/weight";
import type { Translator } from "@/i18n/server";
import { isolateLtr } from "./isolate";
import styles from "./progress.module.css";

const TITLE_ID = "progress-milestones-title";

// The mark of each state. Shapes, not colors, tell them apart; every new state has to be written here, and the record makes
// the compiler ask for it.
const MARK: Record<MilestoneStepState, string> = {
  REACHED: styles.markReached,
  NEXT: styles.markNext,
  AHEAD: styles.markAhead,
};

function Step({ step, locale, t }: { step: MilestoneStep; locale: string; t: Translator }) {
  return (
    <li className={styles.milestone}>
      <span aria-hidden="true" className={`${styles.mark} ${MARK[step.state]}`} />
      <span className={styles.milestoneKg}>{t("milestones.item.kg", { kg: isolateLtr(formatKg(step.kg, locale)) })}</span>
      {step.kind === "START" ? <span className={styles.milestoneWord}>{t("milestones.item.start")}</span> : null}
      {step.kind === "GOAL" ? <span className={styles.milestoneWord}>{t("milestones.item.goal")}</span> : null}
      {step.state === "REACHED" ? <span className={styles.srOnly}>{t("milestones.item.reached")}</span> : null}
      {step.state === "NEXT" ? <span className={styles.srOnly}>{t("milestones.item.next")}</span> : null}
    </li>
  );
}

/**
 * The landmarks from the start weight toward the goal: places worth a pause, not tests. Marks and words only; there is no
 * counter, no distance left, no percentage and no estimate of when. A landmark reached stays reached. Shown only for a list
 * (no numeric goal, or a history that was not read in full, gives no card). Pure: no I/O.
 */
export function MilestonesCard({
  milestones,
  locale,
  t,
}: {
  milestones: MilestoneProgress;
  locale: string;
  /** Scoped to `progress`. */
  t: Translator;
}) {
  if (milestones.kind !== "LIST") return null;

  return (
    <section aria-labelledby={TITLE_ID}>
      <Card>
        <div className={styles.cardBody}>
          <h2 id={TITLE_ID} className={styles.sectionTitle}>
            {t("milestones.title")}
          </h2>
          <p className={styles.note}>{t("milestones.lead")}</p>
          {milestones.goalReached ? <p>{t("milestones.goalReached")}</p> : null}
          <ol role="list" aria-label={t("milestones.listLabel")} className={styles.milestones}>
            {milestones.steps.map((step) => (
              <Step key={step.index} step={step} locale={locale} t={t} />
            ))}
          </ol>
        </div>
      </Card>
    </section>
  );
}
