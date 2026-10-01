import { Logo } from "@/components/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { HOME_PATH } from "@/domain/onboarding";
import { getTranslations } from "@/i18n/server";
import styles from "./(app)/_components/pages.module.css";

// An unknown address: a calm card and one way back. It lives outside the (app) group, so there is
// no header or navigation, and it renders its own <main>. It sets no title of its own (a metadata
// export is only documented for global-not-found).
export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <main className={styles.centered}>
      <section className={styles.card}>
        <div className={styles.brandMark}>
          <Logo size={64} />
        </div>
        <h1>{t("title")}</h1>
        <p>{t("body")}</p>
        <ButtonLink href={HOME_PATH} variant="primary">
          {t("cta")}
        </ButtonLink>
      </section>
    </main>
  );
}
