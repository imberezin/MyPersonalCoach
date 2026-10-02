import { experimentTextFor } from "@/components/firstWeek/ExperimentView";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { WEIGHT_FLOW, WEIGHT_ROUTES } from "@/domain/weight";
import { getLocale, getTranslations } from "@/i18n/server";
import type { ProgressLoad } from "@/lib/weight/load";
import { MilestonesCard } from "./MilestonesCard";
import { NoticedCard } from "./NoticedCard";
import { WeightTrendCard } from "./WeightTrendCard";
import styles from "./progress.module.css";

const TITLE_ID = "progress-title";

/**
 * The Progress screen: where am I, what changed, what we learned. One heading and its lead, then the weight card, the
 * landmarks and what was noticed, each in its own card with its own heading; a part with nothing to say is absent, never an
 * empty box. When there is nothing at all (no weights, no landmarks, nothing noticed) the page is one card with the honest
 * "nothing to show yet" sentence and the way to report a weight. A pure READ of what the loader says: no writes, no AI, no
 * comparison with anyone, and the same words and the same look for a rise and a fall.
 */
export async function ProgressView({ load }: { load: Extract<ProgressLoad, { kind: "ready" }> }) {
  const [t, tLibrary, locale] = await Promise.all([
    getTranslations("progress"),
    getTranslations("interventions"),
    getLocale(),
  ]);
  const { weight, milestones, noticed } = load;

  const nothingNoticed = noticed.patterns.length === 0 && noticed.activeExperiment === null;
  const nothingAtAll = weight.kind === "ready" && weight.trend.state === "NONE" && milestones.kind !== "LIST" && nothingNoticed;
  if (nothingAtAll) {
    return (
      <section aria-labelledby={TITLE_ID}>
        <Card>
          <div className={styles.cardBody}>
            <h1 id={TITLE_ID} className={styles.title}>
              {t("title")}
            </h1>
            <p className={styles.lead}>{t("lead")}</p>
            <p>{t("body")}</p>
            {WEIGHT_FLOW.reportingEnabled ? (
              <div className={styles.links}>
                <ButtonLink href={WEIGHT_ROUTES.entry} variant="secondary">
                  {t("weight.add")}
                </ButtonLink>
              </div>
            ) : null}
          </div>
        </Card>
      </section>
    );
  }

  const goalReached = milestones.kind === "LIST" && milestones.goalReached;
  const experimentText =
    noticed.activeExperiment !== null ? experimentTextFor(noticed.activeExperiment, locale, tLibrary) : null;

  return (
    <section aria-labelledby={TITLE_ID} className={styles.page}>
      <div className={styles.heading}>
        <h1 id={TITLE_ID} className={styles.title}>
          {t("title")}
        </h1>
        <p className={styles.lead}>{t("lead")}</p>
      </div>
      <WeightTrendCard weight={weight} goalReached={goalReached} locale={locale} t={t} />
      <MilestonesCard milestones={milestones} locale={locale} t={t} />
      <NoticedCard noticed={noticed} experimentText={experimentText} t={t} />
    </section>
  );
}
