import { describe, expect, it } from "vitest";
import { createAbortScope } from "./abortScope";

describe("createAbortScope", () => {
  it("begin() returns a fresh signal that is not aborted", () => {
    expect(createAbortScope().begin().aborted).toBe(false);
  });

  it("begin() aborts the previous signal and leaves the new one running", () => {
    const scope = createAbortScope();
    const first = scope.begin();
    const second = scope.begin();
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });

  it("abort() aborts the current signal", () => {
    const scope = createAbortScope();
    const signal = scope.begin();
    scope.abort();
    expect(signal.aborted).toBe(true);
  });

  it("abort() with nothing started, or called twice after completion, is harmless", () => {
    const scope = createAbortScope();
    expect(() => scope.abort()).not.toThrow();
    scope.begin();
    expect(() => {
      scope.abort();
      scope.abort();
    }).not.toThrow();
  });

  it("is what Cancel, retry and the unmount cleanup share: after abort(), a retry gets a live signal", () => {
    const scope = createAbortScope();
    const first = scope.begin();
    scope.abort();
    const retry = scope.begin();
    expect(first.aborted).toBe(true);
    expect(retry.aborted).toBe(false);
  });
});
