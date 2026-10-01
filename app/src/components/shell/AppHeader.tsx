import type { JSX } from "react";
import { Logo } from "@/components/Logo";
import { getTranslations } from "@/i18n/server";
import styles from "./shell.module.css";

/** The persistent header: the emblem and the short app name. Not sticky, so it never takes space from a small screen. */
export async function AppHeader(): Promise<JSX.Element> {
  const t = await getTranslations("app");

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Logo size={32} priority />
        <span className={styles.brandName}>{t("shortName")}</span>
      </div>
    </header>
  );
}
