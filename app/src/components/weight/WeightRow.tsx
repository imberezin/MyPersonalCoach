import type { ReactElement } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { DeleteWeightControl } from "./DeleteWeightControl";
import styles from "./weight.module.css";

/** One saved weight, already in words: the server page formats the day and the number with the person's zone and locale. */
export interface WeightRowData {
  entryId: string;
  dayText: string;
  /** The number as `formatKg` gave it ("118.7"). */
  kgText: string;
  /** The unit next to it ("kg" / the Hebrew unit). */
  unit: string;
  /** The note exactly as typed, or null. */
  note: string | null;
  /** null = no Edit link (weight reporting is switched off). */
  editHref: string | null;
}

export const weightTextId = (entryId: string) => `weight-row-${entryId}`;

/**
 * One row: the day, the weight, the note as typed (plain escaped text in its own direction, so a note in the other
 * script never reorders its neighbours), then a quiet Edit and Delete. The number and the day are the text that the
 * Delete control points at with aria-describedby, so a screen reader hears WHICH weight a button is about.
 */
export function WeightRow({
  row,
  editLabel,
  deleteAction,
  after,
}: {
  row: WeightRowData;
  editLabel: string;
  deleteAction: (formData: FormData) => Promise<void>;
  after: string | null;
}): ReactElement {
  const textId = weightTextId(row.entryId);
  return (
    <li className={styles.row}>
      <div id={textId} className={styles.rowText}>
        <p className={styles.rowWhen}>{row.dayText}</p>
        <p className={styles.rowKg}>
          <bdi dir="ltr">{row.kgText}</bdi> {row.unit}
        </p>
        {row.note !== null ? (
          <p className={styles.rowNote}>
            <bdi dir="auto">{row.note}</bdi>
          </p>
        ) : null}
      </div>
      <div className={styles.rowActions}>
        {row.editHref !== null ? (
          <div>
            <ButtonLink href={row.editHref}>{editLabel}</ButtonLink>
          </div>
        ) : null}
        <DeleteWeightControl key={row.entryId} from="list" entryId={row.entryId} action={deleteAction} after={after} describedBy={textId} />
      </div>
    </li>
  );
}
