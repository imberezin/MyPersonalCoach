import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import styles from "./pages.module.css";

const INFO_TITLE_ID = "info-title";

/**
 * An honest placeholder for a tab whose content has not been built yet (Progress, Coach, Me): one
 * card that says what will live here, not an empty chart and not a promise of a date.
 */
export function InfoPage({ title, lead, children }: { title: string; lead?: string; children?: ReactNode }) {
  return (
    <section aria-labelledby={INFO_TITLE_ID}>
      <Card>
        <div className={styles.infoBody}>
          <h1 id={INFO_TITLE_ID} className={styles.infoTitle}>
            {title}
          </h1>
          {lead ? <p className={styles.lead}>{lead}</p> : null}
          {children}
        </div>
      </Card>
    </section>
  );
}
