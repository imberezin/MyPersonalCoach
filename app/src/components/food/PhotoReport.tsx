"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "use-intl";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Message } from "@/components/ui/Message";
import type { AnalyzeFields } from "@/domain/food/analyzeTypes";
import { FOOD_ROUTES } from "@/domain/food/routes";
import { AnalyzeProblem } from "./AnalyzeProblem";
import { FlowTitle } from "./FlowTitle";
import { ProcessingPanel } from "./ProcessingPanel";
import { createAbortScope } from "./client/abortScope";
import { prepareImage } from "./client/prepareImage";
import { initialPhotoState, photoReducer } from "./client/photoReducer";
import { createRequestIds } from "./client/requestId";
import { sendAnalyze } from "./client/sendAnalyze";
import styles from "./food.module.css";

const TITLE_ID = "photo-title";
const NOTE_ID = "photo-note";
const HELP_ID = "photo-camera-help";
/** After this long the processing panel adds its extra, calm line. */
const SLOW_AFTER_MS = 8_000;

interface PreparedPhoto {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

/**
 * D2 and its processing state D5. A photo is taken or chosen with the phone's own file input, shrunk in the
 * browser (EXIF and location are dropped by the re-encode), previewed, and sent once. It is held in memory
 * only: it is never stored, so a reload starts at the beginning, calmly. The phases are the pure
 * photoReducer; this component owns the file, the request and the timers.
 */
export function PhotoReport() {
  const t = useTranslations("food");
  const router = useRouter();
  const [state, dispatch] = useReducer(photoReducer, initialPhotoState);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [note, setNote] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [abortScope] = useState(createAbortScope);
  const [requestIds] = useState(() => createRequestIds());

  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const mountedAt = useRef(0);
  /** Counts prepared photos, so a new photo is a new request even when the note is the same. */
  const photoSeq = useRef(0);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusSendNext = useRef(false);

  // Mount: start the "composed in" clock, listen for the connection coming back, and on the way out stop
  // everything that is running (browser Back from D5 leaves the screen; the server may still finish and
  // the chooser's resume card then offers the result).
  useEffect(() => {
    mountedAt.current = Date.now();
    const onOnline = () => dispatch({ type: "ONLINE" });
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      abortScope.abort();
      if (slowTimer.current) clearTimeout(slowTimer.current);
    };
  }, [abortScope]);

  // The preview URL is created in the handler and released here when it is replaced or the screen closes.
  const previewUrl = photo?.url ?? null;
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // After Cancel the Send button is not rendered yet; focus it as soon as the screen is back at "ready".
  useEffect(() => {
    if (focusSendNext.current && state.phase === "ready") {
      focusSendNext.current = false;
      // The Send button is the first button of the actions.
      actions.current?.querySelector("button")?.focus();
    }
  }, [state.phase]);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Clear the input so choosing the same photo again still fires a change.
    input.value = "";
    if (!file) return;

    setPhoto(null);
    setCancelled(false);
    dispatch({ type: "PICK" });
    try {
      const prepared = await prepareImage(file);
      photoSeq.current += 1;
      setPhoto({ ...prepared, url: URL.createObjectURL(prepared.blob) });
      dispatch({ type: "PREPARED" });
    } catch {
      dispatch({ type: "PREPARE_ERROR" });
    }
  }

  async function submit(current: PreparedPhoto) {
    const signal = abortScope.begin();
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => dispatch({ type: "SLOW" }), SLOW_AFTER_MS);

    const text = note.trim();
    const fields: AnalyzeFields = {
      mode: "photo",
      text,
      requestId: requestIds.idFor("photo", `photo:${photoSeq.current}:${text}`),
      composedMs: Math.max(0, Math.round(Date.now() - mountedAt.current)),
    };
    const result = await sendAnalyze({ fields, image: current.blob }, { signal });

    // Cancelled or replaced while waiting: whoever did that already moved the screen and the timer.
    if (signal.aborted) return;
    if (slowTimer.current) {
      clearTimeout(slowTimer.current);
      slowTimer.current = null;
    }

    if (result.ok) {
      dispatch({ type: "SUCCESS" });
      router.replace(result.redirectTo);
    } else if (result.reason === "quiet_time") {
      // Not a problem to explain: the chooser shows the quiet screen.
      router.replace(FOOD_ROUTES.chooser);
    } else {
      dispatch({ type: "FAIL", reason: result.reason });
    }
  }

  function start(retry: boolean) {
    if (!photo) return;
    const online = navigator.onLine !== false;
    setCancelled(false);
    dispatch(retry ? { type: "RETRY", online } : { type: "SEND", online });
    if (online) void submit(photo);
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

  function differentPhoto() {
    setPhoto(null);
    setCancelled(false);
    dispatch({ type: "RESET" });
  }

  const sending = state.phase === "sending";
  const showPhoto = (state.phase === "ready" || state.phase === "problem") && photo !== null;

  return (
    <section aria-labelledby={TITLE_ID} aria-busy={sending} className={styles.screen}>
      <FlowTitle id={TITLE_ID}>{t("photo.title")}</FlowTitle>

      {/* Always in the page, so a change of phase is announced. Visible only while the photo is being prepared. */}
      <p role="status" aria-live="polite" className={state.phase === "preparing" ? styles.text : styles.srOnly}>
        {state.phase === "preparing" ? t("photo.preparing") : state.phase === "ready" ? t("photo.ready") : ""}
      </p>

      {/* The phone's own camera and library. Visually hidden and out of the reading order: the visible
          buttons below are what a person (and a screen reader) meets. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.srOnly}
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFileChange}
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/*"
        className={styles.srOnly}
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFileChange}
      />

      {state.phase === "idle" ? (
        <>
          {state.notice === "unreadable" ? (
            <Message variant="attention" role="status">
              {t("photo.unreadable")}
            </Message>
          ) : null}
          <div className={styles.pickers}>
            <Button type="button" aria-describedby={HELP_ID} onClick={() => cameraInput.current?.click()}>
              {t("photo.take")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => libraryInput.current?.click()}>
              {t("photo.choose")}
            </Button>
          </div>
          <p className={styles.hint}>{t("photo.hint")}</p>
          <p id={HELP_ID} className={styles.hint}>
            {t("photo.cameraHelp")}
          </p>
        </>
      ) : null}

      {sending ? (
        <ProcessingPanel
          slow={state.slow}
          onCancel={cancel}
          onWriteInstead={() => router.push(FOOD_ROUTES.text)}
        />
      ) : null}

      {state.phase === "problem" ? (
        <AnalyzeProblem
          reason={state.reason}
          flow="photo"
          onRetry={() => start(true)}
          writeInsteadHref={FOOD_ROUTES.text}
        />
      ) : null}

      {cancelled && state.phase === "ready" ? (
        <Message variant="note" role="status">
          {t("processing.cancelled")}
        </Message>
      ) : null}

      {showPhoto && photo ? (
        <>
          <div className={styles.previewFrame}>
            {/* A blob: URL of a picture that exists only in this tab; next/image cannot optimize it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={t("photo.previewAlt")}
              width={photo.width}
              height={photo.height}
              className={styles.previewImage}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={NOTE_ID} className={styles.label}>
              {t("photo.noteLabel")}
            </label>
            <textarea
              id={NOTE_ID}
              className={styles.textarea}
              rows={2}
              maxLength={500}
              dir="auto"
              autoCapitalize="sentences"
              placeholder={t("photo.notePlaceholder")}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {state.phase === "ready" && state.offline ? (
            <Message variant="note" role="status">
              {t("photo.offline")}
            </Message>
          ) : null}
          <div ref={actions} className={styles.actions}>
            {state.phase === "ready" ? (
              <Button type="button" onClick={() => start(false)}>
                {t("photo.send")}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={differentPhoto}>
              {t("photo.another")}
            </Button>
          </div>
        </>
      ) : null}

      {state.phase === "idle" || showPhoto ? (
        <div className={styles.back}>
          <ButtonLink href={FOOD_ROUTES.chooser}>{t("common.back")}</ButtonLink>
        </div>
      ) : null}
    </section>
  );
}
