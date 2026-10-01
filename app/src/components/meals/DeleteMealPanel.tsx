"use client";

import { useEffect, useId, useRef, type ReactElement, type ReactNode, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "use-intl";
import { SubmitButton } from "@/components/food/SubmitButton";
import { Button } from "@/components/ui/Button";
import { MEALS_FORM, type MealDeleteFrom } from "@/domain/food/routes";
import { escapeKeeps } from "./deleteConfirm";
import styles from "./meals.module.css";

/**
 * The two answers. It sits inside the form so it can read the form's pending state, and it copies that
 * state into a ref (in an effect) for the group's Esc handler, which is not inside the form's render.
 */
function Answers({ onKeep, pendingRef }: { onKeep: () => void; pendingRef: RefObject<boolean> }) {
  const t = useTranslations("meals");
  const { pending } = useFormStatus();
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending, pendingRef]);
  return (
    <div className={styles.panelActions}>
      {/* The safe answer is first and primary; Delete is second and quieter. */}
      <Button variant="primary" type="button" disabled={pending} onClick={onKeep}>
        {t("confirm.keep")}
      </Button>
      <SubmitButton variant="secondary" pendingLabel={t("confirm.deleting")}>
        {t("confirm.delete")}
      </SubmitButton>
    </div>
  );
}

/**
 * The inline question under a meal: a neutral sand inset, not a dialog and not an alarm. The form posts the
 * delete Server Action (passed in by the page); the page it lands on is chosen by the action.
 */
export function DeleteMealPanel({
  entryId,
  from,
  action,
  describedBy,
  summary,
  pages,
  onKeep,
}: {
  entryId: string;
  from: MealDeleteFrom;
  action: (formData: FormData) => Promise<void>;
  /** aria-describedby of the group: the list row's summary id, or the Saved summary's id. */
  describedBy?: string;
  summary?: ReactNode;
  pages?: number;
  onKeep: () => void;
}): ReactElement {
  const t = useTranslations("meals");
  const titleId = useId();
  const pendingRef = useRef(false);
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      className={styles.panel}
      onKeyDown={(event) => {
        if (escapeKeeps(event.key, pendingRef.current)) onKeep();
      }}
    >
      <h2 id={titleId} tabIndex={-1} className={styles.panelTitle}>
        {t("confirm.title")}
      </h2>
      <p className={styles.panelBody}>{t("confirm.body")}</p>
      {summary}
      <form action={action} className={styles.panelForm}>
        <input type="hidden" name={MEALS_FORM.entryId} value={entryId} />
        <input type="hidden" name={MEALS_FORM.from} value={from} />
        {pages !== undefined ? <input type="hidden" name={MEALS_FORM.pages} value={pages} /> : null}
        <Answers onKeep={onKeep} pendingRef={pendingRef} />
      </form>
    </div>
  );
}
