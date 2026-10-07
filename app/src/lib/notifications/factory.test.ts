import { describe, expect, it } from "vitest";
import { createNotificationProvider } from "./factory";
import { FAKE_RESULTS, FakeNotificationProvider, parseFakeBehavior } from "./fake";
import { WebPushProvider } from "./webpush";

const SUBSCRIPTION = { endpoint: "https://push.example.test/e1", p256dh: "k1", auth: "a1" };
const MESSAGE = { title: "t", body: "b" };
const VAPID = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@example.test" };

describe("createNotificationProvider", () => {
  it("is null without the VAPID values, in every environment", () => {
    for (const nodeEnv of ["production", "development", "test"]) expect(createNotificationProvider({ env: {}, nodeEnv })).toBeNull();
  });

  it("is null when one of the three VAPID values is missing", () => {
    for (const missing of Object.keys(VAPID)) {
      expect(createNotificationProvider({ env: { ...VAPID, [missing]: "" }, nodeEnv: "production" }), missing).toBeNull();
    }
  });

  it("is the real provider with all three VAPID values", () => {
    expect(createNotificationProvider({ env: VAPID, nodeEnv: "production" })).toBeInstanceOf(WebPushProvider);
  });

  it("REFUSES the fake provider in production, even with VAPID values set", () => {
    expect(createNotificationProvider({ env: { PUSH_PROVIDER: "fake" }, nodeEnv: "production" })).toBeNull();
    expect(createNotificationProvider({ env: { ...VAPID, PUSH_PROVIDER: "fake" }, nodeEnv: "production" })).toBeNull();
  });

  it("builds the fake outside production, and it wins over the VAPID values", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(createNotificationProvider({ env: { PUSH_PROVIDER: "fake" }, nodeEnv })).toBeInstanceOf(FakeNotificationProvider);
      expect(createNotificationProvider({ env: { ...VAPID, PUSH_PROVIDER: "fake" }, nodeEnv })).toBeInstanceOf(FakeNotificationProvider);
    }
  });

  it("treats any other PUSH_PROVIDER value as the real provider", () => {
    expect(createNotificationProvider({ env: { ...VAPID, PUSH_PROVIDER: "something" }, nodeEnv: "production" })).toBeInstanceOf(WebPushProvider);
    expect(createNotificationProvider({ env: { PUSH_PROVIDER: "something" }, nodeEnv: "development" })).toBeNull();
  });

  it("scripts the fake by PUSH_FAKE_BEHAVIOR", async () => {
    const answer = async (behavior: string | undefined) => {
      const fake = createNotificationProvider({ env: { PUSH_PROVIDER: "fake", PUSH_FAKE_BEHAVIOR: behavior }, nodeEnv: "development" });
      return fake?.send(SUBSCRIPTION, MESSAGE);
    };
    expect(await answer(undefined)).toEqual(FAKE_RESULTS.ok());
    expect(await answer("gone")).toEqual(FAKE_RESULTS.gone());
    expect(await answer("rejected")).toEqual(FAKE_RESULTS.rejected());
    expect(await answer("retryable")).toEqual(FAKE_RESULTS.retryable());
    await expect(answer("throw")).rejects.toThrow("scripted failure");
    expect(await answer("nonsense")).toEqual(FAKE_RESULTS.ok());
  });
});

describe("FakeNotificationProvider", () => {
  it("records every send, in order, and answers ok by default", async () => {
    const fake = new FakeNotificationProvider();
    expect(await fake.send(SUBSCRIPTION, MESSAGE)).toEqual({ ok: true, outcome: "ok" });
    await fake.send({ ...SUBSCRIPTION, endpoint: "https://push.example.test/e2" }, { title: "t2", body: "b2" });
    expect(fake.sent.map((s) => s.subscription.endpoint)).toEqual(["https://push.example.test/e1", "https://push.example.test/e2"]);
    expect(fake.sent[1].message).toEqual({ title: "t2", body: "b2" });
  });

  it("answers by script, per send, with the send's index", async () => {
    const fake = new FakeNotificationProvider((send, index) => (send.subscription.endpoint.endsWith("dead") ? FAKE_RESULTS.gone(404) : index === 0 ? FAKE_RESULTS.ok() : FAKE_RESULTS.retryable(429)));
    expect(await fake.send(SUBSCRIPTION, MESSAGE)).toEqual(FAKE_RESULTS.ok());
    expect(await fake.send(SUBSCRIPTION, MESSAGE)).toEqual(FAKE_RESULTS.retryable(429));
    expect(await fake.send({ ...SUBSCRIPTION, endpoint: "https://push.example.test/dead" }, MESSAGE)).toEqual(FAKE_RESULTS.gone(404));
  });

  it("can simulate a provider that breaks its contract by throwing", async () => {
    const fake = new FakeNotificationProvider(() => "throw");
    await expect(fake.send(SUBSCRIPTION, MESSAGE)).rejects.toThrow();
    expect(fake.sent).toHaveLength(1);
  });

  it("marks `gone` only for 404 and 410, in the results it scripts", () => {
    expect(FAKE_RESULTS.gone()).toMatchObject({ gone: true, outcome: "gone", statusCode: 410 });
    for (const result of [FAKE_RESULTS.rejected(), FAKE_RESULTS.retryable(), FAKE_RESULTS.ok()]) expect("gone" in result && result.gone).toBeFalsy();
  });

  it("parses behavior names, and an unknown name is ok", () => {
    expect(["ok", "gone", "rejected", "retryable", "throw"].map(parseFakeBehavior)).toEqual(["ok", "gone", "rejected", "retryable", "throw"]);
    expect(parseFakeBehavior(undefined)).toBe("ok");
    expect(parseFakeBehavior("GONE")).toBe("ok");
  });
});
