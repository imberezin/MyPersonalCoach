import { urlBase64ToBytes, type PushEnvSnapshot, type PushSubscriptionInput } from "@/domain/push";

/** The device facts that do not depend on the server's configuration. */
export type PushDeviceEnv = Omit<PushEnvSnapshot, "hasPublicKey">;

// A small external store for useSyncExternalStore: the browser APIs are read here, never during
// render, and nothing calls setState from an effect. The only thing that changes while the page is
// open is the permission, so the one writer (askPermission) tells the listeners.
const listeners = new Set<() => void>();

export function subscribeToEnv(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyEnvChanged(): void {
  for (const listener of listeners) listener();
}

/**
 * The device facts as a JSON string. A string compares by value, so useSyncExternalStore sees the
 * same snapshot until something really changed.
 */
export function getEnvSnapshot(): string {
  const userAgent = navigator.userAgent;
  // iPadOS reports itself as a Mac; a Mac with a touch screen is an iPad.
  const isIOS = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
  const hasNotification = "Notification" in window;
  const env: PushDeviceEnv = {
    isIOS,
    isStandalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification,
    permission: hasNotification ? Notification.permission : "default",
  };
  return JSON.stringify(env);
}

/** The server render and the first client render know nothing about the device yet. */
export function getServerEnvSnapshot(): string | null {
  return null;
}

/**
 * Registered as soon as the panel opens, never first inside the click handler: waiting for
 * serviceWorker.ready after the tap would hang when nothing had been registered. A failure shows
 * up later as a timeout in subscribeThisDevice.
 */
export function registerServiceWorker(): void {
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
}

/**
 * Must be the first thing a tap handler awaits: iOS only shows the prompt for a call made inside
 * the user gesture.
 */
export async function askPermission(): Promise<NotificationPermission> {
  try {
    return await Notification.requestPermission();
  } finally {
    notifyEnvChanged();
  }
}

const READY_TIMEOUT_MS = 15_000;

class ReadyTimeout extends Error {}

export type SubscribeResult =
  | { ok: true; subscription: PushSubscriptionInput }
  | { ok: false; reason: "timeout" | "subscribe" };

function sameKey(existing: ArrayBuffer | null, key: Uint8Array): boolean {
  if (existing === null || existing.byteLength !== key.byteLength) return false;
  const bytes = new Uint8Array(existing);
  return bytes.every((value, index) => value === key[index]);
}

/**
 * Subscribes this device to push with the app's VAPID key and returns the serialised form the
 * server stores ({ endpoint, keys }), never the PushSubscription object itself.
 */
export async function subscribeThisDevice(publicKey: string): Promise<SubscribeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ReadyTimeout()), READY_TIMEOUT_MS);
    });
    const registration = await Promise.race([navigator.serviceWorker.ready, timeout]);

    const key = urlBase64ToBytes(publicKey);
    // A subscription made with another key cannot be reused: the browser would refuse the new one.
    const existing = await registration.pushManager.getSubscription();
    if (existing && !sameKey(existing.options.applicationServerKey, key)) await existing.unsubscribe();

    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return { ok: true, subscription: JSON.parse(JSON.stringify(subscription)) as PushSubscriptionInput };
  } catch (error) {
    return { ok: false, reason: error instanceof ReadyTimeout ? "timeout" : "subscribe" };
  } finally {
    clearTimeout(timer);
  }
}
