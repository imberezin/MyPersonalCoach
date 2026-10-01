import { describe, expect, it } from "vitest";
import { isSameOrigin } from "./sameOrigin";

const headersOf = (entries: Record<string, string>): Pick<Headers, "get"> => {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null };
};

describe("isSameOrigin", () => {
  it("accepts an Origin whose host equals the Host header", () => {
    expect(isSameOrigin(headersOf({ origin: "https://coach.example", host: "coach.example" }))).toBe(true);
  });

  it("prefers x-forwarded-host over host (the proxy rewrites host)", () => {
    const headers = { origin: "https://coach.example", host: "internal-lambda:3000", "x-forwarded-host": "coach.example" };
    expect(isSameOrigin(headersOf(headers))).toBe(true);
    // ...and does not fall back to host when the forwarded one disagrees.
    expect(isSameOrigin(headersOf({ ...headers, host: "coach.example", "x-forwarded-host": "other.example" }))).toBe(false);
  });

  it("uses the first host of a forwarded chain", () => {
    expect(isSameOrigin(headersOf({ origin: "https://coach.example", "x-forwarded-host": "coach.example, edge.internal" }))).toBe(true);
  });

  it("compares hosts without regard to case", () => {
    expect(isSameOrigin(headersOf({ origin: "https://Coach.Example", host: "coach.example" }))).toBe(true);
  });

  it("rejects a missing Origin", () => {
    expect(isSameOrigin(headersOf({ host: "coach.example" }))).toBe(false);
  });

  it("rejects an Origin that is not a URL, including the opaque 'null'", () => {
    expect(isSameOrigin(headersOf({ origin: "null", host: "null" }))).toBe(false);
    expect(isSameOrigin(headersOf({ origin: "not a url", host: "coach.example" }))).toBe(false);
  });

  it("rejects another host", () => {
    expect(isSameOrigin(headersOf({ origin: "https://evil.example", host: "coach.example" }))).toBe(false);
  });

  it("rejects the same host on another port", () => {
    expect(isSameOrigin(headersOf({ origin: "http://localhost:3001", host: "localhost:3000" }))).toBe(false);
    expect(isSameOrigin(headersOf({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
  });

  it("rejects Sec-Fetch-Site: cross-site even when the hosts match", () => {
    const headers = { origin: "https://coach.example", host: "coach.example", "sec-fetch-site": "cross-site" };
    expect(isSameOrigin(headersOf(headers))).toBe(false);
    expect(isSameOrigin(headersOf({ ...headers, "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("rejects when neither host header is present", () => {
    expect(isSameOrigin(headersOf({ origin: "https://coach.example" }))).toBe(false);
  });
});
