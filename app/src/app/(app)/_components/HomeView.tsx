import type { ReactNode } from "react";
import { acknowledgeMilestoneAction } from "@/app/(app)/progress/actions";
import { snoozeFirstWeekCardAction, answerEarlySignalAction } from "@/app/(flow)/first-week/actions";
import { openWeeklyStoryAction, snoozeWeeklyCardAction } from "@/app/(flow)/week/actions";
import { SubmitButton } from "@/components/food/SubmitButton";
import progressStyles from "@/components/progress/progress.module.css";
import { OpenReportSheetButton } from "@/components/shell/OpenReportSheetButton";
import { ButtonLink } from "@/components/ui/Button";
import firstWeekStyles from "@/components/firstWeek/firstWeek.module.css";
import weeklyStyles from "@/components/weekly/weekly.module.css";
import { experimentTextFor } from "@/components/firstWeek/ExperimentView";
import { FIRST_WEEK_ROUTES, FIRST_WEEK_SNOOZE, type HomeSnoozeCard } from "@/domain/firstWeekFlow";
import type { HomeAction, HomeDecision } from "@/domain/home";
import { WEEKLY_ROUTES } from "@/domain/weekly";
import { WEIGHT_ROUTES } from "@/domain/weight";
import { getLocale, getTranslations } from "@/i18n/server";
import { HOME_TITLE_ID, HomeCard } from "./HomeCard";
import { HomeRefresher } from "./HomeRefresher";
import { homeCopyFor, type HomeCopy } from "./homeCopy";

/** The one field of the Early Signal answer forms. The action reads this field and no other. */
const ANSWER_FIELD = "answer";

/** The one field of the landmark "Thanks" form: the date key of the week that confirmed the landmark. The action reads this field and no other. */
const MILESTONE_FIELD = "week";

/** "Not now": a tiny form of its own, so it works without JavaScript. The hidden field names the card to put away. */
function SnoozeForm({ card, label, pendingLabel }: { card: HomeSnoozeCard; label: string; pendingLabel: string }) {
  return (
    <form action={snoozeFirstWeekCardAction}>
      <input type="hidden" name={FIRST_WEEK_SNOOZE.field} value={card} />
      <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
    </form>
  );
}

/** The three answers of the Early Signal card: the same variant and size for each, in the order of the spec. */
function EarlySignalAnswers({
  answers,
  pendingLabel,
}: {
  answers: NonNullable<HomeCopy["earlySignal"]>;
  pendingLabel: string;
}) {
  const choices = [
    ["confirm", answers.confirm],
    ["unsure", answers.unsure],
    ["reject", answers.reject],
  ] as const;
  return (
    <div role="group" aria-labelledby={HOME_TITLE_ID} className={firstWeekStyles.homeActions}>
      {choices.map(([answer, label]) => (
        <form key={answer} action={answerEarlySignalAction}>
          <input type="hidden" name={ANSWER_FIELD} value={answer} />
          <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
            {label}
          </SubmitButton>
        </form>
      ))}
    </div>
  );
}

// Where each action lands. Every new action kind has to name a landing place that exists, and the `never` below
// makes the compiler ask for it. The two First Week cards that can be put away carry their "Not now" next to the
// button, in one column.
function renderAction(action: HomeAction, copy: HomeCopy, pendingLabel: string): ReactNode {
  const invitation = copy.invitation;
  switch (action.kind) {
    case "OPEN_REPORT_SHEET": {
      if (!invitation) return null;
      const button = <OpenReportSheetButton variant="primary">{invitation.cta}</OpenReportSheetButton>;
      if (action.reason !== "WELCOME_BACK" || invitation.snoozeLabel === null) return button;
      return (
        <div className={firstWeekStyles.homeActions}>
          {button}
          <SnoozeForm card="welcome_back" label={invitation.snoozeLabel} pendingLabel={pendingLabel} />
        </div>
      );
    }
    case "OPEN_FIRST_WEEK_SUMMARY": {
      if (!invitation) return null;
      return (
        <div className={firstWeekStyles.homeActions}>
          <ButtonLink href={FIRST_WEEK_ROUTES.summary} variant="primary">
            {invitation.cta}
          </ButtonLink>
          {invitation.snoozeLabel !== null ? (
            <SnoozeForm card="summary" label={invitation.snoozeLabel} pendingLabel={pendingLabel} />
          ) : null}
        </div>
      );
    }
    case "OPEN_WEEKLY_STORY": {
      // "To my week" is a form post and not a link: the press creates the week's row and may call the AI (that is why Home
      // exports maxDuration). Neither form has a hidden field: nothing the page says can be forged, the actions recompute the week.
      if (!invitation) return null;
      return (
        <div className={firstWeekStyles.homeActions}>
          <form action={openWeeklyStoryAction}>
            <SubmitButton pendingLabel={pendingLabel}>{invitation.cta}</SubmitButton>
          </form>
          {invitation.snoozeLabel !== null ? (
            <form action={snoozeWeeklyCardAction}>
              <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
                {invitation.snoozeLabel}
              </SubmitButton>
            </form>
          ) : null}
        </div>
      );
    }
    case "THANK_ACTIVE_EXPERIMENT": {
      // One soft "Thanks" and nothing else: the card is for re-reading the sentence, never for reporting. It reuses the snooze form
      // (same action, same field), so a press only puts the card away for the rest of the local day.
      if (!copy.experiment) return null;
      return (
        <div className={firstWeekStyles.homeActions}>
          <SnoozeForm card={FIRST_WEEK_SNOOZE.experimentCard} label={copy.experiment.ackLabel} pendingLabel={pendingLabel} />
        </div>
      );
    }
    case "ANSWER_EARLY_SIGNAL":
      return copy.earlySignal ? <EarlySignalAnswers answers={copy.earlySignal} pendingLabel={pendingLabel} /> : null;
    case "OPEN_PROGRESS": {
      // A link to Progress as the primary control and a quiet "Thanks" that ends the card for that landmark. No number
      // anywhere on this card: Home is glanced at in public.
      if (!copy.milestone) return null;
      return (
        <div className={progressStyles.homeActions}>
          <ButtonLink href={WEIGHT_ROUTES.progress} variant="primary">
            {copy.milestone.cta}
          </ButtonLink>
          <form action={acknowledgeMilestoneAction}>
            <input type="hidden" name={MILESTONE_FIELD} value={action.week} />
            <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
              {copy.milestone.ackLabel}
            </SubmitButton>
          </form>
        </div>
      );
    }
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}

/**
 * A decision, in words. `renderedAt` is the server's clock reading for this render; the refresher
 * uses it to notice when a Home that iOS restored from memory is old.
 */
export async function HomeView({
  decision,
  timeZone,
  renderedAt,
}: {
  decision: HomeDecision;
  timeZone: string;
  renderedAt: number;
}) {
  const { state } = decision;
  const [t, tCommon, locale, tLibrary] = await Promise.all([
    getTranslations("home"),
    getTranslations("common"),
    getLocale(),
    // The library's sentences are needed only to show an experiment written in another language than the page's.
    state.key === "ACTIVE_EXPERIMENT" ? getTranslations("interventions") : Promise.resolve(null),
  ]);
  const experimentText = state.key === "ACTIVE_EXPERIMENT" && tLibrary !== null ? experimentTextFor(state.experiment, locale, tLibrary) : undefined;
  const copy = homeCopyFor(decision, t, { locale, timeZone, experimentText });
  // The Early Signal card has no invitation (its buttons are its answers), so the action alone decides.
  const action = decision.action ? renderAction(decision.action, copy, tCommon("loading")) : null;

  return (
    <>
      <HomeCard copy={copy} action={action} />
      {/* The way back to "your week" once its card was opened or put away (the installed app has no address bar): one quiet text link under the clock card, never a second card, never beside the card itself. */}
      {decision.weeklyLink ? (
        <div className={weeklyStyles.homeLink}>
          <ButtonLink href={WEEKLY_ROUTES.week} variant="tertiary">
            {t("weeklyLink")}
          </ButtonLink>
        </div>
      ) : null}
      <HomeRefresher renderedAt={renderedAt} />
    </>
  );
}
