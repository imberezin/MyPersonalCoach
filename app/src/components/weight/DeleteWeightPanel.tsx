"use client";

import { useEffect, useId, useRef, type ReactElement, type ReactNode, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "use-intl";
import { SubmitButton } from "@/components/food/SubmitButton";
import { escapeKeeps } from "@/components/meals/deleteConfirm";
import { Button } from "@/components/ui/Button";
import { WEIGHT_DELETE_FIELDS, type WeightDeleteFrom } from "@/domain/weight/routes";
import styles from "./weight.module.css";

/**
 * The two answers. It sits inside the form so it can read the form's pending state, and it copies that
 * state into a ref (in an effect) for the group's Esc handler, which is not inside the form's render.
 */
function Answers({ onKeep, pendingRef }: { onKeep: () => void; pendingRef: RefObject<boolean> }) {
  const t = useTranslations("weight");
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
 * The inline question under a weight: a neutral sand inset, not a dialog and not an alarm. The form posts the delete
 * Server Action (passed in by the page); the page it lands on is chosen by the action.
 */
export function DeleteWeightPanel({
  entryId,
  from,
  after,
  action,
  describedBy,
  summary,
  onKeep,
}: {
  entryId: string;
  from: WeightDeleteFrom;
  /** The cursor of the list page the person is on (a UUID), so the landing keeps the place. Omitted on the Saved screen. */
  after?: string | null;
  action: (formData: FormData) => Promise<void>;
  /** aria-describedby of the group: the list row's text id, or the Saved summary's id. */
  describedBy?: string;
  summary?: ReactNode;
  onKeep: () => void;
}): ReactElement {
  const t = useTranslations("weight");
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
        <input type="hidden" name={WEIGHT_DELETE_FIELDS.entryId} value={entryId} />
        <input type="hidden" name={WEIGHT_DELETE_FIELDS.from} value={from} />
        <input type="hidden" name={WEIGHT_DELETE_FIELDS.after} value={after ?? ""} />
        <Answers onKeep={onKeep} pendingRef={pendingRef} />
      </form>
    </div>
  );
}
