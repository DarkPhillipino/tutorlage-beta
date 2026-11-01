// Draws the site's picture files into public/: the 1200x630 share image (og-image.png: what WhatsApp, Facebook, X and Google show when a
// link is pasted), the iPhone home-screen icon (apple-touch-icon.png) and favicon.ico. Run once, and again only if the look changes:
//   node scripts/make-brand-images.mjs
// It uses the Chromium that Playwright installs (npx playwright install chromium). The pictures are committed; the build does not run this.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

const shareHtml = `<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#FAF7F2;font-family:Georgia,'Times New Roman',serif;color:#0F172A;position:relative;overflow:hidden">
  <div style="position:absolute;left:0;top:0;bottom:0;width:28px;background:#15803D"></div>
  <div style="position:absolute;left:96px;top:84px;display:flex;align-items:center;gap:22px">
    <div style="width:84px;height:84px;border-radius:20px;background:#15803D;color:#FAF7F2;font-size:64px;font-weight:700;text-align:center;line-height:84px">T</div>
    <div style="font-size:60px;font-weight:700;letter-spacing:-1px">Tutorlage</div>
  </div>
  <div style="position:absolute;left:96px;top:236px;width:960px;font-size:76px;line-height:1.1;font-weight:700">Send one request. A tutor who fits accepts it.</div>
  <div style="position:absolute;left:96px;bottom:84px;font-size:36px;color:#15803D;font-weight:700;font-family:Arial,Helvetica,sans-serif;letter-spacing:.5px">Online tutoring in South Africa</div>
  <div style="position:absolute;right:96px;bottom:84px;font-size:32px;color:#475569;font-family:Arial,Helvetica,sans-serif">tutorlage.com</div>
</body></html>`;

const iconHtml = (size) => `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:#15803D;display:flex;align-items:center;justify-content:center;font-family:Georgia,'Times New Roman',serif;font-weight:700;color:#FAF7F2;font-size:${Math.round(size * 0.68)}px;line-height:1">T</body></html>`;

const browser = await chromium.launch();
async function shot(html, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html);
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } });
  await page.close();
  return png;
}

writeFileSync(out('og-image.png'), await shot(shareHtml, 1200, 630));
writeFileSync(out('apple-touch-icon.png'), await shot(iconHtml(180), 180, 180));

// favicon.ico: a one-picture icon file that holds a 32x32 PNG (every browser since Windows Vista / Chrome 4 reads that form).
const png32 = await shot(iconHtml(32), 32, 32);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one picture
const entry = Buffer.alloc(16);
entry.writeUInt8(32, 0); // width
entry.writeUInt8(32, 1); // height
entry.writeUInt8(0, 2); // palette colours
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4); // colour planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png32.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);
writeFileSync(out('favicon.ico'), Buffer.concat([header, entry, png32]));

await browser.close();
console.log('wrote public/og-image.png, public/apple-touch-icon.png, public/favicon.ico');
