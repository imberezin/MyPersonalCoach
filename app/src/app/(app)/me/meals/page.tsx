import type { Metadata } from "next";
import { SetupNotice } from "@/app/(app)/_components/SetupNotice";
import pages from "@/app/(app)/_components/pages.module.css";
import { openReportGate } from "@/app/(flow)/report/food/_lib/gate";
import { buildMealSummary } from "@/components/meals/buildSummary";
import { MealsEmpty } from "@/components/meals/MealsEmpty";
import { MealsList, type MealRowData } from "@/components/meals/MealsList";
import { MealsNotice } from "@/components/meals/MealsNotice";
import { MealsUnavailable } from "@/components/meals/MealsUnavailable";
import { ShowMoreLink } from "@/components/meals/ShowMoreLink";
import { ButtonLink } from "@/components/ui/Button";
import { MEALS_QUERY, MEALS_ROUTES, MEAL_LIST, clampPages, parseNotice, parseNoticeToken } from "@/domain/food";
import { getLocale, getTranslations } from "@/i18n/server";
import { listMealEntries } from "@/lib/food/repo";
import { deleteMealAction } from "./actions";

const TITLE_ID = "meals-title";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meals");
  return { title: t("meta.title") };
}

// "My meals": everything the person saved, newest first, each with a way to delete it. The list shows
// confirmed meals only. Deleting is not reporting, so this page never asks about Shabbat or offline
// periods (openReportGate reads none). A list that cannot be loaded is never shown as an empty one.
export default async function MealsPage(props: PageProps<"/me/meals">) {
  const query = await props.searchParams;
  const pageCount = clampPages(query[MEALS_QUERY.pages]);
  const notice = parseNotice(query[MEALS_QUERY.notice]);
  // The one-shot token of a delete: a new key remounts the notice, so it takes focus and is announced every time.
  const token = parseNoticeToken(query[MEALS_QUERY.token]);

  const gate = await openReportGate();
  if (gate.kind === "not_configured") return <SetupNotice />;

  const [t, tFood, locale] = await Promise.all([getTranslations("meals"), getTranslations("food"), getLocale()]);
  const listed = gate.kind === "ready" ? await listMealEntries(gate.context.supabase, { pages: pageCount }) : null;

  let body;
  if (gate.kind !== "ready" || !listed || !listed.ok) {
    body = <MealsUnavailable />;
  } else if (listed.value.entries.length === 0) {
    body = <MealsEmpty />;
  } else {
    const rows: MealRowData[] = listed.value.entries.map((entry) => ({
      entryId: entry.id,
      summary: buildMealSummary(entry, { now: gate.now, timeZone: gate.timeZone, locale, food: tFood, meals: t }),
    }));
    const more = listed.value.hasMore;
    body = (
      <>
        <MealsList rows={rows} deleteAction={deleteMealAction} pages={pageCount} />
        {more && pageCount < MEAL_LIST.maxPages ? <ShowMoreLink href={MEALS_ROUTES.listPage(pageCount + 1)} /> : null}
        {more && pageCount >= MEAL_LIST.maxPages ? <p className={pages.lead}>{t("capNote")}</p> : null}
        <ButtonLink href={MEALS_ROUTES.me} variant="tertiary">
          {t("back")}
        </ButtonLink>
      </>
    );
  }

  return (
    <section aria-labelledby={TITLE_ID} className={pages.stack}>
      <div className={pages.infoBody}>
        <h1 id={TITLE_ID} className={pages.infoTitle}>
          {t("title")}
        </h1>
        <p className={pages.lead}>{t("lead")}</p>
      </div>
      {notice ? <MealsNotice key={token ?? "no-token"} notice={notice} /> : null}
      {body}
    </section>
  );
}
