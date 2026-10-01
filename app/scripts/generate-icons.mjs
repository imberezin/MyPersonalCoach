// Derives the PWA icons from the brand logo (public/MyIcons/logo.png). Usage: npm run icons
// The originals in public/MyIcons are never modified; everything in public/icons is generated.
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const SOURCE = "public/MyIcons/logo.png"; // 1024x1024, the emblem on a transparent background
const OUT = "public/icons";
// --color-background from the Brand & Color System document (tests/design/tokens.test.ts keeps them
// equal). Maskable and Apple icons must be opaque squares.
const BACKGROUND = "#faf9f6";
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

mkdirSync(OUT, { recursive: true });

const emblem = (size) => sharp(SOURCE).resize(size, size, { fit: "contain", background: TRANSPARENT });

/** The emblem on a transparent square (purpose "any"). */
async function plain(size, file) {
  await emblem(size).png({ compressionLevel: 9 }).toFile(`${OUT}/${file}`);
}

/** The emblem scaled to `ratio` of the side, centered on an opaque square of the background color. */
async function onBackground(size, ratio, file) {
  const inner = Math.round(size * ratio);
  const logo = await emblem(inner).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background: BACKGROUND } })
    .composite([{ input: logo, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${file}`);
}

await plain(192, "icon-192.png");
await plain(512, "icon-512.png");
// Maskable: the platform may crop to a circle, so keep the emblem inside the central 80% safe zone.
await onBackground(512, 0.8, "icon-maskable-512.png");
// iOS ignores transparency and applies its own rounded mask, so give it an opaque square with a margin.
await onBackground(180, 0.86, "apple-touch-icon.png");

console.log("wrote public/icons/* from", SOURCE);
