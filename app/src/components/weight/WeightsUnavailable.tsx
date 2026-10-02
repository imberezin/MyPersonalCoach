import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { WEIGHT_ROUTES } from "@/domain/weight/routes";
import { getTranslations } from "@/i18n/server";
import styles from "./weight.module.css";

/**
 * The list could not be loaded. It must never look like "no weights": an empty list would claim there is
 * nothing to delete while some weights exist. Two ways on: try again (the same address) or go back to Me.
 */
export async function WeightsUnavailable() {
  const t = await getTranslations("weight");
  return (
    <Card>
      <div className={styles.stack}>
        <h2 className={styles.cardTitle}>{t("unavailable.title")}</h2>
        <p>{t("unavailable.body")}</p>
        <div className={styles.actions}>
          <ButtonLink href={WEIGHT_ROUTES.list} variant="secondary">
            {t("unavailable.retry")}
          </ButtonLink>
          <ButtonLink href={WEIGHT_ROUTES.me} variant="tertiary">
            {t("list.back")}
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}
