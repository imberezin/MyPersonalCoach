import { replayOnboardingForDev } from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { isOffline } from "@/domain/offline";
import { getLocale, getTranslations } from "@/i18n/server";
import { currentInstant } from "@/lib/clock/now";
import { computeNextShabbat, defaultCandleLightingMinutes } from "@/lib/shabbat";
import { isLocalSupabase } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import styles from "./dev.module.css";

// Jerusalem is used only until the user chooses a city during onboarding.
const JERUSALEM = { latitude: 31.7683, longitude: 35.2137, cityName: "Jerusalem" } as const;

/**
 * "Is everything wired up?" panel. It renders only in development and disappears from
 * production builds. It exercises the real stack: auth, a database read under RLS, and the
 * server-only Shabbat module plus the offline rule.
 */
export async function DevStatus() {
  if (process.env.NODE_ENV !== "development") return null;

  const [t, locale] = await Promise.all([getTranslations("dev"), getLocale()]);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("lifecycle_state, language, timezone")
    .maybeSingle();
  const { count } = await supabase.from("profiles").select("user_id", { count: "exact", head: true });

  const timezone: string = profile?.timezone ?? "Asia/Jerusalem";
  const now = new Date();
  // The app's own "now" (src/lib/clock) against the real one: when they differ, say so, so a tester never forgets.
  const appNow = currentInstant();
  const clockOverridden = Math.abs(appNow.getTime() - now.getTime()) > 1_000;
  const shabbat = computeNextShabbat({
    ...JERUSALEM,
    timezone,
    inIsrael: true,
    candleLightingMinutes: defaultCandleLightingMinutes(true, JERUSALEM.cityName),
    from: now,
  });
  const offline = shabbat
    ? isOffline([{ type: "SHABBAT", start: shabbat.candleLighting, end: shabbat.havdalah }], now)
    : false;
  const format = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const clockFormat = new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });

  return (
    <section className={styles.dev} aria-label={t("title")}>
      <h2>{t("title")}</h2>
      {clockOverridden ? (
        <p role="status" className={styles.devHint}>
          {t("clockOverride", { time: clockFormat.format(appNow) })}
        </p>
      ) : null}
      <dl>
        <dt>{t("backend")}</dt>
        <dd>{isLocalSupabase() ? t("backendLocal") : t("backendHosted")}</dd>

        <dt>{t("signedInAs")}</dt>
        <dd dir="ltr">{user?.email ?? "-"}</dd>

        <dt>{t("profile")}</dt>
        <dd dir="ltr">{profile ? `${profile.lifecycle_state} · ${profile.language} · ${timezone}` : "-"}</dd>

        <dt>{t("rls")}</dt>
        <dd>{t("rlsResult", { count: count ?? 0 })}</dd>

        <dt>{t("nextShabbat")}</dt>
        <dd>{shabbat ? `${format.format(shabbat.candleLighting)} ← → ${format.format(shabbat.havdalah)}` : "-"}</dd>

        <dt>{t("offlineNow")}</dt>
        <dd>{offline ? t("yes") : t("no")}</dd>
      </dl>

      {isLocalSupabase() ? (
        <form action={replayOnboardingForDev} className={styles.devAction}>
          <Button type="submit" variant="secondary">
            {t("replayOnboarding")}
          </Button>
          <p className={styles.devHint}>{t("replayOnboardingHint")}</p>
        </form>
      ) : null}
    </section>
  );
}
