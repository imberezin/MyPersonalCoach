import { zonedInstantUtc } from "@/domain/time";
import { addDaysToDayKey, parseDayKey } from "@/domain/weight/trend";

/**
 * The local rehearsal of the weekly summary push (step 10 of TODO.md section 4): the whole chain, from the route down to the real
 * Postgres of the local Docker stack, with the dev clock and the fake provider. It runs the timeline of one Sunday morning and the cases
 * around it, and compares what the route answered and what was written with what must happen. Nothing here touches anything but the local
 * stack and one throwaway @eating-coach.test user (the guards are in ./guards.ts, and the live runner refuses anything else).
 *
 * The world is injected, so the same timeline is also checked against an in-memory world (tests/rehearse-weekly-push): the rehearsal's own
 * expectations are tested against the real runner, and then run against the real stack.
 */

export type Behavior = "ok" | "gone" | "rejected" | "retryable";
export const BEHAVIORS: readonly Behavior[] = ["ok", "gone", "rejected", "retryable"];

export interface RouteAnswer {
  status: number;
  body: Record<string, unknown>;
}

export interface LogRow {
  kind: string | null;
  momentKey: string | null;
  reason: string | null;
}

export interface RehearsalWorld {
  /** IANA zone of the user's profile. */
  timeZone: string;
  /** The local Sunday whose morning the seeded clock is on ("as of" the end of the week before), as a date key. */
  sunday: string;
  /** Sets the dev clock (the app reads it on every request). */
  setClock(instant: Date): Promise<void> | void;
  /** One POST to the route, as cron would send it. The query is "" or "?dryRun=1". */
  callRoute(query?: string): Promise<RouteAnswer>;
  /** The start of every case: no claim, the card untouched, no Offline period, the preference on, exactly one subscription. */
  reset(): Promise<void>;
  /** The person opened "your week" (a weekly_summaries row for that week). */
  openCard(weekStart: string): Promise<void>;
  /** An Offline period that covers [from, to). */
  coverWithOffline(from: Date, to: Date): Promise<void>;
  setPreference(on: boolean): Promise<void>;
  readLog(): Promise<LogRow[]>;
  subscriptionCount(): Promise<number>;
}

export interface Check {
  step: string;
  ok: boolean;
  detail: string;
}

const num = (body: Record<string, unknown>, key: string): number => (typeof body[key] === "number" ? (body[key] as number) : Number.NaN);
const results = (body: Record<string, unknown>) => (typeof body.results === "object" && body.results !== null ? (body.results as Record<string, number>) : {});
const skippedBy = (body: Record<string, unknown>) => (typeof body.skippedBy === "object" && body.skippedBy !== null ? (body.skippedBy as Record<string, number>) : {});

/** The local wall-clock time on the rehearsal Sunday plus `days`, as an instant. */
function at(world: RehearsalWorld, days: number, hour: number, minute: number): Date {
  const key = addDaysToDayKey(world.sunday, days);
  const parts = parseDayKey(key);
  if (!parts) throw new Error("bad_sunday");
  return zonedInstantUtc(parts.year, parts.month, parts.day, hour, minute, world.timeZone);
}

export const clock = {
  quiet: (w: RehearsalWorld) => at(w, 0, 6, 0),
  send: (w: RehearsalWorld) => at(w, 0, 8, 5),
  later: (w: RehearsalWorld) => at(w, 0, 8, 10),
  monday: (w: RehearsalWorld) => at(w, 1, 9, 0),
  closed: (w: RehearsalWorld) => at(w, 3, 5, 1),
} as const;

const fmt = (body: Record<string, unknown>) =>
  `mode ${String(body.mode)}, due ${num(body, "due")}, sent ${num(body, "sent")}, notSent ${num(body, "notSent")}, deleted ${num(body, "subscriptionsDeleted")}, skippedBy ${JSON.stringify(skippedBy(body))}, failed ${num(body, "failed")}, aborted ${JSON.stringify(body.aborted)}`;

/**
 * Runs every case and returns what it checked. `behavior` is what the dev server's fake provider (PUSH_FAKE_BEHAVIOR) is set to, so the
 * same cases can be run once per answer the push service can give.
 */
export async function runRehearsal(world: RehearsalWorld, behavior: Behavior, log: (line: string) => void): Promise<Check[]> {
  const checks: Check[] = [];
  const week = addDaysToDayKey(world.sunday, -7);
  const moment = `weekly:${week}`;
  const check = (step: string, ok: boolean, detail: string) => {
    checks.push({ step, ok, detail });
    log(`${ok ? "ok  " : "FAIL"} ${step}: ${detail}`);
  };

  // 0. Before anything that can write or send: a DRY request must show that the dev server sees the seeded local user, and so is on the same
  //    local database as this script. A server pointed anywhere else would answer something else, and the run stops here, with no live call.
  await world.reset();
  await world.setClock(clock.send(world));
  const probe = await world.callRoute("?dryRun=1");
  const sees = probe.status === 200 && probe.body.mode === "dry" && num(probe.body, "candidates") === 1 && num(probe.body, "due") === 1;
  check("preflight, a dry request: the dev server sees the seeded local user", sees, `${probe.status}: ${fmt(probe.body)} (expected exactly one person and one push due)`);
  if (!sees) return checks;

  // 1. Before the quiet hours end: nothing is sent, nothing is claimed.
  await world.reset();
  await world.setClock(clock.quiet(world));
  let answer = await world.callRoute();
  check("06:00, quiet hours", answer.status === 200 && num(answer.body, "sent") === 0 && num(answer.body, "due") === 0 && JSON.stringify(skippedBy(answer.body)) === JSON.stringify({ quiet_hours: 1 }), fmt(answer.body));
  check("06:00, nothing claimed", (await world.readLog()).length === 0, "the log is empty");

  // 2. The first tick after 08:00: one claim, one push, the claim closed by what the push service answered.
  await world.setClock(clock.send(world));
  answer = await world.callRoute();
  const body = answer.body;
  const row = (await world.readLog())[0];
  const subs = await world.subscriptionCount();
  const expected = {
    ok: { status: 200, sent: 1, notSent: 0, deleted: 0, reason: null, subs: 1, key: "ok" },
    gone: { status: 500, sent: 0, notSent: 1, deleted: 1, reason: "subscription_gone", subs: 0, key: "gone" },
    rejected: { status: 500, sent: 0, notSent: 1, deleted: 0, reason: "send_failed", subs: 1, key: "rejected" },
    retryable: { status: 500, sent: 0, notSent: 1, deleted: 0, reason: "send_failed", subs: 1, key: "retryable" },
  }[behavior];
  check(
    `08:05, the push service answers ${behavior}`,
    answer.status === expected.status && num(body, "due") === 1 && num(body, "sent") === expected.sent && num(body, "notSent") === expected.notSent && num(body, "subscriptionsDeleted") === expected.deleted && results(body)[expected.key] === 1,
    `${answer.status}: ${fmt(body)}`,
  );
  check("08:05, one claim, closed by that answer", (await world.readLog()).length === 1 && row?.kind === "weekly_summary" && row?.momentKey === moment && row?.reason === expected.reason, `${JSON.stringify(row)}, expected moment ${moment} and reason ${JSON.stringify(expected.reason)}`);
  check("08:05, the subscription", subs === expected.subs, `${subs} subscription(s), expected ${expected.subs}`);

  // 3. Nothing more, on the ticks after, and on Monday (the card is still up): the claim blocks a second push.
  for (const [label, instant] of [["08:10", clock.later(world)], ["Monday 09:00", clock.monday(world)]] as const) {
    await world.setClock(instant);
    answer = await world.callRoute();
    check(`${label}, no second push`, num(answer.body, "sent") === 0 && num(answer.body, "due") === 0 && JSON.stringify(skippedBy(answer.body)) === JSON.stringify({ already_claimed: 1 }), fmt(answer.body));
  }
  check("after the ticks, still one claim", (await world.readLog()).length === 1, "one row in the log");

  // 4. Wednesday 05:00 the card window closes: no moment any more.
  await world.setClock(clock.closed(world));
  answer = await world.callRoute();
  check("Wednesday 05:01, the window is closed", num(answer.body, "sent") === 0 && JSON.stringify(skippedBy(answer.body)) === JSON.stringify({ no_moment: 1 }), fmt(answer.body));

  // 5. Two ticks at once: one push (the claim is the atomic insert of the real database).
  await world.reset();
  await world.setClock(clock.send(world));
  const pair = await Promise.all([world.callRoute(), world.callRoute()]);
  const claimed = pair.reduce((total, a) => total + num(a.body, "sent") + num(a.body, "notSent"), 0);
  check("two overlapping ticks, one push", claimed === 1 && (await world.readLog()).length === 1, `${claimed} claimed push(es), ${(await world.readLog()).length} row(s) in the log`);

  // 6. The person opened "your week" before the tick: held back, nothing claimed.
  await world.reset();
  await world.openCard(week);
  await world.setClock(clock.send(world));
  answer = await world.callRoute();
  check("the card was opened first", num(answer.body, "sent") === 0 && JSON.stringify(skippedBy(answer.body)) === JSON.stringify({ card_closed: 1 }) && (await world.readLog()).length === 0, fmt(answer.body));

  // 7. Offline covers the moment: nothing.
  await world.reset();
  await world.coverWithOffline(at(world, 0, 7, 0), at(world, 0, 20, 0));
  await world.setClock(clock.send(world));
  answer = await world.callRoute();
  check("an Offline period covers the moment", num(answer.body, "sent") === 0 && JSON.stringify(skippedBy(answer.body)) === JSON.stringify({ offline: 1 }) && (await world.readLog()).length === 0, fmt(answer.body));

  // 8. The preference is off: nothing.
  await world.reset();
  await world.setPreference(false);
  await world.setClock(clock.send(world));
  answer = await world.callRoute();
  check("the preference is off", num(answer.body, "sent") === 0 && JSON.stringify(skippedBy(answer.body)) === JSON.stringify({ preference_off: 1 }) && (await world.readLog()).length === 0, fmt(answer.body));

  // 9. A dry request counts the push as due and does nothing else.
  await world.reset();
  await world.setClock(clock.send(world));
  answer = await world.callRoute("?dryRun=1");
  check("?dryRun=1 counts and writes nothing", answer.body.mode === "dry" && num(answer.body, "due") === 1 && num(answer.body, "sent") === 0 && (await world.readLog()).length === 0 && (await world.subscriptionCount()) === 1, fmt(answer.body));

  // 10. Leave the person ready for the next run.
  await world.reset();
  return checks;
}
