"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { RedirectType, redirect } from "next/navigation";
import {
  HOME_PATH,
  decideRoute,
  isStepId,
  planStep,
  readIntent,
  readRawFields,
  resolveStep,
  stepPath,
  type RawFields,
  type StepError,
} from "@/domain/onboarding";
import { validateShabbatChoice } from "@/domain/places";
import { parsePushSubscription, type PushSubscriptionInput } from "@/domain/push";
import { loadOnboardingContext } from "@/lib/onboarding/context";
import { runStep } from "@/lib/onboarding/runStep";
import { getPushClientConfig } from "@/lib/notifications/config";
import { computeNextShabbat } from "@/lib/shabbat";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/** What the form gets back when a step could not be saved. Success never returns: it redirects. */
export type StepFormState = { status: "error"; error: StepError; values: RawFields } | null;

const USER_AGENT_MAX = 200;

/**
 * Saves one onboarding step and moves on. A page guard does not protect a direct POST, so the
 * session, the lifecycle state and the step are all checked again here. `redirect` throws, so it
 * is always the last thing a branch does and nothing wraps it in try/catch.
 */
export async function submitStep(_previous: StepFormState, formData: FormData): Promise<StepFormState> {
  const posted = String(formData.get("step") ?? "");
  // Echoed back with every error, because React resets the form after an action.
  const values: RawFields = isStepId(posted) ? readRawFields(posted, formData) : {};
  const fail = (code: StepError["code"]): StepFormState => ({ status: "error", error: { code }, values });

  if (!isSupabaseConfigured()) return fail("not_configured");

  const context = await loadOnboardingContext();
  if (context.kind === "signed_out") redirect("/login");
  if (context.kind === "not_configured") return fail("not_configured");
  if (context.kind === "profile_missing") return fail("profile_missing");
  if (context.kind === "unavailable") return fail("save_error");

  const { supabase, userId, row } = context;

  const route = decideRoute("onboarding", row.lifecycle_state);
  if (route.kind === "redirect") redirect(route.to);

  // A forged or stale step is not saved; the user is sent to the step they are really on.
  const resolved = resolveStep(posted, row);
  if (resolved.kind !== "ok" || resolved.id !== posted) redirect(stepPath(resolved.id));
  const step = resolved.id;

  const now = new Date();
  const planned = planStep({
    step,
    intent: readIntent(formData),
    raw: values,
    row,
    now,
    pushConfigured: getPushClientConfig().configured,
  });
  if (!planned.ok) return { status: "error", error: planned.error, values: planned.values };

  const result = await runStep({ supabase, userId, row, plan: planned.plan, now });
  // The state changed under us (a double submit of the last step, another tab). The onboarding
  // page routes the user to wherever they now belong.
  if ("stale" in result) redirect("/onboarding");
  if (!result.ok) return { status: "error", error: result.error, values };

  revalidatePath("/onboarding", "layout");
  if (planned.plan.finish) {
    revalidatePath("/", "layout");
    // Replace, so the browser's Back button cannot return from Home to the last question.
    redirect(HOME_PATH, RedirectType.replace);
  }
  redirect(planned.plan.redirectTo);
}

export type ShabbatPreview =
  | { ok: true; timezone: string; candleLightingIso: string; havdalahIso: string; inProgress: boolean }
  | { ok: false; code: "unknown_place" | "out_of_range" | "unavailable" | "unauthenticated" };

/** The signed-in user, or why there is none. Cheaper than the onboarding context: no profile read. */
async function getSignedInUser() {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? { supabase, user } : null;
  } catch {
    return null;
  }
}

/**
 * The next Shabbat for a place and candle-lighting minutes, so the A9 screen can show the times
 * before the user confirms them. Read-only. Instants are returned as ISO strings; the browser
 * formats them in the place's own zone.
 */
export async function previewShabbat(input: { placeKey: string; candleMinutes: number }): Promise<ShabbatPreview> {
  if (!(await getSignedInUser())) return { ok: false, code: "unauthenticated" };

  const choice = validateShabbatChoice(input?.placeKey, input?.candleMinutes);
  if (!choice.ok) return { ok: false, code: choice.code === "out_of_range" ? "out_of_range" : "unknown_place" };

  const { place, candleMinutes } = choice;
  const now = new Date();
  const times = computeNextShabbat({
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone,
    inIsrael: place.inIsrael,
    candleLightingMinutes: candleMinutes,
    from: now,
    cityName: place.cityName,
  });
  if (!times) return { ok: false, code: "unavailable" };

  return {
    ok: true,
    timezone: place.timezone,
    candleLightingIso: times.candleLighting.toISOString(),
    havdalahIso: times.havdalah.toISOString(),
    inProgress: times.candleLighting.getTime() <= now.getTime(),
  };
}

export type PushSaveResult =
  | { ok: true }
  | { ok: false; code: "invalid_subscription" | "unauthenticated" | "not_configured" | "save_error" };

/**
 * Stores this device's push subscription. The user id is not sent: the column defaults to the
 * caller and row level security enforces it. The same endpoint saved twice updates one row.
 */
export async function savePushSubscription(input: PushSubscriptionInput): Promise<PushSaveResult> {
  if (!isSupabaseConfigured() || !getPushClientConfig().configured) return { ok: false, code: "not_configured" };

  const session = await getSignedInUser();
  if (!session) return { ok: false, code: "unauthenticated" };

  const parsed = parsePushSubscription(input);
  if (!parsed.ok) return { ok: false, code: "invalid_subscription" };

  const userAgent = (await headers()).get("user-agent")?.slice(0, USER_AGENT_MAX) ?? null;
  const { error } = await session.supabase
    .from("push_subscriptions")
    .upsert({ ...parsed.value, user_agent: userAgent }, { onConflict: "endpoint" });
  return error ? { ok: false, code: "save_error" } : { ok: true };
}
