import { TEXT_LIMITS } from "@/domain/onboarding";
import { getTranslations } from "@/i18n/server";
import { TextField } from "../fields/TextField";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

/** A7: a lightweight look at food context. The system learns the rest over time. */
export async function FoodStep(props: StepBaseProps) {
  const t = await getTranslations("onboarding.food");

  return (
    <StepForm step="food" {...props}>
      <StepTitle>{t("title")}</StepTitle>
      <TextField name="likes" label={t("likes")} maxLength={TEXT_LIMITS.food} />
      <TextField name="dislikes" label={t("dislikes")} maxLength={TEXT_LIMITS.food} />
      <TextField name="style" label={t("style")} maxLength={TEXT_LIMITS.food} />
    </StepForm>
  );
}
