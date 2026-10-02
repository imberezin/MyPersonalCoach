"use client";

import { Fragment, useActionState, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { FlowTitle } from "@/components/food/FlowTitle";
import { SubmitButton } from "@/components/food/SubmitButton";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Message } from "@/components/ui/Message";
import type { WeightError, WeightFormState, WeightFormValues } from "@/domain/weight/entry";
import { WEIGHT_FORM } from "@/domain/weight/routes";
import { WEIGHT_ENTRY } from "@/domain/weight/types";
import styles from "./weight.module.css";

const TITLE_ID = "weight-title";

type WeightAction = (previous: WeightFormState, formData: FormData) => Promise<WeightFormState>;

export interface DayChoice {
  /** The value the server built ("now", "keep" or a local day key) and will check again. */
  value: string;
  /** The words, built on the server with the person's zone. */
  label: string;
}

type Fields = Pick<WeightFormValues, "weight" | "day" | "note">;

const fieldsOf = (values: WeightFormValues): Fields => ({ weight: values.weight, day: values.day, note: values.note });

/**
 * The weight screen, new and edit: one number, when, an optional note. Server rendered with the first values; a refused
 * save comes back as state with what was typed, so nothing is lost. React resets a form after its action, so after each
 * answer the fields are rebuilt from the values the server sent back (the pattern of the food EditForm). The check step
 * ("is that right?") is the same form with a different primary button: it keeps every field, asks the question once, and
 * only "Yes, it is right" carries `confirmed=1`. Changing the number leaves the step, so a confirmation never covers a
 * number nobody questioned. The component never reads a clock: the days arrive as strings.
 */
export function WeightForm({
  mode,
  id,
  options,
  initial,
  action,
  backHref,
  initialState = null,
}: {
  mode: "new" | "edit";
  id: string;
  options: readonly DayChoice[];
  initial: Fields;
  action: WeightAction;
  /** Where the quiet exit leads: Home for a new weight, the list for an edit. */
  backHref: string;
  /** The answer to start from. Only tests pass it: the page always starts with no answer. */
  initialState?: WeightFormState;
}) {
  const t = useTranslations("weight");
  const tCommon = useTranslations("common");
  const base = useId();
  const [state, formAction] = useActionState<WeightFormState, FormData>(action, initialState);
  const [fields, setFields] = useState<Fields>(() => (initialState ? fieldsOf(initialState.values) : initial));

  // The state-while-rendering pattern: when the server answers, rebuild the fields from its values and remount them,
  // so the form reset that follows an action restores what was typed, not what was first rendered.
  const [seenState, setSeenState] = useState(state);
  const [generation, setGeneration] = useState(0);
  // The question the person has set aside (by fixing the number) is not asked again for the same answer.
  const [dismissed, setDismissed] = useState<WeightFormState>(null);
  if (state !== seenState) {
    setSeenState(state);
    setGeneration((current) => current + 1);
    if (state) setFields(fieldsOf(state.values));
  }

  const errors: readonly WeightError[] = state?.status === "error" ? state.errors : [];
  const checking = state?.status === "check" && dismissed !== state;
  const replies = useRef<HTMLDivElement>(null);
  const weightInput = useRef<HTMLInputElement>(null);
  const focusWeight = useRef(false);

  const weightId = `${base}-weight`;
  const dayId = `${base}-day`;
  const noteId = `${base}-note`;
  const checkId = `${base}-check`;
  const replyId = (index: number) => `${base}-reply-${index}`;
  const describedBy = (field: NonNullable<WeightError["field"]>) => {
    const ids = errors.flatMap((error, index) => (error.field === field ? [replyId(index)] : []));
    return ids.length > 0 ? ids.join(" ") : undefined;
  };

  // A new answer moves focus to what it says, once: the replies after a refused save, the question at the check step.
  useEffect(() => {
    if (generation > 0) replies.current?.focus();
  }, [generation]);

  // After "I'll fix it" the question is gone; focus returns to the number.
  useEffect(() => {
    if (!focusWeight.current || checking) return;
    focusWeight.current = false;
    weightInput.current?.focus();
  }, [checking]);

  function fix() {
    focusWeight.current = true;
    setDismissed(state);
  }

  function changeWeight(value: string) {
    setFields((current) => ({ ...current, weight: value }));
    if (checking) setDismissed(state);
  }

  const errorText = (error: WeightError) =>
    t(`errors.${error.code}`, { min: String(WEIGHT_ENTRY.minKg), max: String(WEIGHT_ENTRY.maxKg) });

  return (
    <form action={formAction} className={styles.form} noValidate>
      <input type="hidden" name={WEIGHT_FORM.id} value={id} />
      {checking ? <input type="hidden" name={WEIGHT_FORM.confirmed} value="1" /> : null}

      <div className={styles.stack}>
        <FlowTitle id={TITLE_ID}>{mode === "edit" ? t("edit.title") : t("entry.title")}</FlowTitle>
        <p className={styles.lead}>{mode === "edit" ? t("edit.lead") : t("entry.lead")}</p>
      </div>

      {errors.length > 0 ? (
        <div ref={replies} tabIndex={-1} className={styles.replies}>
          {errors.map((error, index) => (
            <Message key={index} variant="attention" role="alert" id={replyId(index)}>
              {errorText(error)}
            </Message>
          ))}
        </div>
      ) : null}

      {checking ? (
        <div ref={replies} tabIndex={-1} className={styles.replies}>
          <Message variant="note" role="alert" id={checkId}>
            {t("check.body")}
          </Message>
        </div>
      ) : null}

      <Fragment key={generation}>
        <div className={styles.field}>
          <label htmlFor={weightId} className={styles.label}>
            {t("form.weightLabel")}
          </label>
          <div className={styles.weightRow}>
            {/* No placeholder: an example number reads as a suggested answer. */}
            <input
              ref={weightInput}
              id={weightId}
              name={WEIGHT_FORM.weight}
              type="text"
              inputMode="decimal"
              dir="ltr"
              autoComplete="off"
              className={styles.input}
              value={fields.weight}
              onChange={(event) => changeWeight(event.target.value)}
              aria-invalid={describedBy("weight") ? true : undefined}
              aria-describedby={describedBy("weight") ?? (checking ? checkId : undefined)}
            />
            <span className={styles.unit}>{t("form.unit")}</span>
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor={dayId} className={styles.label}>
            {t("form.dayLabel")}
          </label>
          <select
            id={dayId}
            name={WEIGHT_FORM.day}
            className={styles.select}
            value={fields.day}
            onChange={(event) => setFields((current) => ({ ...current, day: event.target.value }))}
            aria-invalid={describedBy("day") ? true : undefined}
            aria-describedby={describedBy("day")}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor={noteId} className={styles.label}>
            {t("form.noteLabel")}
          </label>
          <input
            id={noteId}
            name={WEIGHT_FORM.note}
            type="text"
            dir="auto"
            autoComplete="off"
            maxLength={WEIGHT_ENTRY.noteMaxCodePoints}
            className={styles.input}
            value={fields.note}
            onChange={(event) => setFields((current) => ({ ...current, note: event.target.value }))}
            aria-invalid={describedBy("note") ? true : undefined}
            aria-describedby={describedBy("note")}
          />
        </div>
      </Fragment>

      <div className={styles.actions}>
        {checking ? (
          <>
            <SubmitButton pendingLabel={t("form.saving")}>{t("check.confirm")}</SubmitButton>
            <Button type="button" variant="secondary" onClick={fix}>
              {t("check.fix")}
            </Button>
          </>
        ) : (
          <SubmitButton pendingLabel={t("form.saving")}>{tCommon("save")}</SubmitButton>
        )}
        <ButtonLink href={backHref}>{mode === "edit" ? t("edit.back") : tCommon("cancel")}</ButtonLink>
      </div>
    </form>
  );
}
