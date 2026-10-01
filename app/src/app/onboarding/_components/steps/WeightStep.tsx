import { getTranslations } from "@/i18n/server";
import { NumberField } from "../fields/NumberField";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

/** A3: the starting weight. Optional, never presented as a judgment. */
export async function WeightStep(props: StepBaseProps) {
  const t = await getTranslations("onboarding.weight");

  return (
    <StepForm step="weight" {...props}>
      <StepTitle>{t("title")}</StepTitle>
      <NumberField name="weight" label={t("title")} labelHidden unit={t("unit")} inputMode="decimal" hint={t("hint")} />
    </StepForm>
  );
}
