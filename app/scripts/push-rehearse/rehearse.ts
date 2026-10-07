import { buildWeeklySummaryPush } from "@/lib/notifications/messages";
import type { NotificationProvider, PushSubscriptionRecord, SendResult } from "@/lib/notifications/types";

/**
 * The device rehearsal of the weekly summary push (step 6 of TODO.md section 4): ONE real push, built by the same function the
 * sender uses (so the words, the path /week, the tag and the direction are exactly the approved ones), sent through the real
 * provider to the owner's own phone. It READS the push subscriptions and WRITES NOTHING: not to the database, not to the
 * notification log, and it never deletes a dead subscription. The output is counts, the push service host and a result code:
 * never an endpoint, a key, a user id or the text of a subscription.
 */

export interface RehearseArgs {
  /** Without it nothing is sent: the run only shows what it would do. */
  yes: boolean;
  /** Restrict to one person's subscriptions. Without it the table must hold exactly one subscription. */
  userId: string | null;
}

export type ParsedArgs = { ok: true; value: RehearseArgs } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The flags come from the wrapper as JSON (REHEARSE_ARGS). Anything unknown is an error: a typo must not turn a dry run into a send. */
export function parseRehearseArgs(raw: string | undefined): ParsedArgs {
  let flags: unknown;
  try {
    flags = raw === undefined || raw === "" ? {} : JSON.parse(raw);
  } catch {
    return { ok: false, error: "The flags could not be read." };
  }
  if (typeof flags !== "object" || flags === null || Array.isArray(flags)) return { ok: false, error: "The flags could not be read." };

  const record = flags as Record<string, unknown>;
  for (const name of Object.keys(record)) {
    if (name !== "yes" && name !== "user-id") return { ok: false, error: `Unknown flag --${name}. The flags are --yes and --user-id <uuid>.` };
  }
  if ("yes" in record && record.yes !== true) return { ok: false, error: "--yes takes no value." };

  let userId: string | null = null;
  if ("user-id" in record) {
    const value = record["user-id"];
    if (typeof value !== "string" || !UUID.test(value)) return { ok: false, error: "--user-id must be a user id (a uuid)." };
    userId = value.toLowerCase();
  }
  return { ok: true, value: { yes: record.yes === true, userId } };
}

export interface StoredSubscription extends PushSubscriptionRecord {
  userId: string;
}

export interface RehearseDeps {
  /** Reads only: push_subscriptions (all, or one user's). Never writes. `null` = the read failed. */
  readSubscriptions(userId: string | null): Promise<StoredSubscription[] | null>;
  /** The person's language (profiles.language); anything unreadable is Hebrew. */
  readLanguage(userId: string): Promise<unknown>;
  /** null when the push keys are not available. */
  provider: NotificationProvider | null;
  /** Where the keys came from, by file NAME only (never a value). */
  keySource: string;
  log(line: string): void;
}

export type RehearseResult =
  | { ok: true; sent: number; delivered: number }
  | { ok: false; code: "bad_args" | "no_keys" | "read_failed" | "no_subscription" | "ambiguous" };

const hostOf = (endpoint: string): string => {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unreadable";
  }
};

function describe(result: SendResult): string {
  const status = "statusCode" in result && result.statusCode !== undefined ? ` (status ${result.statusCode})` : "";
  switch (result.outcome) {
    case "ok":
      return "accepted by the push service";
    case "gone":
      return `the subscription is gone${status}: it was NOT deleted (this script writes nothing)`;
    case "rejected":
      return `refused${status}: if this is 403, the push keys differ from the ones the phone subscribed with`;
    case "retryable":
      return `a temporary failure${status}: nothing was retried`;
  }
}

/**
 * Dry (no --yes): reads, builds the message and says what it would send; calls no provider. With --yes: sends ONE push to every
 * subscription found (one person, normally one phone), and prints the outcome of each.
 */
export async function runRehearsal(args: RehearseArgs, deps: RehearseDeps): Promise<RehearseResult> {
  const { log } = deps;
  if (deps.provider === null) {
    log("The push keys are not available (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). Nothing was read or sent.");
    return { ok: false, code: "no_keys" };
  }

  const subscriptions = await deps.readSubscriptions(args.userId);
  if (subscriptions === null) {
    log("The subscriptions could not be read. Nothing was sent.");
    return { ok: false, code: "read_failed" };
  }
  if (subscriptions.length === 0) {
    log("No push subscription was found. Nothing was sent.");
    return { ok: false, code: "no_subscription" };
  }
  const people = new Set(subscriptions.map((s) => s.userId));
  if (args.userId === null && people.size > 1) {
    log(`Found subscriptions of ${people.size} different people. Run it again with --user-id <uuid>. Nothing was sent.`);
    return { ok: false, code: "ambiguous" };
  }

  const language = await deps.readLanguage(subscriptions[0].userId);
  // The tag is its own, so the rehearsal can never replace the notification of a real week on the lock screen.
  const message = { ...buildWeeklySummaryPush({ language, weekStart: "rehearsal" }), tag: "rehearsal" };

  log(`Push keys from: ${deps.keySource}`);
  log(`Subscriptions: ${subscriptions.length}`);
  log(`The message: "${message.title}" / "${message.body}" (language ${message.lang}, opens ${message.url})`);
  if (!args.yes) {
    log("DRY RUN: nothing was sent. Add --yes to send ONE real push to each subscription above.");
    return { ok: true, sent: 0, delivered: 0 };
  }

  let delivered = 0;
  let index = 0;
  for (const subscription of subscriptions) {
    index += 1;
    let result: SendResult;
    try {
      result = await deps.provider.send({ endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth }, message);
    } catch {
      result = { ok: false, outcome: "retryable", gone: false };
    }
    if (result.ok) delivered += 1;
    log(`Subscription ${index} (${hostOf(subscription.endpoint)}): ${describe(result)}`);
  }
  log(`Sent ${subscriptions.length}, accepted ${delivered}. Nothing was written anywhere.`);
  return { ok: true, sent: subscriptions.length, delivered };
}
