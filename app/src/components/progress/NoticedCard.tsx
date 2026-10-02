import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import type { Translator } from "@/i18n/server";
import type { NoticedFacts } from "@/lib/progress/noticed";
import styles from "./progress.module.css";

const TITLE_ID = "progress-noticed-title";

// The sentence of each kind of observation: the hedged line of the First Week summary, whatever the level. Every new kind
// has to be written here, and the `never` makes the compiler ask for it.
function patternText(kind: NoticedFacts["patterns"][number]["kind"], t: Translator): string {
  switch (kind) {
    case "late_evening_meals":
      return t("noticed.lateEvening");
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

/**
 * What the First Week noticed and the small experiment the person chose, said gently and only when they exist. The loader
 * (loadNoticed) has already kept the noticeable levels and the ACTIVE experiment, so nothing is recomputed here. There is
 * no result question (that is Weekly Learning's) and no number. `experimentText` is already resolved by the page (the
 * stored wording in its own language, otherwise the library's sentence of the current language) and is shown as plain
 * text, never as markup. Absent when there is nothing to say. Pure: no I/O.
 */
export function NoticedCard({
  noticed,
  experimentText,
  t,
}: {
  noticed: NoticedFacts;
  experimentText: string | null;
  /** Scoped to `progress`. */
  t: Translator;
}) {
  const lines: ReactNode[] = noticed.patterns.map((pattern) => <p key={pattern.kind}>{patternText(pattern.kind, t)}</p>);
  if (noticed.activeExperiment !== null && experimentText !== null) {
    lines.push(
      <p key="experiment">{t("noticed.experiment")}</p>,
      <p key="experimentText" className={styles.experimentText}>
        {experimentText}
      </p>,
    );
  }
  if (lines.length === 0) return null;

  return (
    <section aria-labelledby={TITLE_ID}>
      <Card>
        <div className={styles.cardBody}>
          <h2 id={TITLE_ID} className={styles.sectionTitle}>
            {t("noticed.title")}
          </h2>
          {lines}
        </div>
      </Card>
    </section>
  );
}
