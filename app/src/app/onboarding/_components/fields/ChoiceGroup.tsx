"use client";

import { useState } from "react";
import styles from "@/app/onboarding/onboarding.module.css";
import { STEP_ERROR_ID, STEP_TITLE_ID, useStepFormState } from "../StepForm";

interface ChoiceGroupProps {
  name: string;
  type: "checkbox" | "radio";
  options: { value: string; label: string }[];
  /** Checkbox values that stand alone: choosing one clears the others, and choosing another clears it. */
  exclusive?: string[];
  /** Lets a sibling (A9's place picker) react to the current selection. */
  onChange?: (selected: string[]) => void;
}

const asList = (raw: string | string[] | undefined): string[] => (Array.isArray(raw) ? raw : raw ? [raw] : []);

/**
 * Checkboxes or radios as tappable rows. The title of the step names the group. Selection is held
 * in state, so the rule "this one excludes the rest" works at once; the server enforces it too.
 */
export function ChoiceGroup({ name, type, options, exclusive = [], onChange }: ChoiceGroupProps) {
  const { values, error } = useStepFormState();
  const [selected, setSelected] = useState<string[]>(() => asList(values[name]));

  function update(value: string, checked: boolean) {
    let next: string[];
    if (type === "radio") next = [value];
    else if (!checked) next = selected.filter((v) => v !== value);
    else if (exclusive.includes(value)) next = [value];
    else next = [...selected.filter((v) => !exclusive.includes(v)), value];
    setSelected(next);
    onChange?.(next);
  }

  return (
    <fieldset
      className={styles.choices}
      aria-labelledby={STEP_TITLE_ID}
      aria-describedby={error?.field === name ? STEP_ERROR_ID : undefined}
    >
      {options.map((option) => (
        <label key={option.value} className={styles.choice}>
          <input
            type={type}
            name={name}
            value={option.value}
            checked={selected.includes(option.value)}
            onChange={(event) => update(option.value, event.target.checked)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
