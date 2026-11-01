// Runs after `vite build` (see "build" in package.json). Release gate rows SEO-META-01 and FE-SPA-ROUTING-01.
//
// GitHub Pages is a plain file host: it cannot send a page for an address it has no file for, so a direct visit to /signup/tutor was
// answered with its 404 status before the app ever loaded (the page still opened, because 404.html was a copy of index.html, but search
// engines and link previews saw an error). The best a file host can do, and what this does:
//  1. writes one real file for every public address the app has (dist/login.html, dist/signup/tutor.html, ...). GitHub Pages serves
//     /login from login.html with status 200, and each file carries its own title, description, canonical address and robots line;
//  2. writes dist/404.html, the page every unknown address gets, with status 404 (correct for an address that does not exist) and a
//     noindex line. The app reads the address and shows its "We can't find that page" screen, or opens a page whose address carries a
//     code and so has no file of its own (a video room, /room/AB12-CD34: it opens, with status 404 from the host, which only matters to
//     crawlers, and those pages are private);
//  3. writes sitemap.xml and robots.txt from the same table, so they cannot drift from the pages.
// What it cannot fix: any address with a code in it still gets the host's 404 status; only Cloudflare in front of the site (proxied,
// with a rule) or a different host could change that.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NOT_FOUND_META, PAGE_META, SITE_ORIGIN, type PageMeta } from '../src/lib/pageMeta';

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function replaceOnce(html: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(html)) throw new Error(`postbuild: index.html has no ${what} to replace`);
  return html.replace(pattern, () => replacement);
}

export interface PageFill {
  title: string;
  description: string;
  // Absolute address for the canonical line and og:url; null for the 404 page (a missing page has no canonical address).
  url: string | null;
  index: boolean;
}

export function fillPage(html: string, page: PageFill): string {
  const t = escapeAttr(page.title);
  const d = escapeAttr(page.description);
  let out = html;
  out = replaceOnce(out, /<title>[^<]*<\/title>/, `<title>${page.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`, '<title>');
  out = replaceOnce(out, /<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${d}" />`, 'description');
  out = replaceOnce(out, /<meta name="robots" content="[^"]*" \/>/, `<meta name="robots" content="${page.index ? 'index,follow' : 'noindex'}" />`, 'robots line');
  out = replaceOnce(out, /<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${t}" />`, 'og:title');
  out = replaceOnce(out, /<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${d}" />`, 'og:description');
  out = replaceOnce(out, /<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${t}" />`, 'twitter:title');
  out = replaceOnce(out, /<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${d}" />`, 'twitter:description');
  if (page.url) {
    const u = escapeAttr(page.url);
    out = replaceOnce(out, /<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${u}" />`, 'canonical');
    out = replaceOnce(out, /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${u}" />`, 'og:url');
  } else {
    out = replaceOnce(out, /\s*<link rel="canonical" href="[^"]*" \/>/, '', 'canonical');
    out = replaceOnce(out, /\s*<meta property="og:url" content="[^"]*" \/>/, '', 'og:url');
  }
  return out;
}

export const addressFor = (path: string): string => (path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`);

// "/signup/tutor" is written as dist/signup/tutor.html; GitHub Pages answers /signup/tutor from it.
export const fileFor = (path: string): string => `${path.replace(/^\//, '')}.html`;

export function sitemapXml(pages: PageMeta[]): string {
  const urls = pages.filter((p) => p.index).map((p) => `  <url><loc>${addressFor(p.path)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function robotsTxt(pages: PageMeta[]): string {
  // Private and one-use pages are not crawled at all; "/room" also covers every "/room/<code>" address.
  const hidden = pages.filter((p) => !p.index && !p.path.startsWith('/signin/') && !p.path.startsWith('/forgot-password')).map((p) => `Disallow: ${p.path}`);
  return ['User-agent: *', 'Allow: /', ...hidden, 'Disallow: /signin/', 'Disallow: /forgot-password', '', `Sitemap: ${SITE_ORIGIN}/sitemap.xml`, ''].join('\n');
}

function main() {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  const template = readFileSync(join(dist, 'index.html'), 'utf8');
  const write = (relative: string, contents: string) => {
    const target = join(dist, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };

  // The start page is index.html itself; fill it from the same table so the two cannot differ.
  const home = PAGE_META.find((p) => p.path === '/');
  if (!home) throw new Error('postbuild: no entry for "/"');
  write('index.html', fillPage(template, { title: home.title, description: home.description, url: addressFor('/'), index: home.index }));

  let count = 0;
  for (const page of PAGE_META) {
    if (page.path === '/') continue;
    write(fileFor(page.path), fillPage(template, { title: page.title, description: page.description, url: addressFor(page.path), index: page.index }));
    count += 1;
  }
  write('404.html', fillPage(template, { ...NOT_FOUND_META, url: null, index: false }));
  write('sitemap.xml', sitemapXml(PAGE_META));
  write('robots.txt', robotsTxt(PAGE_META));
  console.log(`postbuild: wrote index.html, ${count} page files, 404.html, sitemap.xml and robots.txt into dist/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
