import type { MealSummaryProps } from "@/components/meals/buildSummary";
import { DeleteMealControl } from "@/components/meals/DeleteMealControl";
import { MealSummary } from "@/components/meals/MealSummary";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getTranslations } from "@/i18n/server";
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

/**
 * D8: the meal was added. One short confirmation, announced on arrival, and for the very first meal one
 * warm line. No totals, no comparison, nothing to do next. Under "Back" sits a quiet way to delete the meal
 * that was just saved (outside the status block, so the arrival announcement is unchanged); its question
 * repeats the meal, since this screen has no row that shows it.
 */
export async function SavedView({
  firstReport,
  followUp,
  deletion,
}: {
  firstReport: boolean;
  followUp: SavedFollowUp;
  /** null -> no delete control (nothing to name). */
  deletion: { entryId: string; summary: MealSummaryProps; action: (formData: FormData) => Promise<void> } | null;
}) {
  const t = await getTranslations("food");
  return (
    <section aria-labelledby={TITLE_ID} className={styles.screen}>
      <Card>
        <div className={styles.stack}>
          <div role="status" className={styles.stack}>
            <FlowTitle id={TITLE_ID}>{t("saved.title")}</FlowTitle>
            <p>{t("saved.body")}</p>
            {firstReport ? <p>{t("saved.first")}</p> : null}
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
