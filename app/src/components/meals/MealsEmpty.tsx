import { Card } from "@/components/ui/Card";
import { getTranslations } from "@/i18n/server";
import styles from "./meals.module.css";

/** No meal is saved: one calm sentence and nothing to press. (A failed load is MealsUnavailable, never this.) */
export async function MealsEmpty() {
  const t = await getTranslations("meals");
  return (
    <Card>
      <div className={styles.stack}>
        <h2 className={styles.cardTitle}>{t("empty.title")}</h2>
        <p>{t("empty.body")}</p>
      </div>
    </Card>
  );
}
