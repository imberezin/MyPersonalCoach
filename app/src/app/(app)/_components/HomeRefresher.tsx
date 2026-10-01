"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { HOME_TIMING, isHomeStale } from "@/domain/home";

/**
 * Event wiring only; "is this page old?" is `isHomeStale`, a pure function with its own tests.
 *
 * Home is a function of the clock, but an iPhone PWA that comes back from the background shows the
 * page it kept in memory, which can be from yesterday. When the page becomes visible again (or is
 * restored from the back/forward cache) and it is older than `staleAfterMs`, this asks the server
 * for a fresh render. It does not move a Home that stays open in the foreground: that waits for the
 * next visit or navigation.
 *
 * The client clock is read only inside the effect and the handler (react-hooks/purity), and there
 * is no state: a refresh delivers a new `renderedAt`, which re-runs the effect and so restarts the age.
 */
export function HomeRefresher({
  renderedAt,
  staleAfterMs = HOME_TIMING.staleAfterMs,
}: {
  renderedAt: number;
  staleAfterMs?: number;
}) {
  const router = useRouter();
  const mountedAt = useRef(0);

  useEffect(() => {
    mountedAt.current = Date.now();

    const refreshIfStale = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (!isHomeStale(mountedAt.current, now, staleAfterMs)) return;
      // Restart the age now, so a second event before the new render arrives does not ask twice.
      mountedAt.current = now;
      router.refresh();
    };

    document.addEventListener("visibilitychange", refreshIfStale);
    window.addEventListener("pageshow", refreshIfStale);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfStale);
      window.removeEventListener("pageshow", refreshIfStale);
    };
    // `renderedAt` is not read inside: it changes when the server sends a new render, and that is the cue to restart.
  }, [renderedAt, staleAfterMs, router]);

  return null;
}
