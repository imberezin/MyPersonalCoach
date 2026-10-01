import { describe, expect, it } from "vitest";
import { ProviderError } from "../types";
import { asCount, asRecord, imageMime, kindForStatus, parseModelJson, postJson, toBase64 } from "./http";

function fetchReturning(response: Response | (() => Promise<Response>)): { fetch: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const doFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return typeof response === "function" ? response() : response;
  }) as unknown as typeof fetch;
  return { fetch: doFetch, calls };
}

const signal = () => new AbortController().signal;

async function kindOf(promise: Promise<unknown>): Promise<ProviderError | unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
}

describe("kindForStatus", () => {
  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [400, "bad_request"],
    [404, "bad_request"],
    [422, "bad_request"],
    [413, "bad_request"],
    [500, "server"],
    [503, "server"],
  ])("%s -> %s", (status, kind) => {
    expect(kindForStatus(status)).toBe(kind);
  });
});

describe("postJson", () => {
  it("sends JSON with the given headers and returns the parsed body", async () => {
    const { fetch: doFetch, calls } = fetchReturning(new Response(JSON.stringify({ hello: "world" }), { status: 200 }));
    const result = await postJson("https://api.example/x", { headers: { "x-key": "secret-1" }, body: { a: 1 } }, { signal: signal(), fetch: doFetch });
    expect(result).toEqual({ hello: "world" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example/x");
    expect(calls[0].url).not.toContain("secret-1");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "Content-Type": "application/json", "x-key": "secret-1" });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ a: 1 });
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [400, "bad_request"],
    [500, "server"],
  ])("maps HTTP %s to %s and never copies the body into the error", async (status, kind) => {
    const body = "SECRET-USER-TEXT: schnitzel with rice";
    const { fetch: doFetch } = fetchReturning(new Response(body, { status }));
    const error = (await kindOf(postJson("https://api.example/x", { headers: {}, body: {} }, { signal: signal(), fetch: doFetch }))) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).not.toContain("schnitzel");
    expect(String(error.stack)).not.toContain("schnitzel");
  });

  it("maps a network failure to 'network'", async () => {
    const { fetch: doFetch } = fetchReturning(() => Promise.reject(new TypeError("fetch failed: schnitzel")));
    const error = (await kindOf(postJson("https://api.example/x", { headers: {}, body: {} }, { signal: signal(), fetch: doFetch }))) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe("network");
    expect(error.message).not.toContain("schnitzel");
  });

  it("lets an abort through untouched, so the gateway can tell a timeout from a network failure", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("aborted", "AbortError");
    const { fetch: doFetch } = fetchReturning(() => {
      controller.abort();
      return Promise.reject(abortError);
    });
    const error = await kindOf(postJson("https://api.example/x", { headers: {}, body: {} }, { signal: controller.signal, fetch: doFetch }));
    expect(error).toBe(abortError);
  });

  it("maps a 200 whose body is not JSON to 'server'", async () => {
    const { fetch: doFetch } = fetchReturning(new Response("<html>oops</html>", { status: 200 }));
    const error = (await kindOf(postJson("https://api.example/x", { headers: {}, body: {} }, { signal: signal(), fetch: doFetch }))) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe("server");
  });

  it("refuses an enormous body", async () => {
    const { fetch: doFetch } = fetchReturning(new Response(JSON.stringify({ text: "x".repeat(1_100_000) }), { status: 200 }));
    const error = (await kindOf(postJson("https://api.example/x", { headers: {}, body: {} }, { signal: signal(), fetch: doFetch }))) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe("server");
  });
});

describe("parseModelJson", () => {
  it("parses plain JSON", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("removes a code fence and a reasoning block", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('<think>hmm { not json }</think>\n{"a":2}')).toEqual({ a: 2 });
  });
  it("finds the object inside chatter", () => {
    expect(parseModelJson('Sure! Here it is: {"a":3} Hope that helps.')).toEqual({ a: 3 });
  });
  it.each([["not json at all"], [""], [null], [undefined], ["{broken"], ["}{"]])("gives null for %s", (value) => {
    expect(parseModelJson(value as string | null | undefined)).toBeNull();
  });
});

describe("small helpers", () => {
  it("asRecord accepts plain objects only", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([])).toBeNull();
    expect(asRecord(null)).toBeNull();
    expect(asRecord("x")).toBeNull();
  });
  it("asCount accepts non-negative finite numbers and rounds", () => {
    expect(asCount(12)).toBe(12);
    expect(asCount(12.6)).toBe(13);
    expect(asCount(-1)).toBeUndefined();
    expect(asCount(Number.NaN)).toBeUndefined();
    expect(asCount("5")).toBeUndefined();
  });
  it("toBase64 encodes a view of a larger buffer correctly", () => {
    const big = new Uint8Array([0, 72, 105, 0]);
    expect(toBase64(big.subarray(1, 3))).toBe(Buffer.from("Hi").toString("base64"));
  });
  it("imageMime falls back to JPEG", () => {
    expect(imageMime("image/png")).toBe("image/png");
    expect(imageMime("application/pdf")).toBe("image/jpeg");
    expect(imageMime(undefined)).toBe("image/jpeg");
  });
});
