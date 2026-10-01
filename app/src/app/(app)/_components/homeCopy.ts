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
   * Non-null exactly when the decision carries an action. `lead` is the sentence above the button;
   * First Week Start says its piece in `copy.lead` and `copy.body` instead, so its own is null.
   */
  invitation: { lead: string | null; cta: string } | null;
  /** Non-null exactly when a fact was unknown. One calm sentence, never an error. */
  degradedNote: string | null;
}

// A candle for Shabbat in view or in progress, a moon for its end. A new copy key has to decide here
// whether it has one, because the record is exhaustive.
const EMOJI: Record<HomeCopyKey, string | null> = {
  morning: null,
  evening: null,
  beforeShabbat: "🕯️",
  motzeiShabbat: "🌙",
  firstWeekStart: null,
  silence: null,
  offlineShabbat: "🕯️",
  offlineOther: null,
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

/** The button's words. First Week Start (B1) has its own, and no extra sentence above the button. */
function invitationFor(key: HomeCopyKey, t: Translator): { lead: string | null; cta: string } {
  if (key === "firstWeekStart") return { lead: null, cta: t("firstWeekStart.cta") };
  return { lead: t("firstReport.lead"), cta: t("firstReport.cta") };
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
    invitation: decision.action ? invitationFor(key, t) : null,
    degradedNote: decision.degraded ? t("degraded") : null,
  };
}
