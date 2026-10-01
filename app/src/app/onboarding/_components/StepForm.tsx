"use client";

import { Fragment, createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { submitStep, type StepFormState } from "@/app/onboarding/actions";
import styles from "@/app/onboarding/onboarding.module.css";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Message } from "@/components/ui/Message";
import { rangeForField, type RawFields, type StepError, type StepErrorCode, type StepId } from "@/domain/onboarding";

/** The step title's id, so fields without a visible label can be named by it (aria-labelledby). */
export const STEP_TITLE_ID = "step-title";
/** The error line's id, so an invalid field can point at it (aria-describedby). */
export const STEP_ERROR_ID = "step-error";

interface StepFormContextValue {
  values: RawFields;
  error: StepError | null;
  pending: boolean;
}

const StepFormContext = createContext<StepFormContextValue | null>(null);

/**
 * What the fields need from the form: the values to show (the saved answers, or the ones the person
 * typed when a save was refused, because React resets the form after an action), the error, and
 * whether a save is running.
 */
export function useStepFormState(): StepFormContextValue {
  const context = useContext(StepFormContext);
  if (context === null) throw new Error("useStepFormState must be used inside <StepForm>");
  return context;
}

export interface StepFormProps {
  step: StepId;
  initial: RawFields;
  skippable: boolean;
  backHref: string | null;
  /** Extra hidden inputs, for example { phase: "device" }. */
  hidden?: Record<string, string>;
  /** A key in the onboarding namespace. Without it the button says "Continue". */
  primaryLabelKey?: string;
  /**
   * A second way forward that answers "no" (A4). It renders after Continue in the DOM, so Enter in a
   * text field is always Continue; leadKey is the short word between the two ("or").
   */
  decline?: { leadKey: string; labelKey: string };
  children: ReactNode;
}

/** The props every step component takes from the screen. */
export type StepBaseProps = Pick<StepFormProps, "initial" | "skippable" | "backHref">;

/** The h1 of a step. It takes focus when the step opens, so a screen reader announces the new question. */
export function StepTitle({ children }: { children: ReactNode }) {
  return (
    <h1 id={STEP_TITLE_ID} tabIndex={-1} className={styles.title}>
      {children}
    </h1>
  );
}

// Technical problems use the Error palette; everything the person can fix by typing is Attention.
const TECHNICAL_ERRORS: ReadonlySet<StepErrorCode> = new Set([
  "save_error",
  "unauthenticated",
  "not_configured",
  "profile_missing",
  "step_not_available",
]);

export function StepForm({
  step,
  initial,
  skippable,
  backHref,
  hidden,
  primaryLabelKey,
  decline,
  children,
}: StepFormProps) {
  const t = useTranslations("onboarding");
  const tCommon = useTranslations("common");
  const [state, formAction, pending] = useActionState<StepFormState, FormData>(submitStep, null);
  const formRef = useRef<HTMLFormElement>(null);

  // React resets the form after every action. A controlled field (a checkbox, a select) goes back to
  // the value it was first rendered with, while its state still holds what the person chose, so the
  // screen and the data disagree (A9 lost the "Shabbat" tick after a missing place). Remounting the
  // fields on each answer from the server makes the typed values their first render, which is what
  // the reset restores. This is React's documented "adjust state while rendering" pattern.
  const [seenState, setSeenState] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (state !== seenState) {
    setSeenState(state);
    setGeneration((current) => current + 1);
  }

  // The step title takes focus when the step opens, and again after an answer replaced the fields.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [generation]);

  const error = state?.error ?? null;
  const context: StepFormContextValue = { values: state?.values ?? initial, error, pending };

  return (
    <form ref={formRef} action={formAction} className={styles.form}>
      <input type="hidden" name="step" value={step} />
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <StepFormContext.Provider value={context}>
        <Fragment key={generation}>{children}</Fragment>
      </StepFormContext.Provider>

      {error ? (
        <Message variant={TECHNICAL_ERRORS.has(error.code) ? "error" : "attention"} role="alert" id={STEP_ERROR_ID}>
          {errorText(error, t)}
        </Message>
      ) : null}

      <div className={styles.actions}>
        <Button type="submit" name="intent" value="continue" disabled={pending}>
          {pending ? t("common.saving") : primaryLabelKey ? t(primaryLabelKey) : tCommon("continue")}
        </Button>
        {decline ? (
          <>
            <p className={styles.or}>{t(decline.leadKey)}</p>
            <Button type="submit" name="intent" value="decline" variant="secondary" disabled={pending}>
              {t(decline.labelKey)}
            </Button>
          </>
        ) : null}
        {skippable ? (
          <Button type="submit" name="intent" value="skip" variant="tertiary" disabled={pending}>
            {t("common.skip")}
          </Button>
        ) : null}
        {backHref ? (
          <div className={styles.back}>
            <ButtonLink href={backHref}>{t("common.back")}</ButtonLink>
          </div>
        ) : null}
      </div>
    </form>
  );
}

function errorText(error: StepError, t: (key: string, values?: Record<string, number>) => string): string {
  if (error.code === "out_of_range") {
    const range = error.field ? rangeForField(error.field) : null;
    // Only numeric fields have a range; anything else falls back to the plain "numbers only" line.
    return range ? t("errors.out_of_range", { min: range.min, max: range.max }) : t("errors.invalid_number");
  }
  return t(`errors.${error.code}`);
}
