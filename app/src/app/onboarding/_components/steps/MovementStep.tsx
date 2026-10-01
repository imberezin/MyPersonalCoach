import { ACTIVITY_BASELINE_KEYS } from "@/domain/onboarding";
import { getTranslations } from "@/i18n/server";
import { ChoiceGroup } from "../fields/ChoiceGroup";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

/** A6: current movement. The 60-minute target is deliberately not mentioned here. */
export async function MovementStep(props: StepBaseProps) {
  const t = await getTranslations("onboarding.movement");

  return (
    <StepForm step="movement" {...props}>
      <StepTitle>{t("title")}</StepTitle>
      <ChoiceGroup
        name="movement"
        type="radio"
        options={ACTIVITY_BASELINE_KEYS.map((value) => ({ value, label: t(`options.${value}`) }))}
      />
    </StepForm>
  );
}
