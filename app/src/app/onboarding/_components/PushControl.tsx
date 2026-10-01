"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "use-intl";
import { savePushSubscription } from "@/app/onboarding/actions";
import styles from "@/app/onboarding/onboarding.module.css";
import { Button } from "@/components/ui/Button";
import { Message } from "@/components/ui/Message";
import { derivePushState } from "@/domain/push";
import {
  askPermission,
  getEnvSnapshot,
  getServerEnvSnapshot,
  registerServiceWorker,
  subscribeThisDevice,
  subscribeToEnv,
  type PushDeviceEnv,
} from "./pushClient";

type Status = "idle" | "enabling" | "enabled" | "errorTimeout" | "errorSubscribe" | "errorSave";

const IOS_STEPS = ["step1", "step2", "step3", "step4"] as const;

/**
 * The device half of A11. It never blocks: whatever happens here, Continue stays available.
 * The permission is asked only after the tap, and never again once it has been denied.
 */
export function PushControl({ configured, publicKey }: { configured: boolean; publicKey: string | null }) {
  const t = useTranslations("onboarding");
  const [status, setStatus] = useState<Status>("idle");
  const rawEnv = useSyncExternalStore(subscribeToEnv, getEnvSnapshot, getServerEnvSnapshot);
  const hasPublicKey = configured && publicKey !== null;
  const state = derivePushState(
    rawEnv === null ? null : { ...(JSON.parse(rawEnv) as PushDeviceEnv), hasPublicKey },
  );

  const canRegister = state === "ready" || state === "denied" || state === "not_configured";
  useEffect(() => {
    if (canRegister) registerServiceWorker();
  }, [canRegister]);

  async function enable() {
    if (publicKey === null) return;
    setStatus("enabling");

    let permission: NotificationPermission;
    try {
      // The first await, so the browser still counts this as the result of the tap.
      permission = await askPermission();
    } catch {
      setStatus("errorSubscribe");
      return;
    }
    // Dismissed or denied: a denial shows up through the environment store as the "denied" note.
    if (permission !== "granted") {
      setStatus("idle");
      return;
    }

    const subscribed = await subscribeThisDevice(publicKey);
    if (!subscribed.ok) {
      setStatus(subscribed.reason === "timeout" ? "errorTimeout" : "errorSubscribe");
      return;
    }

    try {
      const saved = await savePushSubscription(subscribed.subscription);
      setStatus(saved.ok ? "enabled" : "errorSave");
    } catch {
      setStatus("errorSave");
    }
  }

  switch (state) {
    case "checking":
      return <p className={styles.hint}>{t("push.checking")}</p>;

    case "ios_needs_install":
      return (
        <div className={`${styles.subBlock} ${styles.device}`}>
          <h2>{t("push.ios.title")}</h2>
          <ol className={styles.steps}>
            {IOS_STEPS.map((step) => (
              <li key={step}>{t(`push.ios.${step}`)}</li>
            ))}
          </ol>
          <p className={styles.hint}>{t("push.ios.hint")}</p>
        </div>
      );

    case "unsupported":
      return (
        <Message variant="note" role="status">
          {t("push.unsupported")}
        </Message>
      );

    case "not_configured":
      return (
        <Message variant="note" role="status">
          {t("push.notConfigured")}
        </Message>
      );

    case "denied":
      return (
        <Message variant="note" role="status">
          {t("push.denied")}
        </Message>
      );

    case "ready":
      return (
        <div className={styles.device}>
          <Button variant="secondary" onClick={enable} disabled={status === "enabling" || status === "enabled"}>
            {status === "enabling" ? t("push.enabling") : t("push.enable")}
          </Button>
          {status === "enabled" ? (
            <Message variant="note" role="status">
              {t("push.enabled")}
            </Message>
          ) : null}
          {status === "errorTimeout" || status === "errorSubscribe" || status === "errorSave" ? (
            <Message variant="error" role="alert">
              {t(`push.${status}`)}
            </Message>
          ) : null}
        </div>
      );
  }
}
