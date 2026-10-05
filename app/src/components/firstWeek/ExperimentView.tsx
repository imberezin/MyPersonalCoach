import { FlowTitle } from "@/components/food/FlowTitle";
import { SubmitButton } from "@/components/food/SubmitButton";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Message } from "@/components/ui/Message";
import { FIRST_WEEK_ROUTES } from "@/domain/firstWeekFlow";
import { INTERVENTIONS } from "@/domain/interventions/library";
import { getTranslations, type Translator } from "@/i18n/server";
import type { OpenExperiment } from "@/lib/experiments/repo";
import styles from "./firstWeek.module.css";

const TITLE_ID = "experiment-title";

/**
 * The sentence to show for the open experiment: the stored wording when it was written in the language the page is
 * in, otherwise the library's approved sentence of the current language (the person may have switched language
 * since). `tLibrary` is scoped to `interventions`. Pure.
 */
export function experimentTextFor(open: Pick<OpenExperiment, "key" | "variantId" | "wording" | "locale">, locale: string, tLibrary: Translator): string {
  if (open.locale === locale) return open.wording;
  return tLibrary(`${open.key}.${open.variantId}`, { ...INTERVENTIONS[open.key].params });
}

/**
 * B5, the small experiment. The sentence is the library's approved text or its validated rewording; it is rendered
 * as plain text (never as markup) at the body size, with no quotation marks and no decoration, and nothing says where
 * it came from: the origin is a `data-wording-source` attribute for tests and the manual run only.
 *
 * OFFERED: the sentence with two equal-weight choices ("I'll try" primary, "Not this time" secondary) and the
 * reassurance that saying no is fine. ACTIVE: the sentence, two calm lines and the way back; no form. The actions are
 * passed in so a test can stub them.
 */
export async function ExperimentView({
  experiment,
  text,
  failed,
  startAction,
  skipAction,
}: {
  experiment: OpenExperiment;
  /** Already resolved by the page (experimentTextFor). */
  text: string;
  /** `?failed=1`: a write did not go through. */
  failed: boolean;
  startAction: () => Promise<void>;
  skipAction: () => Promise<void>;
}) {
  const [t, tCommon] = await Promise.all([getTranslations("firstWeek"), getTranslations("common")]);
  const offered = experiment.status === "OFFERED";

  return (
    <section aria-labelledby={TITLE_ID} className={styles.screen}>
      <Card>
        <div className={styles.stack}>
          <FlowTitle id={TITLE_ID}>{t(offered ? "experiment.title" : "experiment.activeTitle")}</FlowTitle>
          {offered ? <p className={styles.lead}>{t("experiment.lead")}</p> : null}
          <p className={styles.experimentText} data-wording-source={experiment.source}>
            {text}
          </p>
          {offered ? null : <p>{t("experiment.activeBody")}</p>}

          {failed ? (
            <Message variant="note" role="status">
              {t("problem.save")}
            </Message>
          ) : null}

          {offered ? (
            <>
              <p className={styles.note}>{t("experiment.note")}</p>
              <div className={styles.actions}>
                <form action={startAction}>
                  <SubmitButton pendingLabel={tCommon("loading")}>{t("experiment.try")}</SubmitButton>
                </form>
                <form action={skipAction}>
                  <SubmitButton variant="secondary" pendingLabel={tCommon("loading")}>
                    {t("experiment.notThisTime")}
                  </SubmitButton>
                </form>
              </div>
            </>
          ) : (
            <div className={styles.actions}>
              <ButtonLink href={FIRST_WEEK_ROUTES.summary} variant="secondary">
                {t("experiment.back")}
              </ButtonLink>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
