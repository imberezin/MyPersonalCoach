import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FlowTitle } from "./FlowTitle";
import styles from "./food.module.css";

/** A calm card with a title, one sentence and one link: the shape of the quiet, unavailable and photo-off screens. */
export function NoticeCard({
  titleId,
  title,
  body,
  href,
  linkLabel,
  children,
}: {
  titleId: string;
  title: string;
  body: string;
  href: string;
  linkLabel: string;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={titleId} className={styles.screen}>
      <Card>
        <div className={styles.stack}>
          <FlowTitle id={titleId}>{title}</FlowTitle>
          <p>{body}</p>
          {children}
          <div className={styles.actions}>
            <ButtonLink href={href} variant="secondary">
              {linkLabel}
            </ButtonLink>
          </div>
        </div>
      </Card>
    </section>
  );
}
