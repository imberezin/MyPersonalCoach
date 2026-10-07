import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { USER_A, USER_B, as, createTestDb } from "./harness";

/**
 * The SQL the sender's store (src/lib/notify/weeklyPushStore.ts) turns its calls into, run as the service role on a real Postgres.
 * The store's own tests (weeklyPushStore.test.ts) pin which calls it makes; here the same statements are run to prove what they DO:
 * a claim ends exactly one row, and a subscription is deleted or stamped only when user, endpoint and both keys all match.
 * PGlite has one connection, so this is the semantics of the statements, not a race. The real PostgREST path is rehearsed on the
 * local Supabase (step 10 of TODO.md section 4).
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("delete from public.notification_log; delete from public.push_subscriptions;");
});

const asServer = <T>(fn: () => Promise<T>) => as(db, "service_role", null, fn);
const asA = <T>(fn: () => Promise<T>) => as(db, "authenticated", USER_A, fn);

const E1 = "https://web.push.apple.com/endpoint-one";
const E2 = "https://web.push.apple.com/endpoint-two";

async function subscribe(userId: string, endpoint: string, p256dh: string, auth: string) {
  await db.query("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)", [userId, endpoint, p256dh, auth]);
}

const subs = async () =>
  (await db.query<{ user_id: string; endpoint: string; p256dh: string; last_success_at: Date | null }>("select user_id, endpoint, p256dh, last_success_at from public.push_subscriptions order by endpoint")).rows;

describe("the claim and its end", () => {
  const claim = (userId: string, moment: string) =>
    asServer(() =>
      db.query("insert into public.notification_log (user_id, channel, kind, moment_key, suppressed_reason, sent_at) values ($1, 'web_push', 'weekly_summary', $2, 'pending', $3::timestamptz)", [
        userId,
        moment,
        "2026-10-18T05:05:00Z",
      ]),
    );

  const finish = (userId: string, moment: string, reason: string | null) =>
    asServer(() =>
      db.query<{ id: string }>(
        "update public.notification_log set suppressed_reason = $1, sent_at = $2::timestamptz where user_id = $3 and kind = 'weekly_summary' and moment_key = $4 returning id",
        [reason, "2026-10-18T05:05:07Z", userId, moment],
      ),
    );

  it("ends exactly the claimed row: another week of the same person, and the same week of another person, stay pending", async () => {
    await claim(USER_A, "weekly:2026-10-11");
    await claim(USER_A, "weekly:2026-10-18");
    await claim(USER_B, "weekly:2026-10-11");

    const done = await finish(USER_A, "weekly:2026-10-11", null);
    expect(done.rows).toHaveLength(1);

    const { rows } = await db.query<{ user_id: string; moment_key: string; suppressed_reason: string | null }>(
      "select user_id, moment_key, suppressed_reason from public.notification_log order by user_id, moment_key",
    );
    expect(rows).toEqual([
      { user_id: USER_A, moment_key: "weekly:2026-10-11", suppressed_reason: null },
      { user_id: USER_A, moment_key: "weekly:2026-10-18", suppressed_reason: "pending" },
      { user_id: USER_B, moment_key: "weekly:2026-10-11", suppressed_reason: "pending" },
    ]);
  });

  it("ends nothing when there is no claim (the statement matches zero rows)", async () => {
    expect((await finish(USER_A, "weekly:2026-10-11", null)).rows).toHaveLength(0);
  });

  it("leaves a crashed claim visible: it stays pending until someone ends or deletes it", async () => {
    await claim(USER_A, "weekly:2026-10-11");
    const { rows } = await db.query<{ suppressed_reason: string }>("select suppressed_reason from public.notification_log");
    expect(rows).toEqual([{ suppressed_reason: "pending" }]);
  });
});

describe("deleting and stamping a subscription", () => {
  const del = (userId: string, endpoint: string, p256dh: string, auth: string) =>
    asServer(() => db.query<{ id: string }>("delete from public.push_subscriptions where user_id = $1 and endpoint = $2 and p256dh = $3 and auth = $4 returning id", [userId, endpoint, p256dh, auth]));

  it("deletes the matching row, and only it", async () => {
    await subscribe(USER_A, E1, "k1", "a1");
    await subscribe(USER_A, E2, "k2", "a2");
    expect((await del(USER_A, E1, "k1", "a1")).rows).toHaveLength(1);
    expect((await subs()).map((s) => s.endpoint)).toEqual([E2]);
  });

  it("does NOT delete a row the browser just saved again with new keys (the upsert on the endpoint)", async () => {
    await subscribe(USER_A, E1, "old-key", "old-auth");
    // What onboarding's saveSubscription does: the same endpoint, fresh keys.
    await db.query("update public.push_subscriptions set p256dh = 'new-key', auth = 'new-auth' where endpoint = $1", [E1]);
    expect((await del(USER_A, E1, "old-key", "old-auth")).rows).toHaveLength(0);
    expect(await subs()).toMatchObject([{ endpoint: E1, p256dh: "new-key" }]);
  });

  it("does not delete another person's subscription, even with the right endpoint and keys", async () => {
    await subscribe(USER_B, E1, "k1", "a1");
    expect((await del(USER_A, E1, "k1", "a1")).rows).toHaveLength(0);
    expect(await subs()).toHaveLength(1);
  });

  it("stamps last_success_at on the matching row only", async () => {
    await subscribe(USER_A, E1, "k1", "a1");
    await subscribe(USER_A, E2, "k2", "a2");
    const stamped = await asServer(() =>
      db.query<{ id: string }>(
        "update public.push_subscriptions set last_success_at = $1::timestamptz where user_id = $2 and endpoint = $3 and p256dh = $4 and auth = $5 returning id",
        ["2026-10-18T05:05:07Z", USER_A, E1, "k1", "a1"],
      ),
    );
    expect(stamped.rows).toHaveLength(1);
    const rows = await subs();
    expect(rows.map((r) => [r.endpoint, r.last_success_at?.toISOString() ?? null])).toEqual([
      [E1, "2026-10-18T05:05:07.000Z"],
      [E2, null],
    ]);
  });

  it("is a write only the server may make to the log, while the owner keeps control of their own subscriptions", async () => {
    await subscribe(USER_A, E1, "k1", "a1");
    // The owner (the browser's own client) can still delete their own subscription: that is how a person turns push off.
    await asA(() => db.query("delete from public.push_subscriptions where endpoint = $1", [E1]));
    expect(await subs()).toHaveLength(0);
  });
});

describe("who the sender looks at", () => {
  it("lists only people in the weekly cycle, in user id order, with their preferences in a second read", async () => {
    // USER_A stays NEW (the default). USER_B finished onboarding and the First Week and is in the weekly cycle.
    await db.query("update public.profiles set lifecycle_state = 'WEEKLY_CYCLE', onboarding_completed_at = now(), first_week_started_at = now(), first_week_ended_at = now() where user_id = $1", [USER_B]);
    await db.query("update public.user_preferences set notifications = jsonb_set(notifications, '{weekly_summary}', 'true') where user_id = $1", [USER_B]);

    const profiles = await asServer(() => db.query<{ user_id: string }>("select user_id from public.profiles where lifecycle_state = 'WEEKLY_CYCLE' order by user_id limit 50"));
    expect(profiles.rows.map((r) => r.user_id)).toEqual([USER_B]);

    const prefs = await asServer(() => db.query<{ notifications: Record<string, boolean>; quiet_hours_start: string; quiet_hours_end: string }>("select notifications, quiet_hours_start, quiet_hours_end from public.user_preferences where user_id = any($1::uuid[])", [[USER_B]]));
    expect(prefs.rows[0].notifications.weekly_summary).toBe(true);
    expect([prefs.rows[0].quiet_hours_start, prefs.rows[0].quiet_hours_end]).toEqual(["00:00:00", "08:00:00"]);
  });
});
