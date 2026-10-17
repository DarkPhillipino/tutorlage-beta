// Draws the desktop app's icon (icon.png, 512 x 512): the admin app's navy and green with a white T, no image tools needed.
// Run: node make-icon.mjs  (inside admin/desktop). The result is committed, so this only matters if the icon is to change.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 512;
const NAVY = [10, 25, 47];
const GREEN = [21, 128, 61];
const WHITE = [255, 255, 255];
const RADIUS = 112;

// Is (x, y) inside the rounded square?
function insideCard(x, y) {
  const cx = Math.min(Math.max(x, RADIUS), SIZE - 1 - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), SIZE - 1 - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
}
// The T: a bar across the top and a stem down the middle, with a green strip under the bar.
function colourAt(x, y) {
  if (x >= 116 && x <= 396 && y >= 124 && y <= 196) return WHITE;
  if (x >= 220 && x <= 292 && y >= 196 && y <= 392) return WHITE;
  if (x >= 116 && x <= 396 && y >= 208 && y <= 232) return GREEN;
  return NAVY;
}

// 3 x 3 samples per pixel for smooth edges.
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < 3; sy += 1) {
      for (let sx = 0; sx < 3; sx += 1) {
        const px = x + (sx + 0.5) / 3;
        const py = y + (sy + 0.5) / 3;
        if (!insideCard(px, py)) continue;
        const [cr, cg, cb] = colourAt(px, py);
        r += cr;
        g += cg;
        b += cb;
        a += 1;
      }
    }
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[o] = a ? Math.round(r / a) : 0;
    raw[o + 1] = a ? Math.round(g / a) : 0;
    raw[o + 2] = a ? Math.round(b / a) : 0;
    raw[o + 3] = Math.round((a / 9) * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // colour type: RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('./icon.png', import.meta.url), png);
console.log(`icon.png written (${png.length} bytes)`);
