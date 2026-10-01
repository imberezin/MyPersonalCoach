import { getTranslations } from "@/i18n/server";
import { NumberField } from "../fields/NumberField";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

/** A5: age and height, each optional. */
export async function AboutYouStep(props: StepBaseProps) {
  const t = await getTranslations("onboarding.aboutYou");

  return (
    <StepForm step="about-you" {...props}>
      <StepTitle>{t("title")}</StepTitle>
      <NumberField name="age" label={t("age")} inputMode="numeric" />
      <NumberField name="height" label={t("height")} unit={t("unit")} inputMode="decimal" />
    </StepForm>
  );
}
