import type { LifecycleState } from "../firstWeek";
import type { FirstWeekProgress, FirstWeekSnoozed } from "../firstWeekFlow/types";
import type { OfflinePeriod, OfflineType } from "../offline";
import type { EarlySignalDecision } from "../patterns/earlySignal";
import type { PatternKind } from "../patterns/types";
import type { QuietHours } from "../quietHours";
import type { MilestoneMoment } from "../weight/milestoneProgress";
import type { WeeklyHomeFact } from "../weekly/types";

/**
 * Home: the one calm thing the first screen says right now. This file is the vocabulary (facts in,
 * decision out); the rules are in resolve.ts and the database reads in src/lib/home/load.ts.
 * Pure: no I/O, no clock.
 */

/** Must equal DEFAULT_TIME_ZONE of src/i18n/config.ts (a loader test asserts it). */
export const HOME_FALLBACK_TIME_ZONE = "Asia/Jerusalem";

export const HOME_TIMING = {
  morningStartMinute: 300, // 05:00 local, inclusive
  morningEndMinute: 660, // 11:00 local, exclusive
  eveningStartMinute: 1080, // 18:00 local, inclusive; the evening runs to local midnight
  beforeShabbatLeadMs: 10_800_000, // 3 h: [candleLighting - 3h, candleLighting)
  motzeiShabbatWindowMs: 21_600_000, // 6 h: [havdalah, havdalah + 6h)
  staleAfterMs: 300_000, // 5 min: when a tab becomes visible again and its page is older than this, Home refreshes
} as const;

/** Product switches that are one-line decisions. */
export const HOME_FEATURES = {
  /** Offer the first-report invitation (leads to the Report sheet). false -> `action` is always null and the First Week Start screen is not shown. */
  firstReportInvitation: true,
} as const;

export interface HomeFacts {
  /** The instant Home is rendered for. Injected; the domain never reads the clock. */
  now: Date;
  /** IANA zone of the profile. `loadHomeFacts` always returns a VALID zone (resolveTimeZone); the resolver re-validates anyway and never throws. */
  timeZone: string;
  /** Offline periods that overlap homePeriodsWindow(now), any type. null = the query failed (Shabbat unknown). */
  offlinePeriods: readonly OfflinePeriod[] | null;
  /** True when ANY confirmed report exists (meal, weight, activity, sleep, stress). null = unknown (never treated as "no report yet"). */
  hasAnyReport: boolean | null;
  /** The profile's lifecycle state. null = unknown (the context was not ready). */
  lifecycle: LifecycleState | null;
  /** Counts for the First Week rules. Non-null only when lifecycle === "FIRST_WEEK" AND it loaded. null otherwise; with lifecycle FIRST_WEEK, null means "could not be read" (degraded). */
  firstWeek: FirstWeekProgress | null;
  /** Which First Week cards the person pressed "Not now" on in the last 24 hours. Both false when lifecycle is not FIRST_WEEK, when nothing was pressed, and when the read failed (a card returning is calm; a card hidden by a failed read would be invisible). */
  firstWeekSnoozed: FirstWeekSnoozed;
  /** B4, data level: does the live late-evening signal call for the Early Signal card, given the person's earlier answer and the cooldown? Non-null only when lifecycle === "FIRST_WEEK" AND the signal loaded; null = unknown, and then there is simply no card. The resolver adds only the time-of-day rules. */
  earlySignal: EarlySignalDecision | null;
  /** The person's quiet hours. Read ONLY when earlySignal.due; null = not read or unknown, and then there is no Early Signal card (better silent than intrusive). */
  quietHours: QuietHours | null;
  /** The landmark achievement Home may show now (derived from the weekly weight averages; carries no number). null = none, or unknown: an unknown read is never a celebration. */
  milestone: MilestoneMoment | null;
  /**
   * Weekly Learning, while the card window is open (Sunday 05:00 to Wednesday 05:00). `{ weekStart, card: true }` = show the card;
   * `{ weekStart, card: false }` = it was already opened or snoozed, so Home shows only the quiet "Your week" link; null = nothing
   * (outside the window, not due, a week with no report, or unknown). The loader applies the snooze and the opened state, so this
   * is one fact. Non-null only when lifecycle === "WEEKLY_CYCLE"; the resolver ignores it otherwise.
   */
  weekly: WeeklyHomeFact | null;
}

export type HomeState =
  | { key: "MORNING" }
  | { key: "EVENING" }
  | { key: "BEFORE_SHABBAT"; candleLighting: Date }
  | { key: "MOTZEI_SHABBAT"; havdalah: Date }
  /** B1 of the spec: the user has reported nothing yet. Content on the screen at any hour, not a notification. */
  | { key: "FIRST_WEEK_START" }
  /** B6: the First Week rules say the summary is ready. `hadEnoughData` picks the wording (no claim of familiarity without data). Snoozable. */
  | { key: "FIRST_WEEK_SUMMARY_READY"; hadEnoughData: boolean }
  /** "You're back": at least FIRST_WEEK_RECOVERY.minAvailableDaysWithoutMeal available days with no confirmed meal. Snoozable. */
  | { key: "FIRST_WEEK_WELCOME_BACK" }
  /** B4: a small optional question about what was noticed. Its three answers are its exits. */
  | { key: "EARLY_SIGNAL"; signal: PatternKind }
  /** A landmark on the way to the goal was confirmed by two completed weekly averages. `week` is the confirming week's date key; `isGoal` picks the wording. Ended by "Thanks" or after its window. Carries no number. */
  | { key: "MILESTONE_REACHED"; week: string; isGoal: boolean }
  /** Weekly Learning: "your week" is ready (WEEKLY_CYCLE only). One calm card with "To my week" and "Not now". Carries no number. */
  | { key: "WEEKLY_SUMMARY_READY" }
  | { key: "SILENCE"; reason: "NOTHING_TO_SAY" }
  | { key: "SILENCE"; reason: "OFFLINE_PERIOD"; periodType: OfflineType };
export type HomeStateKey = HomeState["key"];

/** The single optional action Home offers. Every member needs a landing place that exists. */
export type HomeAction =
  | { kind: "OPEN_REPORT_SHEET"; reason: "FIRST_REPORT" | "WELCOME_BACK" }
  | { kind: "OPEN_FIRST_WEEK_SUMMARY" }
  | { kind: "ANSWER_EARLY_SIGNAL" }
  | { kind: "OPEN_PROGRESS"; week: string }
  | { kind: "OPEN_WEEKLY_STORY" };

export interface HomeDecision {
  state: HomeState;
  action: HomeAction | null;
  /** True when a fact was unknown. Home adds one calm sentence; it is never an error. */
  degraded: boolean;
  /**
   * True iff the weekly card was already opened or snoozed (`weekly.card === false`) in WEEKLY_CYCLE and the state is a calm clock
   * state (MORNING, EVENING, SILENCE / NOTHING_TO_SAY): Home then shows one quiet "Your week" link to /week, under the clock card.
   * A link, never a second card, never beside the card itself and never in a Shabbat or offline state. It is not an action.
   */
  weeklyLink: boolean;
}

/** Keys under `home.*` in the message catalogs; each has a `title` and a `body` (`firstWeekStart` also has a `lead` and a `cta`; the welcome-back and summary cards a `cta`). */
export const HOME_COPY_KEYS = [
  "morning",
  "evening",
  "beforeShabbat",
  "motzeiShabbat",
  "firstWeekStart",
  "silence",
  "offlineShabbat",
  "offlineOther",
  "firstWeekSummaryReady",
  "firstWeekSummaryReadyLittle",
  "firstWeekWelcomeBack",
  "earlySignalLateEvening",
  "milestoneReached",
  "milestoneGoalReached",
  "weeklyReady",
] as const;
export type HomeCopyKey = (typeof HOME_COPY_KEYS)[number];
