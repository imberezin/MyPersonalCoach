import type { ReactNode } from "react";
import styles from "./ui.module.css";

/** A white surface for information that helps (Brand document section 16), not a report card. */
export function Card({ children }: { children: ReactNode }) {
  return <div className={styles.card}>{children}</div>;
}
