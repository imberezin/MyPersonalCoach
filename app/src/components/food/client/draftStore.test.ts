import { describe, expect, it } from "vitest";
import { DRAFT_KEY, DRAFT_MAX_AGE_MS, clearDraft, loadDraft, saveDraft } from "./draftStore";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: (): void => {
    throw new Error("blocked");
  },
  removeItem: (): void => {
    throw new Error("blocked");
  },
};

const NOW = 1_800_000_000_000;

describe("draftStore", () => {
  it("saves and loads the text", () => {
    const storage = memoryStorage();
    saveDraft("bread and cheese", { storage, now: NOW });
    expect(loadDraft({ storage, now: NOW + 1000 })).toEqual({ text: "bread and cheese" });
    expect(JSON.parse(storage.data.get(DRAFT_KEY) as string)).toEqual({ text: "bread and cheese", savedAt: NOW });
  });

  it("keeps a draft for 12 hours and not a moment longer", () => {
    const storage = memoryStorage();
    saveDraft("bread", { storage, now: NOW });
    expect(loadDraft({ storage, now: NOW + DRAFT_MAX_AGE_MS })).toEqual({ text: "bread" });
    expect(loadDraft({ storage, now: NOW + DRAFT_MAX_AGE_MS + 1 })).toBeNull();
    // An expired draft is removed, not just ignored.
    expect(storage.data.has(DRAFT_KEY)).toBe(false);
  });

  it("returns null when nothing was saved", () => {
    expect(loadDraft({ storage: memoryStorage(), now: NOW })).toBeNull();
  });

  it("treats corrupt JSON and the wrong shape as no draft", () => {
    for (const raw of ["{not json", "123", "null", JSON.stringify({ text: 5, savedAt: NOW }), JSON.stringify({ text: "a" })]) {
      const storage = memoryStorage({ [DRAFT_KEY]: raw });
      expect(loadDraft({ storage, now: NOW }), raw).toBeNull();
      expect(storage.data.has(DRAFT_KEY), raw).toBe(false);
    }
  });

  it("treats a whitespace-only draft as no draft", () => {
    const storage = memoryStorage({ [DRAFT_KEY]: JSON.stringify({ text: "   \n", savedAt: NOW }) });
    expect(loadDraft({ storage, now: NOW })).toBeNull();
  });

  it("clips a stored draft to the 500 characters the field allows", () => {
    const storage = memoryStorage({ [DRAFT_KEY]: JSON.stringify({ text: "a".repeat(900), savedAt: NOW }) });
    expect(Array.from(loadDraft({ storage, now: NOW })?.text ?? "")).toHaveLength(500);
  });

  it("saving empty text clears the draft", () => {
    const storage = memoryStorage();
    saveDraft("bread", { storage, now: NOW });
    saveDraft("  ", { storage, now: NOW });
    expect(storage.data.has(DRAFT_KEY)).toBe(false);
  });

  it("clearDraft removes it", () => {
    const storage = memoryStorage();
    saveDraft("bread", { storage, now: NOW });
    clearDraft({ storage });
    expect(loadDraft({ storage, now: NOW })).toBeNull();
  });

  it("never throws when the storage does", () => {
    expect(() => saveDraft("bread", { storage: throwing, now: NOW })).not.toThrow();
    expect(() => clearDraft({ storage: throwing })).not.toThrow();
    expect(loadDraft({ storage: throwing, now: NOW })).toBeNull();
  });

  it("never throws when there is no storage at all (no window)", () => {
    expect(() => saveDraft("bread")).not.toThrow();
    expect(() => clearDraft()).not.toThrow();
    expect(loadDraft()).toBeNull();
  });
});
