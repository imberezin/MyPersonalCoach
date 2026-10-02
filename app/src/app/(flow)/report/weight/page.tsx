import type { Metadata } from "next";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { FlowUnavailable } from "@/components/food/FlowUnavailable";
import { QuietNotice } from "@/components/food/QuietNotice";
import { buildDayChoices } from "@/components/weight/dayChoices";
import { WeightForm } from "@/components/weight/WeightForm";
import { localDayOf } from "@/domain/time";
import { dayOptions } from "@/domain/weight";
import { getLocale, getTranslations } from "@/i18n/server";
import { saveWeightAction } from "./actions";
import { openWeightEntryGate } from "./_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("weight");
  return { title: t("meta.title") };
}

/** A fresh id for every render: the idempotency key of the save (a double tap or a second tab saves once). */
function newEntryId(): string {
  return crypto.randomUUID();
}

// The entry screen: one number, when, an optional note. Reporting is reporting, so during Shabbat or any offline
// period this is the quiet screen with no override (the action checks again).
export default async function WeightEntryPage() {
  const gate = await openWeightEntryGate();
  if (gate.kind === "not_configured") return <SetupNotice />;
  if (gate.kind === "unavailable") return <FlowUnavailable />;
  if (gate.kind === "quiet") return <QuietNotice />;

  const [t, locale] = await Promise.all([getTranslations("weight"), getLocale()]);
  const options = buildDayChoices({
    options: dayOptions({ now: gate.now, timeZone: gate.timeZone }),
    t,
    locale,
    timeZone: gate.timeZone,
    currentYear: localDayOf(gate.now, gate.timeZone).key.slice(0, 4),
  });

  return (
    <WeightForm mode="new" id={newEntryId()} options={options} initial={{ weight: "", day: "now", note: "" }} action={saveWeightAction} backHref="/" />
  );
}
