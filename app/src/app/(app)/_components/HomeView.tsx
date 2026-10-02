import type { ReactNode } from "react";
import { acknowledgeMilestoneAction } from "@/app/(app)/progress/actions";
import { snoozeFirstWeekCardAction, answerEarlySignalAction } from "@/app/(flow)/first-week/actions";
import { SubmitButton } from "@/components/food/SubmitButton";
import progressStyles from "@/components/progress/progress.module.css";
import { OpenReportSheetButton } from "@/components/shell/OpenReportSheetButton";
import { ButtonLink } from "@/components/ui/Button";
import firstWeekStyles from "@/components/firstWeek/firstWeek.module.css";
import { FIRST_WEEK_ROUTES, FIRST_WEEK_SNOOZE, type FirstWeekSnoozeCard } from "@/domain/firstWeekFlow";
import type { HomeAction, HomeDecision } from "@/domain/home";
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
function SnoozeForm({ card, label, pendingLabel }: { card: FirstWeekSnoozeCard; label: string; pendingLabel: string }) {
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
  const [t, tCommon, locale] = await Promise.all([getTranslations("home"), getTranslations("common"), getLocale()]);
  const copy = homeCopyFor(decision, t, { locale, timeZone });
  // The Early Signal card has no invitation (its buttons are its answers), so the action alone decides.
  const action = decision.action ? renderAction(decision.action, copy, tCommon("loading")) : null;

  return (
    <>
      <HomeCard copy={copy} action={action} />
      <HomeRefresher renderedAt={renderedAt} />
    </>
  );
}
