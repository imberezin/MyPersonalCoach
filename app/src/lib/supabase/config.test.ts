import { describe, expect, it } from "vitest";
import { isLocalSupabaseUrl } from "./config";

describe("isLocalSupabaseUrl", () => {
  it("accepts the local Supabase on this machine", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://[::1]:54321")).toBe(true);
  });

  it("rejects a hosted project and look-alike hosts", () => {
    expect(isLocalSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("https://localhost.example.com")).toBe(false);
    expect(isLocalSupabaseUrl("https://127.0.0.1.nip.io")).toBe(false);
    expect(isLocalSupabaseUrl("https://example.com/?next=http://127.0.0.1")).toBe(false);
  });

  it("rejects a missing or malformed value", () => {
    expect(isLocalSupabaseUrl(undefined)).toBe(false);
    expect(isLocalSupabaseUrl("")).toBe(false);
    expect(isLocalSupabaseUrl("not a url")).toBe(false);
  });
});
