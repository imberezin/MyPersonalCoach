import type { Metadata } from "next";
import { getTranslations } from "@/i18n/server";
import { InfoPage } from "../_components/InfoPage";
import { SetupNotice } from "../_components/SetupNotice";
import { openAppGate } from "../_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("coach");
  return { title: t("title") };
}

// The conversation comes with the Coach group; until then this says so, calmly.
export default async function CoachPage() {
  const gate = await openAppGate();
  if (gate.kind === "not_configured") return <SetupNotice />;

  const t = await getTranslations("coach");
  return (
    <InfoPage title={t("heading")}>
      <p>{t("body")}</p>
    </InfoPage>
  );
}
