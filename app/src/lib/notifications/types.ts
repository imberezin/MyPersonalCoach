export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Path opened when the notification is tapped. */
  url?: string;
  /** Replaces an earlier notification with the same tag. */
  tag?: string;
  lang?: "he" | "en";
  dir?: "rtl" | "ltr";
}

/**
 * What a send came to, in the only terms the sender acts on:
 *  - `ok`: the push service accepted it (201).
 *  - `gone`: the subscription is dead (404 or 410): the one answer that lets the sender delete the matching row.
 *  - `rejected`: the push service or the library refused it for a reason a repeat would not fix (400, 401, 403, 413, a payload that
 *    is too large, a subscription the library cannot read). Never deletes anything.
 *  - `retryable`: a temporary failure (429, 5xx, a network error or a timeout). Never deletes anything.
 * There is no automatic retry anyway (at-most-once); the split decides only what is written to the log and what is deleted.
 */
export type SendOutcome = "ok" | "gone" | "rejected" | "retryable";

export type SendResult =
  | { ok: true; outcome: "ok" }
  /** `gone` is true exactly when the outcome is `gone` (404 or 410). */
  | { ok: false; outcome: Exclude<SendOutcome, "ok">; gone: boolean; statusCode?: number };

export interface NotificationProvider {
  /** Never throws: every failure is a result. */
  send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<SendResult>;
}
