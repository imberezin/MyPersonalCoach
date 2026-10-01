import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { FOOD_ROUTES } from "@/domain/food/routes";
import { getTranslations } from "@/i18n/server";
import { FlowTitle } from "./FlowTitle";
import { ResumeCard } from "./ResumeCard";
import styles from "./food.module.css";

const TITLE_ID = "chooser-title";

/**
 * D1: two ways to tell, as real links. When automatic photo analysis is not available the Photo tile is a
 * sentence instead of a link, so nobody takes a picture that cannot be understood. An unfinished report
 * from the last two hours is offered above the tiles.
 */
export async function FoodChooser({
  photoEnabled,
  resume,
  discardAction,
}: {
  photoEnabled: boolean;
  resume: { id: string } | null;
  discardAction: (formData: FormData) => Promise<void>;
}) {
  const t = await getTranslations("food");
  return (
    <section aria-labelledby={TITLE_ID} className={styles.screen}>
      <div>
        <FlowTitle id={TITLE_ID}>{t("chooser.title")}</FlowTitle>
        <p className={styles.lead}>{t("chooser.lead")}</p>
      </div>
      {resume ? <ResumeCard id={resume.id} discardAction={discardAction} /> : null}
      <ul className={styles.tiles} role="list">
        <li>
          {photoEnabled ? (
            <Link href={FOOD_ROUTES.photo} className={styles.tile}>
              <span className={styles.tileTitle}>{t("chooser.photo")}</span>
              <span className={styles.tileHint}>{t("chooser.photoHint")}</span>
            </Link>
          ) : (
            <div className={`${styles.tile} ${styles.tileOff}`}>
              <span className={styles.tileTitle}>{t("chooser.photo")}</span>
              <span className={styles.tileHint}>{t("chooser.photoOff")}</span>
            </div>
          )}
        </li>
        <li>
          <Link href={FOOD_ROUTES.text} className={styles.tile}>
            <span className={styles.tileTitle}>{t("chooser.text")}</span>
            <span className={styles.tileHint}>{t("chooser.textHint")}</span>
          </Link>
        </li>
      </ul>
      <div className={styles.back}>
        <ButtonLink href="/">{t("common.back")}</ButtonLink>
      </div>
    </section>
  );
}
