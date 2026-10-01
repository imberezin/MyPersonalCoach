import { describe, expect, it } from "vitest";
import { createRequestIds, randomUuid } from "./requestId";

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createRequestIds", () => {
  it("gives the same id to the same mode and input", () => {
    const ids = createRequestIds(counter());
    expect(ids.idFor("text", "two slices of bread")).toBe(ids.idFor("text", "two slices of bread"));
  });

  it("gives a new id when the text is edited", () => {
    const ids = createRequestIds(counter());
    const first = ids.idFor("text", "bread");
    expect(ids.idFor("text", "bread and cheese")).not.toBe(first);
  });

  it("gives a new id when the same text is sent as a manual list after an AI attempt", () => {
    const ids = createRequestIds(counter());
    const ai = ids.idFor("text", "bread");
    const manual = ids.idFor("manual", "bread");
    expect(manual).not.toBe(ai);
    // A retry of the manual attempt keeps its own id.
    expect(ids.idFor("manual", "bread")).toBe(manual);
  });

  it("gives a new id for a new photo even when the note is the same", () => {
    const ids = createRequestIds(counter());
    const first = ids.idFor("photo", "photo:1:no sauce");
    const second = ids.idFor("photo", "photo:2:no sauce");
    expect(second).not.toBe(first);
    expect(ids.idFor("photo", "photo:2:no sauce")).toBe(second);
  });

  it("does not call the generator again for a repeat", () => {
    let calls = 0;
    const ids = createRequestIds(() => `id-${++calls}`);
    ids.idFor("text", "a");
    ids.idFor("text", "a");
    ids.idFor("text", "a");
    expect(calls).toBe(1);
  });
});

describe("randomUuid", () => {
  it("produces a version 4 UUID", () => {
    expect(randomUuid()).toMatch(UUID_V4);
  });

  it("falls back to getRandomValues when randomUUID is missing (an insecure context)", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(171) },
    });
    try {
      expect(randomUuid()).toMatch(UUID_V4);
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
  });
});
