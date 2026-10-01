import type { ReactNode } from "react";
import { FlowShell } from "@/components/food/FlowShell";

// Chrome only: one centered column and no navigation. A focus task (typing, the camera, the Save button)
// needs the whole bottom of the screen, so every screen carries its own exits. Who may see a screen is
// decided by the pages, not here: a layout does not re-render on navigation, so it cannot hold a guard.
export default function FlowLayout({ children }: { children: ReactNode }) {
  return <FlowShell>{children}</FlowShell>;
}
