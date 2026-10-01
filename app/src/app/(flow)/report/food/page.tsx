import type { Metadata } from "next";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { FlowUnavailable } from "@/components/food/FlowUnavailable";
import { FoodChooser } from "@/components/food/FoodChooser";
import { QuietNotice } from "@/components/food/QuietNotice";
import { getTranslations } from "@/i18n/server";
import { isAiConfigured } from "@/lib/ai/factory";
import { findResumable } from "@/lib/food/repo";
import { discardAction } from "./actions";
import { openFoodEntryGate } from "./_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("food");
  return { title: t("meta.title") };
}

// D1: how would you like to tell me. Photo or writing, and the card for an unfinished report.
export default async function FoodChooserPage() {
  const gate = await openFoodEntryGate();
  if (gate.kind === "not_configured") return <SetupNotice />;
  if (gate.kind === "unavailable") return <FlowUnavailable />;
  if (gate.kind === "quiet") return <QuietNotice />;

  const resume = await findResumable(gate.context.supabase, gate.now);
  return <FoodChooser photoEnabled={isAiConfigured()} resume={resume ? { id: resume.id } : null} discardAction={discardAction} />;
}
