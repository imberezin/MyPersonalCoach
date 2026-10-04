import { NoticeCard } from "@/components/food/NoticeCard";
import { getTranslations } from "@/i18n/server";

const TITLE_ID = "weekly-unavailable-title";

/** "Your week" could not be loaded (the database is unreachable): calm, with the way home. Never an error wall. */
export async function WeeklyUnavailable() {
  const t = await getTranslations("weekly");
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
