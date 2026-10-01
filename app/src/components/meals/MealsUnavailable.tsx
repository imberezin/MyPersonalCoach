import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MEALS_ROUTES } from "@/domain/food/routes";
import { getTranslations } from "@/i18n/server";
import styles from "./meals.module.css";

/**
 * The list could not be loaded. It must never look like "no meals": an empty list would claim there is
 * nothing to delete while some meals exist. Two ways on: try again (the same address) or go back to Me.
 */
export async function MealsUnavailable() {
  const t = await getTranslations("meals");
  return (
    <Card>
      <div className={styles.stack}>
        <h2 className={styles.cardTitle}>{t("unavailable.title")}</h2>
        <p>{t("unavailable.body")}</p>
        <div className={styles.actions}>
          <ButtonLink href={MEALS_ROUTES.list} variant="secondary">
            {t("unavailable.retry")}
          </ButtonLink>
          <ButtonLink href={MEALS_ROUTES.me} variant="tertiary">
            {t("back")}
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}
