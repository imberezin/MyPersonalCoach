import { describe, expect, it } from "vitest";
import { guardCronRequest, isValidCronRequest } from "./auth";

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

  it("rejects a wrong secret of the same length as the real one", () => {
    expect(isValidCronRequest(request("Bearer s3cres"), "s3cret")).toBe(false);
    expect(isValidCronRequest(request("Bearer x3cret"), "s3cret")).toBe(false);
  });

  it("authorizes nothing when no secret is configured", () => {
    expect(isValidCronRequest(request("Bearer "), "")).toBe(false);
    expect(isValidCronRequest(request("Bearer undefined"), undefined)).toBe(false);
  });
});

describe("guardCronRequest", () => {
  it("answers 503 when no secret is configured, even for a request that carries a header", async () => {
    for (const secret of [undefined, ""]) {
      const response = guardCronRequest(request("Bearer anything"), secret);
      expect(response?.status).toBe(503);
      expect(await response?.json()).toEqual({ error: "cron_not_configured" });
    }
  });

  it("answers 401 for a wrong secret, a missing header and a different scheme", async () => {
    for (const header of ["Bearer nope", undefined, "Basic s3cret", "Bearer s3cres"]) {
      const response = guardCronRequest(request(header), "s3cret");
      expect(response?.status).toBe(401);
      expect(await response?.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("lets the right bearer secret through with null", () => {
    expect(guardCronRequest(request("Bearer s3cret"), "s3cret")).toBeNull();
  });
});
