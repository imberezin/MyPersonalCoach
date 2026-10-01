import styles from "@/app/onboarding/onboarding.module.css";
import { getTranslations } from "@/i18n/server";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

/** A12: onboarding is done. The button moves the person into the first week. */
export async function ReadyStep(props: StepBaseProps) {
  const t = await getTranslations("onboarding.ready");

  return (
    <StepForm step="ready" {...props} primaryLabelKey="ready.cta">
      <StepTitle>{t("title")}</StepTitle>
      <p className={styles.lead}>{t("line1")}</p>
      <div className={styles.lines}>
        <p className={styles.lead}>{t("line2")}</p>
        <p className={styles.lead}>{t("line3")}</p>
      </div>
    </StepForm>
  );
}
