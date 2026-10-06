/**
 * Photo limits and checks shared by the browser (which compresses) and the server (which verifies),
 * so the two cannot drift apart. The photo is never stored: it is compressed on the phone, sent,
 * held in memory for the request and forwarded to the AI provider.
 */

export const IMAGE_LIMITS = {
  longSidePx: 1024,
  jpegQuality: 0.8,
  retryQualities: [0.7, 0.6, 0.5],
  retryLongSidePx: 800,
  targetMaxBytes: 700_000,
  serverMaxBytes: 1_000_000,
  requestMaxBytes: 1_100_000,
} as const;

/**
 * The crop frame on the photo preview (D2), for a photo taken or chosen from the library. `enabled` is its switch: off,
 * the preview is the plain picture and the photo is sent as prepared. The frame is always on the picture and starts
 * as the whole picture, so sending without touching it is still one tap.
 */
export const PHOTO_CROP = {
  enabled: true,
  /** The smallest side of the frame, as a share of the picture's side (5 times zoom at most, and two corner targets never cover each other completely). */
  minFraction: 0.2,
  /** One arrow-key press moves an edge by this share of the picture. */
  keyboardStep: 0.02,
  /** A frame within this share of the whole picture counts as "not cropped": the prepared photo is sent as it is. */
  fullEpsilon: 0.005,
} as const;

/** The format of an image by its first bytes. The declared MIME type is never trusted. */
export function sniffImageType(bytes: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  // "RIFF" <4 size bytes> "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

/**
 * The size to draw on the canvas: the long side at most `longSidePx`, the aspect ratio kept, never
 * upscaled, never below 1 px. An unusable size (zero, negative, NaN) gives 1 x 1.
 */
export function computeTargetSize(width: number, height: number, longSidePx: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return { width: 1, height: 1 };
  const longSide = Math.max(width, height);
  const scale = longSide > longSidePx ? longSidePx / longSide : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
