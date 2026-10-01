"use client";

import { useActionState } from "react";
import { useTranslations } from "use-intl";
import { signIn, type LoginState } from "./actions";
import styles from "./login.module.css";

export function LoginForm() {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState<LoginState, FormData>(signIn, null);

  return (
    <form action={formAction} className={styles.form}>
      <label className={styles.field}>
        <span>{t("email")}</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          defaultValue={state?.email ?? ""}
          required
        />
      </label>

      <label className={styles.field}>
        <span>{t("password")}</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>

      {state?.error ? (
        <p role="alert" className={styles.error}>
          {t(`errors.${state.error}`)}
        </p>
      ) : null}

      <button type="submit" className={styles.primary} disabled={pending}>
        {t("submit")}
      </button>
    </form>
  );
}
