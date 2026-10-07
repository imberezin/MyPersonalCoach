import type { NotificationProvider, PushMessage, PushSubscriptionRecord, SendResult } from "./types";

/** The results a test or a local rehearsal can script. */
export const FAKE_RESULTS = {
  ok: (): SendResult => ({ ok: true, outcome: "ok" }),
  gone: (statusCode: 404 | 410 = 410): SendResult => ({ ok: false, outcome: "gone", gone: true, statusCode }),
  rejected: (statusCode = 403): SendResult => ({ ok: false, outcome: "rejected", gone: false, statusCode }),
  retryable: (statusCode = 503): SendResult => ({ ok: false, outcome: "retryable", gone: false, statusCode }),
} as const;

export type FakeBehaviorName = "ok" | "gone" | "rejected" | "retryable" | "throw";

const BEHAVIORS: readonly FakeBehaviorName[] = ["ok", "gone", "rejected", "retryable", "throw"];

/** An unknown or missing value is "ok". */
export function parseFakeBehavior(value: string | undefined): FakeBehaviorName {
  return BEHAVIORS.find((name) => name === value) ?? "ok";
}

export interface FakeSend {
  subscription: PushSubscriptionRecord;
  message: PushMessage;
}

/** What the fake answers for one send: a result, or the word "throw" to simulate a provider that breaks its contract. */
export type FakeScript = (send: FakeSend, index: number) => SendResult | "throw";

/**
 * A provider that sends nothing. It records every send (the subscription and the message) and answers by a script, so the
 * sender's decisions can be tested and rehearsed with no network. Deterministic. It is refused in production by the factory.
 */
export class FakeNotificationProvider implements NotificationProvider {
  readonly sent: FakeSend[] = [];

  constructor(private readonly script: FakeScript = () => FAKE_RESULTS.ok()) {}

  static fromBehavior(name: FakeBehaviorName): FakeNotificationProvider {
    return new FakeNotificationProvider(() => (name === "throw" ? "throw" : FAKE_RESULTS[name]()));
  }

  async send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<SendResult> {
    const send = { subscription, message };
    const index = this.sent.length;
    this.sent.push(send);
    const answer = this.script(send, index);
    if (answer === "throw") throw new Error("fake provider: scripted failure");
    return answer;
  }
}
