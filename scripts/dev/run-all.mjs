// One command for the release gate row QA-REGRESSION-01 (28 Oct 2026): runs every scripts/dev/*-test.ts, the type check of the app,
// the type check of the admin app and the production build, then prints one PASS/FAIL line per item and one summary. Exit 1 if any fails.
//
//   npm run regress        (or: node scripts/dev/run-all.mjs)
//
// What the summary covers, and what it does not:
//  - the app type check is the root `tsc --noEmit` (tsconfig.json excludes only node_modules, admin, dist and build, so src/, server/
//    and scripts/ are all in it); the admin app has its own tsconfig and is checked separately;
//  - the production build is the app's `vite build` (the admin app's build is not run);
//  - it does NOT run the database suites (supabase/tests/*.sql: they need the rolled-back runner on dev) and does not open a browser.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const testFiles = readdirSync(new URL('./', import.meta.url)).filter((f) => f.endsWith('-test.ts')).sort();

const allItems = [
  ...testFiles.map((f) => ({ name: `test ${f}`, cmd: `npx --no-install tsx scripts/dev/${f}`, cwd: root })),
  { name: 'type check: app (src, server, scripts)', cmd: 'npx --no-install tsc --noEmit', cwd: root },
  { name: 'type check: admin app', cmd: 'npx --no-install tsc --noEmit', cwd: `${root}admin` },
  { name: 'production build: app', cmd: 'npx --no-install vite build', cwd: root },
];
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
  }
}

const failedItems = results.filter((r) => !r.pass);
console.log(`\n${failedItems.length === 0 ? 'ALL PASS' : 'FAILED'}: ${results.length - failedItems.length} of ${results.length} items passed `
  + (only.length ? `(PARTIAL RUN: only items matching "${only.join('", "')}"; ${allItems.length - results.length} items not run).`
    : `(${testFiles.length} script tests, 2 type checks, 1 build). Database suites and browser checks are not part of this run.`));
for (const r of failedItems) console.log(`  failed: ${r.name}`);
process.exit(failedItems.length === 0 ? 0 : 1);
