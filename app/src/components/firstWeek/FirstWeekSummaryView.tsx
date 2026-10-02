import type { ReactNode } from "react";
import { FlowTitle } from "@/components/food/FlowTitle";
import { SubmitButton } from "@/components/food/SubmitButton";
import { Card } from "@/components/ui/Card";
import { Message } from "@/components/ui/Message";
import { FIRST_WEEK_SNOOZE, type DidLine, type FirstWeekSummary, type NoticedItem } from "@/domain/firstWeekFlow";
import { getTranslations, type Translator } from "@/i18n/server";
import type { OpenExperiment } from "@/lib/experiments/repo";
import { FirstWeekNext } from "./FirstWeekNext";
import styles from "./firstWeek.module.css";

const TITLE_ID = "first-week-title";

// The text of each line. Every new kind has to be written here, and the `never` makes the compiler ask for it.
function didText(line: DidLine, t: Translator): string {
  switch (line.kind) {
    case "MEALS":
      return t("summary.did.meals");
    case "NO_MEALS":
      return t("summary.did.none");
    case "EXPERIMENT":
      return t("summary.did.experiment");
    default: {
      const unhandled: never = line;
      return unhandled;
    }
  }
}

function noticedText(item: NoticedItem, t: Translator): string {
  switch (item.kind) {
    case "LATE_EVENING_MEALS":
      return t("summary.noticed.lateEvening");
    default: {
      const unhandled: never = item.kind;
      return unhandled;
    }
  }
}

/** One titled part of the page: a section named by its own h2. */
function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={styles.part}>
      <h2 id={id} className={styles.partTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * "Why we started": what the person said at the start, in the app's own gentle wording (never a number, never the
 * weight target), their own words quoted when they wrote some, and one sentence that ties what is learned about their
 * eating to the change they want. It claims nothing about how things are going. Absent when they said nothing.
 */
function Why({ why, t }: { why: FirstWeekSummary["why"]; t: Translator }) {
  switch (why.kind) {
    case "NONE":
      return null;
    case "SOME": {
      const stated = why.focus.length > 0 || why.notSure || why.motivation !== null;
      return (
        <Part id="first-week-why" title={t("summary.why.title")}>
          {why.focus.length > 0 ? (
            <>
              <p>{t("summary.why.goalsLead")}</p>
              <ul className={styles.goals}>
                {why.focus.map((goal) => (
                  <li key={goal}>{t(`summary.why.focus.${goal}`)}</li>
                ))}
              </ul>
            </>
          ) : null}
          {why.notSure ? <p>{t("summary.why.notSure")}</p> : null}
          {!stated ? <p>{t("summary.why.goalSet")}</p> : null}
          {why.motivation !== null ? (
            <>
              <p>{t("summary.why.motivationLead")}</p>
              <p dir="auto" data-user-text="" className={styles.userText}>
                {why.motivation}
              </p>
            </>
          ) : null}
          <p>{t(why.notSure ? "summary.why.linkNotSure" : "summary.why.link")}</p>
        </Part>
      );
    }
    default: {
      const unhandled: never = why;
      return unhandled;
    }
  }
}

/**
 * B6, the First Week summary: what the person said at the start, what they did, what was noticed, one meaningful
 * moment, and what comes next. Every line is true or absent, and there is NO number anywhere: a line says that
 * something happened, never how many times. The one exception is the person's own words from onboarding, shown as
 * plain escaped text in an element of its own (`data-user-text`), already shortened by the domain. The weight target
 * is never shown.
 *
 * Two real forms, both working without JavaScript: "Let's continue" (the one-way step, said plainly under the
 * button) and "Not now" (hides the Home card for a day). The actions are passed in so a test can stub them.
 */
export async function FirstWeekSummaryView({
  summary,
  failed,
  finishAction,
  snoozeAction,
  proposeAction,
  experiment,
}: {
  summary: FirstWeekSummary;
  /** `?failed=1`: a write did not go through. */
  failed: boolean;
  finishAction: () => Promise<void>;
  snoozeAction: (formData: FormData) => Promise<void>;
  proposeAction: () => Promise<void>;
  /** The open experiment, and the text of an ACTIVE one already resolved to the current locale. */
  experiment: { open: OpenExperiment | null; text: string | null };
}) {
  const [t, tCommon] = await Promise.all([getTranslations("firstWeek"), getTranslations("common")]);
  // Only the tone with data behind it may say "we already know each other".
  const enough = summary.tone === "ENOUGH";

  return (
    <section aria-labelledby={TITLE_ID} className={styles.screen}>
      <Card>
        <div className={styles.stack}>
          <FlowTitle id={TITLE_ID}>{t(enough ? "summary.title.enough" : "summary.title.neutral")}</FlowTitle>
          <p className={styles.lead}>{t(enough ? "summary.lead.enough" : "summary.lead.little")}</p>

          <Why why={summary.why} t={t} />

          <Part id="first-week-did" title={t("summary.did.title")}>
            <ul className={styles.lines} role="list">
              {summary.did.map((line) => (
                <li key={line.kind} className={styles.line}>
                  {/* A check marks something the person did. "Nothing saved yet" gets an empty mark of the same width: a tick there would read as a verdict. */}
                  <span aria-hidden="true" className={styles.check}>
                    {line.kind === "NO_MEALS" ? "" : "✓"}
                  </span>
                  <span>{didText(line, t)}</span>
                </li>
              ))}
            </ul>
          </Part>

          <Part id="first-week-noticed" title={t("summary.noticed.title")}>
            {summary.noticed.kind === "OBSERVATIONS" ? (
              summary.noticed.items.map((item) => <p key={item.kind}>{noticedText(item, t)}</p>)
            ) : (
              <p>{t("summary.noticed.notEnough")}</p>
            )}
          </Part>

          {summary.moment.kind !== "NONE" ? (
            <Part id="first-week-moment" title={t("summary.moment.title")}>
              <p>{t(summary.moment.kind === "RETURNED" ? "summary.moment.returned" : "summary.moment.firstReport")}</p>
            </Part>
          ) : null}

          <Part id="first-week-next" title={t("summary.next.title")}>
            <FirstWeekNext
              next={summary.next}
              proposeAction={proposeAction}
              text={experiment.text}
              t={t}
              pendingLabel={tCommon("loading")}
            />
          </Part>

          {failed ? (
            <Message variant="note" role="status">
              {t("problem.save")}
            </Message>
          ) : null}

          <div className={styles.actions}>
            <form action={finishAction}>
              <SubmitButton pendingLabel={tCommon("loading")}>{t("summary.continue")}</SubmitButton>
            </form>
            <p className={styles.note}>{t("summary.continueNote")}</p>
            <form action={snoozeAction}>
              <input type="hidden" name={FIRST_WEEK_SNOOZE.field} value="summary" />
              <SubmitButton variant="secondary" pendingLabel={tCommon("loading")}>
                {t("summary.notNow")}
              </SubmitButton>
            </form>
          </div>
        </div>
      </Card>
    </section>
  );
}
