"use client";

import { useId } from "react";
import styles from "@/app/onboarding/onboarding.module.css";
import { STEP_ERROR_ID, useStepFormState } from "../StepForm";

interface NumberFieldProps {
  name: string;
  label: string;
  unit?: string;
  inputMode: "decimal" | "numeric";
  hint?: string;
  /** Names the field for assistive technology only, when the step title already asks the question. */
  labelHidden?: boolean;
}

/**
 * A number typed as text, so "99,5" and "99.5" both reach the server, which does the parsing and
 * the range check. No placeholder: an example number reads as a suggested answer.
 */
export function NumberField({ name, label, unit, inputMode, hint, labelHidden = false }: NumberFieldProps) {
  const { values, error } = useStepFormState();
  const id = useId();
  const hintId = `${id}-hint`;
  const raw = values[name];
  const invalid = error?.field === name;
  const describedBy = [hint ? hintId : null, invalid ? STEP_ERROR_ID : null].filter(Boolean).join(" ");

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={labelHidden ? styles.srOnly : styles.label}>
        {label}
      </label>
      <div className={styles.inputRow}>
        <input
          id={id}
          name={name}
          type="text"
          inputMode={inputMode}
          dir="ltr"
          autoComplete="off"
          defaultValue={typeof raw === "string" ? raw : ""}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
          className={`${styles.input} ${styles.numberInput}`}
        />
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </div>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
