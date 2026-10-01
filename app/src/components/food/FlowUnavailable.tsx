import { getTranslations } from "@/i18n/server";
import { NoticeCard } from "./NoticeCard";

const TITLE_ID = "unavailable-title";

/** The report could not be loaded (the database is unreachable): calm, with the way home. Never an error wall. */
export async function FlowUnavailable() {
  const t = await getTranslations("food");
  return (
    <NoticeCard
      titleId={TITLE_ID}
      title={t("unavailable.title")}
      body={t("unavailable.body")}
      href="/"
      linkLabel={t("problem.action.goHome")}
    />
  );
}
