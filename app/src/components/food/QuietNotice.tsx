import { getTranslations } from "@/i18n/server";
import { NoticeCard } from "./NoticeCard";

const TITLE_ID = "quiet-title";

/** D9 for the entry screens: during Shabbat or any offline period there is nothing to report. No override. */
export async function QuietNotice() {
  const t = await getTranslations("food");
  return <NoticeCard titleId={TITLE_ID} title={t("quiet.title")} body={t("quiet.body")} href="/" linkLabel={t("quiet.cta")} />;
}
