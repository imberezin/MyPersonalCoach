import type { ReactNode } from "react";
import styles from "./food.module.css";

/**
 * The body of the (flow) layout: one centered column, clear of the home indicator, and no navigation.
 * A focus task needs the whole bottom of the screen for the keyboard, the camera sheet and the Save
 * button, so every screen carries its own explicit exits. Chrome only: who may see a screen is decided
 * by the pages, not here (a layout does not re-render on navigation, so it cannot hold a guard).
 */
export function FlowShell({ children }: { children: ReactNode }) {
  return (
    <main className={styles.main}>
      <div className={styles.column}>{children}</div>
    </main>
  );
}
