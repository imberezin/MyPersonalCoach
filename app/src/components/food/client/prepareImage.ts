import { IMAGE_LIMITS, computeTargetSize } from "@/domain/food/image";

/** The photo could not be opened or re-encoded (a HEIC this browser cannot read, a corrupt file, out of memory). */
export class ImageError extends Error {
  readonly code = "unreadable";
  constructor() {
    super("unreadable");
    this.name = "ImageError";
  }
}

type ImageSource = { width: number; height: number; draw: CanvasImageSource; release: () => void };

export interface PrepareDeps {
  createImageBitmap?: typeof createImageBitmap;
  document?: Pick<Document, "createElement">;
}

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

async function decodeWithBitmap(file: Blob, create: typeof createImageBitmap): Promise<ImageSource> {
  // Modern engines honor the EXIF orientation by default; asking for it keeps older ones upright too.
  const bitmap = await create(file, { imageOrientation: "from-image" });
  return { width: bitmap.width, height: bitmap.height, draw: bitmap, release: () => bitmap.close() };
}

async function decodeWithImageElement(file: Blob, doc: Pick<Document, "createElement">): Promise<ImageSource> {
  const url = URL.createObjectURL(file);
  try {
    const image = doc.createElement("img");
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight, draw: image, release: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decode(file: Blob, deps: PrepareDeps): Promise<ImageSource> {
  const create = deps.createImageBitmap ?? (typeof createImageBitmap === "function" ? createImageBitmap : undefined);
  if (create) {
    try {
      return await decodeWithBitmap(file, create);
    } catch {
      // Fall through to the <img> path; a file neither can read ends in ImageError below.
    }
  }
  const doc = deps.document ?? (typeof document === "undefined" ? undefined : document);
  if (!doc) throw new ImageError();
  return decodeWithImageElement(file, doc);
}

function encode(
  source: ImageSource,
  size: { width: number; height: number },
  quality: number,
  doc: Pick<Document, "createElement">,
): Promise<Blob> {
  const canvas = doc.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new ImageError();
  // JPEG has no transparency: a transparent PNG would turn black without this white fill.
  context.fillStyle = "white";
  context.fillRect(0, 0, size.width, size.height);
  // The target is drawn straight at the small size, so a huge photo never needs a second big canvas.
  context.drawImage(source.draw, 0, 0, size.width, size.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // iOS keeps canvas memory around until the size is reset.
        canvas.width = 0;
        canvas.height = 0;
        if (blob) resolve(blob);
        else reject(new ImageError());
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Turns a picked photo into a small upright JPEG. The re-encode drops EXIF, GPS and any embedded
 * thumbnail, so location never leaves the phone. The long side is at most 1024 px at quality 0.8; if
 * the result is still above the target size it retries at 0.7, 0.6 and 0.5, then once at 800 px. The
 * smallest result is returned even when it is above the target (the server has more room).
 */
export async function prepareImage(file: Blob, deps: PrepareDeps = {}): Promise<PreparedImage> {
  const doc = deps.document ?? (typeof document === "undefined" ? undefined : document);
  if (!doc) throw new ImageError();

  let source: ImageSource;
  try {
    source = await decode(file, deps);
  } catch {
    throw new ImageError();
  }

  try {
    if (!(source.width > 0 && source.height > 0)) throw new ImageError();

    const normal = computeTargetSize(source.width, source.height, IMAGE_LIMITS.longSidePx);
    const qualities = [IMAGE_LIMITS.jpegQuality, ...IMAGE_LIMITS.retryQualities];
    let blob: Blob | null = null;
    let size = normal;

    for (const quality of qualities) {
      blob = await encode(source, normal, quality, doc);
      if (blob.size <= IMAGE_LIMITS.targetMaxBytes) return { blob, width: normal.width, height: normal.height };
    }

    // Last resort: a smaller picture at the lowest quality, unless it would not be any smaller.
    const smaller = computeTargetSize(source.width, source.height, IMAGE_LIMITS.retryLongSidePx);
    if (smaller.width < normal.width || smaller.height < normal.height) {
      blob = await encode(source, smaller, qualities[qualities.length - 1], doc);
      size = smaller;
    }
    if (!blob) throw new ImageError();
    return { blob, width: size.width, height: size.height };
  } catch (error) {
    throw error instanceof ImageError ? error : new ImageError();
  } finally {
    source.release();
  }
}
