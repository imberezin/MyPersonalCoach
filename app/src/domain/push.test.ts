import { describe, expect, it } from "vitest";
import { derivePushState, parsePushSubscription, urlBase64ToBytes, type PushEnvSnapshot } from "./push";

const env = (over: Partial<PushEnvSnapshot> = {}): PushEnvSnapshot => ({
  isIOS: false,
  isStandalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: "default",
  hasPublicKey: true,
  ...over,
});

describe("derivePushState", () => {
  it("is checking before the environment is read", () => {
    expect(derivePushState(null)).toBe("checking");
  });

  it("asks an iPhone browser tab to install first, even though the APIs are missing", () => {
    const tab = env({ isIOS: true, hasPushManager: false, hasNotification: false });
    expect(derivePushState(tab)).toBe("ios_needs_install");
    expect(derivePushState(env({ isIOS: true }))).toBe("ios_needs_install");
  });

  it("is ready for the installed iPhone app", () => {
    expect(derivePushState(env({ isIOS: true, isStandalone: true }))).toBe("ready");
  });

  it("is unsupported when an API is missing", () => {
    expect(derivePushState(env({ hasServiceWorker: false }))).toBe("unsupported");
    expect(derivePushState(env({ hasPushManager: false }))).toBe("unsupported");
    expect(derivePushState(env({ hasNotification: false }))).toBe("unsupported");
  });

  it("is not configured without a public key", () => {
    expect(derivePushState(env({ hasPublicKey: false }))).toBe("not_configured");
  });

  it("is denied after a refusal, and checks the key first", () => {
    expect(derivePushState(env({ permission: "denied" }))).toBe("denied");
    expect(derivePushState(env({ permission: "denied", hasPublicKey: false }))).toBe("not_configured");
  });

  it("is ready otherwise, granted or not yet asked", () => {
    expect(derivePushState(env())).toBe("ready");
    expect(derivePushState(env({ permission: "granted" }))).toBe("ready");
  });
});

describe("urlBase64ToBytes", () => {
  it("decodes a known string", () => {
    expect(Array.from(urlBase64ToBytes("AQID"))).toEqual([1, 2, 3]);
  });

  it("uses the URL alphabet and accepts missing padding", () => {
    expect(Array.from(urlBase64ToBytes("-_8"))).toEqual([251, 255]);
    expect(Array.from(urlBase64ToBytes("-_8="))).toEqual([251, 255]);
  });

  it("decodes a 65-byte key", () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i));
    const decoded = urlBase64ToBytes(Buffer.from(bytes).toString("base64url"));
    expect(decoded).toHaveLength(65);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("throws on something that is not base64url", () => {
    expect(() => urlBase64ToBytes("not base64!")).toThrow();
  });
});

describe("parsePushSubscription", () => {
  const key = (length: number, first = 4) =>
    Buffer.from(Uint8Array.from({ length }, (_, i) => (i === 0 ? first : i))).toString("base64url");
  const valid = () => ({ endpoint: "https://push.example/abc", keys: { p256dh: key(65), auth: key(16, 1) } });

  it("accepts a valid subscription and keeps only three values", () => {
    const input = { ...valid(), expirationTime: null, extra: "ignored" };
    expect(parsePushSubscription(input)).toEqual({
      ok: true,
      value: { endpoint: "https://push.example/abc", p256dh: key(65), auth: key(16, 1) },
    });
  });

  it("rejects an endpoint that is not https or is too long", () => {
    expect(parsePushSubscription({ ...valid(), endpoint: "http://push.example/abc" }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid(), endpoint: "" }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid(), endpoint: `https://${"a".repeat(2041)}` }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid(), endpoint: `https://${"a".repeat(2040)}` }).ok).toBe(true);
  });

  it("rejects empty or missing keys", () => {
    expect(parsePushSubscription({ ...valid(), keys: { p256dh: "", auth: key(16) } }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid(), keys: { p256dh: key(65), auth: "" } }).ok).toBe(false);
    expect(parsePushSubscription({ endpoint: "https://push.example/abc" }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid(), keys: null }).ok).toBe(false);
  });

  it("rejects a public key of the wrong size or format", () => {
    expect(parsePushSubscription({ ...valid(), keys: { p256dh: key(64), auth: key(16) } }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid(), keys: { p256dh: key(66), auth: key(16) } }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid(), keys: { p256dh: key(65, 3), auth: key(16) } }).ok).toBe(false);
  });

  it("rejects an auth secret of the wrong size", () => {
    expect(parsePushSubscription({ ...valid(), keys: { p256dh: key(65), auth: key(15) } }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid(), keys: { p256dh: key(65), auth: key(17) } }).ok).toBe(false);
  });

  it("rejects bad base64 and wrong types", () => {
    expect(parsePushSubscription({ ...valid(), keys: { p256dh: "!!!", auth: key(16) } }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid(), keys: { p256dh: key(65), auth: "a b" } }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid(), keys: { p256dh: 1, auth: 2 } }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid(), endpoint: 5 }).ok).toBe(false);
    expect(parsePushSubscription(null).ok).toBe(false);
    expect(parsePushSubscription("https://push.example").ok).toBe(false);
  });
});
