import "server-only";
import webpush from "web-push";
import type { NotificationProvider, PushMessage, PushSubscriptionRecord, SendResult } from "./types";

/** Push payloads are limited to about 4 KB; stay clearly below it. */
export const MAX_PAYLOAD_BYTES = 3800;
const TWELVE_HOURS_SECONDS = 12 * 60 * 60;
/** web-push's `timeout` is a SOCKET timeout (no byte for this long aborts the request). */
export const SOCKET_TIMEOUT_MS = 8_000;
/** The whole send, whatever the socket does. A slow-drip answer cannot hold the run past this. */
export const SEND_DEADLINE_MS = 10_000;

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

type Env = Record<string, string | undefined>;

/** Network and timeout failures of Node (ECONNRESET, ETIMEDOUT, ENOTFOUND, ...) and web-push's own socket timeout. */
function isTransportError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (typeof code === "string" && /^E[A-Z]+$/.test(code)) || message === "Socket timeout";
}

/**
 * Status code to outcome. Only 404 and 410 are `gone`. 408 and 429 are temporary, like every 5xx. Any other 4xx is a refusal a
 * repeat would not fix. A missing code is a transport failure (temporary) or a library error about the subscription itself
 * (not temporary): the caller says which.
 */
function classify(statusCode: number): SendResult {
  if (statusCode === 404 || statusCode === 410) return { ok: false, outcome: "gone", gone: true, statusCode };
  if (statusCode === 408 || statusCode === 429 || statusCode >= 500) return { ok: false, outcome: "retryable", gone: false, statusCode };
  return { ok: false, outcome: "rejected", gone: false, statusCode };
}

export class WebPushProvider implements NotificationProvider {
  constructor(private readonly vapid: VapidConfig) {}

  /** Never throws, never logs: no endpoint, key or text ever leaves this method except to the push service. */
  async send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<SendResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const payload = JSON.stringify(message);
      if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) return { ok: false, outcome: "rejected", gone: false };

      const sending = webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
        { vapidDetails: this.vapid, TTL: TWELVE_HOURS_SECONDS, urgency: "normal", timeout: SOCKET_TIMEOUT_MS },
      );
      const deadline = new Promise<"deadline">((resolve) => {
        timer = setTimeout(() => resolve("deadline"), SEND_DEADLINE_MS);
      });
      const winner = await Promise.race([sending, deadline]);
      if (winner === "deadline") {
        // The request may still finish later; its outcome is dropped, and a rejection must not become unhandled.
        sending.catch(() => undefined);
        return { ok: false, outcome: "retryable", gone: false };
      }
      return { ok: true, outcome: "ok" };
    } catch (error) {
      const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
      if (typeof statusCode === "number") return classify(statusCode);
      return { ok: false, outcome: isTransportError(error) ? "retryable" : "rejected", gone: false };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/** Null until all three VAPID values exist (generate with `npx web-push generate-vapid-keys`). Pure on `env`. */
export function createWebPushProvider(env: Env): WebPushProvider | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return new WebPushProvider({ subject, publicKey, privateKey });
}

/** Returns null until the VAPID keys exist (generate with `npx web-push generate-vapid-keys`). */
export function createWebPushProviderFromEnv(): WebPushProvider | null {
  return createWebPushProvider(process.env);
}
