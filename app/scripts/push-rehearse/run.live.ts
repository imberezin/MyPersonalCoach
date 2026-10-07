import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { it } from "vitest";
import { createNotificationProvider } from "@/lib/notifications/factory";
import { parseRehearseArgs, runRehearsal, type StoredSubscription } from "./rehearse";

// vitest does not show the console output of a test that passes, so the lines go straight to the terminal.
const write = (line: string) => process.stdout.write(line + "\n");

// The live runner of `npm run push:rehearse` (see scripts/push-rehearse.mjs). It is a "test" only because vitest is the one runner
// that can import the app's TypeScript (vitest.config.mts); `npm test` never includes it. The OWNER runs it, once, on purpose.
//
// It READS the hosted push subscriptions (and one profile language) with the server key from app/.env.local and sends one real
// push with the real provider. It has no write call of any kind (tests/push-rehearse pins that in the source). It prints counts,
// the push service host and result codes: never a key, an endpoint, a user id or a subscription.

const appRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");

/** KEY=value lines of an environment file, or null when the file does not exist. Values are never printed. */
function readEnvFile(name: string): Record<string, string> | null {
  const path = join(appRoot, name);
  if (!existsSync(path)) return null;
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const VAPID_NAMES = ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

it("push-rehearse", async () => {
  const parsed = parseRehearseArgs(process.env.REHEARSE_ARGS);
  if (!parsed.ok) throw new Error(parsed.error);

  const local = readEnvFile(".env.local") ?? {};
  const vercel = readEnvFile(".env.vercel") ?? {};

  // The push keys must be the PRODUCTION ones: the phone subscribed against the production public key, and a push service
  // refuses (403) a push signed with any other key. The shell wins, then .env.vercel (a copy of the production values),
  // then .env.local. Whichever source has all three is used, and only its NAME is printed.
  const sources: Array<[string, Record<string, string | undefined>]> = [
    ["your shell", process.env],
    [".env.vercel", vercel],
    [".env.local", local],
  ];
  const source = sources.find(([, env]) => VAPID_NAMES.every((name) => Boolean(env[name])));
  // nodeEnv "production": this script never uses the fake provider.
  const provider = source ? createNotificationProvider({ env: { ...source[1], PUSH_PROVIDER: undefined }, nodeEnv: "production" }) : null;

  const url = local.SUPABASE_PROJECT_URL_1;
  const key = local.SUPABASE_SECRET_KEY_1;
  const client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

  const result = await runRehearsal(parsed.value, {
    provider,
    keySource: source ? source[0] : "none",
    log: (line) => write(line),
    async readSubscriptions(userId) {
      if (client === null) return null;
      let query = client.from("push_subscriptions").select("user_id, endpoint, p256dh, auth").order("created_at").limit(50);
      if (userId !== null) query = query.eq("user_id", userId);
      const { data, error } = await query;
      if (error || !Array.isArray(data)) return null;
      return data.map((row): StoredSubscription => ({ userId: row.user_id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }));
    },
    async readLanguage(userId) {
      if (client === null) return null;
      const { data } = await client.from("profiles").select("language").eq("user_id", userId).limit(1);
      return Array.isArray(data) && data.length > 0 ? (data[0] as { language?: unknown }).language : null;
    },
  });
  if (!result.ok) throw new Error(`push-rehearse stopped: ${result.code}`);
});
