import { PHOTO_CROP } from "./image";

/**
 * The crop frame of the photo screen (D2) as pure geometry: no DOM, no React. The frame is a rectangle on the picture
 * as it is DISPLAYED (already upright), written as shares of the picture's width and height, so the same numbers
 * describe the small preview and the full-size original the final crop is cut from. The picture is never mirrored,
 * so these are physical coordinates (x grows to the right) in Hebrew and in English alike.
 */
export interface CropRect {
  /** The frame's left edge, from 0 to 1 minus `w`. */
  x: number;
  /** The frame's top edge, from 0 to 1 minus `h`. */
  y: number;
  /** The frame's width, from the minimum to 1. */
  w: number;
  /** The frame's height, from the minimum to 1. */
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

/** What a finger or a key moves: the whole frame, one edge, or one corner (two edges). */
export type CropHandle = "move" | "n" | "e" | "s" | "w" | "nw" | "ne" | "sw" | "se";

export const CROP_CORNERS = ["nw", "ne", "sw", "se"] as const;
export const CROP_EDGES = ["n", "e", "s", "w"] as const;

export type CropKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** The whole pixel rectangle of the original to draw: `sx`, `sy` is the top-left corner. */
export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const finite = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback);
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
/** Four decimals: enough for a 4000 px photo, and no float dust (0.1 + 0.2) in the numbers that are compared and keyed. */
const round = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * A frame that is always valid: finite numbers, each side at least `min` and at most 1, and fully inside the picture.
 * An unusable frame (NaN, infinity) becomes the whole picture on that axis.
 */
export function clampCrop(rect: CropRect, min: number = PHOTO_CROP.minFraction): CropRect {
  const w = round(clamp(finite(rect.w, 1), min, 1));
  const h = round(clamp(finite(rect.h, 1), min, 1));
  const x = Math.min(round(clamp(finite(rect.x, 0), 0, 1)), round(1 - w));
  const y = Math.min(round(clamp(finite(rect.y, 0), 0, 1)), round(1 - h));
  return { x, y, w, h };
}

/**
 * The frame after the person dragged `handle` by (`dx`, `dy`), where both are shares of the picture's size measured from
 * where the drag STARTED (so a drag is a pure function of its start and its distance, and cannot drift). A corner moves
 * its two edges; an edge moves one; "move" slides the whole frame. Nothing leaves the picture and no side gets smaller
 * than `min`: the frame stops at the limit instead of jumping.
 */
export function dragCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  min: number = PHOTO_CROP.minFraction,
): CropRect {
  const from = clampCrop(start, min);
  const moveX = finite(dx, 0);
  const moveY = finite(dy, 0);

  if (handle === "move") {
    return clampCrop(
      { x: clamp(from.x + moveX, 0, 1 - from.w), y: clamp(from.y + moveY, 0, 1 - from.h), w: from.w, h: from.h },
      min,
    );
  }

  let left = from.x;
  let top = from.y;
  let right = from.x + from.w;
  let bottom = from.y + from.h;
  if (handle.includes("w")) left = clamp(left + moveX, 0, right - min);
  if (handle.includes("e")) right = clamp(right + moveX, left + min, 1);
  if (handle.includes("n")) top = clamp(top + moveY, 0, bottom - min);
  if (handle.includes("s")) bottom = clamp(bottom + moveY, top + min, 1);
  return clampCrop({ x: left, y: top, w: right - left, h: bottom - top }, min);
}

/** One arrow-key press on a handle: the same as a drag of `step` in that direction. */
export function nudgeCrop(
  rect: CropRect,
  handle: CropHandle,
  key: CropKey,
  step: number = PHOTO_CROP.keyboardStep,
  min: number = PHOTO_CROP.minFraction,
): CropRect {
  const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
  const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
  return dragCrop(rect, handle, dx, dy, min);
}

/** The modifier keys of a keyboard event, so the rule below can be tested without one. */
export interface KeyModifiers {
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

const CROP_KEYS: readonly string[] = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

/**
 * What a key press on a handle does, or `null` when it is not the frame's business and must be left to the browser: any key
 * but an arrow, and an arrow with Alt, Ctrl or Cmd (Alt+Left is the browser's Back). Shift makes the step five times bigger,
 * so a frame can be brought across the picture without sixty presses.
 */
export function nudgeFromKey(rect: CropRect, handle: CropHandle, key: string, modifiers: KeyModifiers = {}): CropRect | null {
  if (!CROP_KEYS.includes(key)) return null;
  if (modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey) return null;
  const step = modifiers.shiftKey ? PHOTO_CROP.keyboardStep * 5 : PHOTO_CROP.keyboardStep;
  return nudgeCrop(rect, handle, key as CropKey, step);
}

/** The frame covers the whole picture (within `epsilon`): nothing to cut, the prepared photo goes as it is. */
export function isFullCrop(rect: CropRect, epsilon: number = PHOTO_CROP.fullEpsilon): boolean {
  return rect.x <= epsilon && rect.y <= epsilon && rect.x + rect.w >= 1 - epsilon && rect.y + rect.h >= 1 - epsilon;
}

/** A short text for the same frame: used inside the request key, so a different crop is a different request. */
export function cropKey(rect: CropRect): string {
  if (isFullCrop(rect)) return "full";
  return [rect.x, rect.y, rect.w, rect.h].map((value) => value.toFixed(3)).join("-");
}

/**
 * The frame in whole pixels of a picture that is `width` x `height`. The two edges are rounded and the size is their
 * difference, so neighbouring frames share a border exactly; the result is at least 1 px and always inside the picture.
 */
export function cropSourceRect(rect: CropRect, width: number, height: number): SourceRect {
  const maxX = Math.max(1, Math.floor(finite(width, 1)));
  const maxY = Math.max(1, Math.floor(finite(height, 1)));
  const left = clamp(finite(rect.x, 0), 0, 1);
  const top = clamp(finite(rect.y, 0), 0, 1);
  const right = clamp(finite(rect.x, 0) + finite(rect.w, 1), 0, 1);
  const bottom = clamp(finite(rect.y, 0) + finite(rect.h, 1), 0, 1);
  const sx = clamp(Math.round(left * maxX), 0, maxX - 1);
  const sy = clamp(Math.round(top * maxY), 0, maxY - 1);
  const sRight = clamp(Math.round(right * maxX), sx + 1, maxX);
  const sBottom = clamp(Math.round(bottom * maxY), sy + 1, maxY);
  return { sx, sy, sw: sRight - sx, sh: sBottom - sy };
}
