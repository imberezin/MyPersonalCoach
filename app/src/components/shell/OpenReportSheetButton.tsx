"use client";

import type { JSX, ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui/Button";
import { REPORT_SHEET_ID, useReportSheet } from "./ReportSheet";

/** A button that opens the Report sheet, for pages that invite a report. Needs the (app) layout's provider. */
export function OpenReportSheetButton({
  variant,
  children,
}: {
  variant?: ButtonVariant;
  children: ReactNode;
}): JSX.Element {
  const { open } = useReportSheet();
  return (
    <Button
      type="button"
      variant={variant}
      aria-haspopup="dialog"
      aria-controls={REPORT_SHEET_ID}
      // The opener is passed in so focus can return to this button (see ReportSheetProvider).
      onClick={(event) => open(event.currentTarget)}
    >
      {children}
    </Button>
  );
}
