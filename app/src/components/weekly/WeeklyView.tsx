import type { ReactNode } from "react";
import { FlowTitle } from "@/components/food/FlowTitle";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Message } from "@/components/ui/Message";
import type {
  ExperimentResult,
  HappenedLine,
  LearnedLine,
  Rationale,
  WeeklyExperimentDecision,
  WeeklyStory,
  WeightLine,
} from "@/domain/weekly";
import { getTranslations } from "@/i18n/server";
import { offerMessageKey } from "./messageKeys";
import { WeeklyNext } from "./WeeklyNext";
import { WeeklyPatternQuestion } from "./WeeklyPatternQuestion";
import { WeeklyResult } from "./WeeklyResult";
import styles from "./weekly.module.css";

const TITLE_ID = "weekly-title";

// The text of each line. Every new kind has to be written here, and the `never` makes the compiler ask for it. A line says that
// something happened, never how many times.
function happenedKey(line: HappenedLine): string {
  switch (line.kind) {
    case "MEALS":
      return "happened.meals";
    case "WEIGHED":
      return "happened.weighed";
    case "RETURNED":
      return "happened.returned";
    case "EXPERIMENT_STARTED":
      return "happened.experimentStarted";
    case "EXPERIMENT_TRIED":
      return "happened.experimentTried";
    default: {
      const unhandled: never = line;
      return unhandled;
    }
  }
}

const RESULT_KEY: Record<ExperimentResult, string> = {
  helpful: "learned.helped",
  somewhat: "learned.somewhat",
  not_really: "learned.notReally",
  unknown: "learned.unknown",
  not_tried: "learned.notTried",
};

function learnedKey(line: LearnedLine): string {
  switch (line.kind) {
    case "LATE_EVENING":
      return line.level === "ESTABLISHED" ? "learned.lateEveningRepeats" : "learned.lateEveningHedged";
    case "EXPERIMENT":
      return RESULT_KEY[line.result];
    case "NOT_YET":
      return "learned.notYet";
    default: {
      const unhandled: never = line;
      return unhandled;
    }
  }
}

/** The weight line. One plain sentence per kind, and ONE style for all of them: an increase is worded and drawn like a decrease. null = no line. */
function weightKey(line: WeightLine): string | null {
  switch (line.kind) {
    case "NONE":
      return null;
    case "FIRST":
      return "changed.first";
    case "BUILDING":
      return "changed.building";
    case "DOWN":
      return "changed.down";
    case "STEADY":
      return "changed.steady";
    case "UP":
      return "changed.up";
    default: {
      const unhandled: never = line;
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
 * "Your week" (/week): the opening line, what was meaningful, what we learned, what changed (one weight line) and what next.
 * A pure READ of a story that is already decided: every line is true or absent, and there is NO number anywhere (a line says
 * that something happened, never how many times), no score, no comparison and no target. The only digits are the dates of the
 * range, which the page builds with Intl and which sit in a `<bdi>`. Nothing is colored by what the weight did.
 *
 * The decisions are real forms that work without JavaScript: the five result answers and the three answers to the pattern
 * question (each with one closed hidden field), and the offer, "I'll try" and "Not this time" (no field at all). The actions
 * are passed in so a test can stub them. The opening line and the experiment sentence may be the AI's wording: they are plain
 * escaped text, with `data-wording-source` for tests and the manual run only.
 */
export async function WeeklyView({
  story,
  decision,
  rangeLabel,
  line,
  experiment,
  offer,
  failed,
  actions,
}: {
  story: WeeklyStory;
  decision: WeeklyExperimentDecision;
  /** "20 September to 26 September", built by the page with Intl in the person's zone. The only digits on the page. */
  rangeLabel: string;
  line: { source: "ai" | "catalog"; text: string };
  /** The sentence of the open experiment (PENDING, ACTIVE and RESULT_DUE), already in the current locale. */
  experiment: { text: string; source: "ai" | "library"; origin: "pattern" | "starter" } | null;
  /** OFFER only. The sentence is a FIXED catalog key chosen by the rationale, never an interpolation of the person's goal. */
  offer: { rationale: Rationale } | null;
  /** `?failed=1`: a write did not go through. */
  failed: boolean;
  actions: {
    propose: () => Promise<void>;
    start: () => Promise<void>;
    skip: () => Promise<void>;
    answerResult: (formData: FormData) => Promise<void>;
    answerPattern: (formData: FormData) => Promise<void>;
  };
}) {
  const [t, tRoot, tCommon] = await Promise.all([getTranslations("weekly"), getTranslations(), getTranslations("common")]);
  const pendingLabel = tCommon("loading");
  const weight = weightKey(story.weight);

  return (
    <section aria-labelledby={TITLE_ID} className={styles.screen}>
      <Card>
        <div className={styles.stack}>
          <FlowTitle id={TITLE_ID}>{t("title")}</FlowTitle>
          <p className={styles.range}>
            <bdi>{rangeLabel}</bdi>
          </p>
          <p className={styles.lead} data-wording-source={line.source}>
            {line.text}
          </p>

          {decision.kind === "RESULT_DUE" ? (
            <WeeklyResult
              text={experiment?.text ?? null}
              source={experiment?.source ?? "library"}
              answerAction={actions.answerResult}
              t={t}
              pendingLabel={pendingLabel}
            />
          ) : null}

          {story.happened.length > 0 ? (
            <Part id="weekly-happened" title={t("happened.title")}>
              <ul className={styles.lines} role="list">
                {story.happened.map((item) => (
                  <li key={item.kind}>{t(happenedKey(item))}</li>
                ))}
              </ul>
            </Part>
          ) : null}

          <Part id="weekly-learned" title={t("learned.title")}>
            <ul className={styles.lines} role="list">
              {story.learned.map((item) => (
                <li key={item.kind}>{t(learnedKey(item))}</li>
              ))}
            </ul>
            {story.patternQuestion.kind === "ASK" ? (
              <WeeklyPatternQuestion answerAction={actions.answerPattern} t={t} pendingLabel={pendingLabel} />
            ) : null}
          </Part>

          {weight !== null ? (
            <Part id="weekly-changed" title={t("changed.title")}>
              <p>{t(weight)}</p>
            </Part>
          ) : null}

          <Part id="weekly-next" title={t("next.title")}>
            <WeeklyNext
              mode={story.mode}
              decision={decision}
              experiment={experiment}
              offerText={offer !== null ? tRoot(offerMessageKey(offer.rationale)) : null}
              weighInvite={story.invite.weighIn}
              actions={actions}
              t={t}
              pendingLabel={pendingLabel}
            />
          </Part>

          {failed ? (
            <Message variant="note" role="status">
              {t("problem.save")}
            </Message>
          ) : null}

          <div className={styles.actions}>
            <ButtonLink href="/" variant="secondary">
              {t("back")}
            </ButtonLink>
          </div>
        </div>
      </Card>
    </section>
  );
}
