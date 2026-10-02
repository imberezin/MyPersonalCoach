import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteWeightAction } from "@/app/(app)/me/weights/actions";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import { FlowUnavailable } from "@/components/food/FlowUnavailable";
import { WeightSavedView } from "@/components/weight/WeightSavedView";
import { localDayOf } from "@/domain/time";
import { WEIGHT_FLOW, WEIGHT_QUERY, formatDayLabel, formatKg, isUuid } from "@/domain/weight";
import { getLocale, getTranslations } from "@/i18n/server";
import { loadSavedWeight } from "@/lib/weight/repo";
import { openWeightReadGate } from "../../_lib/gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("weight");
  return { title: t("meta.title") };
}

// The weight was added or updated. Reached by `replace`, so Back skips the form. Never quiet: finishing is not blocked,
// and a person can always delete what they just saved.
export default async function WeightSavedPage(props: PageProps<"/report/weight/[id]/saved">) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();
  const query = await props.searchParams;
  const flag = query[WEIGHT_QUERY.edited];

  const gate = await openWeightReadGate();
  if (gate.kind === "not_configured") return <SetupNotice />;
  if (gate.kind === "unavailable") return <FlowUnavailable />;

  const loaded = await loadSavedWeight(gate.context.supabase, id);
  if (!loaded.ok) {
    // Someone else's id looks exactly like a missing one (Row Level Security).
    if (loaded.code === "not_found") notFound();
    return <FlowUnavailable />;
  }
  const entry = loaded.value;

  const [t, locale] = await Promise.all([getTranslations("weight"), getLocale()]);
  const sameYear = localDayOf(entry.measuredAt, gate.timeZone).key.slice(0, 4) === localDayOf(gate.now, gate.timeZone).key.slice(0, 4);
  return (
    <WeightSavedView
      entryId={entry.id}
      kgText={formatKg(entry.weightKg, locale)}
      unit={t("form.unit")}
      dayText={formatDayLabel({ instant: entry.measuredAt, locale, timeZone: gate.timeZone, includeYear: !sameYear })}
      edited={(Array.isArray(flag) ? flag[0] : flag) === "1"}
      canEdit={WEIGHT_FLOW.reportingEnabled}
      deleteAction={deleteWeightAction}
    />
  );
}
