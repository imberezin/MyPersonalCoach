import styles from "./onboarding.module.css";

// Chrome only. Who may see which step is decided by the pages, not here: a layout does not
// re-render on navigation, so it cannot hold a guard.
export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  return (
    <main className={styles.main}>
      <div className={styles.shell}>{children}</div>
    </main>
  );
}
