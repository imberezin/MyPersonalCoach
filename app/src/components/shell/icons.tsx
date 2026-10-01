import type { JSX, ReactNode } from "react";
import type { NavItemId } from "./navModel";

// Five inline icons for the bottom bar: simple, rounded, friendly (Brand document section 21).
// One stroke style, drawn with currentColor so the bar's CSS decides the color. They are decorative
// (the label always sits next to them), so they are hidden from screen readers. Nothing here points
// left or right, so nothing needs to be mirrored in Hebrew.

export interface IconProps {
  /** CSS pixels. */
  size?: number;
}

function Svg({ size = 24, strokeWidth = 1.75, children }: IconProps & { strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A rounded house. */
export function HomeIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />
    </Svg>
  );
}

/** A sprout: growth over time, not a chart and not a scale (Brand sections 17 and 21). */
export function ProgressIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12 20v-8" />
      <path d="M12 12c0-3 2-5 6-5 0 3-2 5-6 5z" />
      <path d="M12 15c0-2-1.5-3.5-5-3.5 0 2.5 1.5 3.5 5 3.5z" />
    </Svg>
  );
}

/** A plus, a little heavier than the others because it sits on the colored disc. */
export function ReportIcon({ size }: IconProps) {
  return (
    <Svg size={size} strokeWidth={2.25}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** A speech bubble with a centered tail. */
export function CoachIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M7 5h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-3.5L12 19.5 10.5 17H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z" />
    </Svg>
  );
}

/** A head and shoulders. */
export function MeIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="8.5" r="3.25" />
      <path d="M5.5 19.5c.8-3.3 3.3-5 6.5-5s5.7 1.7 6.5 5" />
    </Svg>
  );
}

export const NAV_ICONS: Readonly<Record<NavItemId, (props: IconProps) => JSX.Element>> = {
  home: HomeIcon,
  progress: ProgressIcon,
  report: ReportIcon,
  coach: CoachIcon,
  me: MeIcon,
};
