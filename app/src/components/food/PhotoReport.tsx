"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "use-intl";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Message } from "@/components/ui/Message";
import type { AnalyzeFields } from "@/domain/food/analyzeTypes";
import { FULL_CROP, cropKey, isFullCrop, type CropRect } from "@/domain/food/crop";
import { PHOTO_CROP } from "@/domain/food/image";
import { FOOD_ROUTES } from "@/domain/food/routes";
import { AnalyzeProblem } from "./AnalyzeProblem";
import { CropFrame } from "./CropFrame";
import { FlowTitle } from "./FlowTitle";
import { ProcessingPanel } from "./ProcessingPanel";
import { createAbortScope } from "./client/abortScope";
import { prepareImage } from "./client/prepareImage";
import { initialPhotoState, photoReducer } from "./client/photoReducer";
import { photoRequestKey } from "./client/photoRequest";
import { createRequestIds } from "./client/requestId";
import { sendAnalyze } from "./client/sendAnalyze";
import styles from "./food.module.css";

const TITLE_ID = "photo-title";
const NOTE_ID = "photo-note";
const HELP_ID = "photo-camera-help";
const CROP_HINT_ID = "photo-crop-hint";
/** After this long the processing panel adds its extra, calm line. */
const SLOW_AFTER_MS = 8_000;

/**
 * The picture for a real crop: cut from the ORIGINAL file, so the chosen part gets all the pixels. When the original cannot
 * be decoded a second time (the browser let go of it, or there is no memory for a second large picture), the same frame is
 * cut from the preview that is already in memory: smaller, but upright and certain, and still the part the person chose.
 */
async function cutFrame(original: Blob, preview: Blob, frame: CropRect): Promise<Blob> {
  try {
    return (await prepareImage(original, {}, { crop: frame })).blob;
  } catch {
    return (await prepareImage(preview, {}, { crop: frame })).blob;
  }
}

interface PreparedPhoto {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

/** The picture on the preview: with or without the crop frame around it it is the same element. */
function PreviewImage({ photo, alt }: { photo: PreparedPhoto; alt: string }) {
  return (
    // A blob: URL of a picture that exists only in this tab; next/image cannot optimize it.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo.url} alt={alt} width={photo.width} height={photo.height} className={styles.previewImage} />
  );
}

/**
 * D2 and its processing state D5. A photo is taken or chosen with the phone's own file input, shrunk in the
 * browser (EXIF and location are dropped by the re-encode), previewed, and sent once. It is held in memory
 * only: it is never stored, so a reload starts at the beginning, calmly. The phases are the pure
 * photoReducer; this component owns the file, the request and the timers.
 *
 * The preview carries a free crop frame (`CropFrame`), for a photo from the camera and from the library alike, since both
 * come through the same handler. The frame starts as the whole picture, so sending untouched is as before. A real crop is cut
 * from the ORIGINAL file (kept in memory with the rest) when Send is pressed, not from the small preview, so the chosen part
 * gets all the pixels; the result is remembered, so a retry sends the very same picture under the very same request id.
 */
export function PhotoReport() {
  const t = useTranslations("food");
  const router = useRouter();
  const [state, dispatch] = useReducer(photoReducer, initialPhotoState);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
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
  /** The file the person picked, in memory only: a real crop is cut from it, not from the small preview. */
  const original = useRef<File | null>(null);
  /** The last cropped picture, for this photo and this frame, so a retry or a second Send re-uses it. */
  const cropped = useRef<{ seq: number; key: string; blob: Blob } | null>(null);
  /** The cut that is running now, so a second Send for the same photo and frame waits for it instead of decoding again. */
  const cutting = useRef<{ seq: number; key: string; promise: Promise<Blob> } | null>(null);
  /** The reset button disappears when it is pressed: the focus goes to Send, so a keyboard user is not left on nothing. */
  const focusAfterReset = useRef(false);
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

  // After "Whole photo" the button that had the focus is gone; the focus goes to the Send button.
  useEffect(() => {
    if (focusAfterReset.current && isFullCrop(crop)) {
      focusAfterReset.current = false;
      actions.current?.querySelector("button")?.focus();
    }
  }, [crop]);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Clear the input so choosing the same photo again still fires a change.
    input.value = "";
    if (!file) return;

    // A new photo starts with the whole picture, and nothing cropped from an earlier one can be sent for it.
    original.current = file;
    cropped.current = null;
    cutting.current = null;
    setCrop(FULL_CROP);
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

  /**
   * The picture to send: the prepared photo as it is when the frame is the whole picture (no second re-encode), otherwise
   * the chosen part cut from the original. The cut is remembered for this photo and this frame, and a cut that is still
   * running is shared, so Send, Cancel, Send never decodes a large picture twice at once. A result is remembered only if the
   * photo on the screen is still the one it was cut from.
   */
  function pictureFor(current: PreparedPhoto, frame: CropRect): Promise<Blob> {
    if (!PHOTO_CROP.enabled || isFullCrop(frame)) return Promise.resolve(current.blob);
    const key = cropKey(frame);
    const seq = photoSeq.current;
    const known = cropped.current;
    if (known && known.seq === seq && known.key === key) return Promise.resolve(known.blob);
    const running = cutting.current;
    if (running && running.seq === seq && running.key === key) return running.promise;
    const source = original.current;
    if (!source) return Promise.resolve(current.blob);
    const promise = cutFrame(source, current.blob, frame)
      .then((blob) => {
        if (photoSeq.current === seq && original.current === source) cropped.current = { seq, key, blob };
        return blob;
      })
      .finally(() => {
        if (cutting.current?.promise === promise) cutting.current = null;
      });
    cutting.current = { seq, key, promise };
    return promise;
  }

  async function submit(current: PreparedPhoto) {
    const signal = abortScope.begin();
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => dispatch({ type: "SLOW" }), SLOW_AFTER_MS);

    // The frame as it is at the moment of Send: a later change cannot alter what this request carries.
    const frame = crop;
    let picture: Blob;
    try {
      picture = await pictureFor(current, frame);
    } catch {
      // The cut itself failed (a picture the browser cannot draw again, or no memory): the same calm panel as an unusable file.
      if (signal.aborted) return;
      if (slowTimer.current) {
        clearTimeout(slowTimer.current);
        slowTimer.current = null;
      }
      dispatch({ type: "FAIL", reason: "unsupported_type" });
      return;
    }
    // Cancelled or replaced while the picture was being cut: whoever did that already moved the screen and the timer.
    if (signal.aborted) return;

    const text = note.trim();
    const fields: AnalyzeFields = {
      mode: "photo",
      text,
      // A different frame is a different picture, so it is a different request; the same frame and note keep the same id.
      requestId: requestIds.idFor("photo", photoRequestKey(photoSeq.current, frame, text)),
      composedMs: Math.max(0, Math.round(Date.now() - mountedAt.current)),
    };
    const result = await sendAnalyze({ fields, image: picture }, { signal });

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
    original.current = null;
    cropped.current = null;
    cutting.current = null;
    setCrop(FULL_CROP);
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
            {PHOTO_CROP.enabled ? (
              <CropFrame
                aspect={photo.width / photo.height}
                crop={crop}
                onChange={setCrop}
                interactive={state.phase === "ready"}
                hintId={CROP_HINT_ID}
              >
                <PreviewImage photo={photo} alt={t("photo.previewAlt")} />
              </CropFrame>
            ) : (
              <PreviewImage photo={photo} alt={t("photo.previewAlt")} />
            )}
          </div>
          {/* The words about the frame are for the moment it can be moved: not while a problem panel is showing. */}
          {PHOTO_CROP.enabled && state.phase === "ready" ? (
            <div className={styles.cropInfo}>
              <p id={CROP_HINT_ID} className={styles.hint} aria-live="polite">
                {isFullCrop(crop) ? t("photo.cropHint") : t("photo.cropActive")}
              </p>
              {!isFullCrop(crop) ? (
                <Button
                  type="button"
                  variant="tertiary"
                  onClick={() => {
                    focusAfterReset.current = true;
                    setCrop(FULL_CROP);
                  }}
                >
                  {t("photo.cropReset")}
                </Button>
              ) : null}
            </div>
          ) : null}
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
