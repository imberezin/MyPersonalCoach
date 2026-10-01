import type { Metadata } from "next";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { FlowUnavailable } from "@/components/food/FlowUnavailable";
import { PhotoReport } from "@/components/food/PhotoReport";
import { PhotoUnavailable } from "@/components/food/PhotoUnavailable";
import { QuietNotice } from "@/components/food/QuietNotice";
import { getTranslations } from "@/i18n/server";
import { isAiConfigured } from "@/lib/ai/factory";
import { openFoodEntryGate } from "../_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("food");
  return { title: t("meta.title") };
}

// D2 (with D5 inside the client form): one photo, an optional note, send. Without AI there is nothing to send to.
export default async function FoodPhotoPage() {
  const gate = await openFoodEntryGate();
  if (gate.kind === "not_configured") return <SetupNotice />;
  if (gate.kind === "unavailable") return <FlowUnavailable />;
  if (gate.kind === "quiet") return <QuietNotice />;

  return isAiConfigured() ? <PhotoReport /> : <PhotoUnavailable />;
}
