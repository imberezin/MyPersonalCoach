import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushMessage, PushSubscriptionRecord } from "./types";
import { MAX_PAYLOAD_BYTES, SEND_DEADLINE_MS, SOCKET_TIMEOUT_MS, WebPushProvider, createWebPushProvider, createWebPushProviderFromEnv } from "./webpush";

const mocks = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.sendNotification } }));

const VAPID = { subject: "mailto:owner@example.test", publicKey: "PUBLIC", privateKey: "PRIVATE" };
const SUBSCRIPTION: PushSubscriptionRecord = { endpoint: "https://push.example.test/send/secret-endpoint-token", p256dh: "p256dh-key-value", auth: "auth-secret-value" };
const MESSAGE: PushMessage = { title: "השבוע שלך", body: "יש לי כמה מילים על השבוע שעבר. כשנוח, אפשר להסתכל.", url: "/week", tag: "weekly_summary-2026-10-11", lang: "he", dir: "rtl" };

const provider = () => new WebPushProvider(VAPID);

function failWith(fields: Record<string, unknown>, message = "push failed") {
  mocks.sendNotification.mockRejectedValue(Object.assign(new Error(message), fields));
}

beforeEach(() => {
  mocks.sendNotification.mockReset().mockResolvedValue({ statusCode: 201, body: "", headers: {} });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WebPushProvider.send: what the push service answered", () => {
  it("is ok on 201", async () => {
    expect(await provider().send(SUBSCRIPTION, MESSAGE)).toEqual({ ok: true, outcome: "ok" });
  });

  it.each([404, 410])("is gone on %i, the only answers that let the sender delete a subscription", async (statusCode) => {
    failWith({ statusCode });
    expect(await provider().send(SUBSCRIPTION, MESSAGE)).toEqual({ ok: false, outcome: "gone", gone: true, statusCode });
  });

  it.each([400, 401, 403, 413])("is rejected, never gone, on %i", async (statusCode) => {
    failWith({ statusCode });
    expect(await provider().send(SUBSCRIPTION, MESSAGE)).toEqual({ ok: false, outcome: "rejected", gone: false, statusCode });
  });

  it.each([408, 429, 500, 502, 503, 504])("is retryable, never gone, on %i", async (statusCode) => {
    failWith({ statusCode });
    expect(await provider().send(SUBSCRIPTION, MESSAGE)).toEqual({ ok: false, outcome: "retryable", gone: false, statusCode });
  });

  it("is retryable for a network error or a socket timeout (no status code)", async () => {
    failWith({ code: "ECONNRESET" });
    expect(await provider().send(SUBSCRIPTION, MESSAGE)).toEqual({ ok: false, outcome: "retryable", gone: false });
    failWith({}, "Socket timeout");
    expect(await provider().send(SUBSCRIPTION, MESSAGE)).toEqual({ ok: false, outcome: "retryable", gone: false });
  });

  it("is rejected, not retryable, when the library cannot read the subscription", async () => {
    failWith({}, "Subscription should have 'keys'");
    expect(await provider().send(SUBSCRIPTION, MESSAGE)).toEqual({ ok: false, outcome: "rejected", gone: false });
  });

  it("never throws, even when the library throws something that is not an Error", async () => {
    mocks.sendNotification.mockRejectedValue("boom");
    expect(await provider().send(SUBSCRIPTION, MESSAGE)).toEqual({ ok: false, outcome: "rejected", gone: false });
    mocks.sendNotification.mockImplementation(() => {
      throw new TypeError("sync failure");
    });
    expect(await provider().send(SUBSCRIPTION, MESSAGE)).toEqual({ ok: false, outcome: "rejected", gone: false });
  });
});

describe("WebPushProvider.send: how it calls the library", () => {
  it("passes the subscription, the payload, the VAPID details, a 12 hour TTL and a socket timeout", async () => {
    await provider().send(SUBSCRIPTION, MESSAGE);
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    const [subscription, payload, options] = mocks.sendNotification.mock.calls[0];
    expect(subscription).toEqual({ endpoint: SUBSCRIPTION.endpoint, keys: { p256dh: SUBSCRIPTION.p256dh, auth: SUBSCRIPTION.auth } });
    expect(JSON.parse(payload as string)).toEqual(MESSAGE);
    expect(options).toMatchObject({ vapidDetails: VAPID, TTL: 43_200, urgency: "normal", timeout: SOCKET_TIMEOUT_MS });
    expect(SOCKET_TIMEOUT_MS).toBeLessThan(SEND_DEADLINE_MS);
  });

  it("returns a result, not an exception, for a payload that is too large, and never calls the library", async () => {
    const big: PushMessage = { ...MESSAGE, body: "x".repeat(MAX_PAYLOAD_BYTES) };
    expect(await provider().send(SUBSCRIPTION, big)).toEqual({ ok: false, outcome: "rejected", gone: false });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("gives up on a send that never answers, as retryable, after the deadline", async () => {
    vi.useFakeTimers();
    mocks.sendNotification.mockReturnValue(new Promise(() => undefined));
    const result = provider().send(SUBSCRIPTION, MESSAGE);
    await vi.advanceTimersByTimeAsync(SEND_DEADLINE_MS - 1);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: false, outcome: "retryable", gone: false });
  });

  it("does not leave a timer behind after a normal send", async () => {
    vi.useFakeTimers();
    await provider().send(SUBSCRIPTION, MESSAGE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs nothing: no endpoint, key or text can reach a log from the provider", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    failWith({ statusCode: 410 }, `gone ${SUBSCRIPTION.endpoint} ${SUBSCRIPTION.auth}`);
    await provider().send(SUBSCRIPTION, MESSAGE);
    failWith({ statusCode: 503 });
    await provider().send(SUBSCRIPTION, MESSAGE);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("does not put the endpoint, the keys or the text in any result", async () => {
    failWith({ statusCode: 403 }, `refused ${SUBSCRIPTION.endpoint}`);
    const text = JSON.stringify(await provider().send(SUBSCRIPTION, MESSAGE));
    for (const secret of [SUBSCRIPTION.endpoint, SUBSCRIPTION.p256dh, SUBSCRIPTION.auth, MESSAGE.body]) expect(text).not.toContain(secret);
  });
});

describe("createWebPushProvider", () => {
  const env = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@example.test" };

  it("builds a provider only when all three VAPID values are set", () => {
    expect(createWebPushProvider(env)).toBeInstanceOf(WebPushProvider);
    for (const missing of Object.keys(env)) expect(createWebPushProvider({ ...env, [missing]: undefined }), missing).toBeNull();
    expect(createWebPushProvider({ ...env, VAPID_SUBJECT: "" })).toBeNull();
    expect(createWebPushProvider({})).toBeNull();
  });

  it("reads process.env only when called (the CI build has no VAPID keys)", () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
    expect(createWebPushProviderFromEnv()).toBeNull();
    vi.unstubAllEnvs();
  });
});
