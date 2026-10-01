"use client";

import { useEffect, useReducer, useRef, type ReactElement, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/Button";
import type { MealDeleteFrom } from "@/domain/food/routes";
import { deleteConfirmReducer, focusTargetFor, initialDeleteConfirm, type DeleteConfirmEvent } from "./deleteConfirm";
import { DeleteMealPanel } from "./DeleteMealPanel";

export interface DeleteMealControlProps {
  entryId: string;
  from: MealDeleteFrom;
  action: (formData: FormData) => Promise<void>;
  /** The id of the element OUTSIDE the control that describes the meal (list rows). The trigger AND the open panel's group get aria-describedby={describedBy}. */
  describedBy?: string;
  /** Rendered INSIDE the panel (Saved screen). The list passes nothing: its row already shows the meal. */
  summary?: ReactNode;
  /** The id of the element rendered by `summary` (Saved screen). Only the open panel's group gets aria-describedby={summaryId}; the trigger does not (the node does not exist while the panel is closed). */
  summaryId?: string;
  /** The page size the list shows now (1..6). Carried as a hidden form field so the landing keeps it. Omitted on the Saved screen. */
  pages?: number;
}

/**
 * A quiet "Delete" under a meal that opens the confirm panel in the same place. The state only decides
 * open or closed: nothing is sent until the panel's own Delete is pressed, and a reload closes it.
 *
 * Focus is moved through this control's own wrapper (the Button and Message primitives take no ref), never
 * through document.activeElement, which Safari and iOS leave on the body after a tap.
 */
export function DeleteMealControl({
  entryId,
  from,
  action,
  describedBy,
  summary,
  summaryId,
  pages,
}: DeleteMealControlProps): ReactElement {
  const t = useTranslations("meals");
  const [state, dispatch] = useReducer(deleteConfirmReducer, initialDeleteConfirm);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"panel" | "trigger" | null>(null);

  // After the state change has committed, put focus where the person is looking next. Only a ref is read
  // and cleared here; nothing is set.
  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === null) return;
    const root = rootRef.current;
    const element = target === "panel" ? root?.querySelector("h2") : root?.querySelector("button");
    element?.focus();
  }, [state]);

  const send = (event: DeleteConfirmEvent) => {
    pendingFocus.current = focusTargetFor(event);
    dispatch(event);
  };

  return (
    <div ref={rootRef}>
      {state.phase === "confirming" ? (
        <DeleteMealPanel
          entryId={entryId}
          from={from}
          action={action}
          describedBy={describedBy ?? summaryId}
          summary={summary}
          pages={pages}
          onKeep={() => send({ type: "KEEP" })}
        />
      ) : (
        <Button variant="tertiary" type="button" aria-describedby={describedBy} onClick={() => send({ type: "ASK" })}>
          {t(from === "saved" ? "row.deleteThis" : "row.delete")}
        </Button>
      )}
    </div>
  );
}
