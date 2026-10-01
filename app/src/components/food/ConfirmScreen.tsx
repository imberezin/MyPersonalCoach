import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Message } from "@/components/ui/Message";
import { FOOD_FORM, FOOD_ROUTES } from "@/domain/food/routes";
import type { ConfirmView } from "@/domain/food/view";
import { getTranslations } from "@/i18n/server";
import { FlowTitle } from "./FlowTitle";
import { SubmitButton } from "./SubmitButton";
import { formatPortion, isolateTime } from "./formatPortion";
import styles from "./food.module.css";

const TITLE_ID = "confirm-title";
const DISCARD_FORM_ID = "confirm-discard";

/**
 * D6: what was understood, on one screen. Foods and portions are plain text ("about" for an estimate,
 * "Maybe" as a word for an uncertain food); there are no numbers besides amounts, and no per-food icons.
 * Save is the first button after the content, then the fix link, then the quiet "Not now". The form only
 * carries the report's id and the revision of what is shown: the server rebuilds everything else.
 */
export async function ConfirmScreen({
  view,
  refreshed,
  failed = false,
  confirmAction,
  discardAction,
}: {
  view: ConfirmView;
  refreshed: boolean;
  /** The last Save did not go through (`?failed=1`). */
  failed?: boolean;
  confirmAction: (formData: FormData) => Promise<void>;
  discardAction: (formData: FormData) => Promise<void>;
}) {
  const t = await getTranslations("food");
  const meal = t(`mealType.${view.mealType}`);
  const time = isolateTime(view.time);
  const when =
    view.day === "other"
      ? t("confirm.whenOther", { meal, time })
      : t("confirm.when", { meal, day: t(`day.${view.day}`), time });

  return (
    <section aria-labelledby={TITLE_ID} className={styles.screen}>
      <Card>
        <form action={confirmAction} className={styles.form}>
          <input type="hidden" name={FOOD_FORM.id} value={view.id} />
          <input type="hidden" name={FOOD_FORM.revision} value={view.revision} />

          <FlowTitle id={TITLE_ID}>{view.manual ? t("confirm.titleManual") : t("confirm.title")}</FlowTitle>
          {view.manual ? <Message variant="note">{t("confirm.manualNote")}</Message> : null}
          {view.fake ? <Message variant="note">{t("confirm.fakeNote")}</Message> : null}
          {refreshed ? (
            <Message variant="note" role="status">
              {t("confirm.refreshed")}
            </Message>
          ) : null}

          {failed ? (
            <Message variant="error" role="alert">
              {t("confirm.notSaved")}
            </Message>
          ) : null}

          <ul className={styles.foods} role="list">
            {view.items.map((item, index) => {
              const portion = formatPortion(item.portion, t);
              return (
                <li key={index} className={styles.food}>
                  {/* bdi: an English food name inside a Hebrew list keeps its own direction. */}
                  <bdi className={styles.foodName}>{item.name}</bdi>
                  {portion ? <span className={styles.foodPortion}>{portion}</span> : null}
                  {item.uncertain ? <span className={styles.maybe}>{t("confirm.maybe")}</span> : null}
                </li>
              );
            })}
          </ul>
          {view.anyEstimated ? <p className={styles.hint}>{t("confirm.estimateNote")}</p> : null}

          {view.unclear.length > 0 ? (
            <div className={styles.unclear}>
              <p>{t("confirm.unclearTitle")}</p>
              <ul className={styles.unclearList}>
                {view.unclear.map((text, index) => (
                  <li key={index}>
                    <bdi>{text}</bdi>
                  </li>
                ))}
              </ul>
              <p className={styles.hint}>{t("confirm.unclearHint")}</p>
            </div>
          ) : null}

          <p className={styles.when}>{when}</p>

          <div className={styles.actions}>
            <SubmitButton pendingLabel={t("confirm.saving")}>{t("confirm.save")}</SubmitButton>
            <ButtonLink href={FOOD_ROUTES.edit(view.id)} variant="secondary">
              {t("confirm.fix")}
            </ButtonLink>
            {/* Belongs to the form below by its id, not to this one: a button's own name and value are dropped when
                its action is a Server Action, so the stage travels in that form's hidden fields instead. */}
            <Button type="submit" variant="tertiary" form={DISCARD_FORM_ID}>
              {t("confirm.notNow")}
            </Button>
          </div>
        </form>
        <form id={DISCARD_FORM_ID} action={discardAction}>
          <input type="hidden" name={FOOD_FORM.id} value={view.id} />
          <input type="hidden" name={FOOD_FORM.stage} value="confirm" />
        </form>
      </Card>
    </section>
  );
}
