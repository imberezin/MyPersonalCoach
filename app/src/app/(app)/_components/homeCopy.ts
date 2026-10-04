import { homeCopyKey, resolveTimeZone, type HomeCopyKey, type HomeDecision } from "@/domain/home";
import type { Translator } from "@/i18n/server";

export interface HomeCopy {
  /** Decorative (Brand document section 23): the words carry the meaning. */
  emoji: string | null;
  title: string;
  /** An opening line between the title and the body. Only First Week Start has one. */
  lead: string | null;
  body: string;
  /**
   * Non-null exactly when the decision carries an action other than answering the Early Signal or opening Progress for a
   * landmark. `lead` is the sentence above the button; First Week Start and the summary card say their piece in `copy.lead` and
   * `copy.body` instead, so their own is null. `snoozeLabel` is the "Not now" of the three cards that
   * can be put away for a day (the First Week summary and welcome-back, and "your week"), and null for every other state.
   */
  invitation: { lead: string | null; cta: string; snoozeLabel: string | null } | null;
  /**
   * The three answers of the Early Signal card (B4): non-null exactly for that state. They are equal in weight and
   * come in the order of the spec; the card has no other button and no invitation.
   */
  earlySignal: { confirm: string; unsure: string; reject: string } | null;
  /**
   * The two buttons of the landmark card: the way to Progress (primary) and the quiet "Thanks" that ends the card for that
   * landmark. Non-null exactly for that state, which has no invitation: the card carries its own action, and shows no number.
   */
  milestone: { cta: string; ackLabel: string } | null;
  /** Non-null exactly when a fact was unknown. One calm sentence, never an error. */
  degradedNote: string | null;
}

// A candle for Shabbat in view or in progress, a moon for its end, a light bulb for something I noticed (the insight
// mark of the Brand document, section 23). A new copy key has to decide here whether it has one, because the record
// is exhaustive.
const EMOJI: Record<HomeCopyKey, string | null> = {
  morning: null,
  evening: null,
  beforeShabbat: "🕯️",
  motzeiShabbat: "🌙",
  firstWeekStart: null,
  silence: null,
  offlineShabbat: "🕯️",
  offlineOther: null,
  firstWeekSummaryReady: null,
  firstWeekSummaryReadyLittle: null,
  firstWeekWelcomeBack: null,
  earlySignalLateEvening: "💡",
  milestoneReached: null,
  milestoneGoalReached: null,
  weeklyReady: null,
};

// U+2066 (left-to-right isolate) and U+2069 (pop directional isolate): "16:10" stays one
// left-to-right run inside a right-to-left sentence, as the onboarding preview does with CSS.
const LTR_ISOLATE = "⁦";
const POP_ISOLATE = "⁩";

/** HH:mm on the 24-hour clock (h23, so midnight is 00:00) in the user's zone. */
function clockTime(instant: Date, locale: string, timeZone: string): string {
  const text = new Intl.DateTimeFormat(locale, {
    // The profile's zone is a free text column: a bad value formats in Jerusalem instead of throwing.
    timeZone: resolveTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  return `${LTR_ISOLATE}${text}${POP_ISOLATE}`;
}

/**
 * The button's words. First Week Start (B1) and the summary card have their own, and no extra sentence above the
 * button; the welcome-back card has its own sentence and button. The cards that can be put away (the two First Week cards and
 * "your week") carry the label of their "Not now". The Early Signal card has no invitation at all: its three buttons are its answers.
 */
function invitationFor(key: HomeCopyKey, t: Translator): HomeCopy["invitation"] {
  switch (key) {
    case "firstWeekStart":
      return { lead: null, cta: t("firstWeekStart.cta"), snoozeLabel: null };
    case "firstWeekSummaryReady":
    case "firstWeekSummaryReadyLittle":
      return { lead: null, cta: t(`${key}.cta`), snoozeLabel: t("firstWeekSnooze") };
    case "firstWeekWelcomeBack":
      return { lead: t("firstWeekWelcomeBack.lead"), cta: t("firstWeekWelcomeBack.cta"), snoozeLabel: t("firstWeekSnooze") };
    case "weeklyReady":
      return { lead: null, cta: t("weeklyReady.cta"), snoozeLabel: t("weeklySnooze") };
    case "earlySignalLateEvening":
    case "milestoneReached":
    case "milestoneGoalReached":
      return null;
    case "morning":
    case "evening":
    case "beforeShabbat":
    case "motzeiShabbat":
    case "silence":
    case "offlineShabbat":
    case "offlineOther":
      return { lead: t("firstReport.lead"), cta: t("firstReport.cta"), snoozeLabel: null };
    default: {
      const unhandled: never = key;
      return unhandled;
    }
  }
}

/**
 * The words for one decision. `t` is scoped to the "home" namespace. Pure: no I/O, no clock.
 * Only Before Shabbat names a time (candle lighting); no state shows a counter, a percentage or a day number.
 */
export function homeCopyFor(
  decision: HomeDecision,
  t: Translator,
  format: { locale: string; timeZone: string },
): HomeCopy {
  const { state } = decision;
  const key = homeCopyKey(state);
  const values =
    state.key === "BEFORE_SHABBAT" ? { time: clockTime(state.candleLighting, format.locale, format.timeZone) } : undefined;

  return {
    emoji: EMOJI[key],
    title: t(`${key}.title`),
    lead: key === "firstWeekStart" ? t("firstWeekStart.lead") : null,
    body: t(`${key}.body`, values),
    // The Early Signal card answers with its three buttons and the landmark card has its own two, so neither brings an
    // invitation (invitationFor says null).
    invitation: decision.action ? invitationFor(key, t) : null,
    earlySignal:
      state.key === "EARLY_SIGNAL"
        ? { confirm: t(`${key}.confirm`), unsure: t(`${key}.unsure`), reject: t(`${key}.reject`) }
        : null,
    milestone: state.key === "MILESTONE_REACHED" ? { cta: t("milestoneCta"), ackLabel: t("milestoneAck") } : null,
    degradedNote: decision.degraded ? t("degraded") : null,
  };
}
