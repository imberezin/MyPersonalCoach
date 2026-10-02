import type { Metadata } from "next";
import { ProgressUnavailable } from "@/components/progress/ProgressUnavailable";
import { ProgressView } from "@/components/progress/ProgressView";
import { WEIGHT_FLOW } from "@/domain/weight";
import { getTranslations } from "@/i18n/server";
import { currentInstant } from "@/lib/clock/now";
import { loadProgress } from "@/lib/weight/load";
import { InfoPage } from "../_components/InfoPage";
import { SetupNotice } from "../_components/SetupNotice";
import { openAppGate } from "../_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("progress");
  return { title: t("title") };
}

/**
 * Progress: the weekly weight trend, the landmarks and, gently, what the First Week noticed. A pure READ: it recomputes
 * everything from the live data on every render, writes nothing and calls no AI. The switch off restores the old honest
 * placeholder. A context that cannot be read (signed out, the database unreachable, no profile) shows one calm card; the
 * proxy owns sign-in, as for every page of the shell.
 */
export default async function ProgressPage() {
  const gate = await openAppGate();
  if (gate.kind === "not_configured") return <SetupNotice />;

  const t = await getTranslations("progress");
  if (!WEIGHT_FLOW.progressEnabled) {
    return (
      <InfoPage title={t("title")} lead={t("lead")}>
        <p>{t("body")}</p>
      </InfoPage>
    );
  }

  // The page's one clock read (the real time, or the development clock).
  const load = await loadProgress(gate.context, currentInstant());
  if (load.kind === "unavailable") return <ProgressUnavailable />;
  return <ProgressView load={load} />;
}
