import styles from "@/app/onboarding/onboarding.module.css";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ONBOARDING_PATH } from "@/domain/onboarding";
import { getTranslations } from "@/i18n/server";

/**
 * A calm page for the moments onboarding cannot load: Supabase is not set up, it did not answer,
 * or the profile row is missing. Never an error screen, and never a redirect, so it cannot loop.
 */
export async function OnboardingUnavailable({
  reason,
}: {
  reason: "not_configured" | "unavailable" | "profile_missing";
}) {
  const [t, tSetup] = await Promise.all([getTranslations("onboarding"), getTranslations("setup")]);

  const copy =
    reason === "not_configured"
      ? { title: tSetup("title"), body: tSetup("body") }
      : {
          title: t("common.unavailableTitle"),
          body: reason === "profile_missing" ? t("errors.profile_missing") : t("common.unavailableBody"),
        };

  return (
    <Card>
      <div className={styles.unavailable}>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.lead}>{copy.body}</p>
        {reason === "not_configured" ? null : (
          <ButtonLink href={ONBOARDING_PATH} variant="secondary">
            {t("common.retry")}
          </ButtonLink>
        )}
      </div>
    </Card>
  );
}
