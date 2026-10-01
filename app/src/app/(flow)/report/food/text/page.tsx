import type { Metadata } from "next";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { FlowUnavailable } from "@/components/food/FlowUnavailable";
import { QuietNotice } from "@/components/food/QuietNotice";
import { TextReport } from "@/components/food/TextReport";
import { getTranslations } from "@/i18n/server";
import { isAiConfigured } from "@/lib/ai/factory";
import { openFoodEntryGate } from "../_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("food");
  return { title: t("meta.title") };
}

// D3 (with D5 inside the client form): the person writes what they ate. Without AI the words are kept as a list.
export default async function FoodTextPage() {
  const gate = await openFoodEntryGate();
  if (gate.kind === "not_configured") return <SetupNotice />;
  if (gate.kind === "unavailable") return <FlowUnavailable />;
  if (gate.kind === "quiet") return <QuietNotice />;

  return <TextReport aiAvailable={isAiConfigured()} />;
}
