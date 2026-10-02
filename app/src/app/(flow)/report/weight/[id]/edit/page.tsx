import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { FlowUnavailable } from "@/components/food/FlowUnavailable";
import { QuietNotice } from "@/components/food/QuietNotice";
import { buildDayChoices } from "@/components/weight/dayChoices";
import { WeightForm } from "@/components/weight/WeightForm";
import { localDayOf } from "@/domain/time";
import { WEIGHT_ROUTES, dayOptions, isUuid } from "@/domain/weight";
import { getLocale, getTranslations } from "@/i18n/server";
import { loadWeightEntry } from "@/lib/weight/repo";
import { editWeightAction } from "../../actions";
import { openWeightEntryGate } from "../../_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("weight");
  return { title: t("meta.title") };
}

// Fix the number, the day or the note of a saved weight. Editing is reporting, so an offline period shows the quiet screen.
export default async function WeightEditPage(props: PageProps<"/report/weight/[id]/edit">) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const gate = await openWeightEntryGate();
  if (gate.kind === "not_configured") return <SetupNotice />;
  if (gate.kind === "unavailable") return <FlowUnavailable />;
  if (gate.kind === "quiet") return <QuietNotice />;

  const loaded = await loadWeightEntry(gate.context.supabase, id);
  if (!loaded.ok) {
    if (loaded.code === "not_found") notFound();
    return <FlowUnavailable />;
  }
  const row = loaded.value;

  const [t, locale] = await Promise.all([getTranslations("weight"), getLocale()]);
  const options = buildDayChoices({
    options: dayOptions({ now: gate.now, timeZone: gate.timeZone, currentMeasuredAt: row.measuredAt }),
    t,
    locale,
    timeZone: gate.timeZone,
    currentYear: localDayOf(gate.now, gate.timeZone).key.slice(0, 4),
  });

  return (
    <WeightForm
      mode="edit"
      id={id}
      options={options}
      initial={{ weight: row.weightKg.toFixed(1), day: "keep", note: row.note ?? "" }}
      action={editWeightAction}
      backHref={WEIGHT_ROUTES.list}
    />
  );
}
