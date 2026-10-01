"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "use-intl";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { ProblemReason } from "@/domain/food/analyzeTypes";
import { FOOD_ROUTES } from "@/domain/food/routes";
import { PHOTO_BODY_REASONS, problemActionsFor, type ProblemAction, type ProblemFlow } from "./client/problemActions";
import styles from "./food.module.css";

interface AnalyzeProblemProps {
  reason: ProblemReason;
  flow: ProblemFlow;
  onRetry: () => void;
  onSaveAsWritten?: () => void;
  /** Where "Write instead" goes: the writing screen. */
  writeInsteadHref: string;
}

/**
 * Something did not work, said calmly and with the next step: never an error wall. The reason decides
 * the words and the buttons (problemActionsFor, in display order: the first is the primary one). Only
 * a technical save problem is an alert; the rest are information, not alarms. The heading takes focus.
 */
export function AnalyzeProblem({ reason, flow, onRetry, onSaveAsWritten, writeInsteadHref }: AnalyzeProblemProps) {
  const t = useTranslations("food");
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const bodyKey = flow === "photo" && PHOTO_BODY_REASONS.includes(reason) ? "bodyPhoto" : "body";
  const technical = reason === "save_error";
  // A handler that is missing removes its button instead of leaving one that does nothing.
  const actions = problemActionsFor(reason, flow).filter((action) => action !== "saveAsWritten" || onSaveAsWritten);

  return (
    <div
      role={technical ? "alert" : "status"}
      className={technical ? `${styles.problem} ${styles.problemTechnical}` : styles.problem}
    >
      <h2 ref={headingRef} tabIndex={-1} className={styles.problemTitle}>
        {t(`problem.${reason}.title`)}
      </h2>
      <p>{t(`problem.${reason}.${bodyKey}`)}</p>
      <div className={styles.problemActions}>
        {actions.map((action, index) => (
          <ProblemButton
            key={action}
            action={action}
            primary={index === 0}
            label={t(`problem.action.${action}`)}
            onRetry={onRetry}
            onSaveAsWritten={onSaveAsWritten}
            writeInsteadHref={writeInsteadHref}
          />
        ))}
      </div>
    </div>
  );
}

function ProblemButton({
  action,
  primary,
  label,
  onRetry,
  onSaveAsWritten,
  writeInsteadHref,
}: {
  action: ProblemAction;
  primary: boolean;
  label: string;
  onRetry: () => void;
  onSaveAsWritten?: () => void;
  writeInsteadHref: string;
}) {
  const variant = primary ? "primary" : "secondary";
  switch (action) {
    case "retry":
      return (
        <Button type="button" variant={variant} onClick={onRetry}>
          {label}
        </Button>
      );
    case "saveAsWritten":
      return (
        <Button type="button" variant={variant} onClick={onSaveAsWritten}>
          {label}
        </Button>
      );
    case "writeInstead":
      return (
        <ButtonLink href={writeInsteadHref} variant={variant}>
          {label}
        </ButtonLink>
      );
    case "checkPending":
      // The server may have finished after the answer was lost; the chooser's resume card shows the report.
      return (
        <ButtonLink href={FOOD_ROUTES.chooser} variant={variant}>
          {label}
        </ButtonLink>
      );
    case "goHome":
      return (
        <ButtonLink href="/" variant={variant}>
          {label}
        </ButtonLink>
      );
    case "signIn":
      return (
        <ButtonLink href="/login" variant={variant}>
          {label}
        </ButtonLink>
      );
  }
}
