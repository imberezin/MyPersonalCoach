import type { AnalyzeMode } from "@/domain/food/analyzeTypes";

export interface RequestIds {
  /**
   * The id that goes with this attempt. The same (mode, input) pair gets the same id, so a retry after
   * a dropped answer is recognized by the server and answered from the stored report. A different mode
   * or a different input gets a new id: "keep it as I wrote it" must not be answered with the AI report
   * that the first attempt may already have created.
   */
  idFor(mode: AnalyzeMode, inputKey: string): string;
}

/** `crypto.randomUUID` needs a secure context; `getRandomValues` does not, and neither needs a library. */
export function randomUuid(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === "function") webCrypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createRequestIds(uuid: () => string = randomUuid): RequestIds {
  let last: { mode: AnalyzeMode; inputKey: string; id: string } | null = null;
  return {
    idFor(mode, inputKey) {
      if (last && last.mode === mode && last.inputKey === inputKey) return last.id;
      last = { mode, inputKey, id: uuid() };
      return last.id;
    },
  };
}
