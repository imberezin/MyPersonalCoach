import "server-only";
import { FakeNotificationProvider, parseFakeBehavior } from "./fake";
import type { NotificationProvider } from "./types";
import { createWebPushProvider } from "./webpush";

type Env = Record<string, string | undefined>;

/**
 * The provider the sender uses, or null when none can run. Built from the environment, never throws.
 *  - `PUSH_PROVIDER=fake` is the visible fake, and ONLY outside production: in production it is refused (null), so a leftover
 *    variable can never make the sender pretend to send. `PUSH_FAKE_BEHAVIOR` (ok, gone, rejected, retryable, throw) scripts it.
 *  - Otherwise the real provider, and only when all three VAPID values exist. Read at call time, never at module load: the CI
 *    build runs without them.
 */
export function createNotificationProvider(options: { env?: Env; nodeEnv?: string } = {}): NotificationProvider | null {
  try {
    const env = options.env ?? process.env;
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "production";
    if (env.PUSH_PROVIDER === "fake") {
      return nodeEnv === "production" ? null : FakeNotificationProvider.fromBehavior(parseFakeBehavior(env.PUSH_FAKE_BEHAVIOR));
    }
    return createWebPushProvider(env);
  } catch {
    return null;
  }
}
