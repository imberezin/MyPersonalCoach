import "server-only";
import { createWebPushProviderFromEnv } from "./webpush";

/**
 * What the browser needs to offer push notifications. `configured` means the server can also
 * send (all three VAPID variables exist); `publicKey` is what `pushManager.subscribe` takes.
 */
export function getPushClientConfig(): { configured: boolean; publicKey: string | null } {
  return {
    configured: createWebPushProviderFromEnv() !== null,
    // A static reference, so Next.js inlines it into the browser bundle too.
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
  };
}
