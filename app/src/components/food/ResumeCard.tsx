"use client";

import { useTranslations } from "use-intl";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FOOD_FORM, FOOD_ROUTES } from "@/domain/food/routes";
import styles from "./food.module.css";

const TITLE_ID = "resume-title";

/**
 * A report that was started in the last two hours and never finished: pick it up, or let it go. The
 * discard action is a Server Action passed in by the page (this component never imports the actions
 * file), so the form posts without waiting for any script.
 */
export function ResumeCard({
  id,
  discardAction,
}: {
  id: string;
  discardAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("food");
  return (
    <section aria-labelledby={TITLE_ID} className={styles.resume}>
      <h2 id={TITLE_ID}>{t("resume.title")}</h2>
      <p>{t("resume.body")}</p>
      <div className={styles.resumeActions}>
        <ButtonLink href={FOOD_ROUTES.confirm(id)} variant="primary">
          {t("resume.continue")}
        </ButtonLink>
        <form action={discardAction}>
          <input type="hidden" name={FOOD_FORM.id} value={id} />
          <input type="hidden" name={FOOD_FORM.stage} value="resume" />
          <Button type="submit" variant="tertiary">
            {t("resume.discard")}
          </Button>
        </form>
      </div>
    </section>
  );
}
