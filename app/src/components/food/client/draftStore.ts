import { FOOD_LIMITS } from "@/domain/food/types";

/** The unsent text survives a reload and iOS killing the installed app. Photos are never kept. */
export const DRAFT_KEY = "eating-coach:food-draft:v1";
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface DraftOptions {
  storage?: DraftStorage;
  /** The clock reading, for tests. */
  now?: number;
}

// Storage can be missing, blocked (private window, site data off) or throw on access, so every touch is guarded.
function storageOf(options?: DraftOptions): DraftStorage | null {
  try {
    return options?.storage ?? window.localStorage;
  } catch {
    return null;
  }
}

function clipToLimit(text: string): string {
  const points = Array.from(text);
  return points.length > FOOD_LIMITS.textMax ? points.slice(0, FOOD_LIMITS.textMax).join("") : text;
}

export function loadDraft(options?: DraftOptions): { text: string } | null {
  const storage = storageOf(options);
  if (!storage) return null;
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    const record = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    if (!record || typeof record.text !== "string" || typeof record.savedAt !== "number") {
      clearDraft(options);
      return null;
    }
    const now = options?.now ?? Date.now();
    if (now - record.savedAt > DRAFT_MAX_AGE_MS) {
      clearDraft(options);
      return null;
    }
    const text = clipToLimit(record.text);
    return text.trim() === "" ? null : { text };
  } catch {
    // Corrupt JSON or a storage that throws: there is no draft.
    clearDraft(options);
    return null;
  }
}

/** Empty or whitespace-only text clears the draft instead of keeping an empty one. */
export function saveDraft(text: string, options?: DraftOptions): void {
  if (text.trim() === "") {
    clearDraft(options);
    return;
  }
  const storage = storageOf(options);
  if (!storage) return;
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify({ text, savedAt: options?.now ?? Date.now() }));
  } catch {
    // Full or blocked storage: the draft is a convenience, never a requirement.
  }
}

export function clearDraft(options?: DraftOptions): void {
  const storage = storageOf(options);
  if (!storage) return;
  try {
    storage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to do.
  }
}
