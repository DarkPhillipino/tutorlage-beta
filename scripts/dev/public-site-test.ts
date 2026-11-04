// Checks on the public-site batch of 1 Nov 2026 (release gate rows SEO-META-01, FE-SPA-ROUTING-01, SEC-HEADERS-01): the page table, the build
// step that writes one file per address plus 404.html, sitemap.xml and robots.txt, the head of index.html, the share image, the start page's
// wording and the Content-Security-Policy plugin. Run:  npx tsx scripts/dev/public-site-test.ts
import fs from 'node:fs';
import { PAGE_META, NOT_FOUND_META, SITE_ORIGIN, metaForPath, titleForPath } from '../../src/lib/pageMeta';
import { addressFor, fileFor, fillPage, robotsTxt, sitemapXml } from '../postbuild';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

const indexHtml = read('index.html');
const mainTsx = read('src/main.tsx');
const landing = read('src/pages/Landing.tsx');
const viteConfig = read('vite.config.ts');

// ---- the page table ----
check('every page has a title under 70 characters and a description under 170', PAGE_META.every((p) => p.title.length <= 70 && p.description.length <= 170 && p.description.length > 20));
check('every address is unique and starts with a slash', new Set(PAGE_META.map((p) => p.path)).size === PAGE_META.length && PAGE_META.every((p) => p.path.startsWith('/')));
check('the table has the start page and the three legal pages as indexable', ['/', '/terms', '/privacy', '/refunds'].every((p) => metaForPath(p)?.index === true));
check('private and one-use pages are not indexable', ['/reset-password', '/auth/callback', '/account-closed', '/payment/callback', '/room', '/tutor-documents', '/signin/tutor', '/forgot-password/parent'].every((p) => metaForPath(p)?.index === false));
check('a trailing slash is the same page', metaForPath('/terms/')?.path === '/terms');
check('a video room address (it carries a code) gets the video-room title', titleForPath('/room/AB12-CD34') === 'Video room | Tutorlage');
check('an unknown address gets no title from the table (the not-found page sets its own)', titleForPath('/no/such/page') === null);
// Every table address must be a route the app really has (so the build never writes a file for a page that does not exist).
const routePatterns = [...mainTsx.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
const matchesRoute = (path: string) =>
  routePatterns.some((pattern) => {
    const regex = new RegExp(`^${pattern.replace(/:[A-Za-z]+/g, '[^/]+')}$`);
    return regex.test(path);
  });
const expand = (path: string) => path.replace(/\/(student|tutor|parent)$/, '/$1');
check('every address in the table is a route in main.tsx', PAGE_META.every((p) => matchesRoute(expand(p.path))), PAGE_META.filter((p) => !matchesRoute(p.path)).map((p) => p.path).join(', '));
check('no title or description claims "certified", "validated" or "qualified" tutors, or gives a price', PAGE_META.every((p) => !/certified|validated|qualified|\bR\s?\d/i.test(`${p.title} ${p.description}`)));

// ---- the build step ----
const filled = fillPage(indexHtml, { title: 'Terms "of" <Service> & more | Tutorlage', description: 'A "quoted" <b>description</b> & more', url: addressFor('/terms'), index: false });
check('fillPage puts the new title, description, canonical and og:url in', /<title>Terms "of" &lt;Service> &amp; more \| Tutorlage<\/title>/.test(filled) && /rel="canonical" href="https:\/\/tutorlage\.com\/terms"/.test(filled) && /og:url" content="https:\/\/tutorlage\.com\/terms"/.test(filled));
check('fillPage escapes quotes and angle brackets inside attributes', /name="description" content="A &quot;quoted&quot; &lt;b&gt;description&lt;\/b&gt; &amp; more"/.test(filled));
check('fillPage sets noindex for a private page and index,follow for a public one', /name="robots" content="noindex"/.test(filled) && /name="robots" content="index,follow"/.test(fillPage(indexHtml, { title: 't', description: 'd', url: addressFor('/'), index: true })));
const notFound = fillPage(indexHtml, { ...NOT_FOUND_META, url: null, index: false });
check('the 404 page has no canonical address and no og:url, and says noindex', !/rel="canonical"/.test(notFound) && !/og:url/.test(notFound) && /content="noindex"/.test(notFound) && /<title>Page not found \| Tutorlage<\/title>/.test(notFound));
let threw = false;
try { fillPage('<html><head></head></html>', { title: 't', description: 'd', url: 'https://x', index: true }); } catch { threw = true; }
check('fillPage refuses a page template that lacks a tag (so a broken index.html cannot publish silently)', threw);
check('an address becomes a file GitHub Pages serves without the extension', fileFor('/signup/tutor') === 'signup/tutor.html' && fileFor('/login') === 'login.html');
check('addresses are absolute https://tutorlage.com addresses', addressFor('/') === 'https://tutorlage.com/' && addressFor('/terms') === 'https://tutorlage.com/terms' && SITE_ORIGIN === 'https://tutorlage.com');
const sitemap = sitemapXml(PAGE_META);
check('sitemap.xml lists the indexable pages, absolute, and nothing private', sitemap.includes('<loc>https://tutorlage.com/</loc>') && sitemap.includes('<loc>https://tutorlage.com/terms</loc>') && sitemap.includes('<loc>https://tutorlage.com/signup/tutor</loc>') && !/reset-password|auth\/callback|payment|account-closed|signin|room/.test(sitemap));
const robots = robotsTxt(PAGE_META);
check('robots.txt allows the site, hides the private pages and names the sitemap', /User-agent: \*\nAllow: \/\n/.test(robots) && /Disallow: \/reset-password/.test(robots) && /Disallow: \/room/.test(robots) && /Disallow: \/payment\/callback/.test(robots) && /Sitemap: https:\/\/tutorlage\.com\/sitemap\.xml/.test(robots));
check('robots.txt does not hide the legal pages or the sign-up pages', !/Disallow: \/(terms|privacy|refunds|login|signup)/.test(robots));

// ---- index.html ----
check('index.html has a real title, a description and a canonical address', /<title>Tutorlage \| Online tutoring in South Africa<\/title>/.test(indexHtml) && /name="description" content="[^"]{60,}"/.test(indexHtml) && /rel="canonical" href="https:\/\/tutorlage\.com\/"/.test(indexHtml));
check('index.html describes the share preview: Open Graph and Twitter card, with an absolute 1200x630 image and its description', /og:image" content="https:\/\/tutorlage\.com\/og-image\.png"/.test(indexHtml) && /og:image:width" content="1200"/.test(indexHtml) && /og:image:height" content="630"/.test(indexHtml) && /og:image:alt"/.test(indexHtml) && /twitter:card" content="summary_large_image"/.test(indexHtml) && /twitter:image" content="https:\/\/tutorlage\.com\/og-image\.png"/.test(indexHtml));
check('index.html links the favicon (svg and ico) and the home-screen icon, and sets a referrer policy', /rel="icon" href="\/favicon\.svg"/.test(indexHtml) && /rel="icon" href="\/favicon\.ico"/.test(indexHtml) && /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/.test(indexHtml) && /name="referrer" content="strict-origin-when-cross-origin"/.test(indexHtml));
check('index.html has no inline script (the Content-Security-Policy allows only our own files) and keeps the policy marker', !/<script(?![^>]*\ssrc=)[^>]*>/.test(indexHtml) && indexHtml.includes('<!--content-security-policy-->'));
const indexWithoutComments = indexHtml.replace(/<!--[\s\S]*?-->/g, '');
check('no github.io address and no old project-path link is left in the page (the one comment that explains legacy-path.js aside)', !/github\.io/.test(indexWithoutComments) && !/tutorlage-beta/.test(indexWithoutComments));
const png = fs.readFileSync(new URL('public/og-image.png', root));
check('the share image is a PNG of exactly 1200x630 under 300 kB', png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630 && png.length < 300_000, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, ${png.length} bytes`);
const ico = fs.readFileSync(new URL('public/favicon.ico', root));
check('favicon.ico is a real icon file (type 1, one picture)', ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) === 1);
check('the old-path script is a file, and the home-screen icon exists', fs.existsSync(new URL('public/legacy-path.js', root)) && fs.existsSync(new URL('public/apple-touch-icon.png', root)));
check('the deploy workflow no longer overwrites 404.html with a copy of index.html', !/cp dist\/index\.html dist\/404\.html/.test(read('.github/workflows/deploy-pages.yml')));
check('package.json runs the postbuild step after vite build', /"build": "vite build && tsx scripts\/postbuild\.ts"/.test(read('package.json')));

// ---- routes ----
check('"/" is the start page for a visitor and the app for a signed-in person, and every other address is the not-found page', /path="\/" element=\{<HomeRoute \/>\}/.test(mainTsx) && /path="\*" element=\{<NotFound \/>\}/.test(mainTsx) && !/path="\/\*"/.test(mainTsx));
check('HomeRoute waits for the sign-in state before choosing (the start page never flashes at someone signed in)', /if \(loading\) return <PageLoading \/>;\s*return session \? <GuardedApp \/> : <Landing \/>;/.test(mainTsx));
check('every page is loaded on demand (no static page imports remain in main.tsx)', !/^import (Login|SignIn|CreateAccount|ForgotPassword|ResetPassword|PaymentCallback|AuthCallback|AccountClosed|LegalPage|RoomPage|TutorDocuments|App) from/m.test(mainTsx));

// ---- the start page ----
const landingText = landing.replace(/\/\/.*$/gm, '');
check('the start page makes no earnings or price figure (no "R" followed by a number, no "earn")', !/\bR\s?\d/.test(landingText) && !/\bearn/i.test(landingText));
check('the start page makes no "certified", "validated" or "qualified" claim and says nothing about "guarantee", "best" or "top"', !/certified|validated|qualified|guarantee|\bbest\b|\btop\b/i.test(landingText));
check('the start page has no sign-up-for-news form or mailing list', !/<form|<input|newsletter|subscribe|mailing list|waitlist/i.test(landingText));
check('the start page links Terms, Privacy, Refund Policy and the sign-in page, and the tutor sign-up', ['to="/terms"', 'to="/privacy"', 'to="/refunds"', 'to="/login"', 'to="/signup/tutor"', 'to="/signup/parent"', 'to="/signup/student"'].every((s) => landing.includes(s)));
check('the start page no longer carries the "payments are not open" notice (CEO, 4 Nov 2026: wallet top-ups by bank transfer are live; only card payments are closed)', !/PAYMENTS_NOT_OPEN|data-landing-payments-notice/.test(landingText));
check('the start page has one h1 and the page is a header, a main and a footer', (landing.match(/<h1\b/g) ?? []).length === 1 && /<header\b/.test(landing) && /<main>/.test(landing) && /<footer\b/.test(landing));

// ---- the Content-Security-Policy ----
check('the policy is added to built pages only, and the pages may load scripts only from our own origin', /apply: 'build'/.test(viteConfig) && /"script-src 'self'"/.test(viteConfig));
check('the policy allows the database (https and websocket) and the payments/rooms API, read from the build settings, and nothing hard-coded', /VITE_SUPABASE_URL/.test(viteConfig) && /VITE_API_BASE_URL/.test(viteConfig) && /replace\(\/\^https:\/, 'wss:'\)/.test(viteConfig) && !/supabase\.co/.test(viteConfig));
check('the policy forbids plugins and other bases, and form posts to other sites', /"object-src 'none'"/.test(viteConfig) && /"base-uri 'self'"/.test(viteConfig) && /"form-action 'self'"/.test(viteConfig));
check('the policy does not use upgrade-insecure-requests (WebKit applies it to local http and the app would not start under test)', !/^\s*'upgrade-insecure-requests'/m.test(viteConfig));
check('no unsafe-eval and no unsafe-inline for scripts', !/unsafe-eval/.test(viteConfig) && !/script-src[^"]*unsafe-inline/.test(viteConfig));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
