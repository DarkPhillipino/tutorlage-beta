// A tiny static server that answers like GitHub Pages does, so the browser tests meet the same behaviour the live site has:
//  - /thing is served from thing.html (status 200), or from thing/index.html;
//  - an address with no file gets 404.html with status 404;
//  - files are compressed with gzip when the browser accepts it (GitHub Pages does this, so transfer sizes are realistic);
//  - NO security headers are added (GitHub Pages sends none), so the tests cannot pass because of a header the live site lacks.
// Serves ./dist (run `npm run build` first).   Usage: node scripts/dev/pages-server.mjs [port]
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../dist/', import.meta.url));
const port = Number(process.argv[2] || 4173);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.map': 'application/json',
};

const isFile = (p) => existsSync(p) && statSync(p).isFile();

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/') && pathname !== '/') pathname = pathname.slice(0, -1);
  const clean = normalize(pathname).replace(/^([/\\])+/, '');
  let file = join(root, clean);
  let status = 200;
  if (!file.startsWith(root)) file = join(root, '404.html'), status = 404;
  else if (pathname === '/' || pathname === '') file = join(root, 'index.html');
  else if (isFile(file)) { /* exact file */ }
  else if (isFile(`${file}.html`)) file = `${file}.html`;
  else if (isFile(join(file, 'index.html'))) file = join(file, 'index.html');
  else { file = join(root, '404.html'); status = 404; }

  let body = readFileSync(file);
  const headers = { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'max-age=600' };
  if (/gzip/.test(String(req.headers['accept-encoding'])) && /\.(html|js|css|svg|json|txt|xml)$/.test(file)) {
    body = gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(port, '127.0.0.1', () => console.log(`pages-server: http://127.0.0.1:${port}/ serving ${root}`));
