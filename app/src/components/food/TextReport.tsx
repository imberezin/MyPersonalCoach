"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent } from "react";
import { useTranslations } from "use-intl";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Message } from "@/components/ui/Message";
import type { AnalyzeFields } from "@/domain/food/analyzeTypes";
import { FOOD_ROUTES } from "@/domain/food/routes";
import { FOOD_LIMITS } from "@/domain/food/types";
import { AnalyzeProblem } from "./AnalyzeProblem";
import { FlowTitle } from "./FlowTitle";
import { ProcessingPanel } from "./ProcessingPanel";
import { createAbortScope } from "./client/abortScope";
import { clearDraft, loadDraft, saveDraft } from "./client/draftStore";
import { createRequestIds } from "./client/requestId";
import { sendAnalyze } from "./client/sendAnalyze";
import { initialTextState, textReducer } from "./client/textReducer";
import styles from "./food.module.css";

const TITLE_ID = "text-title";
const TEXT_ID = "text-input";
const HINT_ID = "text-hint";
const MANUAL_ID = "text-manual-note";
const OFFLINE_ID = "text-offline";
const ERROR_ID = "text-error";
/** After this long the processing panel adds its extra, calm line. */
const SLOW_AFTER_MS = 8_000;

type SendMode = "text" | "manual";

// "Has the page hydrated?": false on the server and during hydration, true afterwards. It lets the saved
// draft be read from the browser exactly once, without a mismatch between the server HTML and the first paint.
const subscribeNever = () => () => {};
const isHydrated = () => true;
const notHydrated = () => false;

/**
 * D3 and its processing state D5. The person types what they ate; the unsent text is kept in the browser
 * (12 hours) so it survives a reload or iOS closing the installed app. Without automatic analysis the same
 * screen saves the words as a list. The phases are the pure textReducer; this component owns the text,
 * the request and the timers.
 */
export function TextReport({ aiAvailable }: { aiAvailable: boolean }) {
  const t = useTranslations("food");
  const router = useRouter();
  const [state, dispatch] = useReducer(textReducer, initialTextState);
  const [text, setText] = useState("");
  const [emptyError, setEmptyError] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  // How the last request was sent, so the problem panel and a retry speak about the right flow.
  const [sentMode, setSentMode] = useState<SendMode>(aiAvailable ? "text" : "manual");
  const [abortScope] = useState(createAbortScope);
  const [requestIds] = useState(() => createRequestIds());

  const textarea = useRef<HTMLTextAreaElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const mountedAt = useRef(0);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusSendNext = useRef(false);

  // Bring back an unsent draft once, as soon as the page is in the browser. This is the house pattern of
  // adjusting state while rendering (see onboarding's StepForm), not an effect that sets state.
  const hydrated = useSyncExternalStore(subscribeNever, isHydrated, notHydrated);
  const [draftChecked, setDraftChecked] = useState(false);
  if (hydrated && !draftChecked) {
    setDraftChecked(true);
    const draft = loadDraft();
    if (draft) {
      setText(draft.text);
      dispatch({ type: "DRAFT_RESTORED" });
    }
  }

  useEffect(() => {
    mountedAt.current = Date.now();
    const onOnline = () => dispatch({ type: "ONLINE" });
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      // Browser Back from D5: stop the request. The typed text stays in the draft.
      abortScope.abort();
      if (slowTimer.current) clearTimeout(slowTimer.current);
    };
  }, [abortScope]);

  // After Cancel the Send button is not rendered yet; focus it as soon as the screen is back at "editing".
  useEffect(() => {
    if (focusSendNext.current && state.phase === "editing") {
      focusSendNext.current = false;
      // The Send button is the first button of the actions.
      actions.current?.querySelector("button")?.focus();
    }
  }, [state.phase]);

  function onTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setText(value);
    saveDraft(value);
    setEmptyError(false);
    setCancelled(false);
    dispatch({ type: "EDIT" });
  }

  async function submit(mode: SendMode, trimmed: string) {
    const signal = abortScope.begin();
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => dispatch({ type: "SLOW" }), SLOW_AFTER_MS);

    const fields: AnalyzeFields = {
      mode,
      text: trimmed,
      requestId: requestIds.idFor(mode, trimmed),
      composedMs: Math.max(0, Math.round(Date.now() - mountedAt.current)),
    };
    const result = await sendAnalyze({ fields, image: null }, { signal });

    // Cancelled or replaced while waiting: whoever did that already moved the screen and the timer.
    if (signal.aborted) return;
    if (slowTimer.current) {
      clearTimeout(slowTimer.current);
      slowTimer.current = null;
    }

    if (result.ok) {
      dispatch({ type: "SUCCESS" });
      clearDraft();
      router.replace(result.redirectTo);
    } else if (result.reason === "quiet_time") {
      // Not a problem to explain: the chooser shows the quiet screen. The draft is kept.
      router.replace(FOOD_ROUTES.chooser);
    } else {
      dispatch({ type: "FAIL", reason: result.reason });
    }
  }

  function start(mode: SendMode, retry: boolean) {
    const trimmed = text.trim();
    if (trimmed === "") {
      setEmptyError(true);
      textarea.current?.focus();
      return;
    }
    const online = navigator.onLine !== false;
    setSentMode(mode);
    setEmptyError(false);
    setCancelled(false);
    dispatch(retry ? { type: "RETRY", online } : { type: "SEND", online });
    if (online) void submit(mode, trimmed);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.phase === "editing") start(aiAvailable ? "text" : "manual", false);
  }

  function cancel() {
    abortScope.abort();
    if (slowTimer.current) {
      clearTimeout(slowTimer.current);
      slowTimer.current = null;
    }
    focusSendNext.current = true;
    setCancelled(true);
    dispatch({ type: "CANCEL" });
  }

  const sending = state.phase === "sending";
  const describedBy = [HINT_ID, aiAvailable ? null : MANUAL_ID, state.phase === "editing" && state.offline ? OFFLINE_ID : null, emptyError ? ERROR_ID : null]
    .filter((id): id is string => id !== null)
    .join(" ");

  return (
    <section aria-labelledby={TITLE_ID} aria-busy={sending} className={styles.screen}>
      <FlowTitle id={TITLE_ID}>{t("text.title")}</FlowTitle>

      {sending ? (
        <ProcessingPanel slow={state.slow} onCancel={cancel} />
      ) : (
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {state.phase === "problem" ? (
            <AnalyzeProblem
              reason={state.reason}
              flow={sentMode === "manual" ? "manual" : "text"}
              onRetry={() => start(sentMode, true)}
              onSaveAsWritten={() => start("manual", true)}
              writeInsteadHref={FOOD_ROUTES.text}
            />
          ) : null}
          {state.phase === "editing" && state.restored ? (
            <Message variant="note" role="status">
              {t("text.draftRestored")}
            </Message>
          ) : null}
          {cancelled && state.phase === "editing" ? (
            <Message variant="note" role="status">
              {t("processing.cancelled")}
            </Message>
          ) : null}

          <div className={styles.field}>
            <textarea
              id={TEXT_ID}
              ref={textarea}
              className={styles.textarea}
              rows={5}
              maxLength={FOOD_LIMITS.textMax}
              dir="auto"
              autoCapitalize="sentences"
              spellCheck
              placeholder={t("text.placeholder")}
              value={text}
              onChange={onTextChange}
              aria-labelledby={TITLE_ID}
              aria-describedby={describedBy}
              aria-invalid={emptyError ? true : undefined}
            />
            <p id={HINT_ID} className={styles.hint}>
              {t("text.hint")}
            </p>
          </div>

          {aiAvailable ? null : (
            <Message variant="note" id={MANUAL_ID}>
              {t("text.manualNote")}
            </Message>
          )}
          {state.phase === "editing" && state.offline ? (
            <Message variant="note" role="status" id={OFFLINE_ID}>
              {t("text.offline")}
            </Message>
          ) : null}
          {emptyError ? (
            <Message variant="attention" role="alert" id={ERROR_ID}>
              {t("text.empty")}
            </Message>
          ) : null}

          {state.phase === "editing" ? (
            <div ref={actions} className={styles.actions}>
              <Button type="submit">{aiAvailable ? t("text.send") : t("text.sendManual")}</Button>
            </div>
          ) : null}

          <div className={styles.back}>
            <ButtonLink href={FOOD_ROUTES.chooser}>{t("common.back")}</ButtonLink>
          </div>
        </form>
      )}
    </section>
  );
}
