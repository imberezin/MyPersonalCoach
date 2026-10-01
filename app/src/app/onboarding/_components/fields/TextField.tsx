"use client";

import { useId } from "react";
import styles from "@/app/onboarding/onboarding.module.css";
import { STEP_ERROR_ID, useStepFormState } from "../StepForm";

interface TextFieldProps {
  name: string;
  label: string;
  /** The limit in characters; the server checks it again, counting code points. */
  maxLength: number;
  multiline?: boolean;
  hint?: string;
  /** Names the field for assistive technology only, when the step title already asks the question. */
  labelHidden?: boolean;
}

/** Free text, always optional. */
export function TextField({ name, label, maxLength, multiline = false, hint, labelHidden = false }: TextFieldProps) {
  const { values, error } = useStepFormState();
  const id = useId();
  const hintId = `${id}-hint`;
  const raw = values[name];
  const invalid = error?.field === name;
  const shared = {
    id,
    name,
    maxLength,
    defaultValue: typeof raw === "string" ? raw : "",
    "aria-invalid": invalid || undefined,
    "aria-describedby": [hint ? hintId : null, invalid ? STEP_ERROR_ID : null].filter(Boolean).join(" ") || undefined,
  };

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={labelHidden ? styles.srOnly : styles.label}>
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={4} className={styles.textarea} />
      ) : (
        <input {...shared} type="text" autoComplete="off" className={styles.input} />
      )}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
