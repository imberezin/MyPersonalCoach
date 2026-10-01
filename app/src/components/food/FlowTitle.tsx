"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./food.module.css";

/**
 * The h1 of a flow screen. Each screen is its own page, so the title takes focus when it opens and a
 * screen reader announces where the person is. It is not a control, so it shows no focus ring.
 */
export function FlowTitle({ id, children }: { id?: string; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <h1 id={id} ref={ref} tabIndex={-1} className={styles.title}>
      {children}
    </h1>
  );
}
