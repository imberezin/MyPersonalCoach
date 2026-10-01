import { GOAL_FOCUS_KEYS } from "@/domain/onboarding";
import { getTranslations } from "@/i18n/server";
import { ChoiceGroup } from "../fields/ChoiceGroup";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

/** A2: what to improve. Several answers are fine, and "not sure" is a complete answer on its own. */
export async function GoalsStep(props: StepBaseProps) {
  const t = await getTranslations("onboarding.goals");

  return (
    <StepForm step="goals" {...props}>
      <StepTitle>{t("title")}</StepTitle>
      <ChoiceGroup
        name="goals"
        type="checkbox"
        options={GOAL_FOCUS_KEYS.map((value) => ({ value, label: t(`options.${value}`) }))}
        exclusive={["not_sure"]}
      />
    </StepForm>
  );
}
