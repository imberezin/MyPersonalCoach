"use client";

import { useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { previewShabbat, type ShabbatPreview } from "@/app/onboarding/actions";
import styles from "@/app/onboarding/onboarding.module.css";
import { Chip } from "@/components/ui/Chip";
import { OFFLINE_CHOICES, RANGES } from "@/domain/onboarding";
import { PLACES, getPlace, type Place } from "@/domain/places";
import { ChoiceGroup } from "./fields/ChoiceGroup";
import { STEP_ERROR_ID, useStepFormState } from "./StepForm";

const MINUTE_CHIPS = [18, 20, 30, 40] as const;
const PREVIEW_DELAY_MS = 250;

const asList = (raw: string | string[] | undefined): string[] => (Array.isArray(raw) ? raw : raw ? [raw] : []);
const asText = (raw: string | string[] | undefined): string => (typeof raw === "string" ? raw : "");

/** The minutes the server would use: blank means the place's default; anything else must be a valid whole number. */
function effectiveMinutes(typed: string, place: Place): number | null {
  const text = typed.trim();
  if (text === "") return place.candleDefault;
  if (!/^\d{1,3}$/.test(text)) return null;
  const minutes = Number(text);
  return minutes >= RANGES.candleMinutes.min && minutes <= RANGES.candleMinutes.max ? minutes : null;
}

/**
 * A9: whether and where the person keeps Shabbat. Checking "Shabbat" opens a place list and the
 * candle-lighting minutes with a preview of the next times, so pressing Continue confirms numbers
 * the person has seen. No geolocation (the app's permissions policy blocks it) and no free text:
 * the places come from a curated list.
 */
export function OfflinePlaceField() {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const { values, error } = useStepFormState();
  const placeId = useId();
  const minutesId = useId();

  const [offline, setOffline] = useState<string[]>(() => asList(values.offline));
  const [placeKey, setPlaceKey] = useState(() => asText(values.place));
  const [minutes, setMinutes] = useState(() => asText(values.candle_minutes));
  // Once the person edits the minutes, choosing another place no longer overwrites them.
  const [minutesEdited, setMinutesEdited] = useState(false);
  const [preview, setPreview] = useState<{ key: string; result: ShabbatPreview } | null>(null);

  const place = getPlace(placeKey);
  const shabbatOn = offline.includes("shabbat");
  const targetMinutes = shabbatOn && place ? effectiveMinutes(minutes, place) : null;
  const targetKey = place && targetMinutes !== null ? `${place.key}|${targetMinutes}` : null;

  useEffect(() => {
    if (!shabbatOn || !place || targetMinutes === null) return;
    const request = { placeKey: place.key, candleMinutes: targetMinutes };
    let stale = false;
    // Debounced, and an answer that arrives after the inputs changed again is ignored.
    const timer = setTimeout(() => {
      previewShabbat(request)
        .then((result) => {
          if (!stale) setPreview({ key: `${request.placeKey}|${request.candleMinutes}`, result });
        })
        .catch(() => {
          if (!stale) setPreview(null);
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [shabbatOn, place, targetMinutes]);

  function choosePlace(key: string) {
    setPlaceKey(key);
    const chosen = getPlace(key);
    if (!minutesEdited) setMinutes(chosen ? String(chosen.candleDefault) : "");
  }

  function typeMinutes(value: string) {
    setMinutes(value);
    setMinutesEdited(true);
  }

  const collator = new Intl.Collator(locale);
  const byName = (a: Place, b: Place) => collator.compare(t(`places.${a.key}`), t(`places.${b.key}`));
  const inIsrael = PLACES.filter((p) => p.inIsrael).sort(byName);
  const abroad = PLACES.filter((p) => !p.inIsrael).sort(byName);
  const placeOptions = (places: Place[]) =>
    places.map((p) => (
      <option key={p.key} value={p.key}>
        {t(`places.${p.key}`)}
      </option>
    ));

  const shown = preview?.key === targetKey && preview.result.ok ? preview.result : null;
  const formatTime = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <>
      <ChoiceGroup
        name="offline"
        type="checkbox"
        options={OFFLINE_CHOICES.map((value) => ({ value, label: t(`offline.options.${value}`) }))}
        exclusive={["none"]}
        onChange={setOffline}
      />

      {shabbatOn ? (
        <div className={styles.subBlock}>
          <div className={styles.field}>
            <label htmlFor={placeId} className={styles.label}>
              {t("offline.placeLabel")}
            </label>
            <select
              id={placeId}
              name="place"
              value={placeKey}
              onChange={(event) => choosePlace(event.target.value)}
              aria-invalid={error?.field === "place" || undefined}
              aria-describedby={error?.field === "place" ? STEP_ERROR_ID : undefined}
              className={styles.select}
            >
              <option value="">{t("offline.placeEmpty")}</option>
              <optgroup label={t("offline.groupIsrael")}>{placeOptions(inIsrael)}</optgroup>
              <optgroup label={t("offline.groupAbroad")}>{placeOptions(abroad)}</optgroup>
            </select>
            <p className={styles.hint}>{t("offline.placeHint")}</p>
          </div>

          <div className={styles.field}>
            <label htmlFor={minutesId} className={styles.label}>
              {t("offline.minutesLabel")}
            </label>
            <input
              id={minutesId}
              name="candle_minutes"
              type="text"
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
              value={minutes}
              onChange={(event) => typeMinutes(event.target.value)}
              aria-invalid={error?.field === "candle_minutes" || undefined}
              aria-describedby={error?.field === "candle_minutes" ? STEP_ERROR_ID : undefined}
              className={`${styles.input} ${styles.numberInput}`}
            />
            <div className={styles.chipRow} role="group" aria-label={t("offline.minutesLabel")}>
              {MINUTE_CHIPS.map((value) => (
                <Chip key={value} selected={minutes.trim() === String(value)} onClick={() => typeMinutes(String(value))}>
                  {value}
                </Chip>
              ))}
            </div>
            <p className={styles.hint}>{t("offline.minutesHint")}</p>
          </div>

          <div aria-live="polite">
            {shown ? (
              <p className={styles.preview}>
                <strong>{shown.inProgress ? t("offline.preview.inProgress") : t("offline.preview.label")}</strong>
                {": "}
                {t("offline.preview.candle")}{" "}
                <span className={styles.previewTime}>{formatTime(shown.candleLightingIso, shown.timezone)}</span>
                {", "}
                {t("offline.preview.havdalah")}{" "}
                <span className={styles.previewTime}>{formatTime(shown.havdalahIso, shown.timezone)}</span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {offline.includes("other") ? <p className={styles.hint}>{t("offline.otherNote")}</p> : null}
    </>
  );
}
