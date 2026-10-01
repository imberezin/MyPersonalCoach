import { Logo } from "@/components/Logo";
import { getTranslations } from "@/i18n/server";
import styles from "./pages.module.css";

/**
 * "Setup needed" while Supabase is not configured. The layout then draws no header and no
 * navigation (their links would only lead to more of this card), so it stands alone. It renders a
 * <div>: the layout provides the <main>.
 */
export async function SetupNotice() {
  const t = await getTranslations("setup");

  return (
    <div className={styles.centered}>
      <section className={styles.card}>
        <div className={styles.brandMark}>
          <Logo size={64} priority />
        </div>
        <h1>{t("title")}</h1>
        <p>{t("body")}</p>
        <p>
          <code>{t("missing")}</code>
        </p>
      </section>
    </div>
  );
}
