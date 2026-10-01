import { describe, expect, it, vi } from "vitest";
import { IMAGE_LIMITS } from "@/domain/food/image";
import { ImageError, prepareImage, type PrepareDeps } from "./prepareImage";

interface EncodeCall {
  width: number;
  height: number;
  quality: number;
  type: string;
}

/**
 * A canvas double that records what was asked of it. `bytesFor` decides how big the encoded JPEG is, so
 * the quality ladder can be driven without a real encoder.
 */
function setup(options: { width: number; height: number; bytesFor?: (call: EncodeCall) => number; noContext?: boolean; nullBlob?: boolean }) {
  const calls: EncodeCall[] = [];
  const draws: Array<{ w: number; h: number }> = [];
  const canvases: Array<{ width: number; height: number }> = [];
  const close = vi.fn();
  const bitmap = { width: options.width, height: options.height, close };

  const document = {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected element ${tag}`);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () =>
          options.noContext
            ? null
            : {
                fillStyle: "",
                fillRect: vi.fn(),
                drawImage: (_source: unknown, _x: number, _y: number, w: number, h: number) => draws.push({ w, h }),
              },
        toBlob: (callback: (blob: Blob | null) => void, type: string, quality: number) => {
          const call = { width: canvas.width, height: canvas.height, quality, type };
          calls.push(call);
          callback(options.nullBlob ? null : new Blob([new Uint8Array(options.bytesFor?.(call) ?? 100_000)], { type }));
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  } as unknown as PrepareDeps["document"];

  const deps: PrepareDeps = { createImageBitmap: (async () => bitmap) as unknown as typeof createImageBitmap, document };
  return { deps, calls, draws, canvases, close };
}

const file = new Blob(["x"], { type: "image/jpeg" });

describe("prepareImage", () => {
  it("scales a large landscape photo to a 1024 px long side and encodes JPEG at quality 0.8", async () => {
    const { deps, calls } = setup({ width: 4032, height: 3024 });
    const result = await prepareImage(file, deps);
    expect(calls).toEqual([{ width: 1024, height: 768, quality: 0.8, type: "image/jpeg" }]);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
    expect(result.blob.type).toBe("image/jpeg");
  });

  it("scales a portrait photo by its long side", async () => {
    const { deps, calls } = setup({ width: 3024, height: 4032 });
    await prepareImage(file, deps);
    expect(calls[0]).toMatchObject({ width: 768, height: 1024 });
  });

  it("never upscales a small photo", async () => {
    const { deps, calls } = setup({ width: 640, height: 480 });
    const result = await prepareImage(file, deps);
    expect(calls[0]).toMatchObject({ width: 640, height: 480 });
    expect(result).toMatchObject({ width: 640, height: 480 });
  });

  it("draws straight at the small size, on a canvas it empties afterwards", async () => {
    const { deps, draws, canvases } = setup({ width: 4032, height: 3024 });
    await prepareImage(file, deps);
    expect(draws).toEqual([{ w: 1024, h: 768 }]);
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it("walks down the quality ladder until the result is small enough", async () => {
    const { deps, calls } = setup({
      width: 4032,
      height: 3024,
      bytesFor: ({ quality }) => (quality > 0.65 ? IMAGE_LIMITS.targetMaxBytes + 1 : IMAGE_LIMITS.targetMaxBytes),
    });
    await prepareImage(file, deps);
    expect(calls.map((call) => call.quality)).toEqual([0.8, 0.7, 0.6]);
    expect(calls.every((call) => call.width === 1024)).toBe(true);
  });

  it("falls back to 800 px at the lowest quality when the ladder is not enough, and returns that", async () => {
    const { deps, calls } = setup({
      width: 4032,
      height: 3024,
      bytesFor: ({ width }) => (width === 800 ? 600_000 : 900_000),
    });
    const result = await prepareImage(file, deps);
    expect(calls.map((call) => [call.width, call.quality])).toEqual([
      [1024, 0.8],
      [1024, 0.7],
      [1024, 0.6],
      [1024, 0.5],
      [800, 0.5],
    ]);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.blob.size).toBe(600_000);
  });

  it("skips the 800 px attempt when the photo is not bigger than that already", async () => {
    const { deps, calls } = setup({ width: 600, height: 400, bytesFor: () => 900_000 });
    const result = await prepareImage(file, deps);
    expect(calls).toHaveLength(4);
    expect(result.width).toBe(600);
  });

  it("closes the decoded bitmap, also when encoding fails", async () => {
    const ok = setup({ width: 2000, height: 1000 });
    await prepareImage(file, ok.deps);
    expect(ok.close).toHaveBeenCalledTimes(1);

    const bad = setup({ width: 2000, height: 1000, nullBlob: true });
    await expect(prepareImage(file, bad.deps)).rejects.toBeInstanceOf(ImageError);
    expect(bad.close).toHaveBeenCalledTimes(1);
  });

  it("throws ImageError when the browser cannot decode the file", async () => {
    const { document } = setup({ width: 1, height: 1 }).deps;
    const deps: PrepareDeps = {
      createImageBitmap: (async () => {
        throw new Error("cannot decode");
      }) as unknown as typeof createImageBitmap,
      document: {
        createElement: () => ({ decode: () => Promise.reject(new Error("cannot decode")), naturalWidth: 0, naturalHeight: 0 }),
      } as unknown as PrepareDeps["document"],
    };
    expect(document).toBeDefined();
    await expect(prepareImage(file, deps)).rejects.toMatchObject({ name: "ImageError", code: "unreadable" });
  });

  it("falls back to an <img> element when createImageBitmap is not usable", async () => {
    const calls: EncodeCall[] = [];
    const image = { src: "", naturalWidth: 3000, naturalHeight: 2000, decode: vi.fn().mockResolvedValue(undefined) };
    const document = {
      createElement: (tag: string) => {
        if (tag === "img") return image;
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }),
          toBlob: (callback: (blob: Blob | null) => void, type: string, quality: number) => {
            calls.push({ width: canvas.width, height: canvas.height, quality, type });
            callback(new Blob([new Uint8Array(1000)], { type }));
          },
        };
        return canvas;
      },
    } as unknown as PrepareDeps["document"];
    const deps: PrepareDeps = {
      createImageBitmap: (async () => {
        throw new Error("options not supported");
      }) as unknown as typeof createImageBitmap,
      document,
    };
    const result = await prepareImage(file, deps);
    expect(image.decode).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ width: 1024, height: 683 });
    expect(calls[0]).toMatchObject({ width: 1024, height: 683, quality: 0.8 });
  });

  it("throws ImageError for an image with no size, or when there is no 2d context", async () => {
    await expect(prepareImage(file, setup({ width: 0, height: 0 }).deps)).rejects.toBeInstanceOf(ImageError);
    await expect(prepareImage(file, setup({ width: 100, height: 100, noContext: true }).deps)).rejects.toBeInstanceOf(ImageError);
  });
});
