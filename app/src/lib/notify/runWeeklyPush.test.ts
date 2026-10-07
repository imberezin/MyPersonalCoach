import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideWeeklyPush, type WeeklyPushInput } from "@/domain/notifications";
import type { OfflinePeriod } from "@/domain/offline";
import type { QuietHours } from "@/domain/quietHours";
import type { WeeklyHomeFact } from "@/domain/weekly";
import { FAKE_RESULTS, FakeNotificationProvider } from "@/lib/notifications/fake";
import type { PushSubscriptionRecord } from "@/lib/notifications/types";
import { createMemoryWeeklyPushStore, type MemoryPerson, type MemoryStoreOptions } from "./memoryStore";
import { WEEKLY_PUSH_MAX_SENDS, runWeeklyPush, weeklyPushNeedsAttention } from "./runWeeklyPush";
import type { PushCandidate, WeeklyPushStore } from "./store";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const SUB_A: PushSubscriptionRecord = { endpoint: "https://web.push.apple.com/aaa-endpoint-secret", p256dh: "p256dh-aaa", auth: "auth-aaa" };
const SUB_B: PushSubscriptionRecord = { endpoint: "https://fcm.googleapis.com/bbb-endpoint-secret", p256dh: "p256dh-bbb", auth: "auth-bbb" };
const CARD: WeeklyHomeFact = { weekStart: "2026-10-11", card: true };
const MOMENT = "weekly:2026-10-11";
const DEFAULT_QUIET: QuietHours = { kind: "WINDOW", startMinute: 0, endMinute: 480 };
const SUNDAY_0805 = new Date("2026-10-18T05:05:00Z"); // 08:05 Israel time

type PersonOver = Omit<Partial<MemoryPerson>, "candidate"> & { candidate?: Partial<PushCandidate> };

function person(userId = U1, over: PersonOver = {}): MemoryPerson {
  const { candidate, ...rest } = over;
  return {
    candidate: { userId, language: "he", timeZone: "Asia/Jerusalem", lifecycle: "WEEKLY_CYCLE", preferenceOn: true, quietHours: DEFAULT_QUIET, ...candidate },
    fact: CARD,
    periods: [],
    subscriptions: [SUB_A],
    ...rest,
  };
}

function setup(people: MemoryPerson[] = [person()], storeOptions: MemoryStoreOptions = {}, provider: FakeNotificationProvider | null = new FakeNotificationProvider()) {
  const mem = createMemoryWeeklyPushStore(people, storeOptions);
  const run = (over: Partial<Parameters<typeof runWeeklyPush>[2]> = {}) => runWeeklyPush(mem.store, provider, { now: SUNDAY_0805, live: true, ...over });
  return { mem, provider, run };
}

const sentCount = (p: FakeNotificationProvider | null) => p?.sent.length ?? 0;

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a live tick", () => {
  it("sends one push to the person's phone with the approved words, claims it first, and closes the claim as sent", async () => {
    const { mem, provider, run } = setup();
    const summary = await run();
    expect(summary).toMatchObject({ candidates: 1, due: 1, sent: 1, notSent: 0, dryRun: false, aborted: null, failed: 0, stuck: 0 });
    expect(provider?.sent).toHaveLength(1);
    expect(provider?.sent[0].message).toEqual({
      title: "השבוע שלך",
      body: "יש לי כמה מילים על השבוע שעבר. כשנוח, אפשר להסתכל.",
      url: "/week",
      tag: "weekly_summary-2026-10-11",
      lang: "he",
      dir: "rtl",
    });
    expect(mem.writes().map((w) => w.method)).toEqual(["claim", "markSubscriptionSuccess", "finish"]);
    expect(mem.claims.get(`${U1}|${MOMENT}`)?.reason).toBeNull();
    expect(mem.stamped).toEqual([SUB_A.endpoint]);
  });

  it("speaks English to an English speaker", async () => {
    const { provider, run } = setup([person(U1, { candidate: { language: "en" } })]);
    await run();
    expect(provider?.sent[0].message).toMatchObject({ title: "Your week", lang: "en", dir: "ltr" });
  });

  it("sends once per subscription to every device of one person, with one claim", async () => {
    const { mem, provider, run } = setup([person(U1, { subscriptions: [SUB_A, SUB_B] })]);
    const summary = await run();
    expect(provider?.sent).toHaveLength(2);
    expect(summary).toMatchObject({ due: 1, sent: 1, notSent: 0 });
    expect(summary.results).toMatchObject({ ok: 2 });
    expect(mem.called("claim")).toBe(1);
  });

  it("is one provider call per tick, and two ticks in a row send once", async () => {
    const { provider, run } = setup();
    await run();
    const second = await run({ now: new Date(SUNDAY_0805.getTime() + 5 * 60_000) });
    expect(sentCount(provider)).toBe(1);
    expect(second).toMatchObject({ sent: 0, due: 0, skipped: 1 });
    expect(second.skippedBy).toEqual({ already_claimed: 1 });
  });

  it("sends once when two ticks overlap (the claim is atomic)", async () => {
    const { provider, run } = setup();
    const [a, b] = await Promise.all([run(), run()]);
    expect(sentCount(provider)).toBe(1);
    expect(a.sent + b.sent).toBe(1);
    expect(a.skippedBy.already_claimed ?? 0 + (b.skippedBy.already_claimed ?? 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("the clock: quiet hours delay the push, they do not cancel it", () => {
  it("sends nothing until 08:00 on Sunday, one push at 08:00, and nothing on the ticks after", async () => {
    const { provider, mem, run } = setup();
    const at = (iso: string) => run({ now: new Date(iso) });

    expect((await at("2026-10-18T02:00:00Z")).skippedBy).toEqual({ quiet_hours: 1 }); // 05:00, the week is ready
    expect((await at("2026-10-18T04:55:00Z")).skippedBy).toEqual({ quiet_hours: 1 }); // 07:55
    expect(sentCount(provider)).toBe(0);
    expect(mem.writes()).toHaveLength(0);

    expect((await at("2026-10-18T05:00:00Z")).sent).toBe(1); // 08:00
    expect(sentCount(provider)).toBe(1);

    for (const iso of ["2026-10-18T05:05:00Z", "2026-10-18T09:00:00Z", "2026-10-19T06:00:00Z", "2026-10-21T01:55:00Z"]) {
      expect((await at(iso)).sent, iso).toBe(0);
    }
    expect(sentCount(provider)).toBe(1);
  });

  it("sends nothing once the card window has closed (Wednesday 05:00), because the card fact is gone", async () => {
    const { provider, run } = setup([person(U1, { fact: null })]);
    const summary = await run({ now: new Date("2026-10-21T02:00:00Z") });
    expect(summary.skippedBy).toEqual({ no_moment: 1 });
    expect(sentCount(provider)).toBe(0);
  });
});

describe("every other gate", () => {
  it("stops at Offline and at unknown Offline periods", async () => {
    const covering: OfflinePeriod = { type: "USER_DEFINED", start: new Date("2026-10-18T00:00:00Z"), end: new Date("2026-10-19T00:00:00Z") };
    const { provider, run } = setup([person(U1, { periods: [covering] }), person(U2, { periods: null })]);
    const summary = await run();
    expect(summary.skippedBy).toEqual({ offline: 1, offline_unknown: 1 });
    expect(sentCount(provider)).toBe(0);
  });

  it("stops at a preference that is off or unknown, before reading anything about the week", async () => {
    const { provider, mem, run } = setup([person(U1, { candidate: { preferenceOn: false } }), person(U2, { candidate: { preferenceOn: null } })]);
    const summary = await run();
    expect(summary.skippedBy).toEqual({ preference_off: 1, preference_unknown: 1 });
    expect(mem.called("loadFact")).toBe(0);
    expect(mem.called("loadSendFacts")).toBe(0);
    expect(sentCount(provider)).toBe(0);
  });

  it("stops at a lifecycle that is not the weekly cycle", async () => {
    const { mem, run } = setup([person(U1, { candidate: { lifecycle: "FIRST_WEEK" } })]);
    expect((await run()).skippedBy).toEqual({ not_weekly_cycle: 1 });
    expect(mem.called("loadFact")).toBe(0);
  });

  it("reads nothing else when there is no card (no Offline, subscription or claim read)", async () => {
    const { mem, run } = setup([person(U1, { fact: null }), person(U2, { fact: { weekStart: "2026-10-11", card: false } })]);
    expect((await run()).skippedBy).toEqual({ no_moment: 1, card_closed: 1 });
    expect(mem.called("loadSendFacts")).toBe(0);
  });

  it("does not claim a person with no subscription, so a device that registers later in the window still gets the push", async () => {
    const { provider, mem, run } = setup([person(U1, { subscriptions: [] })]);
    expect((await run()).skippedBy).toEqual({ no_subscription: 1 });
    expect(mem.writes()).toHaveLength(0);
    mem.subscriptions.set(U1, [SUB_A]);
    expect((await run({ now: new Date(SUNDAY_0805.getTime() + 60 * 60_000) })).sent).toBe(1);
    expect(sentCount(provider)).toBe(1);
  });

  it("holds the push back, without using it up, when the card was opened or put away after the decision", async () => {
    let reads = 0;
    let snoozeOver = false;
    // First read (the decision): the card is there. Second read (just before the claim): the person has put it away.
    const fact = () => (snoozeOver || ++reads === 1 ? CARD : { weekStart: "2026-10-11", card: false });
    const { provider, mem, run } = setup([person(U1, { fact })]);
    const first = await run();
    expect(first.skippedBy).toEqual({ card_closed: 1 });
    expect(sentCount(provider)).toBe(0);
    expect(mem.writes()).toHaveLength(0);

    // The snooze ended, inside the window: the next tick sends it.
    snoozeOver = true;
    const later = await run({ now: new Date(SUNDAY_0805.getTime() + 24 * 60 * 60_000) });
    expect(later.sent).toBe(1);
  });

  it("holds the push back when the card now belongs to another week", async () => {
    let reads = 0;
    const fact = () => (++reads === 1 ? CARD : { weekStart: "2026-10-18", card: true });
    const { provider, run } = setup([person(U1, { fact })]);
    expect((await run()).skippedBy).toEqual({ card_closed: 1 });
    expect(sentCount(provider)).toBe(0);
  });
});

describe("a dry run", () => {
  it("counts what would go out, with NO write and NO provider call", async () => {
    const { provider, mem, run } = setup([person(U1), person(U2, { candidate: { preferenceOn: false } })]);
    const summary = await run({ live: false });
    expect(summary).toMatchObject({ dryRun: true, candidates: 2, due: 1, sent: 0, notSent: 0, skipped: 1 });
    expect(mem.writes()).toHaveLength(0);
    expect(sentCount(provider)).toBe(0);
  });

  it("is also what a live run without a provider becomes (it fails closed)", async () => {
    const { mem, run } = setup([person()], {}, null);
    const summary = await run({ live: true });
    expect(summary).toMatchObject({ dryRun: true, due: 1, sent: 0 });
    expect(mem.writes()).toHaveLength(0);
  });

  it("works before the migration is applied: the claim is treated as not made, and it is counted", async () => {
    const { provider, mem, run } = setup([person()], { migrationMissing: true });
    const summary = await run({ live: false });
    expect(summary).toMatchObject({ dryRun: true, due: 1, migrationPending: 1, aborted: null, failed: 0 });
    expect(weeklyPushNeedsAttention(summary)).toBe(false);
    expect(mem.writes()).toHaveLength(0);
    expect(sentCount(provider)).toBe(0);
  });

  it("is the same decision as a live run, only without the sending", async () => {
    const people = [person(U1), person(U2, { candidate: { quietHours: null } })];
    const dry = await setup(people).run({ live: false });
    const live = await setup(people).run({ live: true });
    expect(dry.due).toBe(live.due);
    expect(dry.skippedBy).toEqual(live.skippedBy);
  });
});

describe("a live run before the migration is applied", () => {
  it("stops, sends nothing and writes nothing", async () => {
    const { provider, mem, run } = setup([person()], { migrationMissing: true });
    const summary = await run();
    expect(summary).toMatchObject({ aborted: "migration_missing", sent: 0, due: 0 });
    expect(weeklyPushNeedsAttention(summary)).toBe(true);
    expect(mem.writes()).toHaveLength(0);
    expect(sentCount(provider)).toBe(0);
  });
});

describe("what the push service answers", () => {
  const scripted = (answer: (sub: PushSubscriptionRecord) => ReturnType<typeof FAKE_RESULTS.ok>) => new FakeNotificationProvider((send) => answer(send.subscription));

  it("a 410 deletes only that subscription and closes the claim as subscription_gone", async () => {
    const { mem, run } = setup([person(U1, { subscriptions: [SUB_A] })], {}, scripted(() => FAKE_RESULTS.gone(410)));
    const summary = await run();
    expect(summary).toMatchObject({ sent: 0, notSent: 1, subscriptionsDeleted: 1 });
    expect(summary.results).toMatchObject({ gone: 1 });
    expect(mem.subscriptions.get(U1)).toEqual([]);
    expect(mem.claims.get(`${U1}|${MOMENT}`)?.reason).toBe("subscription_gone");
    expect(weeklyPushNeedsAttention(summary)).toBe(true);
  });

  it("a dead phone and a live phone: the push is sent, only the dead one is deleted", async () => {
    const { mem, run } = setup([person(U1, { subscriptions: [SUB_A, SUB_B] })], {}, scripted((s) => (s.endpoint === SUB_A.endpoint ? FAKE_RESULTS.gone(404) : FAKE_RESULTS.ok())));
    const summary = await run();
    expect(summary).toMatchObject({ sent: 1, notSent: 0, subscriptionsDeleted: 1 });
    expect(mem.subscriptions.get(U1)).toEqual([SUB_B]);
    expect(mem.claims.get(`${U1}|${MOMENT}`)?.reason).toBeNull();
    expect(mem.stamped).toEqual([SUB_B.endpoint]);
  });

  it("a 403 deletes nothing and closes the claim as send_failed", async () => {
    const { mem, run } = setup([person()], {}, scripted(() => FAKE_RESULTS.rejected(403)));
    const summary = await run();
    expect(summary).toMatchObject({ sent: 0, notSent: 1, subscriptionsDeleted: 0 });
    expect(summary.results).toMatchObject({ rejected: 1 });
    expect(mem.subscriptions.get(U1)).toEqual([SUB_A]);
    expect(mem.claims.get(`${U1}|${MOMENT}`)?.reason).toBe("send_failed");
    expect(mem.called("deleteSubscription")).toBe(0);
  });

  it("a 503 or a timeout deletes nothing and is not retried on the next tick", async () => {
    const { provider, mem, run } = setup([person()], {}, scripted(() => FAKE_RESULTS.retryable(503)));
    const first = await run();
    expect(first).toMatchObject({ notSent: 1, subscriptionsDeleted: 0 });
    expect(first.results).toMatchObject({ retryable: 1 });
    expect(mem.claims.get(`${U1}|${MOMENT}`)?.reason).toBe("send_failed");
    const second = await run({ now: new Date(SUNDAY_0805.getTime() + 5 * 60_000) });
    expect(second.skippedBy).toEqual({ already_claimed: 1 });
    expect(sentCount(provider)).toBe(1);
  });

  it("an accepted push and a refused one: sent, nothing deleted", async () => {
    const { mem, run } = setup([person(U1, { subscriptions: [SUB_A, SUB_B] })], {}, scripted((s) => (s.endpoint === SUB_A.endpoint ? FAKE_RESULTS.ok() : FAKE_RESULTS.rejected(403))));
    const summary = await run();
    expect(summary).toMatchObject({ sent: 1, notSent: 0, subscriptionsDeleted: 0 });
    expect(mem.subscriptions.get(U1)).toHaveLength(2);
  });

  it("a provider that throws is counted, the claim is closed as send_failed, and it is never sent again", async () => {
    const provider = new FakeNotificationProvider(() => "throw");
    const { mem, run } = setup([person()], {}, provider);
    const summary = await run();
    expect(summary).toMatchObject({ sent: 0, notSent: 1, failed: 0 });
    expect(summary.results).toMatchObject({ providerThrew: 1, retryable: 1 });
    expect(mem.claims.get(`${U1}|${MOMENT}`)?.reason).toBe("send_failed");
    await run({ now: new Date(SUNDAY_0805.getTime() + 5 * 60_000) });
    expect(provider.sent).toHaveLength(1);
  });
});

describe("when a write fails", () => {
  it("does not send when the claim fails", async () => {
    const { provider, run } = setup([person()], { fail: { claim: true } });
    const summary = await run();
    expect(summary).toMatchObject({ failed: 1, sent: 0 });
    expect(sentCount(provider)).toBe(0);
  });

  it("counts a claim that could not be closed as stuck, and still never sends again", async () => {
    const { provider, mem, run } = setup([person()], { fail: { finish: true } });
    const first = await run();
    expect(first).toMatchObject({ sent: 1, stuck: 1 });
    expect(weeklyPushNeedsAttention(first)).toBe(true);
    // Within ten minutes a pending claim is a send in flight: skipped, and not reported as stuck.
    const soon = await run({ now: new Date(SUNDAY_0805.getTime() + 2 * 60_000) });
    expect(soon).toMatchObject({ stuck: 0, sent: 0 });
    // After ten minutes it is a crash: reported, and still not sent again.
    const later = await run({ now: new Date(SUNDAY_0805.getTime() + 11 * 60_000) });
    expect(later).toMatchObject({ stuck: 1, sent: 0 });
    expect(later.skippedBy).toEqual({ already_claimed: 1 });
    expect(weeklyPushNeedsAttention(later)).toBe(true);
    expect(sentCount(provider)).toBe(1);
    expect(mem.claims.get(`${U1}|${MOMENT}`)?.reason).toBe("pending");
  });

  it("still sends and closes the claim when stamping or deleting fails", async () => {
    const { mem, run } = setup([person()], { fail: { markSubscriptionSuccess: true } });
    expect(await run()).toMatchObject({ sent: 1, stuck: 0 });
    expect(mem.claims.get(`${U1}|${MOMENT}`)?.reason).toBeNull();
  });

  it("counts a person whose facts cannot be read as failed, and moves on", async () => {
    const { provider, run } = setup([person(U1, { subscriptions: null }), person(U2)]);
    const summary = await run();
    expect(summary).toMatchObject({ failed: 1, sent: 1, candidates: 2 });
    expect(sentCount(provider)).toBe(1);
  });

  it("counts an unknown claim read as failed, and sends nothing", async () => {
    const { provider, run } = setup([person()], { fail: { loadSendFacts: true } });
    expect(await run()).toMatchObject({ failed: 1, sent: 0 });
    expect(sentCount(provider)).toBe(0);
  });
});

describe("the limits of a run, and a run that never throws", () => {
  it("stops after the send cap", async () => {
    const ids = Array.from({ length: WEEKLY_PUSH_MAX_SENDS + 2 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    const { provider, run } = setup(ids.map((id, i) => person(id, { subscriptions: [{ ...SUB_A, endpoint: `${SUB_A.endpoint}-${i}` }] })));
    const summary = await run();
    expect(summary).toMatchObject({ aborted: "send_cap", sent: WEEKLY_PUSH_MAX_SENDS });
    expect(sentCount(provider)).toBe(WEEKLY_PUSH_MAX_SENDS);
    expect(weeklyPushNeedsAttention(summary)).toBe(true);
  });

  it("stops at the user cap and at the deadline", async () => {
    const three = [person("00000000-0000-4000-8000-000000000001"), person("00000000-0000-4000-8000-000000000002"), person("00000000-0000-4000-8000-000000000003")];
    expect((await setup(three).run({ live: false, maxUsers: 2 })).aborted).toBe("user_cap");
    let t = 0;
    const slow = await setup(three).run({ live: false, nowMs: () => (t += 10_000), deadlineMs: 15_000 });
    expect(slow.aborted).toBe("deadline");
    expect(slow.candidates).toBeLessThan(3);
  });

  it("walks every page of people", async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    const { mem, run } = setup(ids.map((id) => person(id)));
    const summary = await run({ live: false, pageSize: 2 });
    expect(summary).toMatchObject({ candidates: 5, due: 5 });
    expect(mem.called("listCandidates")).toBe(3);
  });

  it("aborts when the people cannot be read, and never throws", async () => {
    const { run } = setup([person()], { fail: { listCandidates: true } });
    expect(await run()).toMatchObject({ aborted: "candidates_failed", candidates: 0 });
  });

  it("one person's unexpected error never stops the others", async () => {
    const mem = createMemoryWeeklyPushStore([person(U1), person(U2)]);
    const flaky: WeeklyPushStore = {
      ...mem.store,
      loadFact: (userId, timeZone, now) => (userId === U1 ? Promise.reject(new Error("boom")) : mem.store.loadFact(userId, timeZone, now)),
    };
    const provider = new FakeNotificationProvider();
    const summary = await runWeeklyPush(flaky, provider, { now: SUNDAY_0805, live: true });
    expect(summary).toMatchObject({ failed: 1, sent: 1, candidates: 2 });
    expect(provider.sent).toHaveLength(1);
  });
});

describe("staged reading gives the same answer as deciding with everything read", () => {
  const PREFS = [true, false, null] as const;
  const LIFE = ["WEEKLY_CYCLE", "FIRST_WEEK"] as const;
  const FACTS: Array<WeeklyHomeFact | null> = [CARD, null, { weekStart: "2026-10-11", card: false }];
  const PERIODS: Array<OfflinePeriod[] | null> = [[], null, [{ type: "VACATION", start: new Date("2026-10-18T00:00:00Z"), end: new Date("2026-10-19T00:00:00Z") }]];
  const CLAIMS = ["none", "exists", "stuck"] as const;
  const QUIETS: Array<QuietHours | null> = [DEFAULT_QUIET, null, { kind: "WINDOW", startMinute: 480, endMinute: 540 }];
  const SUBS: PushSubscriptionRecord[][] = [[SUB_A], []];

  it("agrees on all 972 combinations: the same SEND or the same first closed gate", async () => {
    let checked = 0;
    for (const lifecycle of LIFE)
      for (const preferenceOn of PREFS)
        for (const fact of FACTS)
          for (const periods of PERIODS)
            for (const claim of CLAIMS)
              for (const quietHours of QUIETS)
                for (const subscriptions of SUBS) {
                  const claims: MemoryStoreOptions["claims"] = claim === "none" ? {} : { [`${U1}|${MOMENT}`]: { reason: claim === "stuck" ? "pending" : null, at: claim === "stuck" ? new Date(SUNDAY_0805.getTime() - 30 * 60_000) : SUNDAY_0805 } };
                  const mem = createMemoryWeeklyPushStore([person(U1, { candidate: { lifecycle, preferenceOn, quietHours }, fact, periods, subscriptions })], { claims });
                  const summary = await runWeeklyPush(mem.store, null, { now: SUNDAY_0805, live: false });

                  const full: WeeklyPushInput = {
                    now: SUNDAY_0805,
                    timeZone: "Asia/Jerusalem",
                    lifecycle,
                    preferenceOn,
                    fact,
                    periods,
                    quietHours,
                    subscriptionCount: subscriptions.length,
                    claimExists: claim !== "none",
                  };
                  const expected = decideWeeklyPush(full);
                  const label = JSON.stringify({ lifecycle, preferenceOn, fact: fact?.card ?? "none", periods: periods === null ? "null" : periods.length, claim, quiet: quietHours?.kind ?? "null", subs: subscriptions.length });
                  if (expected.kind === "SEND") {
                    expect(summary.due, label).toBe(1);
                    expect(summary.skipped, label).toBe(0);
                  } else {
                    expect(summary.due, label).toBe(0);
                    expect(summary.skippedBy, label).toEqual({ [expected.reason]: 1 });
                  }
                  checked += 1;
                }
    expect(checked).toBe(972);
  });
});

describe("what a run reveals", () => {
  it("puts no user id, endpoint, key or notification text in the summary or in any log, even when things go wrong", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const people = [person(U1, { subscriptions: [SUB_A, SUB_B] }), person(U2, { subscriptions: [{ ...SUB_A, endpoint: "https://web.push.apple.com/ccc-endpoint-secret", p256dh: "p256dh-ccc", auth: "auth-ccc" }] })];
    const provider = new FakeNotificationProvider((send, index) => (index === 0 ? FAKE_RESULTS.gone(410) : index === 1 ? "throw" : FAKE_RESULTS.rejected(403)));
    const { run } = setup(people, { fail: { finish: true } }, provider);
    const summary = await run();
    const everything = JSON.stringify([summary, info.mock.calls, error.mock.calls]);
    for (const secret of [U1, U2, SUB_A.endpoint, SUB_B.endpoint, "ccc-endpoint-secret", "p256dh-aaa", "auth-aaa", "p256dh-bbb", "auth-bbb", "יש לי כמה מילים"]) {
      expect(everything, secret).not.toContain(secret);
    }
  });

  it("calls a quiet, ordinary skip normal, and a failure or a stuck claim for attention", () => {
    const base = { candidates: 1, due: 0, sent: 0, notSent: 0, subscriptionsDeleted: 0, results: { ok: 0, gone: 0, rejected: 0, retryable: 0, providerThrew: 0 }, skipped: 1, skippedBy: { quiet_hours: 1 }, failed: 0, stuck: 0, migrationPending: 0, dryRun: false, aborted: null } as const;
    expect(weeklyPushNeedsAttention(base)).toBe(false);
    expect(weeklyPushNeedsAttention({ ...base, failed: 1 })).toBe(true);
    expect(weeklyPushNeedsAttention({ ...base, stuck: 1 })).toBe(true);
    expect(weeklyPushNeedsAttention({ ...base, notSent: 1 })).toBe(true);
    expect(weeklyPushNeedsAttention({ ...base, aborted: "deadline" })).toBe(true);
    expect(weeklyPushNeedsAttention({ ...base, migrationPending: 1 })).toBe(false);
  });
});
