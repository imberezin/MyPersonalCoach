import { FlowTitle } from "@/components/food/FlowTitle";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { WEIGHT_ROUTES } from "@/domain/weight/routes";
import { getTranslations } from "@/i18n/server";
import { DeleteWeightControl } from "./DeleteWeightControl";
import styles from "./weight.module.css";

const TITLE_ID = "weight-saved-title";
const SUMMARY_ID = "weight-saved-summary";

/**
 * The weight, in words: the number the person typed and its day. Plain confirmation, never compared with anything.
 * Used by the Saved line and, again, inside the delete question (this screen has no row that shows the weight).
 */
function WeightLine({ id, kgText, unit, dayText }: { id?: string; kgText: string; unit: string; dayText: string }) {
  return (
    <p id={id} className={styles.saved}>
      <bdi dir="ltr">{kgText}</bdi> {unit} · {dayText}
    </p>
  );
}

/**
 * The weight was added or updated. One short confirmation, announced on arrival, then the day and the number, the
 * one calm line, and the ways on: to Progress, Edit, Back. Under them sits a quiet way to delete the weight that was
 * just saved (outside the status block, so the arrival announcement is unchanged). No total, no change since last
 * time, no emoji.
 */
export async function WeightSavedView({
  entryId,
  kgText,
  unit,
  dayText,
  edited,
  canEdit,
  deleteAction,
}: {
  entryId: string;
  kgText: string;
  unit: string;
  dayText: string;
  /** `?edited=1`: say "updated" instead of "added". */
  edited: boolean;
  /** false while weight reporting is switched off: no Edit link (the edit page would send the person Home). */
  canEdit: boolean;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const t = await getTranslations("weight");
  return (
    <section aria-labelledby={TITLE_ID} className={styles.screen}>
      <Card>
        <div className={styles.stack}>
          <div role="status" className={styles.stack}>
            <FlowTitle id={TITLE_ID}>{t("saved.title")}</FlowTitle>
            <p>{edited ? t("saved.edited") : t("saved.body")}</p>
            <WeightLine kgText={kgText} unit={unit} dayText={dayText} />
            <p>{t("saved.note")}</p>
          </div>
          <div className={styles.actions}>
            <ButtonLink href={WEIGHT_ROUTES.progress} variant="secondary">
              {t("saved.progress")}
            </ButtonLink>
            {canEdit ? <ButtonLink href={WEIGHT_ROUTES.edit(entryId)}>{t("saved.edit")}</ButtonLink> : null}
            <ButtonLink href="/">{t("saved.back")}</ButtonLink>
            <DeleteWeightControl
              entryId={entryId}
              from="saved"
              action={deleteAction}
              summary={<WeightLine id={SUMMARY_ID} kgText={kgText} unit={unit} dayText={dayText} />}
              summaryId={SUMMARY_ID}
            />
          </div>
        </div>
      </Card>
    </section>
  );
}
