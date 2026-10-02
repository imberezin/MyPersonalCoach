import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { WEIGHT_ROUTES } from "@/domain/weight/routes";
import { WEIGHT_FLOW } from "@/domain/weight/types";
import { getTranslations } from "@/i18n/server";
import styles from "./weight.module.css";

/** No weight is saved: one calm sentence and, while reporting is on, the way to the entry screen. (A failed load is WeightsUnavailable, never this.) */
export async function WeightsEmpty() {
  const t = await getTranslations("weight");
  return (
    <Card>
      <div className={styles.stack}>
        <h2 className={styles.cardTitle}>{t("empty.title")}</h2>
        <p>{t("empty.body")}</p>
        {WEIGHT_FLOW.reportingEnabled ? (
          <div className={styles.actions}>
            <ButtonLink href={WEIGHT_ROUTES.entry} variant="secondary">
              {t("list.add")}
            </ButtonLink>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
