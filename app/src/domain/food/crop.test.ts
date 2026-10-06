import { describe, expect, it } from "vitest";
import {
  CROP_CORNERS,
  CROP_EDGES,
  FULL_CROP,
  clampCrop,
  cropKey,
  cropSourceRect,
  dragCrop,
  isFullCrop,
  nudgeCrop,
  type CropHandle,
  type CropRect,
} from "./crop";
import { PHOTO_CROP } from "./image";

const MIN = PHOTO_CROP.minFraction;
const right = (rect: CropRect) => Math.round((rect.x + rect.w) * 10_000) / 10_000;
const bottom = (rect: CropRect) => Math.round((rect.y + rect.h) * 10_000) / 10_000;
const inside = (rect: CropRect) => rect.x >= 0 && rect.y >= 0 && right(rect) <= 1 && bottom(rect) <= 1 && rect.w >= MIN && rect.h >= MIN;

describe("PHOTO_CROP", () => {
  it("ships on, with a frame that cannot shrink to a speck and a small keyboard step", () => {
    expect(PHOTO_CROP.enabled).toBe(true);
    expect(PHOTO_CROP.minFraction).toBe(0.15);
    expect(PHOTO_CROP.keyboardStep).toBe(0.02);
    expect(PHOTO_CROP.fullEpsilon).toBeLessThan(0.01);
  });
});

describe("clampCrop", () => {
  it("leaves a valid frame as it is", () => {
    expect(clampCrop({ x: 0.2, y: 0.1, w: 0.5, h: 0.6 })).toEqual({ x: 0.2, y: 0.1, w: 0.5, h: 0.6 });
  });

  it("raises a side that is too small to the minimum", () => {
    expect(clampCrop({ x: 0.1, y: 0.1, w: 0.01, h: 0 })).toEqual({ x: 0.1, y: 0.1, w: MIN, h: MIN });
  });

  it("pulls a frame that sticks out of the picture back inside, keeping its size", () => {
    expect(clampCrop({ x: 0.9, y: -0.2, w: 0.4, h: 0.3 })).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.3 });
  });

  it("treats numbers that are not finite as the whole picture on that axis", () => {
    expect(clampCrop({ x: Number.NaN, y: Number.POSITIVE_INFINITY, w: Number.NaN, h: Number.NEGATIVE_INFINITY })).toEqual(FULL_CROP);
  });

  it("never lets rounding push the right or bottom edge past 1", () => {
    for (const w of [0.3333333, 0.6666667, 0.7777777, 0.15]) {
      const rect = clampCrop({ x: 1 - w + 1e-9, y: 1 - w + 1e-9, w, h: w });
      expect(inside(rect), JSON.stringify(rect)).toBe(true);
    }
  });
});

describe("dragCrop", () => {
  const frame: CropRect = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };

  it("moves the top-left corner and keeps the opposite corner where it was", () => {
    const next = dragCrop(frame, "nw", 0.1, 0.05);
    expect(next).toEqual({ x: 0.3, y: 0.25, w: 0.4, h: 0.45 });
    expect(right(next)).toBe(right(frame));
    expect(bottom(next)).toBe(bottom(frame));
  });

  it("moves each of the other corners on its own two edges", () => {
    expect(dragCrop(frame, "ne", -0.1, 0.1)).toEqual({ x: 0.2, y: 0.3, w: 0.4, h: 0.4 });
    expect(dragCrop(frame, "sw", 0.1, -0.1)).toEqual({ x: 0.3, y: 0.2, w: 0.4, h: 0.4 });
    expect(dragCrop(frame, "se", 0.1, 0.1)).toEqual({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 });
  });

  it("moves one edge only, and ignores the other axis", () => {
    expect(dragCrop(frame, "w", 0.1, 0.4)).toEqual({ x: 0.3, y: 0.2, w: 0.4, h: 0.5 });
    expect(dragCrop(frame, "e", 0.1, 0.4)).toEqual({ x: 0.2, y: 0.2, w: 0.6, h: 0.5 });
    expect(dragCrop(frame, "n", 0.4, -0.1)).toEqual({ x: 0.2, y: 0.1, w: 0.5, h: 0.6 });
    expect(dragCrop(frame, "s", 0.4, 0.1)).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.6 });
  });

  it("stops at the edge of the picture instead of leaving it", () => {
    expect(dragCrop(frame, "se", 5, 5)).toEqual({ x: 0.2, y: 0.2, w: 0.8, h: 0.8 });
    expect(dragCrop(frame, "nw", -5, -5)).toEqual({ x: 0, y: 0, w: 0.7, h: 0.7 });
  });

  it("stops at the minimum size instead of flipping or jumping", () => {
    const squeezed = dragCrop(frame, "se", -5, -5);
    expect(squeezed).toEqual({ x: 0.2, y: 0.2, w: MIN, h: MIN });
    const fromTop = dragCrop(frame, "nw", 5, 5);
    expect(fromTop).toEqual({ x: 0.55, y: 0.55, w: MIN, h: MIN });
    expect(right(fromTop)).toBe(0.7);
  });

  it("slides the whole frame without changing its size, and keeps it inside", () => {
    expect(dragCrop(frame, "move", 0.1, -0.1)).toEqual({ x: 0.3, y: 0.1, w: 0.5, h: 0.5 });
    expect(dragCrop(frame, "move", 5, 5)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(dragCrop(frame, "move", -5, -5)).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
  });

  it("is a pure function of its start and the distance: the same drag gives the same frame, and the start is untouched", () => {
    const start = { ...frame };
    const first = dragCrop(start, "se", 0.1, 0.1);
    const second = dragCrop(start, "se", 0.1, 0.1);
    expect(second).toEqual(first);
    expect(start).toEqual(frame);
  });

  it("ignores a distance that is not a number", () => {
    expect(dragCrop(frame, "se", Number.NaN, Number.POSITIVE_INFINITY)).toEqual(frame);
  });

  it("keeps the frame valid for every handle and a spread of drags (a small fuzz)", () => {
    const handles: CropHandle[] = ["move", ...CROP_EDGES, ...CROP_CORNERS];
    const distances = [-3, -0.6, -0.17, -0.02, 0, 0.02, 0.17, 0.6, 3];
    for (const handle of handles) {
      for (const dx of distances) {
        for (const dy of distances) {
          const next = dragCrop(frame, handle, dx, dy);
          expect(inside(next), `${handle} ${dx} ${dy} -> ${JSON.stringify(next)}`).toBe(true);
        }
      }
    }
  });
});

describe("nudgeCrop (the keyboard)", () => {
  const frame: CropRect = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };

  it("moves the handle's own edge by the step in the arrow's direction", () => {
    expect(nudgeCrop(frame, "e", "ArrowRight")).toEqual({ x: 0.2, y: 0.2, w: 0.52, h: 0.5 });
    expect(nudgeCrop(frame, "e", "ArrowLeft")).toEqual({ x: 0.2, y: 0.2, w: 0.48, h: 0.5 });
    expect(nudgeCrop(frame, "n", "ArrowUp")).toEqual({ x: 0.2, y: 0.18, w: 0.5, h: 0.52 });
    expect(nudgeCrop(frame, "s", "ArrowUp")).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.48 });
  });

  it("moves a corner on the axis of the arrow only", () => {
    expect(nudgeCrop(frame, "nw", "ArrowRight")).toEqual({ x: 0.22, y: 0.2, w: 0.48, h: 0.5 });
    expect(nudgeCrop(frame, "nw", "ArrowDown")).toEqual({ x: 0.2, y: 0.22, w: 0.5, h: 0.48 });
  });

  it("does nothing when the arrow is along an axis the edge does not have", () => {
    expect(nudgeCrop(frame, "n", "ArrowLeft")).toEqual(frame);
    expect(nudgeCrop(frame, "e", "ArrowDown")).toEqual(frame);
  });

  it("takes a different step when asked", () => {
    expect(nudgeCrop(frame, "e", "ArrowRight", 0.1)).toEqual({ x: 0.2, y: 0.2, w: 0.6, h: 0.5 });
  });
});

describe("isFullCrop and cropKey", () => {
  it("knows the whole picture, also with a hair of difference", () => {
    expect(isFullCrop(FULL_CROP)).toBe(true);
    expect(isFullCrop({ x: 0.003, y: 0, w: 0.994, h: 0.998 })).toBe(true);
    expect(isFullCrop({ x: 0.02, y: 0, w: 0.98, h: 1 })).toBe(false);
    expect(isFullCrop({ x: 0, y: 0, w: 0.5, h: 1 })).toBe(false);
  });

  it("keys the whole picture as full, and any other frame by its numbers", () => {
    expect(cropKey(FULL_CROP)).toBe("full");
    expect(cropKey({ x: 0.001, y: 0, w: 0.999, h: 1 })).toBe("full");
    expect(cropKey({ x: 0.2, y: 0.1, w: 0.5, h: 0.6 })).toBe("0.200-0.100-0.500-0.600");
  });

  it("gives two different frames two different keys", () => {
    const a = cropKey({ x: 0.2, y: 0.1, w: 0.5, h: 0.6 });
    expect(cropKey({ x: 0.2, y: 0.1, w: 0.5, h: 0.61 })).not.toBe(a);
    expect(cropKey({ x: 0.21, y: 0.1, w: 0.5, h: 0.6 })).not.toBe(a);
  });
});

describe("cropSourceRect", () => {
  it("maps the whole picture to the whole original", () => {
    expect(cropSourceRect(FULL_CROP, 4032, 3024)).toEqual({ sx: 0, sy: 0, sw: 4032, sh: 3024 });
  });

  it("maps a frame to whole pixels of the original", () => {
    expect(cropSourceRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 4000, 3000)).toEqual({ sx: 1000, sy: 1500, sw: 2000, sh: 750 });
  });

  it("rounds the two edges and takes their difference, so the frame never leaves the picture", () => {
    const rect = cropSourceRect({ x: 0.3333, y: 0.3333, w: 0.6667, h: 0.6667 }, 1001, 999);
    expect(rect.sx + rect.sw).toBeLessThanOrEqual(1001);
    expect(rect.sy + rect.sh).toBeLessThanOrEqual(999);
    expect(rect.sx + rect.sw).toBe(1001);
    expect(rect.sy + rect.sh).toBe(999);
  });

  it("is never smaller than one pixel and never outside, whatever it is given", () => {
    for (const rect of [
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 2, y: 2, w: 1, h: 1 },
      { x: -1, y: -1, w: 0.001, h: 0.001 },
      { x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN },
    ]) {
      const out = cropSourceRect(rect, 640, 480);
      expect(out.sw, JSON.stringify(rect)).toBeGreaterThanOrEqual(1);
      expect(out.sh).toBeGreaterThanOrEqual(1);
      expect(out.sx).toBeGreaterThanOrEqual(0);
      expect(out.sy).toBeGreaterThanOrEqual(0);
      expect(out.sx + out.sw).toBeLessThanOrEqual(640);
      expect(out.sy + out.sh).toBeLessThanOrEqual(480);
    }
  });

  it("copes with a picture of one pixel", () => {
    expect(cropSourceRect({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 1, 1)).toEqual({ sx: 0, sy: 0, sw: 1, sh: 1 });
  });
});
