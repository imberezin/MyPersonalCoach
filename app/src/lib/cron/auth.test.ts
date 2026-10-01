import { describe, expect, it } from "vitest";
import { isValidCronRequest } from "./auth";

const request = (authorization?: string) =>
  new Request("https://example.com/api/engine/tick", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });

describe("isValidCronRequest", () => {
  it("accepts the right bearer secret", () => {
    expect(isValidCronRequest(request("Bearer s3cret"), "s3cret")).toBe(true);
  });

  it("rejects a wrong secret, a missing header and a different scheme", () => {
    expect(isValidCronRequest(request("Bearer nope"), "s3cret")).toBe(false);
    expect(isValidCronRequest(request(), "s3cret")).toBe(false);
    expect(isValidCronRequest(request("Basic s3cret"), "s3cret")).toBe(false);
  });

  it("authorizes nothing when no secret is configured", () => {
    expect(isValidCronRequest(request("Bearer "), "")).toBe(false);
    expect(isValidCronRequest(request("Bearer undefined"), undefined)).toBe(false);
  });
});
