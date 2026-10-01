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

export type SendResult =
  | { ok: true }
  /** `gone` means the subscription is no longer valid (404 or 410) and should be deleted. */
  | { ok: false; gone: boolean; statusCode?: number };

export interface NotificationProvider {
  send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<SendResult>;
}
