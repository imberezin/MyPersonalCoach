/**
 * Web Push in the browser: what state the device is in, and a check of the subscription the
 * browser hands back before it is stored. Pure; the browser APIs are read elsewhere and passed in
 * as a snapshot.
 */

export type PushState = "checking" | "ios_needs_install" | "unsupported" | "not_configured" | "denied" | "ready";

export interface PushEnvSnapshot {
  isIOS: boolean;
  isStandalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: "default" | "granted" | "denied";
  hasPublicKey: boolean;
}

/**
 * Null means "not read yet" (server render and first paint). The order matters: an iPhone
 * browser tab lacks the push APIs until the app is added to the Home Screen, so it is asked to
 * install before it is called unsupported.
 */
export function derivePushState(s: PushEnvSnapshot | null): PushState {
  if (s === null) return "checking";
  if (s.isIOS && !s.isStandalone) return "ios_needs_install";
  if (!s.hasServiceWorker || !s.hasPushManager || !s.hasNotification) return "unsupported";
  if (!s.hasPublicKey) return "not_configured";
  if (s.permission === "denied") return "denied";
  return "ready";
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Decodes base64url, padded or not. Null for anything that is not valid base64url. */
function decodeBase64Url(input: string): Uint8Array<ArrayBuffer> | null {
  const unpadded = input.replace(/={1,2}$/, "");
  if (!BASE64URL.test(unpadded) || unpadded.length % 4 === 1) return null;

  const padded = unpadded.padEnd(unpadded.length + ((4 - (unpadded.length % 4)) % 4), "=");
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  // An explicit ArrayBuffer: with TypeScript 5.9 a BufferSource must not be backed by a SharedArrayBuffer.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The VAPID public key in the form pushManager.subscribe() wants. Throws on malformed input. */
export function urlBase64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bytes = decodeBase64Url(b64.trim());
  if (bytes === null) throw new Error("Not a base64url string");
  return bytes;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const MAX_ENDPOINT_LENGTH = 2048;
// An uncompressed P-256 point: 0x04 followed by two 32-byte coordinates.
const P256DH_BYTES = 65;
const AUTH_BYTES = 16;

/**
 * Checks the serialised subscription (the browser's toJSON form) before it is stored.
 * Extra properties are ignored. The result has only the three values the table keeps.
 */
export function parsePushSubscription(
  input: unknown,
): { ok: true; value: { endpoint: string; p256dh: string; auth: string } } | { ok: false } {
  if (typeof input !== "object" || input === null) return { ok: false };
  const { endpoint, keys } = input as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return { ok: false };
  }
  if (typeof keys !== "object" || keys === null) return { ok: false };
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== "string" || typeof auth !== "string") return { ok: false };

  const publicKey = decodeBase64Url(p256dh);
  if (publicKey === null || publicKey.length !== P256DH_BYTES || publicKey[0] !== 0x04) return { ok: false };
  const secret = decodeBase64Url(auth);
  if (secret === null || secret.length !== AUTH_BYTES) return { ok: false };

  return { ok: true, value: { endpoint, p256dh, auth } };
}
