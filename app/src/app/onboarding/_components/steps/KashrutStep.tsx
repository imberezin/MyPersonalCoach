import { KASHRUT_CHOICES } from "@/domain/onboarding";
import { getTranslations } from "@/i18n/server";
import { ChoiceGroup } from "../fields/ChoiceGroup";
import { StepForm, StepTitle, type StepBaseProps } from "../StepForm";

/** A8: constraints and preferences. The app records them and gives no halachic ruling. */
export async function KashrutStep(props: StepBaseProps) {
  const t = await getTranslations("onboarding.kashrut");

  return (
    <StepForm step="kashrut" {...props}>
      <StepTitle>{t("title")}</StepTitle>
      <ChoiceGroup
        name="kashrut"
        type="checkbox"
        options={KASHRUT_CHOICES.map((value) => ({ value, label: t(`options.${value}`) }))}
      />
    </StepForm>
  );
}
