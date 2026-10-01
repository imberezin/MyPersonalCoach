// Generates placeholder PWA icons (no dependencies). Replace public/icons/* with real artwork later.
// Usage: npm run icons
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const ACCENT = [0x2b, 0x7a, 0x6a];
const WHITE = [0xff, 0xff, 0xff];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, drawPixel) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = drawPixel(x, y, size);
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** A white plate (ring + disc) on the accent color. `scale` shrinks it for the maskable safe zone. */
function plate(scale) {
  return (x, y, size) => {
    const c = size / 2;
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    const outer = size * 0.34 * scale;
    const ring = size * 0.045 * scale;
    const inner = size * 0.2 * scale;
    const edge = (r) => Math.min(1, Math.max(0, r - d + 0.5)); // 1px antialiasing
    const ringCoverage = Math.max(0, edge(outer) - edge(outer - ring));
    const discCoverage = edge(inner);
    return mix(ACCENT, WHITE, Math.max(ringCoverage, discCoverage));
  };
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, plate(1)));
writeFileSync("public/icons/icon-512.png", png(512, plate(1)));
writeFileSync("public/icons/icon-maskable-512.png", png(512, plate(0.78)));
writeFileSync("public/icons/apple-touch-icon.png", png(180, plate(1)));
console.log("wrote public/icons/*.png");
