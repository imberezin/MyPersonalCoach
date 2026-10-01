"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { JSX } from "react";
import { useTranslations } from "use-intl";
import { NAV_ICONS } from "./icons";
import { NAV_ITEM_IDS, NAV_TAB_HREF, activeTab } from "./navModel";
import { REPORT_NAV_BUTTON_ID, REPORT_SHEET_ID, useReportSheet } from "./ReportSheet";
import styles from "./shell.module.css";

/**
 * The bottom bar: Home, Progress, Report, Coach, Me. One row in reading order, so the order
 * mirrors by itself in Hebrew. Report is a button that opens the sheet, never a "current" page;
 * the other four are links, and the current one carries aria-current plus a bold label and a pill
 * (never color alone).
 */
export function BottomNav(): JSX.Element {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { isOpen, open } = useReportSheet();
  const current = activeTab(pathname);

  return (
    <nav aria-label={t("ariaLabel")} className={styles.nav}>
      <ul role="list" className={styles.list}>
        {NAV_ITEM_IDS.map((id) => {
          const Icon = NAV_ICONS[id];
          if (id === "report") {
            return (
              <li key={id}>
                <button
                  type="button"
                  id={REPORT_NAV_BUTTON_ID}
                  className={`${styles.item} ${styles.report}`}
                  aria-haspopup="dialog"
                  aria-controls={REPORT_SHEET_ID}
                  aria-expanded={isOpen}
                  onClick={(event) => open(event.currentTarget)}
                >
                  <span className={styles.reportDisc}>
                    <Icon size={28} />
                  </span>
                  <span className={`${styles.label} ${styles.reportLabel}`}>{t(id)}</span>
                </button>
              </li>
            );
          }
          const active = current === id;
          return (
            <li key={id}>
              <Link
                href={NAV_TAB_HREF[id]}
                aria-current={active ? "page" : undefined}
                className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
              >
                <span className={styles.iconWrap}>
                  <Icon />
                </span>
                <span className={styles.label}>{t(id)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
