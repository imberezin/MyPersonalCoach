import { Card } from "@/components/ui/Card";
import { getTranslations } from "@/i18n/server";
import styles from "./progress.module.css";

const TITLE_ID = "progress-unavailable-title";

/** The page could not be loaded (the database is unreachable): one calm card and the way to try again. Never an error wall. */
export async function ProgressUnavailable() {
  const t = await getTranslations("progress");
  return (
    <section aria-labelledby={TITLE_ID}>
      <Card>
        <div className={styles.cardBody}>
          <h1 id={TITLE_ID} className={styles.title}>
            {t("unavailable.title")}
          </h1>
          <p>{t("unavailable.body")}</p>
        </div>
      </Card>
    </section>
  );
}
