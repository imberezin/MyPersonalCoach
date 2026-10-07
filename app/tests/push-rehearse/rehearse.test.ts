import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FAKE_RESULTS, FakeNotificationProvider } from "@/lib/notifications/fake";
import { parseRehearseArgs, runRehearsal, type RehearseDeps, type StoredSubscription } from "../../scripts/push-rehearse/rehearse";

const USER_ONE = "11111111-1111-4111-8111-111111111111";
const USER_TWO = "22222222-2222-4222-8222-222222222222";
const APPLE = "https://web.push.apple.com/QSecretEndpointPathToken123";
const FCM = "https://fcm.googleapis.com/fcm/send/AnotherSecretTokenXYZ";

const sub = (userId: string, endpoint: string): StoredSubscription => ({ userId, endpoint, p256dh: `p256dh-of-${userId}`, auth: `auth-of-${userId}` });

function setup(over: Partial<RehearseDeps> & { subscriptions?: StoredSubscription[] | null; language?: unknown; provider?: FakeNotificationProvider | null } = {}) {
  const lines: string[] = [];
  const provider = over.provider === undefined ? new FakeNotificationProvider() : over.provider;
  const readSubscriptions = vi.fn(async (userId: string | null) => {
    const all = over.subscriptions === undefined ? [sub(USER_ONE, APPLE)] : over.subscriptions;
    return all === null ? null : userId === null ? all : all.filter((s) => s.userId === userId);
  });
  const deps: RehearseDeps = {
    provider,
    keySource: ".env.vercel",
    log: (line) => lines.push(line),
    readSubscriptions: over.readSubscriptions ?? readSubscriptions,
    readLanguage: over.readLanguage ?? (async () => (over.language === undefined ? "he" : over.language)),
  };
  return { deps, lines, provider, readSubscriptions, text: () => lines.join("\n") };
}

describe("parseRehearseArgs", () => {
  it("defaults to a dry run for one person", () => {
    expect(parseRehearseArgs(undefined)).toEqual({ ok: true, value: { yes: false, userId: null } });
    expect(parseRehearseArgs("{}")).toEqual({ ok: true, value: { yes: false, userId: null } });
  });

  it("reads --yes and --user-id", () => {
    expect(parseRehearseArgs(JSON.stringify({ yes: true }))).toEqual({ ok: true, value: { yes: true, userId: null } });
    expect(parseRehearseArgs(JSON.stringify({ yes: true, "user-id": USER_ONE.toUpperCase() }))).toEqual({ ok: true, value: { yes: true, userId: USER_ONE } });
  });

  it.each([
    ["an unknown flag (a typo must not become a send)", { yse: true }],
    ["--yes with a value", { yes: "true" }],
    ["a user id that is not a uuid", { "user-id": "me" }],
    ["a user id flag without a value", { "user-id": true }],
    ["a list", ["--yes"]],
  ])("refuses %s", (_label, flags) => {
    expect(parseRehearseArgs(JSON.stringify(flags))).toMatchObject({ ok: false });
  });

  it("refuses text that is not JSON", () => {
    expect(parseRehearseArgs("{nope")).toMatchObject({ ok: false });
  });
});

describe("runRehearsal: a dry run", () => {
  it("shows the message and the subscription count and sends nothing", async () => {
    const { deps, provider, text } = setup();
    const send = vi.spyOn(provider as FakeNotificationProvider, "send");
    expect(await runRehearsal({ yes: false, userId: null }, deps)).toEqual({ ok: true, sent: 0, delivered: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain("Subscriptions: 1");
    expect(text()).toContain("השבוע שלך");
    expect(text()).toContain("DRY RUN");
  });
});

describe("runRehearsal: the real send", () => {
  it("sends ONE push per subscription with the approved weekly words, the /week path and its own tag", async () => {
    const { deps, provider, text } = setup();
    expect(await runRehearsal({ yes: true, userId: null }, deps)).toEqual({ ok: true, sent: 1, delivered: 1 });
    const fake = provider as FakeNotificationProvider;
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].message).toEqual({
      title: "השבוע שלך",
      body: "יש לי כמה מילים על השבוע שעבר. כשנוח, אפשר להסתכל.",
      url: "/week",
      tag: "rehearsal",
      lang: "he",
      dir: "rtl",
    });
    expect(text()).toContain("web.push.apple.com");
    expect(text()).toContain("accepted by the push service");
    expect(text()).toContain("Nothing was written anywhere");
  });

  it("speaks English to an English speaker", async () => {
    const { deps, provider } = setup({ language: "en" });
    await runRehearsal({ yes: true, userId: null }, deps);
    expect((provider as FakeNotificationProvider).sent[0].message).toMatchObject({ title: "Your week", lang: "en", dir: "ltr" });
  });

  it("falls back to Hebrew when the language cannot be read", async () => {
    const { deps, provider } = setup({ language: null });
    await runRehearsal({ yes: true, userId: null }, deps);
    expect((provider as FakeNotificationProvider).sent[0].message).toMatchObject({ lang: "he" });
  });

  it("sends to each subscription of one person (a phone and a second device) and says what each answered", async () => {
    const { deps, text } = setup({
      subscriptions: [sub(USER_ONE, APPLE), sub(USER_ONE, FCM)],
      provider: new FakeNotificationProvider((send) => (send.subscription.endpoint === FCM ? FAKE_RESULTS.rejected(403) : FAKE_RESULTS.ok())),
    });
    expect(await runRehearsal({ yes: true, userId: null }, deps)).toEqual({ ok: true, sent: 2, delivered: 1 });
    expect(text()).toContain("Subscription 1 (web.push.apple.com): accepted");
    expect(text()).toContain("Subscription 2 (fcm.googleapis.com): refused (status 403)");
    expect(text()).toContain("push keys differ");
  });

  it("reports a dead subscription and does NOT delete it (it has no way to)", async () => {
    const { deps, text } = setup({ provider: new FakeNotificationProvider(() => FAKE_RESULTS.gone(410)) });
    await runRehearsal({ yes: true, userId: null }, deps);
    expect(text()).toContain("the subscription is gone (status 410): it was NOT deleted");
    expect(Object.keys(deps).sort()).toEqual(["keySource", "log", "provider", "readLanguage", "readSubscriptions"]);
  });

  it("survives a provider that throws and says it was a temporary failure", async () => {
    const { deps, text } = setup({ provider: new FakeNotificationProvider(() => "throw") });
    expect(await runRehearsal({ yes: true, userId: null }, deps)).toEqual({ ok: true, sent: 1, delivered: 0 });
    expect(text()).toContain("a temporary failure");
  });

  it("prints no endpoint path, key, user id or payload text beyond the approved words", async () => {
    const { deps, text } = setup({ subscriptions: [sub(USER_ONE, APPLE), sub(USER_ONE, FCM)] });
    await runRehearsal({ yes: true, userId: null }, deps);
    for (const secret of ["QSecretEndpointPathToken123", "AnotherSecretTokenXYZ", `p256dh-of-${USER_ONE}`, `auth-of-${USER_ONE}`, USER_ONE]) {
      expect(text(), secret).not.toContain(secret);
    }
  });
});

describe("runRehearsal: what stops it before anything is sent", () => {
  it("stops without keys, and reads nothing", async () => {
    const { deps, readSubscriptions, text } = setup({ provider: null });
    expect(await runRehearsal({ yes: true, userId: null }, deps)).toEqual({ ok: false, code: "no_keys" });
    expect(readSubscriptions).not.toHaveBeenCalled();
    expect(text()).toContain("Nothing was read or sent");
  });

  it("stops when the subscriptions cannot be read", async () => {
    const { deps, provider } = setup({ subscriptions: null });
    expect(await runRehearsal({ yes: true, userId: null }, deps)).toEqual({ ok: false, code: "read_failed" });
    expect((provider as FakeNotificationProvider).sent).toHaveLength(0);
  });

  it("stops when there is no subscription", async () => {
    const { deps, provider } = setup({ subscriptions: [] });
    expect(await runRehearsal({ yes: true, userId: null }, deps)).toEqual({ ok: false, code: "no_subscription" });
    expect((provider as FakeNotificationProvider).sent).toHaveLength(0);
  });

  it("stops when two different people have subscriptions and no --user-id was given", async () => {
    const { deps, provider, text } = setup({ subscriptions: [sub(USER_ONE, APPLE), sub(USER_TWO, FCM)] });
    expect(await runRehearsal({ yes: true, userId: null }, deps)).toEqual({ ok: false, code: "ambiguous" });
    expect((provider as FakeNotificationProvider).sent).toHaveLength(0);
    expect(text()).toContain("--user-id");
  });

  it("with --user-id it asks for that person only", async () => {
    const { deps, provider, readSubscriptions } = setup({ subscriptions: [sub(USER_ONE, APPLE), sub(USER_TWO, FCM)] });
    expect(await runRehearsal({ yes: true, userId: USER_TWO }, deps)).toEqual({ ok: true, sent: 1, delivered: 1 });
    expect(readSubscriptions).toHaveBeenCalledWith(USER_TWO);
    expect((provider as FakeNotificationProvider).sent.map((s) => s.subscription.endpoint)).toEqual([FCM]);
  });
});

describe("the rehearsal source", () => {
  const read = (...parts: string[]) =>
    readFileSync(join(process.cwd(), ...parts), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  it("has no call that writes: no insert, update, upsert, delete or rpc, and it never touches the notification log", () => {
    for (const file of [["scripts", "push-rehearse", "rehearse.ts"], ["scripts", "push-rehearse", "run.live.ts"], ["scripts", "push-rehearse.mjs"]]) {
      const source = read(...file);
      expect(source, file.join("/")).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
      expect(source, file.join("/")).not.toMatch(/notification_log/);
    }
  });

  it("reads only the two tables it needs, with select", () => {
    const source = read("scripts", "push-rehearse", "run.live.ts");
    expect([...source.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]).sort()).toEqual(["profiles", "push_subscriptions"]);
    expect([...source.matchAll(/\.select\("([^"]+)"\)/g)].map((m) => m[1])).toEqual(["user_id, endpoint, p256dh, auth", "language"]);
  });

  it("is never run by npm test: the root config does not include the scripts folder", () => {
    // Raw text: the glob "src/**/*.test.ts" contains /**/, which a comment stripper would eat.
    const config = readFileSync(join(process.cwd(), "vitest.config.mts"), "utf8");
    expect(config).toMatch(/include:\s*\["src\/\*\*\/\*\.test\.ts",\s*"tests\/\*\*\/\*\.test\.ts"\]/);
    expect(readFileSync(join(process.cwd(), "scripts", "push-rehearse", "vitest.config.mts"), "utf8")).toMatch(/include:\s*\["scripts\/push-rehearse\/run\.live\.ts"\]/);
  });

  it("never uses the fake provider: it builds the real one as production", () => {
    const source = read("scripts", "push-rehearse", "run.live.ts");
    expect(source).toMatch(/nodeEnv:\s*"production"/);
    expect(source).toMatch(/PUSH_PROVIDER:\s*undefined/);
  });
});
