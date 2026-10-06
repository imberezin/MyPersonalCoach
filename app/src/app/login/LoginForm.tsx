"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "use-intl";
import { signIn, type LoginState } from "./actions";
import { passwordFieldState } from "./passwordField";
import styles from "./login.module.css";

const PASSWORD_ID = "login-password";

/** An eye, and the same eye crossed out. Drawn here, in the text color of the button: no icon library, no color of its own. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {crossed ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

export function LoginForm() {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState<LoginState, FormData>(signIn, null);
  const [revealed, setRevealed] = useState(false);
  const password = passwordFieldState(revealed);

  return (
    // The password goes back into hiding when the form is sent, so it is never left readable on the screen afterwards.
    <form action={formAction} onSubmit={() => setRevealed(false)} className={styles.form}>
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

      {/* Not a <label> around the input: the show button lives in the same box, and a button must not sit inside a label. */}
      <div className={styles.field}>
        <label htmlFor={PASSWORD_ID}>{t("password")}</label>
        <div className={styles.passwordBox}>
          <input
            id={PASSWORD_ID}
            name="password"
            type={password.inputType}
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <button
            type="button"
            className={styles.reveal}
            onClick={() => setRevealed((current) => !current)}
            aria-label={t(password.labelKey)}
            aria-controls={PASSWORD_ID}
            title={t(password.labelKey)}
          >
            <EyeIcon crossed={revealed} />
          </button>
        </div>
      </div>

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
