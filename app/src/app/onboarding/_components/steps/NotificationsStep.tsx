import styles from "@/app/onboarding/onboarding.module.css";
import { NOTIFY_CHOICES } from "@/domain/onboarding";
import { getTranslations } from "@/i18n/server";
import { ChoiceGroup } from "../fields/ChoiceGroup";
import { PushControl } from "../PushControl";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

interface NotificationsStepProps extends StepBaseProps {
  phase: "choices" | "device";
  push: { configured: boolean; publicKey: string | null };
}

/**
 * A11 in two halves on one URL: which notifications the person wants, then (only when at least one
 * was chosen) the permission for this device. The device half is where an iPhone is asked to put
 * the app on the Home Screen first.
 */
export async function NotificationsStep({ phase, push, ...base }: NotificationsStepProps) {
  const t = await getTranslations("onboarding.notifications");

  if (phase === "device") {
    return (
      <StepForm step="notifications" {...base} hidden={{ phase: "device" }}>
        <StepTitle>{t("device.title")}</StepTitle>
        <p className={styles.lead}>{t("device.body")}</p>
        <PushControl configured={push.configured} publicKey={push.publicKey} />
      </StepForm>
    );
  }

  return (
    <StepForm step="notifications" {...base} hidden={{ phase: "choices" }}>
      <StepTitle>{t("title")}</StepTitle>
      <ChoiceGroup
        name="notify"
        type="checkbox"
        options={NOTIFY_CHOICES.map((value) => ({ value, label: t(`options.${value}`) }))}
      />
    </StepForm>
  );
}
