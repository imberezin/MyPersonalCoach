"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/Button";
import styles from "./food.module.css";

/**
 * D5: "Trying to understand what you ate...". The live region is in the page from the moment Send is
 * pressed (a region injected later is skipped by some screen readers); after a while the same region
 * gets one more calm line. The heading takes focus so the new state is announced once. Cancel is always there.
 */
export function ProcessingPanel({
  slow,
  onCancel,
  onWriteInstead,
}: {
  slow: boolean;
  onCancel: () => void;
  onWriteInstead?: () => void;
}) {
  const t = useTranslations("food");
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className={styles.processing}>
      <div role="status" aria-live="polite" className={styles.stack}>
        <h2 ref={headingRef} tabIndex={-1} className={styles.processingTitle}>
          <span className={styles.dot} aria-hidden="true" />
          {t("processing.title")}
        </h2>
        {/* "Write instead" is offered on the photo screen only; on the text screen the person has already written. */}
        {slow ? <p>{onWriteInstead ? t("processing.slow") : t("processing.slowText")}</p> : null}
      </div>
      <div className={styles.actions}>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("processing.cancel")}
        </Button>
        {slow && onWriteInstead ? (
          <Button type="button" variant="tertiary" onClick={onWriteInstead}>
            {t("problem.action.writeInstead")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
