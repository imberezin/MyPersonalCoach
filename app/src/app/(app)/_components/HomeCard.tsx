import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Message } from "@/components/ui/Message";
import type { HomeCopy } from "./homeCopy";
import styles from "./pages.module.css";

/** The heading's id, so the section is named by it (aria-labelledby). */
export const HOME_TITLE_ID = "home-title";

/**
 * Home is one card: a heading, a sentence, and (only when the decision has one) an invitation with
 * its single button, or the three answers of the Early Signal card (an action without an invitation).
 * No second card, no counters, no percentages, no day numbers. When something could not be loaded, one
 * calm note sits under the card.
 */
export function HomeCard({ copy, action }: { copy: HomeCopy; action: ReactNode | null }) {
  return (
    <section aria-labelledby={HOME_TITLE_ID} className={styles.home}>
      <Card>
        <div className={styles.homeBody}>
          {copy.emoji ? (
            <span className={styles.emoji} aria-hidden="true">
              {copy.emoji}
            </span>
          ) : null}
          <h1 id={HOME_TITLE_ID} className={styles.homeTitle}>
            {copy.title}
          </h1>
          {copy.lead ? <p className={styles.homeLead}>{copy.lead}</p> : null}
          <p className={styles.homeText}>{copy.body}</p>
          {copy.invitation || action ? (
            <div className={styles.invitation}>
              {copy.invitation?.lead ? <p className={styles.lead}>{copy.invitation.lead}</p> : null}
              {action}
            </div>
          ) : null}
        </div>
      </Card>
      {copy.degradedNote ? (
        <Message variant="note" role="status">
          {copy.degradedNote}
        </Message>
      ) : null}
    </section>
  );
}
