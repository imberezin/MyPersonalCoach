import { Fragment, type ReactElement } from "react";
import type { MealSummaryProps } from "./buildSummary";
import styles from "./meals.module.css";

/**
 * One meal in words: when it was, then what was in it. The block carries the id that a Delete control
 * points at with aria-describedby, so a screen reader hears WHICH meal a button is about. Food names are
 * isolated (<bdi>) so a name in the other script never reorders its neighbours.
 */
export function MealSummary({ summary }: { summary: MealSummaryProps }): ReactElement {
  return (
    <div id={summary.id} className={styles.summary}>
      <p className={styles.when}>{summary.whenText}</p>
      <p className={styles.foods}>
        {summary.foods.map((part, index) =>
          part.kind === "food" ? <bdi key={index}>{part.text}</bdi> : <Fragment key={index}>{part.text}</Fragment>,
        )}
        {summary.moreText !== null ? ` ${summary.moreText}` : null}
        {summary.emptyText}
      </p>
    </div>
  );
}
