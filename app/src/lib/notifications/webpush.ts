import "server-only";
import webpush from "web-push";
import type { NotificationProvider, PushMessage, PushSubscriptionRecord, SendResult } from "./types";

/** Push payloads are limited to about 4 KB; stay clearly below it. */
const MAX_PAYLOAD_BYTES = 3800;
const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export class WebPushProvider implements NotificationProvider {
  constructor(private readonly vapid: VapidConfig) {}

  async send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<SendResult> {
    const payload = JSON.stringify(message);
    if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) {
      throw new Error("Push payload is too large");
    }

    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
        { vapidDetails: this.vapid, TTL: TWELVE_HOURS_SECONDS, urgency: "normal" },
      );
      return { ok: true };
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      return { ok: false, gone: statusCode === 404 || statusCode === 410, statusCode };
    }
  }
}

/** Returns null until the VAPID keys exist (generate with `npx web-push generate-vapid-keys`). */
export function createWebPushProviderFromEnv(): WebPushProvider | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return new WebPushProvider({ subject, publicKey, privateKey });
}
