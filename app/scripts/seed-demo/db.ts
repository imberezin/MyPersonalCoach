import { execSync } from "node:child_process";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { selectFirstExperiment, type PatternFact } from "@/domain/experiments";
import { decideFirstWeekStep } from "@/domain/firstWeekFlow";
import { resolveHome } from "@/domain/home";
import { ONBOARDING_ROW_COLUMNS, normalizeRow } from "@/domain/onboarding";
import { LATE_EVENING, decideEarlySignal } from "@/domain/patterns";
import { resolveTimeZone } from "@/domain/time";
import { DEV_CLOCK_FILE } from "@/lib/clock/now";
import { loadExperiments } from "@/lib/experiments/repo";
import { loadHomeFacts } from "@/lib/home/load";
import type { OnboardingContext } from "@/lib/onboarding/context";
import { loadLateEveningSignal, loadQuietHours } from "@/lib/patterns/load";
import { readClockFile, removeClockFile, writeClockFile } from "./clockfile";
import { describeExcluded, type ExplainFacts } from "./explain";
import type { DbSession, MealRow, SeedDeps, SignInResult, StackStatus } from "./run";

/**
 * The real ports of the runner: the Docker stack's status, the Auth API, the database as the demo user, the clock file.
 * Nothing here opens an environment file or reads a hosted value; the stack's URL and keys come from `supabase status -o json`
 * (the Docker stack on this machine) and from nowhere else.
 */

const BATCH = 100;
const USER_PAGE = 200;
const USER_PAGES = 25;
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } } as const;

type ReadyContext = Extract<OnboardingContext, { kind: "ready" }>;

/** The parsed `supabase status -o json`, or null. The admin key stays inside this object until `adminKeyOf` is called. */
function readStatus(): Record<string, unknown> | null {
  try {
    const text = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 90_000 });
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The stack's own admin key. Called only when a user must be created or deleted; never printed, logged or stored. */
function adminKeyOf(status: Record<string, unknown>): string {
  const direct = status["SECRET_KEY"];
  if (typeof direct === "string" && direct !== "") return direct;
  // Older CLI versions name it after the role.
  const legacy = Object.keys(status).find((k) => /_ROLE_KEY$/.test(k));
  const value = legacy ? status[legacy] : undefined;
  if (typeof value === "string" && value !== "") return value;
  throw new Error("admin_key_missing");
}

async function findUserId(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= USER_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USER_PAGE });
    if (error) throw new Error("user_list_failed");
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < USER_PAGE) return null;
  }
  return null;
}

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function createSession(client: SupabaseClient, userId: string, email: string): DbSession {
  return {
    email,

    async writeProfile(fields) {
      const { data, error } = await client.from("profiles").update(fields).eq("user_id", userId).select("user_id");
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error("profile_failed");
    },

    async upsertShabbat(rows) {
      const { error } = await client.from("offline_periods").upsert(
        rows.map((r) => ({ user_id: userId, type: "SHABBAT", start_at: r.start_at, end_at: r.end_at, source: "auto", metadata: r.metadata })),
        { onConflict: "user_id,type,start_at", ignoreDuplicates: true },
      );
      if (error) throw new Error("shabbat_failed");
    },

    async listPeriods() {
      const { data, error } = await client.from("offline_periods").select("id, start_at").eq("user_id", userId).eq("type", "SHABBAT").limit(200);
      if (error || !Array.isArray(data)) throw new Error("shabbat_failed");
      const out: { id: string; startAt: Date }[] = [];
      for (const row of data as Record<string, unknown>[]) {
        const startAt = toDate(row.start_at);
        if (typeof row.id === "string" && startAt) out.push({ id: row.id, startAt });
      }
      return out;
    },

    async upsertMeals(rows: readonly MealRow[]) {
      let created = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const { data, error } = await client
          .from("meal_entries")
          .upsert(rows.slice(i, i + BATCH), { onConflict: "id", ignoreDuplicates: true })
          .select("id");
        if (error) throw new Error("meals_failed");
        created += Array.isArray(data) ? data.length : 0;
      }
      return created;
    },

    async dropMeals(count) {
      if (count === "all") {
        const { data, error } = await client.from("meal_entries").delete().eq("user_id", userId).select("id");
        if (error) throw new Error("drop_failed");
        return Array.isArray(data) ? data.length : 0;
      }
      const newest = await client.from("meal_entries").select("id").eq("user_id", userId).order("confirmed_at", { ascending: false }).limit(count);
      if (newest.error || !Array.isArray(newest.data)) throw new Error("drop_failed");
      const ids = (newest.data as { id: string }[]).map((r) => r.id);
      if (ids.length === 0) return 0;
      const { data, error } = await client.from("meal_entries").delete().in("id", ids).select("id");
      if (error) throw new Error("drop_failed");
      return Array.isArray(data) ? data.length : 0;
    },

    explain: (a) => collectExplain(client, userId, email, a),
  };
}

/** What the app decides for the demo user at `now`, read with the app's own loaders and resolvers (read-only). */
async function collectExplain(
  client: SupabaseClient,
  userId: string,
  email: string,
  a: { now: Date; clockFile: string | null; dailyCap: number },
): Promise<ExplainFacts> {
  const [profile, prefs] = await Promise.all([
    client.from("profiles").select(ONBOARDING_ROW_COLUMNS).eq("user_id", userId).maybeSingle(),
    client.from("user_preferences").select("notifications").eq("user_id", userId).maybeSingle(),
  ]);
  if (profile.error || prefs.error) throw new Error("explain_failed");
  const row = normalizeRow(profile.data, prefs.data);
  if (!row) throw new Error("explain_failed");
  const context: ReadyContext = { kind: "ready", userId, row, supabase: client };
  const timeZone = resolveTimeZone(row.timezone);
  const { now } = a;

  const facts = await loadHomeFacts(context, now);
  const home = resolveHome(facts);
  const step = facts.firstWeek === null ? null : decideFirstWeekStep(facts.firstWeek);

  const [signal, quietHours, experiments, meals] = await Promise.all([
    loadLateEveningSignal(client, userId, timeZone, now),
    loadQuietHours(client, userId),
    loadExperiments(client, userId),
    client.from("meal_entries").select("occurred_at, aggregated").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(500),
  ]);

  const earlySignal = signal === null ? null : decideEarlySignal({ view: signal.view, row: signal.row, now });
  const patterns: PatternFact[] =
    signal === null
      ? []
      : [
          {
            patternId: signal.row?.id ?? null,
            kind: LATE_EVENING.kind,
            view: signal.view,
            feedback: signal.row?.feedback ?? null,
            feedbackAt: signal.row?.feedbackAt ?? null,
          },
        ];
  // Unknown experiments are unknown, as in the app (an open or recently skipped one might exist).
  const selection = experiments === null ? null : selectFirstExperiment({ patterns, experiments: experiments.facts, now });

  let storedEvidence: number | null = null;
  if (signal?.row) {
    const evidence = await client.from("pattern_evidence").select("id", { count: "exact", head: true }).eq("pattern_id", signal.row.id);
    storedEvidence = evidence.error ? null : (evidence.count ?? 0);
  }

  const mealRows: { occurredAt: Date; aggregated: boolean }[] = [];
  for (const r of Array.isArray(meals.data) ? (meals.data as Record<string, unknown>[]) : []) {
    const occurredAt = toDate(r.occurred_at);
    if (occurredAt) mealRows.push({ occurredAt, aggregated: r.aggregated === true });
  }

  return {
    email,
    now,
    clockFile: a.clockFile,
    timeZone,
    lifecycle: row.lifecycle_state,
    progress: facts.firstWeek,
    step,
    signal,
    excluded: describeExcluded(mealRows, timeZone, now),
    storedEvidence,
    earlySignal,
    quietHours,
    home,
    selection,
    dailyCap: a.dailyCap,
  };
}

export function createRealDeps(a: {
  appRoot: string;
  password: string | undefined;
  log: (line: string) => void;
  now?: () => Date;
}): SeedDeps {
  let status: Record<string, unknown> | null = null;
  const clockPath = join(a.appRoot, DEV_CLOCK_FILE);
  const adminFor = (stack: StackStatus): SupabaseClient => {
    if (status === null) throw new Error("stack_unavailable");
    return createClient(stack.apiUrl, adminKeyOf(status), NO_SESSION);
  };

  return {
    log: a.log,
    now: a.now ?? (() => new Date()),
    password: a.password,

    readStack(): StackStatus | null {
      status = readStatus();
      if (status === null) return null;
      const apiUrl = status["API_URL"];
      const publishableKey = status["PUBLISHABLE_KEY"] ?? status["ANON_KEY"];
      return typeof apiUrl === "string" && typeof publishableKey === "string" ? { apiUrl, publishableKey } : null;
    },

    admin: {
      async createUser(stack, email, password) {
        const { error } = await adminFor(stack).auth.admin.createUser({ email, password, email_confirm: true });
        if (error) throw new Error("user_create_failed");
      },
      async deleteUser(stack, email) {
        const admin = adminFor(stack);
        const id = await findUserId(admin, email);
        if (id === null) return false;
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw new Error("user_delete_failed");
        return true;
      },
    },

    async signIn(stack, email, password): Promise<SignInResult> {
      const client = createClient(stack.apiUrl, stack.publishableKey, NO_SESSION);
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user || !data.user.email) {
        return { ok: false, code: error?.code === "invalid_credentials" ? "invalid_credentials" : "failed" };
      }
      return { ok: true, session: createSession(client, data.user.id, data.user.email.toLowerCase()) };
    },

    clock: {
      read: () => readClockFile(clockPath),
      write: (instant, timeZone) => writeClockFile(clockPath, instant, timeZone),
      remove: () => removeClockFile(clockPath),
    },
  };
}
