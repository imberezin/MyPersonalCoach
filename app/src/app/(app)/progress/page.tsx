import type { Metadata } from "next";
import { getTranslations } from "@/i18n/server";
import { InfoPage } from "../_components/InfoPage";
import { SetupNotice } from "../_components/SetupNotice";
import { openAppGate } from "../_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("progress");
  return { title: t("title") };
}

// Charts and milestones come with the Progress group; until then this says so, calmly.
export default async function ProgressPage() {
  const gate = await openAppGate();
  if (gate.kind === "not_configured") return <SetupNotice />;

  const t = await getTranslations("progress");
  return (
    <InfoPage title={t("title")} lead={t("lead")}>
      <p>{t("body")}</p>
    </InfoPage>
  );
}
