import { TEXT_LIMITS } from "@/domain/onboarding";
import { getTranslations } from "@/i18n/server";
import { TextField } from "../fields/TextField";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

/** A10: why the change matters. A few words, or nothing. */
export async function WhyStep(props: StepBaseProps) {
  const t = await getTranslations("onboarding.why");

  return (
    <StepForm step="why" {...props}>
      <StepTitle>{t("title")}</StepTitle>
      <TextField
        name="motivation"
        label={t("title")}
        labelHidden
        maxLength={TEXT_LIMITS.motivation}
        multiline
        hint={t("hint")}
      />
    </StepForm>
  );
}
