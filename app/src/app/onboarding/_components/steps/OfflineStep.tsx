import { getTranslations } from "@/i18n/server";
import { OfflinePlaceField } from "../OfflinePlaceField";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

/** A9: the times the person does not use the phone. Shabbat asks for a place and shows the times. */
export async function OfflineStep(props: StepBaseProps) {
  const t = await getTranslations("onboarding.offline");

  return (
    <StepForm step="offline" {...props}>
      <StepTitle>{t("title")}</StepTitle>
      <OfflinePlaceField />
    </StepForm>
  );
}
