import { Logo } from "@/components/Logo";
import { getTranslations } from "@/i18n/server";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

export default async function LoginPage() {
  const [t, tApp] = await Promise.all([getTranslations("auth"), getTranslations("app")]);

  return (
    <main className={styles.main}>
      <section className={styles.card}>
        <header className={styles.brand}>
          <Logo size={88} priority />
          <p className={styles.tagline}>{tApp("tagline")}</p>
        </header>
        <h1>{t("title")}</h1>
        <LoginForm />
      </section>
    </main>
  );
}
