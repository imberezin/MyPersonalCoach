import type { ReactNode } from "react";
import { AppHeader } from "@/components/shell/AppHeader";
import { BottomNav } from "@/components/shell/BottomNav";
import { ReportSheetProvider } from "@/components/shell/ReportSheet";
import styles from "@/components/shell/shell.module.css";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// Chrome only: the header, the bottom bar and the Report sheet around Home, Progress, Coach and Me.
// Who may see a page is decided by the pages (openAppGate), not here: a layout does not re-render on
// navigation, so it cannot hold a guard. Pages render a <div> or <section>, never <main>.
export default function AppLayout({ children }: { children: ReactNode }) {
  // Without Supabase every page shows the setup notice, and bar links would only lead to more of them.
  if (!isSupabaseConfigured()) return <main className={styles.bare}>{children}</main>;

  return (
    <ReportSheetProvider>
      <div className={styles.frame}>
        <AppHeader />
        <main className={styles.content}>{children}</main>
        <BottomNav />
      </div>
    </ReportSheetProvider>
  );
}
