import Image from "next/image";

interface LogoProps {
  /** Rendered width and height in CSS pixels. */
  size?: number;
  /** Load eagerly. Use it for the logo that is visible on first paint. */
  priority?: boolean;
}

/**
 * The brand emblem (public/MyIcons/logo.svg). It is decorative: the app name or the screen
 * title is always written next to it, so screen readers skip it.
 * next/image serves an SVG as-is, with no optimization step.
 */
export function Logo({ size = 72, priority = false }: LogoProps) {
  return <Image src="/MyIcons/logo.svg" alt="" width={size} height={size} priority={priority} />;
}
