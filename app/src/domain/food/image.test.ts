import { describe, expect, it } from "vitest";
import { IMAGE_LIMITS, computeTargetSize, sniffImageType } from "./image";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("sniffImageType", () => {
  it("recognizes a JPEG by its first three bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe("jpeg");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff))).toBe("jpeg");
  });

  it("recognizes a PNG", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe("png");
  });

  it("recognizes a WebP (RIFF....WEBP)", () => {
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe("webp");
  });

  it("does not take another RIFF file (a WAV) for a WebP", () => {
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull();
  });

  it("checks all three JPEG bytes and the last byte of the WebP tag", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0x00, 0xe0))).toBeNull();
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x58))).toBeNull(); // WEBX
  });

  it("gives null for a GIF, text, and a truncated header", () => {
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBeNull(); // GIF89a
    expect(sniffImageType(new TextEncoder().encode("<html></html>"))).toBeNull();
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull(); // 2 bytes
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull(); // PNG start only
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe("computeTargetSize", () => {
  it("scales a landscape photo so the long side is the limit", () => {
    expect(computeTargetSize(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
  });

  it("scales a portrait photo the same way", () => {
    expect(computeTargetSize(3000, 4000, 1024)).toEqual({ width: 768, height: 1024 });
  });

  it("never upscales", () => {
    expect(computeTargetSize(800, 600, 1024)).toEqual({ width: 800, height: 600 });
    expect(computeTargetSize(1024, 1024, 1024)).toEqual({ width: 1024, height: 1024 });
    expect(computeTargetSize(1, 1, 1024)).toEqual({ width: 1, height: 1 });
  });

  it("rounds, and keeps at least 1 px for an extreme aspect ratio", () => {
    expect(computeTargetSize(10_000, 3, 1024)).toEqual({ width: 1024, height: 1 });
    expect(computeTargetSize(3, 10_000, 1024)).toEqual({ width: 1, height: 1024 });
    expect(computeTargetSize(3000, 2001, 1024)).toEqual({ width: 1024, height: 683 });
  });

  it("works with the retry long side", () => {
    expect(computeTargetSize(4032, 3024, IMAGE_LIMITS.retryLongSidePx)).toEqual({ width: 800, height: 600 });
  });

  it("gives 1 x 1 for a size that is not usable", () => {
    for (const [w, h] of [[0, 100], [100, 0], [-5, 10], [Number.NaN, 10], [10, Number.POSITIVE_INFINITY]] as const) {
      expect(computeTargetSize(w, h, 1024), `${w}x${h}`).toEqual({ width: 1, height: 1 });
    }
  });
});

describe("IMAGE_LIMITS", () => {
  it("keeps the byte limits in order: target < server < request", () => {
    expect(IMAGE_LIMITS.targetMaxBytes).toBeLessThan(IMAGE_LIMITS.serverMaxBytes);
    expect(IMAGE_LIMITS.serverMaxBytes).toBeLessThan(IMAGE_LIMITS.requestMaxBytes);
  });

  it("retries at a falling quality and a smaller size", () => {
    const qualities = [IMAGE_LIMITS.jpegQuality, ...IMAGE_LIMITS.retryQualities];
    expect([...qualities].sort((a, b) => b - a)).toEqual(qualities);
    expect(IMAGE_LIMITS.retryLongSidePx).toBeLessThan(IMAGE_LIMITS.longSidePx);
  });
});
