import { FOOD_ROUTES } from "@/domain/food/routes";
import { getTranslations } from "@/i18n/server";
import { NoticeCard } from "./NoticeCard";

const TITLE_ID = "photo-unavailable-title";

/** D2 when no AI is configured: a sentence and the way to the writing screen, instead of a camera that leads nowhere. */
export async function PhotoUnavailable() {
  const t = await getTranslations("food");
  return (
    <NoticeCard
      titleId={TITLE_ID}
      title={t("photoUnavailable.title")}
      body={t("photoUnavailable.body")}
      href={FOOD_ROUTES.text}
      linkLabel={t("photoUnavailable.writeInstead")}
    />
  );
}
