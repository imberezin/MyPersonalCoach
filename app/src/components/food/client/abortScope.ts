/**
 * One place that owns the controller of the request in flight. Cancel, a retry and the unmount cleanup
 * all go through it, so there is never a second request that nobody can stop.
 */
export interface AbortScope {
  /** Aborts any earlier request and returns the signal of a fresh one. */
  begin(): AbortSignal;
  /** Aborts the current request. Harmless when nothing is running or the request already finished. */
  abort(): void;
}

export function createAbortScope(): AbortScope {
  let current: AbortController | null = null;
  return {
    begin() {
      current?.abort();
      current = new AbortController();
      return current.signal;
    },
    abort() {
      current?.abort();
    },
  };
}
