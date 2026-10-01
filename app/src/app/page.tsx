import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { decideRoute } from "@/domain/onboarding";
import { getTranslations } from "@/i18n/server";
import { loadOnboardingContext } from "@/lib/onboarding/context";
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
          <div className={styles.brandMark}>
            <Logo size={64} priority />
          </div>
          <h1>{t("setup.title")}</h1>
          <p>{t("setup.body")}</p>
          <p>
            <code>{t("setup.missing")}</code>
          </p>
        </section>
      </main>
    );
  }

  // Only a user whose profile loaded and who has not finished onboarding is sent away. Every other
  // outcome (signed out, Supabase down, no profile) renders Home as before: the proxy owns sign-in,
  // and a hiccup must not trap the user in a redirect.
  const onboarding = await loadOnboardingContext();
  if (onboarding.kind === "ready") {
    const route = decideRoute("home", onboarding.row.lifecycle_state);
    if (route.kind === "redirect") redirect(route.to);
  }

  return (
    <main className={styles.main}>
      <section className={styles.card}>
        <div className={styles.brandMark}>
          <Logo size={64} priority />
        </div>
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
