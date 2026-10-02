"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "use-intl";
import { Message } from "@/components/ui/Message";
import type { WeightNotice } from "@/domain/weight/routes";
import styles from "./weight.module.css";

/**
 * The calm line after a delete attempt. It takes focus when it appears, so a screen reader reads it, and the
 * page keys it by a one-shot token, so a second delete in a row is a new instance that is announced again.
 * `Message` takes no ref or tabIndex, so the focusable element is the wrapper around it.
 */
export function WeightsNotice({ notice }: { notice: WeightNotice }) {
  const t = useTranslations("weight");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  // "error" is the one technical state: the delete could not be confirmed. The others are plain information.
  const isError = notice === "error";
  return (
    <div ref={ref} tabIndex={-1} className={styles.notice}>
      <Message variant={isError ? "error" : "note"} role={isError ? "alert" : "status"}>
        {t(`notice.${notice}`)}
      </Message>
    </div>
  );
}
