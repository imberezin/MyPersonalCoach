"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/Button";
import { restoreFocusTarget } from "./navModel";
import { REPORT_OPTIONS, type ReportOption } from "./reportOptions";
import styles from "./reportSheet.module.css";

export const REPORT_SHEET_ID = "report-sheet";
/** The Report button in the bar: where focus lands when the sheet closes and the opener is gone. */
export const REPORT_NAV_BUTTON_ID = "report-nav-button";
export const REPORT_SHEET_NOTE_ID = "report-sheet-note";
const REPORT_SHEET_TITLE_ID = "report-sheet-title";

export interface ReportSheetApi {
  isOpen: boolean;
  /** `opener` is the element that was activated (`event.currentTarget`). Callers always pass it: never infer it from `document.activeElement`. */
  open: (opener?: HTMLElement | null) => void;
  close: () => void;
}

const ReportSheetContext = createContext<ReportSheetApi | null>(null);

export function useReportSheet(): ReportSheetApi {
  const api = useContext(ReportSheetContext);
  if (api === null) throw new Error("useReportSheet must be used inside <ReportSheetProvider>");
  return api;
}

function OptionList({ options }: { options: readonly ReportOption[] }) {
  const t = useTranslations("report.sheet.options");
  return (
    <ul role="list" className={styles.list}>
      {options.map((option) => {
        const content = (
          <>
            <span className={styles.emoji} aria-hidden="true">
              {option.emoji}
            </span>
            <span>{t(option.id)}</span>
          </>
        );
        // A row without a flow is plain text, not a disabled button: a disabled control reads as broken,
        // a quiet row plus one sentence (the note) is honest.
        return option.href === null ? (
          <li key={option.id} className={styles.option}>
            {content}
          </li>
        ) : (
          <li key={option.id}>
            <Link href={option.href} className={styles.optionLink}>
              {content}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The Report bottom sheet and the state that opens it. It renders its children and, next to them, a
 * native modal <dialog>: the browser makes the rest of the page inert, keeps focus inside, and closes
 * on Esc. `options` exists so tests can render a row that is already a link.
 */
export function ReportSheetProvider({
  children,
  options = REPORT_OPTIONS,
}: {
  children: ReactNode;
  options?: readonly ReportOption[];
}): JSX.Element {
  const t = useTranslations("report.sheet");
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Leaving the page closes the sheet. State is adjusted while rendering (the pattern StepForm uses),
  // because setting it in an effect trips react-hooks/set-state-in-effect.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setIsOpen(false);
  }

  const open = useCallback((opener?: HTMLElement | null) => {
    openerRef.current = opener ?? null;
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const api = useMemo<ReportSheetApi>(() => ({ isOpen, open, close }), [isOpen, open, close]);

  // State -> dialog. These effects only touch the DOM. `showModal()` throws on a dialog that is
  // already open (StrictMode runs effects twice), hence the guards.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      if (!dialog.open) dialog.showModal();
      // The title takes focus, so a screen reader reads it first.
      titleRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // The page behind must not scroll while the sheet is open.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  // Dialog -> state. The dialog fires `close` however it was closed (Esc, the button, the backdrop,
  // the effect above), so this runs once per close and must be safe to repeat. The opener comes from
  // the click event: Safari and iOS do not focus a tapped button, so document.activeElement would be
  // the body there.
  function handleClose() {
    setIsOpen(false);
    restoreFocusTarget<HTMLElement>(openerRef.current, document.getElementById(REPORT_NAV_BUTTON_ID), [
      document.body,
      document.documentElement,
    ])?.focus();
    openerRef.current = null;
  }

  const noteRendered = options.some((option) => option.href === null);
  const categories = options.filter((option) => option.group === "category");
  const inputs = options.filter((option) => option.group === "input");

  return (
    <ReportSheetContext.Provider value={api}>
      {children}
      <dialog
        ref={dialogRef}
        id={REPORT_SHEET_ID}
        className={styles.sheet}
        aria-labelledby={REPORT_SHEET_TITLE_ID}
        aria-describedby={noteRendered ? REPORT_SHEET_NOTE_ID : undefined}
        onClose={handleClose}
        // The panel fills the dialog, so a click that lands on the dialog itself is a click on the backdrop.
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className={styles.panel}>
          <h2 id={REPORT_SHEET_TITLE_ID} ref={titleRef} tabIndex={-1} className={styles.title}>
            {t("title")}
          </h2>
          {noteRendered ? (
            <p id={REPORT_SHEET_NOTE_ID} className={styles.note}>
              {t("note")}
            </p>
          ) : null}
          {categories.length > 0 ? <OptionList options={categories} /> : null}
          {inputs.length > 0 ? (
            <>
              <p className={styles.orSimply}>{t("orSimply")}</p>
              <OptionList options={inputs} />
            </>
          ) : null}
          <div className={styles.actions}>
            <Button type="button" variant="tertiary" onClick={close}>
              {t("close")}
            </Button>
          </div>
        </div>
      </dialog>
    </ReportSheetContext.Provider>
  );
}
