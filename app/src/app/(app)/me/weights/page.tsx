import type { Metadata } from "next";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import pages from "@/app/(app)/_components/pages.module.css";
import { openWeightReadGate } from "@/app/(flow)/report/weight/_lib/gate";
import { ButtonLink } from "@/components/ui/Button";
import { WeightsEmpty } from "@/components/weight/WeightsEmpty";
import { WeightsList, type WeightRowData } from "@/components/weight/WeightsList";
import { WeightsNotice } from "@/components/weight/WeightsNotice";
import { WeightsUnavailable } from "@/components/weight/WeightsUnavailable";
import weightStyles from "@/components/weight/weight.module.css";
import { localDayOf } from "@/domain/time";
import {
  WEIGHT_FLOW,
  WEIGHT_QUERY,
  WEIGHT_ROUTES,
  formatDayLabel,
  formatKg,
  parseWeightCursor,
  parseWeightNotice,
  parseWeightNoticeToken,
} from "@/domain/weight";
import { getLocale, getTranslations } from "@/i18n/server";
import { listWeightEntries } from "@/lib/weight/repo";
import { deleteWeightAction } from "./actions";

const TITLE_ID = "weights-title";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("weight");
  return { title: t("list.title") };
}

// "My weights": everything the person saved, newest first, 30 to a page, each with a way to fix it and to delete it.
// "Show older" follows a cursor (the id of the last row shown), so every entry stays reachable however old. Deleting is
// not reporting, so this page never asks about Shabbat or offline periods (openWeightReadGate reads none). A list that
// cannot be loaded is never shown as an empty one.
export default async function WeightsPage(props: PageProps<"/me/weights">) {
  const query = await props.searchParams;
  // A cursor that is not an entry of the caller (deleted, forged, garbage) falls back to the newest page in the repo.
  const after = parseWeightCursor(query[WEIGHT_QUERY.after]);
  const notice = parseWeightNotice(query[WEIGHT_QUERY.notice]);
  // The one-shot token of a delete: a new key remounts the notice, so it takes focus and is announced every time.
  const token = parseWeightNoticeToken(query[WEIGHT_QUERY.token]);

  const gate = await openWeightReadGate();
  if (gate.kind === "not_configured") return <SetupNotice />;

  const [t, locale] = await Promise.all([getTranslations("weight"), getLocale()]);
  const listed = gate.kind === "ready" ? await listWeightEntries(gate.context.supabase, { after }) : null;

  let body;
  if (gate.kind !== "ready" || !listed || !listed.ok) {
    body = <WeightsUnavailable />;
  } else {
    const { entries, hasMore } = listed.value;
    const thisYear = localDayOf(gate.now, gate.timeZone).key.slice(0, 4);
    const rows: WeightRowData[] = entries.map((entry) => ({
      entryId: entry.id,
      dayText: formatDayLabel({
        instant: entry.measuredAt,
        locale,
        timeZone: gate.timeZone,
        includeYear: localDayOf(entry.measuredAt, gate.timeZone).key.slice(0, 4) !== thisYear,
      }),
      kgText: formatKg(entry.weightKg, locale),
      unit: t("form.unit"),
      note: entry.note,
      editHref: WEIGHT_FLOW.reportingEnabled ? WEIGHT_ROUTES.edit(entry.id) : null,
    }));
    const startKg = gate.context.row.start_weight_kg;
    const last = entries[entries.length - 1];

    body = (
      <>
        {rows.length === 0 ? (
          <WeightsEmpty />
        ) : (
          <WeightsList rows={rows} label={t("list.label")} editLabel={t("row.edit")} deleteAction={deleteWeightAction} after={after} />
        )}
        {/* Where we started: a quiet last line of the OLDEST page. It is the profile's number, so it has no buttons. */}
        {!hasMore && startKg !== null ? (
          <p className={weightStyles.start}>
            <span>{t("list.start")}</span>
            <bdi dir="ltr">{formatKg(startKg, locale)}</bdi>
            <span>{t("form.unit")}</span>
          </p>
        ) : null}
        {hasMore && last ? (
          <ButtonLink href={WEIGHT_ROUTES.listAfter(last.id)} variant="secondary">
            {t("list.more")}
          </ButtonLink>
        ) : null}
        {after !== null ? (
          <ButtonLink href={WEIGHT_ROUTES.list} variant="tertiary">
            {t("list.newest")}
          </ButtonLink>
        ) : null}
        <ButtonLink href={WEIGHT_ROUTES.me} variant="tertiary">
          {t("list.back")}
        </ButtonLink>
      </>
    );
  }

  return (
    <section aria-labelledby={TITLE_ID} className={pages.stack}>
      <div className={pages.infoBody}>
        <h1 id={TITLE_ID} className={pages.infoTitle}>
          {t("list.title")}
        </h1>
        <p className={pages.lead}>{t("list.lead")}</p>
      </div>
      {notice ? <WeightsNotice key={token ?? "no-token"} notice={notice} /> : null}
      {body}
    </section>
  );
}
