"use client";

import { useEffect, useReducer, useRef, type ReactElement, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/Button";
import { deleteConfirmReducer, focusTargetFor, initialDeleteConfirm, type DeleteConfirmEvent } from "@/components/meals/deleteConfirm";
import type { WeightDeleteFrom } from "@/domain/weight/routes";
import { DeleteWeightPanel } from "./DeleteWeightPanel";

export interface DeleteWeightControlProps {
  entryId: string;
  from: WeightDeleteFrom;
  action: (formData: FormData) => Promise<void>;
  /** The cursor of the list page the person is on, carried as a hidden field so the landing keeps the place. */
  after?: string | null;
  /** The id of the element OUTSIDE the control that describes the weight (list rows). The trigger AND the open panel's group get aria-describedby={describedBy}. */
  describedBy?: string;
  /** Rendered INSIDE the panel (Saved screen). The list passes nothing: its row already shows the weight. */
  summary?: ReactNode;
  /** The id of the element rendered by `summary` (Saved screen). Only the open panel's group gets aria-describedby={summaryId}; the trigger does not (the node does not exist while the panel is closed). */
  summaryId?: string;
}

/**
 * A quiet "Delete" under a weight that opens the confirm panel in the same place. The state only decides open or
 * closed: nothing is sent until the panel's own Delete is pressed, and a reload closes it. The reducer, the focus
 * targets and the Esc rule are the ones of "My meals" (imported, not copied).
 *
 * Focus is moved through this control's own wrapper (the Button and Message primitives take no ref), never
 * through document.activeElement, which Safari and iOS leave on the body after a tap.
 */
export function DeleteWeightControl({ entryId, from, action, after, describedBy, summary, summaryId }: DeleteWeightControlProps): ReactElement {
  const t = useTranslations("weight");
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
        <DeleteWeightPanel
          entryId={entryId}
          from={from}
          after={after}
          action={action}
          describedBy={describedBy ?? summaryId}
          summary={summary}
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
