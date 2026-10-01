import type { Metadata } from "next";
import { signOut } from "@/app/actions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { MEALS_ROUTES } from "@/domain/food";
import { getTranslations } from "@/i18n/server";
import { InfoPage } from "../_components/InfoPage";
import { SetupNotice } from "../_components/SetupNotice";
import styles from "../_components/pages.module.css";
import { openAppGate } from "../_lib/gate";
import { DevStatus } from "./_components/DevStatus";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("me");
  return { title: t("title") };
}

// Settings come with the Me group. Sign-out lives here, and it must stay reachable whatever else
// failed to load, so this page opens for every context except "not configured" (see openAppGate).
export default async function MePage() {
  const gate = await openAppGate();
  if (gate.kind === "not_configured") return <SetupNotice />;

  const [t, tCommon] = await Promise.all([getTranslations("me"), getTranslations("common")]);
  return (
    <div className={styles.stack}>
      <InfoPage title={t("title")}>
        <p>{t("body")}</p>
        <p>{t("mealsHint")}</p>
        <ButtonLink href={MEALS_ROUTES.list} variant="secondary">
          {t("mealsLink")}
        </ButtonLink>
        <form action={signOut}>
          <Button type="submit" variant="secondary">
            {tCommon("signOut")}
          </Button>
        </form>
      </InfoPage>
      <DevStatus />
    </div>
  );
}
