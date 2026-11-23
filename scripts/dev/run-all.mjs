// One command for the release gate row QA-REGRESSION-01 (28 Oct 2026): runs every scripts/dev/*-test.ts, the type check of the app,
// the type check of the admin app and the production build, then prints one PASS/FAIL line per item and one summary. Exit 1 if any fails.
//
//   npm run regress        (or: node scripts/dev/run-all.mjs)
//
// What the summary covers, and what it does not:
//  - the app type check is the root `tsc --noEmit` (tsconfig.json excludes only node_modules, admin, dist and build, so src/, server/
//    and scripts/ are all in it); the admin app has its own tsconfig and is checked separately;
//  - the production builds are the app's `npm run build` (vite build + the postbuild step that writes the per-address pages, 404.html,
//    sitemap.xml and robots.txt) and the admin app's `npm run build` (added 1 Nov 2026);
//  - it does NOT run the database suites (supabase/tests/*.sql: they need the rolled-back runner on dev) and does not open a browser
//    (the browser checks are separate: `npm run test:browsers`, on a finished build).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const allTestFiles = readdirSync(new URL('./', import.meta.url)).filter((f) => f.endsWith('-test.ts')).sort();

// The admin app (admin/) may or may not be in this tree: the public repository may stop carrying it (PM, 18 Nov 2026). With admin/ present EVERYTHING runs, as before. Without it, the
// admin type check, the admin build and every script test that reads or imports anything under admin/ are SKIPPED, said so in the output, and the rest must still pass. A test counts as
// an admin test when its source mentions a path under admin/ (an import such as '../../admin/src/...', or a read of 'admin/...').
const hasAdmin = existsSync(`${root}admin/package.json`);
const ADMIN_PATH = /(\.\.\/\.\.\/admin\/|['"`]admin\/)/;
const isAdminTest = (f) => ADMIN_PATH.test(readFileSync(new URL(f, import.meta.url), 'utf8'));
const skippedTests = hasAdmin ? [] : allTestFiles.filter(isAdminTest);
const testFiles = allTestFiles.filter((f) => !skippedTests.includes(f));
// The app's type check covers scripts/ too, so without admin/ the admin tests are left out of it as well (a temporary config that extends the real one, removed afterwards).
const NOADMIN_TSCONFIG = 'tsconfig.regress-noadmin.json';
const appTypeCheck = hasAdmin
  ? 'npx --no-install tsc --noEmit'
  : `npx --no-install tsc --noEmit -p ${NOADMIN_TSCONFIG}`;
if (!hasAdmin) {
  const base = JSON.parse(readFileSync(`${root}tsconfig.json`, 'utf8'));
  writeFileSync(`${root}${NOADMIN_TSCONFIG}`, JSON.stringify({ extends: './tsconfig.json', exclude: [...(base.exclude ?? []), ...skippedTests.map((f) => `scripts/dev/${f}`)] }, null, 2));
  process.on('exit', () => rmSync(`${root}${NOADMIN_TSCONFIG}`, { force: true }));
}

const allItems = [
  ...testFiles.map((f) => ({ name: `test ${f}`, cmd: `npx --no-install tsx scripts/dev/${f}`, cwd: root })),
  { name: 'type check: app (src, server, scripts)', cmd: appTypeCheck, cwd: root },
  ...(hasAdmin ? [{ name: 'type check: admin app', cmd: 'npx --no-install tsc --noEmit', cwd: `${root}admin` }] : []),
  // `npm run build` = vite build + scripts/postbuild.ts (the per-address pages, 404.html, sitemap.xml, robots.txt).
  { name: 'production build: app', cmd: 'npm run build', cwd: root },
  ...(hasAdmin ? [{ name: 'production build: admin app', cmd: 'npm run build', cwd: `${root}admin` }] : []),
];
if (!hasAdmin) {
  console.log(`SKIPPED: admin/ is not in this tree, so the admin type check, the admin build and ${skippedTests.length} script test(s) that use it are not run:`);
  for (const f of skippedTests) console.log(`  skipped  test ${f}`);
  console.log('');
}
// Optional: `npm run regress -- legal build` runs only the items whose name contains one of the words (a partial run; the summary says so).
const only = process.argv.slice(2);
const items = only.length ? allItems.filter((i) => only.some((w) => i.name.includes(w))) : allItems;

const results = [];
for (const item of items) {
  const started = Date.now();
  const run = spawnSync(item.cmd, { cwd: item.cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const pass = run.status === 0 && !run.error;
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  const lines = output.split(/\r?\n/);
  results.push({ ...item, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${item.name}  (${seconds}s)`);
  if (!pass) {
    // Show what failed: the lines the tests mark FAIL and tsc's "error TS" lines, else the last lines of output.
    const failed = lines.filter((l) => /^FAIL|error TS|Error:/.test(l)).slice(0, 15);
    const shown = failed.length ? failed : lines.filter(Boolean).slice(-15);
    console.log(shown.map((l) => `      ${l}`).join('\n'));
    if (run.error) console.log(`      ${run.error.message}`);
    // On GitHub Actions also write each failure as an ANNOTATION: the job log needs a sign-in, annotations are public (added 23 Nov 2026, after a red run could not be read).
    if (process.env.GITHUB_ACTIONS) {
      for (const l of [`${item.name} failed`, ...shown.slice(0, 12)]) console.log(`::error::${String(l).replace(/\s+/g, " ").slice(0, 400)}`);
    }
  }
}

const failedItems = results.filter((r) => !r.pass);
console.log(`\n${failedItems.length === 0 ? 'ALL PASS' : 'FAILED'}: ${results.length - failedItems.length} of ${results.length} items passed `
  + (only.length ? `(PARTIAL RUN: only items matching "${only.join('", "')}"; ${allItems.length - results.length} items not run).`
    : (hasAdmin ? `(${testFiles.length} script tests, 2 type checks, 2 builds). ` : `(WITHOUT admin/: ${testFiles.length} script tests, 1 type check, 1 build; SKIPPED ${skippedTests.length} admin script tests, the admin type check and the admin build). `)
      + 'Database suites and browser checks (npm run test:browsers) are not part of this run.'));
for (const r of failedItems) console.log(`  failed: ${r.name}`);
process.exit(failedItems.length === 0 ? 0 : 1);
