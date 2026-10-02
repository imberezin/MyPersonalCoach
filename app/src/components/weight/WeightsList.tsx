import type { ReactElement } from "react";
import { WeightRow, type WeightRowData } from "./WeightRow";
import styles from "./weight.module.css";

export type { WeightRowData };

/**
 * The saved weights, in the order given. Every row and its control are keyed by the ENTRY ID, never the index, because
 * each control owns client state (open or closed): after the list changes, that state must stay with the same weight.
 * The list is labelled and carries role="list": Safari drops the list semantics of a <ul> whose bullets are removed.
 */
export function WeightsList({
  rows,
  label,
  editLabel,
  deleteAction,
  after,
}: {
  rows: readonly WeightRowData[];
  /** The accessible name of the list. */
  label: string;
  editLabel: string;
  deleteAction: (formData: FormData) => Promise<void>;
  /** The cursor of the page shown now (a UUID), carried in every delete form so the landing keeps the place. */
  after: string | null;
}): ReactElement {
  return (
    <ul role="list" aria-label={label} className={styles.list}>
      {rows.map((row) => (
        <WeightRow key={row.entryId} row={row} editLabel={editLabel} deleteAction={deleteAction} after={after} />
      ))}
    </ul>
  );
}
