import type { ShabbatPeriodRow } from "@/domain/onboarding/shabbatRows";
import type { SeedOptions } from "./args";
import { formatClockInstant, shiftInstant } from "./clockfile";
import { formatExplain, type ExplainFacts } from "./explain";
import { assertSeedTarget } from "./guard";
import { buildSeedPlan, firstWeekEndedAtOf, periodBeforeMeal, resolveAsOf, resolveRelative, startedAtOf, toMealRow, toProfileUpdate } from "./plan";
import { seedShabbatRows, seedShabbatSeries, toPlanShabbat } from "./shabbat";
import { toWeightRow } from "./weights";

/**
 * The runner, with every outside thing injected (the Docker stack, the Auth API, the database, the clock file, the logger),
 * so the whole flow and its output are unit-tested without any of them. `run.live.ts` wires the real ones.
 *
 * Output rule: a line contains counts, ISO instants, the demo e-mail and short codes, never the password, a key, a token, a
 * user id, a motivation text or a path of an environment file. An unexpected failure is reported as `<stage>_failed` and
 * nothing of the underlying error (which could quote a key) is ever printed.
 */

export interface StackStatus {
  /** The API URL of the Docker stack (from `supabase status`). */
  apiUrl: string;
  /** The publishable (public client) key. */
  publishableKey: string;
}

export type ProfileUpdate = ReturnType<typeof toProfileUpdate>;
export type MealRow = ReturnType<typeof toMealRow>;
export type WeightEntryRow = ReturnType<typeof toWeightRow>;

/** A signed-in demo user. Every call runs as that user, so row level security applies exactly as in the app. */
export interface DbSession {
  /** The e-mail the Auth API returned for the session. The runner checks it against the guard again. */
  email: string;
  writeProfile(fields: ProfileUpdate): Promise<void>;
  upsertShabbat(rows: readonly ShabbatPeriodRow[]): Promise<void>;
  listPeriods(): Promise<{ id: string; startAt: Date }[]>;
  /** Inserts the rows that are not there yet and returns how many were new. */
  upsertMeals(rows: readonly MealRow[]): Promise<number>;
  /** Deletes the newest confirmed meals through RLS and returns how many went. */
  dropMeals(count: number | "all"): Promise<number>;
  /** Inserts the weigh-ins that are not there yet (as the demo user, RLS applies) and returns how many were new. */
  upsertWeights(rows: readonly WeightEntryRow[]): Promise<number>;
  /** Deletes the newest weigh-ins through RLS and returns how many went. The audit trail is not touched. */
  dropWeights(count: number | "all"): Promise<number>;
  explain(a: { now: Date; clockFile: string | null; dailyCap: number }): Promise<ExplainFacts>;
}

export type SignInResult = { ok: true; session: DbSession } | { ok: false; code: "invalid_credentials" | "failed" };

export interface SeedDeps {
  log(line: string): void;
  now(): Date;
  /** The tester's SEED_USER_PASSWORD. Used only to sign in and to create the throwaway user; never logged. */
  password: string | undefined;
  /** null = the Docker stack is not running or its status cannot be read (there is no fallback source of a URL). */
  readStack(): StackStatus | null;
  /** The ONE place the stack's admin key is used (held inside the implementation, never visible here). */
  admin: {
    createUser(stack: StackStatus, email: string, password: string): Promise<void>;
    /** true when a user was found and deleted. */
    deleteUser(stack: StackStatus, email: string): Promise<boolean>;
  };
  signIn(stack: StackStatus, email: string, password: string): Promise<SignInResult>;
  clock: {
    read(): Date | null;
    /** Writes the instant (ISO with an offset in `timeZone`) and returns the text written. */
    write(instant: Date, timeZone: string): string;
    /** true when a file was there. */
    remove(): boolean;
  };
}

export type RunResult = { ok: true } | { ok: false; code: string };

export const MIN_PASSWORD_LENGTH = 8;

class Stop extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function runSeed(options: SeedOptions, deps: SeedDeps): Promise<RunResult> {
  const log = (line: string) => deps.log(line);
  let stage = "start";
  try {
    stage = "stack";
    const stack = deps.readStack();
    if (!stack) {
      log("The local Supabase stack is not running, or its status cannot be read. Start it with: npm run local:start");
      return { ok: false, code: "stack_unavailable" };
    }

    // The guard comes before any network call: the local stack AND a throwaway e-mail, or nothing happens.
    stage = "guard";
    const target = assertSeedTarget({ apiUrl: stack.apiUrl, email: options.email });
    if (!target.ok) {
      log(
        target.reason === "not_local_stack"
          ? "Refused: the Supabase stack is not the local Docker one. This tool only runs against it."
          : "Refused: the e-mail must be <name>@eating-coach.test (throwaway users only).",
      );
      return { ok: false, code: target.reason };
    }

    const needsSession = options.action !== "clock" || options.explain;
    const password = deps.password;
    if (needsSession || options.action === "reset") {
      if (password === undefined || password === "") {
        log("Set SEED_USER_PASSWORD in this shell first, at least 8 characters. It is never printed or saved. In PowerShell: $env:SEED_USER_PASSWORD = \"...\"");
        return { ok: false, code: "password_missing" };
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        log("SEED_USER_PASSWORD must be at least 8 characters.");
        return { ok: false, code: "password_too_short" };
      }
    }

    if (options.action === "reset") {
      stage = "user_delete";
      const removed = await deps.admin.deleteUser(stack, target.email);
      log(removed ? `Removed ${target.email} and everything that belongs to it.` : `There was no user ${target.email}.`);
      warnClock(options, deps);
      return { ok: true };
    }

    // `--clock-only`, `--clock-off` and `--clock-shift` touch only the clock file.
    if (options.action === "clock") {
      stage = "clock";
      clockOnly(options, deps);
    }

    if (needsSession) {
      if (options.fresh) {
        stage = "user_delete";
        const removed = await deps.admin.deleteUser(stack, target.email);
        log(removed ? `Recreating ${target.email}: the old user and its rows are gone.` : `Creating ${target.email}.`);
      }

      stage = "sign_in";
      let signedIn = await deps.signIn(stack, target.email, password as string);
      if (!signedIn.ok && signedIn.code === "invalid_credentials" && options.action === "seed") {
        stage = "user_create";
        try {
          await deps.admin.createUser(stack, target.email, password as string);
        } catch {
          log("Could not create the demo user. If it exists already, SEED_USER_PASSWORD is not its password: use the same one, or add --fresh to recreate it.");
          return { ok: false, code: "user_create_failed" };
        }
        log(`Created ${target.email} in the local stack.`);
        stage = "sign_in";
        signedIn = await deps.signIn(stack, target.email, password as string);
      }
      if (!signedIn.ok) {
        log(
          signedIn.code === "invalid_credentials"
            ? "Sign-in was refused: there is no such demo user, or SEED_USER_PASSWORD is not its password. Run a seeding command first, with the same password."
            : "Sign-in failed.",
        );
        return { ok: false, code: "sign_in_failed" };
      }
      const session = signedIn.session;

      // Again, on the e-mail the Auth API returned.
      const again = assertSeedTarget({ apiUrl: stack.apiUrl, email: session.email });
      if (!again.ok || again.email !== target.email) {
        log("Refused: the signed-in user is not the throwaway user that was asked for.");
        return { ok: false, code: "email_mismatch" };
      }

      if (options.action === "drop") {
        stage = "drop";
        if (options.dropMeals !== null) {
          const count = await session.dropMeals(options.dropMeals);
          log(`Deleted ${count} confirmed meal${count === 1 ? "" : "s"} of ${target.email}. Patterns and evidence were not touched.`);
        }
        if (options.dropWeights !== null) {
          const count = await session.dropWeights(options.dropWeights);
          log(`Deleted ${count} weight entr${count === 1 ? "y" : "ies"} of ${target.email}. The change log keeps no weight, only that one was removed.`);
        }
      } else if (options.action === "seed") {
        await seed(options, deps, session, target.email, (s) => (stage = s));
      }

      if (options.explain) {
        stage = "explain";
        const at = deps.clock.read();
        const timeZone = options.timeZone;
        const lines = formatExplain(
          await session.explain({
            now: at ?? deps.now(),
            clockFile: at === null ? null : formatClockInstant(at, timeZone),
            dailyCap: options.explainDailyCap,
          }),
        );
        for (const line of lines) log(line);
      }
    }

    stage = "clock";
    warnClock(options, deps);
    return { ok: true };
  } catch (error) {
    if (error instanceof Stop) return { ok: false, code: error.code };
    log(`Failed at ${stage}. Nothing else was changed after that step.`);
    return { ok: false, code: `${stage}_failed` };
  }
}

function clockOnly(options: SeedOptions, deps: SeedDeps): void {
  if (options.clockOff) {
    deps.log(deps.clock.remove() ? "Dev clock removed: the app uses the real time again." : "There was no dev clock file.");
    return;
  }
  let instant: Date;
  if (options.clockShift !== null) {
    const current = deps.clock.read();
    const shifted = shiftInstant(current ?? deps.now(), options.clockShift);
    if (shifted === null) throw new Stop("bad_shift");
    if (current === null) deps.log("There was no dev clock file; the shift starts from the real time.");
    instant = shifted;
  } else {
    instant = resolveAsOf(options, startedAtOf(options));
  }
  deps.log(`Dev clock set to ${deps.clock.write(instant, options.timeZone)}.`);
}

async function seed(options: SeedOptions, deps: SeedDeps, session: DbSession, email: string, stage: (s: string) => void): Promise<void> {
  const resolved = resolveRelative(options, deps.now());
  stage("plan");
  const series = seedShabbatSeries(resolved);
  const plan = buildSeedPlan(resolved, toPlanShabbat(series));

  stage("profile");
  await session.writeProfile(toProfileUpdate(resolved, plan.startedAt));

  let periods = 0;
  let known: { id: string; startAt: Date }[] = [];
  if (resolved.shabbat) {
    stage("shabbat");
    await session.upsertShabbat(seedShabbatRows(series, plan.startedAt));
    known = await session.listPeriods();
    periods = series.length;
  }

  stage("meals");
  const rows = plan.meals.map((meal) => {
    const period = meal.aggregated ? periodBeforeMeal(meal, plan.offline) : null;
    const periodId = period ? (known.find((p) => p.startAt.getTime() === period.start.getTime())?.id ?? null) : null;
    return toMealRow(meal, periodId);
  });
  const created = await session.upsertMeals(rows);

  // Only a run that asked for weigh-ins touches weight_entries at all.
  let weightsCreated = 0;
  if (plan.weights.length > 0) {
    stage("weights");
    weightsCreated = await session.upsertWeights(plan.weights.map(toWeightRow));
  }

  deps.log(`Seeded ${email}: ${plan.meals.length} meals planned (${created} new), ${periods} Shabbat periods, ${resolved.goals.length} goals.`);
  deps.log(`First Week began ${formatClockInstant(plan.startedAt, resolved.timeZone)}.`);
  if (resolved.lifecycle === "weekly_cycle") {
    const ended = firstWeekEndedAtOf(resolved, plan.startedAt);
    deps.log(`Lifecycle: WEEKLY_CYCLE; the First Week ended ${ended === null ? "never" : formatClockInstant(ended, resolved.timeZone)}.`);
  }
  if (resolved.weights !== "none" || resolved.junkWeights) {
    deps.log(`Weights: ${plan.weights.length} planned (${weightsCreated} new), start ${resolved.startWeightKg} kg, ${resolved.goalWeightKg === null ? "no goal weight" : `goal ${resolved.goalWeightKg} kg`}.`);
  }

  stage("clock");
  if (resolved.mode === "fixed" && !resolved.clockOff) {
    deps.log(`Dev clock set to ${deps.clock.write(plan.asOf, resolved.timeZone)}.`);
  } else {
    deps.clock.remove();
    deps.log("No dev clock is written: the app uses the real time.");
  }
}

/** ONE line whenever a clock file is left behind: a fake clock must never be forgotten. */
function warnClock(options: SeedOptions, deps: SeedDeps): void {
  const at = deps.clock.read();
  if (at === null) return;
  deps.log(`dev clock is ON: ${formatClockInstant(at, options.timeZone)}; meals cannot be saved through the UI until you run --clock-off or --mode relative`);
}
