"use client";

import { Fragment, useActionState, useEffect, useId, useReducer, useRef, useState, type MouseEvent } from "react";
import { useTranslations } from "use-intl";
import { Button, ButtonLink } from "@/components/ui/Button";
import {
  EDIT_FORM,
  rowField,
  type EditError,
  type EditFormState,
  type EditFormValues,
} from "@/domain/food/edit";
import { FOOD_FORM } from "@/domain/food/routes";
import { FOOD_LIMITS, MEAL_TYPES, PORTION_SIZES, PORTION_UNITS } from "@/domain/food/types";
import { createEditRows, editRowsReducer, type EditRowField } from "./client/editRows";
import { FlowTitle } from "./FlowTitle";
import { capitalizeFirst } from "./formatPortion";
import styles from "./food.module.css";

const TITLE_ID = "edit-title";

type EditAction = (previous: EditFormState, formData: FormData) => Promise<EditFormState>;
type Meta = Pick<EditFormValues, "mealType" | "day" | "time">;

const metaOf = (values: EditFormValues): Meta => ({ mealType: values.mealType, day: values.day, time: values.time });

/**
 * D7: change anything about the meal. Every food is its own group with a real label; rows can be added
 * and removed; the meal type, day and time are native controls. The page the person sees is server
 * rendered with the saved values, and a refused save comes back as state with what was typed, so nothing
 * is lost. React resets a form after its action, so after each answer the fields are rebuilt from the
 * values the server sent back (the same pattern as onboarding's StepForm).
 */
export function EditForm({
  id,
  initial,
  action,
  backHref,
  initialState = null,
}: {
  id: string;
  initial: EditFormValues;
  action: EditAction;
  backHref: string;
  /** The answer to start from. Only tests pass it: the page always starts with no answer. */
  initialState?: EditFormState;
}) {
  const t = useTranslations("food");
  const base = useId();
  const [state, formAction, pending] = useActionState<EditFormState, FormData>(action, initialState);
  const start = initialState?.values ?? initial;
  const [rows, dispatchRows] = useReducer(editRowsReducer, start.rows, createEditRows);
  const [meta, setMeta] = useState<Meta>(() => metaOf(start));

  // The state-while-rendering pattern: when the server answers, rebuild the fields from its values and
  // remount them, so the form reset that follows an action restores what was typed, not what was first rendered.
  const [seenState, setSeenState] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (state !== seenState) {
    setSeenState(state);
    setGeneration((current) => current + 1);
    if (state) {
      dispatchRows({ type: "reset", rows: state.values.rows });
      setMeta(metaOf(state.values));
    }
  }

  const errors: EditError[] = state?.errors ?? [];
  const summary = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<string | null>(null);

  const rowFieldId = (key: number, field: "name" | "portion" | "amount" | "unit") => `${base}-r${key}-${field}`;
  const metaFieldId = (field: "mealType" | "day" | "time") => `${base}-${field}`;
  const addId = `${base}-add`;

  // A failed save moves focus to the error summary, once per answer.
  useEffect(() => {
    if (generation > 0 && state?.status === "error") summary.current?.focus();
  }, [generation, state]);

  // Focus follows an added or removed row. The target is chosen in the handler; the element exists after the render.
  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    focusTarget.current = null;
    document.getElementById(target)?.focus();
  }, [rows]);

  function addRow() {
    focusTarget.current = rowFieldId(rows.nextKey, "name");
    dispatchRows({ type: "add" });
  }

  function removeRow(key: number, index: number) {
    const previous = rows.rows[index - 1];
    focusTarget.current = previous ? rowFieldId(previous.key, "name") : addId;
    dispatchRows({ type: "remove", key });
  }

  function change(key: number, field: EditRowField, value: string) {
    dispatchRows({ type: "change", key, field, value });
  }

  function errorFor(row: number, field: "name" | "amount" | "unit"): EditError | undefined {
    return errors.find((error) => error.row === row && error.field === field);
  }

  function metaError(field: "mealType" | "day" | "time"): EditError | undefined {
    return errors.find((error) => error.field === field);
  }

  function targetOf(error: EditError): string {
    if (error.row !== undefined && (error.field === "name" || error.field === "amount" || error.field === "unit")) {
      return rowFieldId(error.row, error.field);
    }
    if (error.field === "mealType" || error.field === "day" || error.field === "time") return metaFieldId(error.field);
    // "At least one food" and "too many foods" belong to the list as a whole: the Add button is its handle.
    return addId;
  }

  function focusField(event: MouseEvent<HTMLAnchorElement>, target: string) {
    event.preventDefault();
    (document.getElementById(target) ?? document.getElementById(addId))?.focus();
  }

  const errorText = (error: EditError) => t(`edit.errors.${error.code}`, { max: FOOD_LIMITS.itemsMax });
  const describe = (error: EditError | undefined, fieldId: string) => (error ? `${fieldId}-error` : undefined);

  return (
    <form action={formAction} className={styles.form} noValidate>
      <input type="hidden" name={FOOD_FORM.id} value={id} />
      <input type="hidden" name={EDIT_FORM.rowCount} value={rows.rows.length} />

      <div>
        <FlowTitle id={TITLE_ID}>{t("edit.title")}</FlowTitle>
        <p className={styles.lead}>{t("edit.lead")}</p>
      </div>

      {errors.length > 0 ? (
        <div ref={summary} role="alert" tabIndex={-1} className={styles.errorSummary}>
          <p>{t("edit.errorsTitle")}</p>
          <ul>
            {errors.map((error, index) => {
              const target = targetOf(error);
              return (
                <li key={index}>
                  <a href={`#${target}`} onClick={(event) => focusField(event, target)}>
                    {errorText(error)}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <Fragment key={generation}>
        {rows.rows.map((row, index) => {
          const name = rowFieldId(row.key, "name");
          const portion = rowFieldId(row.key, "portion");
          const amount = rowFieldId(row.key, "amount");
          const unit = rowFieldId(row.key, "unit");
          const nameError = errorFor(row.key, "name");
          const amountError = errorFor(row.key, "amount");
          const unitError = errorFor(row.key, "unit");
          const label = t("edit.foodLabel", { n: index + 1 });

          return (
            <fieldset key={row.key} className={styles.row}>
              <legend className={styles.rowLegend}>{label}</legend>
              <input type="hidden" name={rowField(index, "orig")} value={row.values.orig} />

              <div className={styles.field}>
                <label htmlFor={name} className={styles.srOnly}>
                  {label}
                </label>
                <input
                  id={name}
                  name={rowField(index, "name")}
                  type="text"
                  className={styles.input}
                  dir="auto"
                  autoCapitalize="sentences"
                  value={row.values.name}
                  onChange={(event) => change(row.key, "name", event.target.value)}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={describe(nameError, name)}
                />
                {nameError ? (
                  <p id={`${name}-error`} className={styles.fieldError}>
                    {errorText(nameError)}
                  </p>
                ) : null}
              </div>

              <div className={styles.field}>
                <label htmlFor={portion} className={styles.label}>
                  {t("edit.portion")}
                </label>
                <select
                  id={portion}
                  name={rowField(index, "portion")}
                  className={styles.select}
                  value={row.values.portion}
                  onChange={(event) => change(row.key, "portion", event.target.value)}
                >
                  <option value="">{t("edit.portionNone")}</option>
                  {PORTION_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {capitalizeFirst(t(`portion.size.${size}`))}
                    </option>
                  ))}
                  <option value="amount">{t("edit.portionAmount")}</option>
                </select>
              </div>

              {/* The amount fields exist only while "Exact amount" is chosen, so a stale number is never sent with a size. */}
              {row.values.portion === "amount" ? (
                <div className={styles.rowPair}>
                  <div className={styles.field}>
                    <label htmlFor={amount} className={styles.label}>
                      {t("edit.amount")}
                    </label>
                    <input
                      id={amount}
                      name={rowField(index, "amount")}
                      type="number"
                      inputMode="decimal"
                      step="0.25"
                      className={styles.input}
                      value={row.values.amount}
                      onChange={(event) => change(row.key, "amount", event.target.value)}
                      aria-invalid={amountError ? true : undefined}
                      aria-describedby={describe(amountError, amount)}
                    />
                    {amountError ? (
                      <p id={`${amount}-error`} className={styles.fieldError}>
                        {errorText(amountError)}
                      </p>
                    ) : null}
                  </div>
                  <div className={styles.field}>
                    <label htmlFor={unit} className={styles.label}>
                      {t("edit.unit")}
                    </label>
                    <select
                      id={unit}
                      name={rowField(index, "unit")}
                      className={styles.select}
                      value={row.values.unit}
                      onChange={(event) => change(row.key, "unit", event.target.value)}
                      aria-invalid={unitError ? true : undefined}
                      aria-describedby={describe(unitError, unit)}
                    >
                      <option value="">{t("edit.unitChoose")}</option>
                      {PORTION_UNITS.map((value) => (
                        <option key={value} value={value}>
                          {t(`unitOne.${value}`)}
                        </option>
                      ))}
                    </select>
                    {unitError ? (
                      <p id={`${unit}-error`} className={styles.fieldError}>
                        {errorText(unitError)}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className={styles.rowRemove}>
                <Button
                  type="button"
                  variant="tertiary"
                  aria-label={t("edit.removeFor", { food: row.values.name.trim() || label })}
                  onClick={() => removeRow(row.key, index)}
                >
                  {t("edit.remove")}
                </Button>
              </div>
            </fieldset>
          );
        })}

        <div>
          <Button
            id={addId}
            type="button"
            variant="secondary"
            disabled={rows.rows.length >= EDIT_FORM.maxRows}
            onClick={addRow}
          >
            {t("edit.add")}
          </Button>
        </div>

        <div className={styles.meta}>
          <div className={styles.field}>
            <label htmlFor={metaFieldId("mealType")} className={styles.label}>
              {t("edit.mealType")}
            </label>
            <select
              id={metaFieldId("mealType")}
              name={EDIT_FORM.mealType}
              className={styles.select}
              value={meta.mealType}
              onChange={(event) => setMeta({ ...meta, mealType: event.target.value })}
              aria-invalid={metaError("mealType") ? true : undefined}
              aria-describedby={describe(metaError("mealType"), metaFieldId("mealType"))}
            >
              {MEAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`mealType.${type}`)}
                </option>
              ))}
            </select>
            {metaError("mealType") ? (
              <p id={`${metaFieldId("mealType")}-error`} className={styles.fieldError}>
                {errorText(metaError("mealType") as EditError)}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor={metaFieldId("day")} className={styles.label}>
              {t("edit.day")}
            </label>
            <select
              id={metaFieldId("day")}
              name={EDIT_FORM.day}
              className={styles.select}
              value={meta.day}
              onChange={(event) => setMeta({ ...meta, day: event.target.value })}
              aria-invalid={metaError("day") ? true : undefined}
              aria-describedby={describe(metaError("day"), metaFieldId("day"))}
            >
              <option value="today">{capitalizeFirst(t("day.today"))}</option>
              <option value="yesterday">{capitalizeFirst(t("day.yesterday"))}</option>
            </select>
            {metaError("day") ? (
              <p id={`${metaFieldId("day")}-error`} className={styles.fieldError}>
                {errorText(metaError("day") as EditError)}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor={metaFieldId("time")} className={styles.label}>
              {t("edit.time")}
            </label>
            <input
              id={metaFieldId("time")}
              name={EDIT_FORM.time}
              type="time"
              dir="ltr"
              className={`${styles.input} ${styles.timeInput}`}
              value={meta.time}
              onChange={(event) => setMeta({ ...meta, time: event.target.value })}
              aria-invalid={metaError("time") ? true : undefined}
              aria-describedby={describe(metaError("time"), metaFieldId("time"))}
            />
            {metaError("time") ? (
              <p id={`${metaFieldId("time")}-error`} className={styles.fieldError}>
                {errorText(metaError("time") as EditError)}
              </p>
            ) : null}
          </div>
        </div>
      </Fragment>

      <div className={styles.actions}>
        <Button type="submit" disabled={pending}>
          {pending ? t("edit.saving") : t("edit.save")}
        </Button>
        <ButtonLink href={backHref}>{t("edit.cancel")}</ButtonLink>
      </div>
    </form>
  );
}
