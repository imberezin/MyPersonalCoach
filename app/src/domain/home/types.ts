import type { OfflinePeriod, OfflineType } from "../offline";

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
}

export type HomeState =
  | { key: "MORNING" }
  | { key: "EVENING" }
  | { key: "BEFORE_SHABBAT"; candleLighting: Date }
  | { key: "MOTZEI_SHABBAT"; havdalah: Date }
  /** B1 of the spec: the user has reported nothing yet. Content on the screen at any hour, not a notification. */
  | { key: "FIRST_WEEK_START" }
  | { key: "SILENCE"; reason: "NOTHING_TO_SAY" }
  | { key: "SILENCE"; reason: "OFFLINE_PERIOD"; periodType: OfflineType };
export type HomeStateKey = HomeState["key"];

/** The single optional action Home offers. A union of one today; every new member needs a landing place that exists. */
export type HomeAction = { kind: "OPEN_REPORT_SHEET"; reason: "FIRST_REPORT" };

export interface HomeDecision {
  state: HomeState;
  action: HomeAction | null;
  /** True when a fact was unknown. Home adds one calm sentence; it is never an error. */
  degraded: boolean;
}

/** Keys under `home.*` in the message catalogs; each has a `title` and a `body` (`firstWeekStart` also has a `lead` and a `cta`). */
export const HOME_COPY_KEYS = [
  "morning",
  "evening",
  "beforeShabbat",
  "motzeiShabbat",
  "firstWeekStart",
  "silence",
  "offlineShabbat",
  "offlineOther",
] as const;
export type HomeCopyKey = (typeof HOME_COPY_KEYS)[number];
