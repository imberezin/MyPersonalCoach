import { NoticeCard } from "@/components/food/NoticeCard";
import { getTranslations } from "@/i18n/server";

const TITLE_ID = "first-week-unavailable-title";

/** The summary or the experiment could not be loaded (the database is unreachable): calm, with the way home. Never an error wall. */
export async function FirstWeekUnavailable() {
  const t = await getTranslations("firstWeek");
  return (
    <NoticeCard
      titleId={TITLE_ID}
      title={t("unavailable.title")}
      body={t("unavailable.body")}
      href="/"
      linkLabel={t("unavailable.home")}
    />
  );
}
