import { getTranslations } from "@/i18n/server";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

export default async function LoginPage() {
  const t = await getTranslations("auth");

  return (
    <main className={styles.main}>
      <section className={styles.card}>
        <h1>{t("title")}</h1>
        <LoginForm />
      </section>
    </main>
  );
}
