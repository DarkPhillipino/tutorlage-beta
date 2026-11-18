// SHOULD item 34 (18 Nov 2026): what the CI workflow (.github/workflows/ci.yml) is and is not allowed to do. It reads only the workflow file and package.json (both public).
import { readFileSync } from 'node:fs';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const wf = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');
const body = wf.replace(/^\s*#.*$/gm, '');
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

check('it runs on every push and every pull request', /\non:\n  push:\n  pull_request:\n/.test(wf));
check('it can only read the repository (no write, no pages, no id-token permission)', /permissions:\n  contents: read\n/.test(wf) && !/(pages|id-token|contents): write/.test(wf));
check('it uses NO secret and no variable from outside', !/secrets\./.test(body) && !/\$\{\{\s*vars\./.test(body) && !/\benv:/.test(body));
check('it gives the build no Supabase address or key (so it cannot reach a database)', !/VITE_|SUPABASE|SERVICE_ROLE|PAYSTACK|OZOW|RESEND/i.test(body));
check('it deploys, publishes and pushes nothing', !/deploy-pages|upload-pages|configure-pages|wrangler|git push|npm publish|gh release/i.test(body));
check('it installs the app and the admin app from their lock files (npm ci), then runs the one regress command', /- run: npm ci\n/.test(wf) && /if: hashFiles\('admin\/package-lock\.json'\) != ''\n\s+run: npm ci --prefix admin\n/.test(wf) && /run: npm run regress\n/.test(wf));
check('it is green with or without the admin app in the repository: the admin install is conditional and regress skips the admin items itself', !/\n      - run: npm ci --prefix admin\n/.test(wf) && readFileSync('scripts/dev/run-all.mjs', 'utf8').includes('const hasAdmin = existsSync('));
check('npm run regress is the type checks, the script tests and both builds', pkg.scripts.regress === 'node scripts/dev/run-all.mjs');
check('it refuses a push that carries the private notes (Drake, admin, CLAUDE.md, any CONTEXT.md) and never reads them', /git ls-files -- 'Drake' 'admin' 'CLAUDE\.md'/.test(wf) && !/(cat|cp|type|grep|read\S*)\s+[^\n]*Drake/i.test(body.replace(/git ls-files[^\n]*/g, '')));
check('the cache path names only the app lock file (the admin app is not in the public repository, so no admin lock file is listed)', /cache-dependency-path: package-lock\.json\n/.test(wf) && !/admin\/package-lock/.test(wf.replace(/#[^\n]*/g, '').replace(/hashFiles\([^)]*\)/g, '')));
check('actions are the same major versions the deploy workflow already uses (checkout v4, setup-node v4)', /actions\/checkout@v4/.test(wf) && /actions\/setup-node@v4/.test(wf));
check('it stops a slow run (timeout) and cancels an older run of the same branch', /timeout-minutes: \d+/.test(wf) && /cancel-in-progress: true/.test(wf));
if (failed > 0) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall ok');
