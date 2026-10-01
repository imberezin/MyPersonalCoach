import Image from "next/image";
import styles from "@/app/onboarding/onboarding.module.css";
import { getTranslations } from "@/i18n/server";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

/** A1: the product philosophy in a few calm lines. */
export async function WelcomeStep(props: StepBaseProps) {
  const t = await getTranslations("onboarding.welcome");

  return (
    <StepForm step="welcome" {...props} primaryLabelKey="welcome.cta">
      <div className={styles.welcome}>
        <div className={styles.banner}>
          <Image src="/MyIcons/logo-banner.svg" alt="" width={1600} height={900} sizes="100vw" priority />
        </div>
        <StepTitle>{t("title")}</StepTitle>
        <div className={styles.lines}>
          <p className={styles.leadStrong}>{t("notDiet")}</p>
          <p className={styles.leadStrong}>{t("notBans")}</p>
        </div>
        <p className={styles.lead}>{t("body")}</p>
      </div>
    </StepForm>
  );
}
