import { getTranslations } from "@/i18n/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { signOut } from "./actions";
import { DevStatus } from "./DevStatus";
import styles from "./home.module.css";

export default async function HomePage() {
  const t = await getTranslations();

  if (!isSupabaseConfigured()) {
    return (
      <main className={styles.main}>
        <section className={styles.card}>
          <h1>{t("setup.title")}</h1>
          <p>{t("setup.body")}</p>
          <p>
            <code>{t("setup.missing")}</code>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <section className={styles.card}>
        <h1>{t("home.greeting")}</h1>
        <p>{t("home.placeholder")}</p>
        <form action={signOut}>
          <button type="submit" className={styles.secondary}>
            {t("common.signOut")}
          </button>
        </form>
      </section>
      <DevStatus />
    </main>
  );
}
