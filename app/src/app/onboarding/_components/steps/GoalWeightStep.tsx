import { getTranslations } from "@/i18n/server";
import { NumberField } from "../fields/NumberField";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

/** A4: a goal weight if the person wants one. A behavioral goal instead is an equal answer. */
export async function GoalWeightStep(props: StepBaseProps) {
  const t = await getTranslations("onboarding.goalWeight");

  return (
    <StepForm step="goal-weight" {...props} decline={{ leadKey: "goalWeight.or", labelKey: "goalWeight.decline" }}>
      <StepTitle>{t("title")}</StepTitle>
      <NumberField name="goal_weight" label={t("title")} labelHidden unit={t("unit")} inputMode="decimal" />
    </StepForm>
  );
}
