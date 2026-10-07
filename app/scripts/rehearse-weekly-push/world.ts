import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { localDayOf, resolveTimeZone } from "@/domain/time";
import { weekWindowOf } from "@/domain/weekly";
import { DEV_CLOCK_FILE } from "@/lib/clock/now";
import { readClockFile, removeClockFile, writeClockFile } from "../seed-demo/clockfile";
import { assertLocalStack } from "./guards";
import type { LogRow, RehearsalWorld, RouteAnswer } from "./rehearse";

/**
 * The real world of the rehearsal: the LOCAL Docker Supabase (its own admin key, from `supabase status`), the dev server on this machine,
 * the dev clock file, and ONE throwaway @eating-coach.test user. Every write is scoped by that user's id, and the stack must be local
 * (guards.ts). It prints no key, no password, no user id and no endpoint.
 */

const SHABBAT_SAFE_TYPE = "USER_DEFINED";
const FAKE_ENDPOINT_PREFIX = "https://fake-push.example.test/";

function readStatus(): Record<string, unknown> | null {
  try {
    const text = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 90_000 });
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function adminKeyOf(status: Record<string, unknown>): string | null {
  const direct = status["SECRET_KEY"];
  if (typeof direct === "string" && direct !== "") return direct;
  const legacy = Object.keys(status).find((k) => /_ROLE_KEY$/.test(k));
  const value = legacy ? status[legacy] : undefined;
  return typeof value === "string" && value !== "" ? value : null;
}

/** KEY=value lines of an environment file. The values are used and never printed. */
function readEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

async function findUserId(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

export async function createRealWorld(a: { appRoot: string; baseUrl: string; email: string }): Promise<{ world: RehearsalWorld; restore: () => void } | { error: string }> {
  const status = readStatus();
  if (status === null) return { error: "The local Supabase is not running (npm run local:start; Docker Desktop must be on)." };
  const apiUrl = typeof status["API_URL"] === "string" ? (status["API_URL"] as string) : undefined;
  const local = assertLocalStack({ apiUrl, nodeEnv: process.env.NODE_ENV });
  if (!local.ok) return { error: `Refused: ${local.reason}. This rehearsal writes to a database and runs only against the local stack.` };
  const key = adminKeyOf(status);
  if (apiUrl === undefined || key === null) return { error: "The local stack's admin key could not be read." };

  const secret = readEnv(join(a.appRoot, ".env.local")).CRON_SECRET;
  if (!secret) return { error: "CRON_SECRET is missing in app/.env.local (the dev server and this script both read it)." };

  const admin = createClient(apiUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = await findUserId(admin, a.email);
  if (userId === null) return { error: `No local user ${a.email}. Run: npm run seed:demo -- --scenario w2-learn --fresh` };

  const profile = await admin.from("profiles").select("timezone, lifecycle_state").eq("user_id", userId).limit(1);
  const row = Array.isArray(profile.data) ? (profile.data[0] as { timezone?: unknown; lifecycle_state?: unknown } | undefined) : undefined;
  if (!row) return { error: "The user has no profile." };
  if (row.lifecycle_state !== "WEEKLY_CYCLE") return { error: "The user is not in the weekly cycle. Run: npm run seed:demo -- --scenario w2-learn --fresh" };
  const timeZone = resolveTimeZone(typeof row.timezone === "string" ? row.timezone : "");

  // The Sunday is the one the seeded dev clock is on. The week the push is about ends the night before.
  const clockPath = join(a.appRoot, DEV_CLOCK_FILE);
  const original = readClockFile(clockPath);
  if (original === null) return { error: "There is no dev clock file. Run: npm run seed:demo -- --scenario w2-learn --fresh (it sets the clock to a Sunday morning)." };
  const sunday = localDayOf(original, timeZone).key;
  if (weekWindowOf(original, timeZone).weekStart !== sunday) return { error: "The dev clock is not on a Sunday. Use a w2-* or w3-* scenario of seed:demo." };

  const count = async (table: string): Promise<number> => {
    const { count: n } = await admin.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
    return n ?? 0;
  };
  let subscriptionSerial = 0;

  const world: RehearsalWorld = {
    timeZone,
    sunday,
    setClock(instant) {
      writeClockFile(clockPath, instant, timeZone);
    },
    async callRoute(query = ""): Promise<RouteAnswer> {
      const response = await fetch(`${a.baseUrl}/api/engine/notify${query}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: "{}",
      });
      let body: Record<string, unknown> = {};
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        body = { error: "unreadable_answer" };
      }
      return { status: response.status, body };
    },
    async reset() {
      await admin.from("notification_log").delete().eq("user_id", userId);
      await admin.from("weekly_summaries").delete().eq("user_id", userId);
      await admin.from("offline_periods").delete().eq("user_id", userId).eq("type", SHABBAT_SAFE_TYPE).contains("metadata", { rehearsal: true });
      await this.setPreference(true);
      await admin.from("push_subscriptions").delete().eq("user_id", userId).like("endpoint", `${FAKE_ENDPOINT_PREFIX}%`);
      subscriptionSerial += 1;
      await admin.from("push_subscriptions").insert({ user_id: userId, endpoint: `${FAKE_ENDPOINT_PREFIX}${Date.now()}-${subscriptionSerial}`, p256dh: "fake-p256dh", auth: "fake-auth" });
    },
    async openCard(weekStart) {
      await admin.from("weekly_summaries").insert({ user_id: userId, week_start: weekStart, opening_mode: "LEARN", content: {} });
    },
    async coverWithOffline(from, to) {
      await admin.from("offline_periods").insert({ user_id: userId, type: SHABBAT_SAFE_TYPE, start_at: from.toISOString(), end_at: to.toISOString(), source: "manual", metadata: { rehearsal: true } });
    },
    async setPreference(on) {
      const { data } = await admin.from("user_preferences").select("notifications").eq("user_id", userId).limit(1);
      const current = Array.isArray(data) && data[0] && typeof (data[0] as { notifications?: unknown }).notifications === "object" ? ((data[0] as { notifications: Record<string, unknown> }).notifications) : {};
      await admin.from("user_preferences").update({ notifications: { ...current, weekly_summary: on } }).eq("user_id", userId);
    },
    async readLog(): Promise<LogRow[]> {
      const { data } = await admin.from("notification_log").select("kind, moment_key, suppressed_reason").eq("user_id", userId).order("sent_at");
      return (data ?? []).map((r) => ({ kind: r.kind, momentKey: r.moment_key, reason: r.suppressed_reason }));
    },
    subscriptionCount: () => count("push_subscriptions"),
  };

  const restore = () => {
    // Back to the Sunday morning the seed left, so the app and the next run see the same state.
    if (original) writeClockFile(clockPath, original, timeZone);
    else removeClockFile(clockPath);
  };
  return { world, restore };
}
