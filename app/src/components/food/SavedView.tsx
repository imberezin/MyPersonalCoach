import type { MealSummaryProps } from "@/components/meals/buildSummary";
import { DeleteMealControl } from "@/components/meals/DeleteMealControl";
import { MealSummary } from "@/components/meals/MealSummary";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Acknowledgement } from "@/domain/firstWeekFlow";
import { getTranslations, type Translator } from "@/i18n/server";
import type { SavedFollowUp } from "@/lib/food/followUp";
import { FlowTitle } from "./FlowTitle";
import styles from "./food.module.css";

const TITLE_ID = "saved-title";

// Where the optional follow-up question will go once the engine can decide one. Every new kind has to be
// rendered here, and the `never` makes the compiler ask for it.
function FollowUp({ followUp }: { followUp: SavedFollowUp }) {
  switch (followUp.kind) {
    case "none":
      return null;
    default: {
      const unhandled: never = followUp.kind;
      return unhandled;
    }
  }
}

// The one calm line under the confirmation. Every new kind has to be written here, and the `never` makes the compiler
// ask for it. The rotating lines are `firstWeek.ack.rotating.<index>`; the very first meal keeps its own B2 line.
function AcknowledgementLine({
  acknowledgement,
  food,
  firstWeek,
}: {
  acknowledgement: Acknowledgement;
  food: Translator;
  firstWeek: Translator;
}) {
  switch (acknowledgement.kind) {
    case "none":
      return null;
    case "first":
      return <p>{food("saved.first")}</p>;
    case "rotating":
      return <p>{firstWeek(`ack.rotating.${acknowledgement.index}`)}</p>;
    default: {
      const unhandled: never = acknowledgement;
      return unhandled;
    }
  }
}

/**
 * D8: the meal was added. One short confirmation, announced on arrival, and at most one more calm line: the warm
 * B2 line for the very first meal, then one rotating line for the first meal of a day (First Week only; the page
 * decides which, from the meal times). No totals, no comparison, nothing to do next. Under "Back" sits a quiet way
 * to delete the meal that was just saved (outside the status block, so the arrival announcement is unchanged); its
 * question repeats the meal, since this screen has no row that shows it.
 */
export async function SavedView({
  acknowledgement,
  followUp,
  deletion,
}: {
  acknowledgement: Acknowledgement;
  followUp: SavedFollowUp;
  /** null -> no delete control (nothing to name). */
  deletion: { entryId: string; summary: MealSummaryProps; action: (formData: FormData) => Promise<void> } | null;
}) {
  const [t, tFirstWeek] = await Promise.all([getTranslations("food"), getTranslations("firstWeek")]);
  return (
    <section aria-labelledby={TITLE_ID} className={styles.screen}>
      <Card>
        <div className={styles.stack}>
          <div role="status" className={styles.stack}>
            <FlowTitle id={TITLE_ID}>{t("saved.title")}</FlowTitle>
            <p>{t("saved.body")}</p>
            <AcknowledgementLine acknowledgement={acknowledgement} food={t} firstWeek={tFirstWeek} />
          </div>
          <FollowUp followUp={followUp} />
          <div className={styles.actions}>
            <ButtonLink href="/" variant="secondary">
              {t("saved.back")}
            </ButtonLink>
            {deletion ? (
              <DeleteMealControl
                entryId={deletion.entryId}
                from="saved"
                action={deletion.action}
                summary={<MealSummary summary={deletion.summary} />}
                summaryId={deletion.summary.id}
              />
            ) : null}
          </div>
        </div>
      </Card>
    </section>
  );
}
