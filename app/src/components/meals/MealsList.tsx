"use client";

import type { ReactElement, ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { MealSummaryProps } from "./buildSummary";
import { DeleteMealControl } from "./DeleteMealControl";
import { MealSummary } from "./MealSummary";
import styles from "./meals.module.css";

export interface MealRowData {
  entryId: string;
  summary: MealSummaryProps;
}

/** The labelled list. It is its own component because MealsList takes no hooks (tests call it directly) and the label needs the translator. */
function ListShell({ children }: { children: ReactNode }) {
  const t = useTranslations("meals");
  // role="list": Safari drops the list semantics of a <ul> whose bullets are removed.
  return (
    <ul role="list" aria-label={t("listLabel")} className={styles.list}>
      {children}
    </ul>
  );
}

/**
 * The saved meals, in the order given: one row each with the meal in words and a quiet Delete. Every row
 * and its control are keyed by the ENTRY ID, never the index, because each control owns client state
 * (open or closed): after the list changes, that state must stay with the same meal.
 */
export function MealsList({
  rows,
  deleteAction,
  pages,
}: {
  rows: MealRowData[];
  deleteAction: (formData: FormData) => Promise<void>;
  /** The page size the list shows now (1..6); carried in the delete form so the landing keeps it. */
  pages: number;
}): ReactElement {
  return (
    <ListShell>
      {rows.map((row) => (
        <li key={row.entryId} className={styles.row}>
          <MealSummary summary={row.summary} />
          <DeleteMealControl
            key={row.entryId}
            from="list"
            describedBy={row.summary.id}
            entryId={row.entryId}
            action={deleteAction}
            pages={pages}
          />
        </li>
      ))}
    </ListShell>
  );
}
