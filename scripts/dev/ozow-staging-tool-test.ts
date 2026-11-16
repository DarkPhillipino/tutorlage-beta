// Checks on the Ozow staging tool (scripts/ops/ozow-staging-tool.ts), run against a PRETEND Ozow written here. No network, no real Ozow, no real key, no wrangler.
// Proves: the credentials are asked at a hidden prompt and appear in no printed line (even though the pretend Ozow echoes the client id in its error bodies);
// webhook-create makes one subscription (transaction.complete, full) and refuses a second; webhook-secret hands the secret to the Worker's secret store and
// prints nothing of it; webhook-delete asks for a typed word; replay-check asks for the same payment twice with one key and tells a pass from a failure;
// resend and notifications print only status codes; production needs a typed word and replay-check refuses it; nothing is ever sent outside Ozow.
// It does NOT prove the real Ozow answers like the pretend one (that is what the staging run is for), nor the hidden prompt or wrangler on a real computer.
// Run: npx tsx scripts/dev/ozow-staging-tool-test.ts
import fs from 'node:fs';
import { DEFAULT_ENDPOINT, PRODUCTION_BASE, STAGING_BASE, WORKER_SECRET_NAME, parseArgs, runTool, type ToolDeps, type ToolFetchInit } from '../ops/ozow-staging-tool';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}\n`);
};
const read = (f: string) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

// Made-up credentials, built from pieces (nothing here is key-shaped, and nothing is a real credential).
const CLIENT_ID = ['pretend', 'client', 'id', '0001'].join('-');
const CLIENT_SECRET = ['pretend', 'client', 'secret', '9f3a1c'].join('-');
const SITE_CODE = ['XYZ', '123', '456'].join('-');
const WEBHOOK_SECRET = `whsec_${Buffer.from('pretend-signing-secret-bytes').toString('base64')}`;
const ACCESS_TOKEN = ['pretend', 'access', 'token', 'abc123'].join('-');
const SECRETS = [CLIENT_ID, CLIENT_SECRET, SITE_CODE, WEBHOOK_SECRET, WEBHOOK_SECRET.replace(/^whsec_/, ''), ACCESS_TOKEN];

interface Call { method: string; url: string; headers: Record<string, string>; body: string | undefined }
interface Hook { id: string; endpoint: string; eventType: string; messageType: string }

class PretendOzow {
  calls: Call[] = [];
  hooks: Hook[] = [];
  payments = new Map<string, { body: string; id: string; link: string }>();
  scopesGranted = new Set(['webhooks', 'payments']);
  tokenScopes: string[] = [];
  replayAs409 = false;
  shortSecret = false;
  failNetwork = false;
  hookSeq = 0;
  paySeq = 0;
  notifications: unknown[] = [{ id: 'atmpt_1', messageId: 'msg_aaa', url: DEFAULT_ENDPOINT, response: 'OK', responseStatusCode: 200, timestamp: '2026-11-12T10:00:00Z' }, { id: 'atmpt_2', messageId: 'msg_bbb', url: DEFAULT_ENDPOINT, response: 'Not accepted.', responseStatusCode: 400, timestamp: '2026-11-12T10:01:00Z' }];

  fetch: ToolDeps['fetchFn'] = async (url: string, init: ToolFetchInit) => {
    this.calls.push({ method: init.method, url, headers: init.headers, body: init.body });
    if (this.failNetwork) throw new Error('network down');
    const u = new URL(url);
    const reply = (status: number, body: unknown) => ({ status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
    // Ozow's error bodies can echo the client id in their detail: the tool must never print it.
    const error = (status: number, code: string, pointer: string | null = null) => reply(status, { id: 'e1', code, title: code, detail: `request from client ${CLIENT_ID} was refused`, source: { pointer, parameter: null, header: null } });
    const path = u.pathname.replace(/^\/v1/, '');
    if (path === '/token') {
      const form = new URLSearchParams(init.body ?? '');
      const scope = form.get('scope') ?? '';
      this.tokenScopes.push(scope);
      if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET || form.get('grant_type') !== 'client_credentials') return error(401, 'Unauthorized');
      if (!this.scopesGranted.has(scope)) return error(400, 'BadRequest');
      return reply(200, { access_token: ACCESS_TOKEN, token_type: 'bearer', expires_in: '14400', scope });
    }
    if (init.headers.Authorization !== `Bearer ${ACCESS_TOKEN}`) return error(401, 'Unauthorized');
    if (path === '/webhooks' && init.method === 'GET') return reply(200, { links: {}, results: this.hooks, meta: {} });
    if (path === '/webhooks' && init.method === 'POST') {
      const b = JSON.parse(init.body ?? '{}');
      const hook = { id: `00000000-0000-4000-8000-${String((this.hookSeq += 1)).padStart(12, '0')}`, endpoint: b.endpoint, eventType: b.eventType, messageType: b.messageType ?? 'thin' };
      this.hooks.push(hook);
      return reply(201, hook);
    }
    let m = /^\/webhooks\/([^/]+)\/secret$/.exec(path);
    if (m && init.method === 'GET') return this.hooks.some((h) => h.id === m![1]) ? reply(200, { secret: this.shortSecret ? 'whsec_ab' : WEBHOOK_SECRET }) : error(404, 'NotFound');
    m = /^\/webhooks\/([^/]+)$/.exec(path);
    if (m && init.method === 'DELETE') {
      const before = this.hooks.length;
      this.hooks = this.hooks.filter((h) => h.id !== m![1]);
      return before === this.hooks.length ? error(404, 'NotFound') : { status: 204, text: async () => '' };
    }
    if (path === '/payments' && init.method === 'POST') {
      const key = init.headers['Idempotency-Key'];
      const seen = this.payments.get(key);
      if (seen) {
        if (this.replayAs409 || seen.body !== init.body) return error(409, 'Conflict', null);
        return reply(200, { id: seen.id, status: 'Created', redirectUrl: seen.link, links: {} });
      }
      const id = `00000000-0000-4000-9000-${String((this.paySeq += 1)).padStart(12, '0')}`;
      const link = `https://pay.example.test/${id}/secure`;
      this.payments.set(key, { body: init.body ?? '', id, link });
      return reply(201, { id, status: 'Created', redirectUrl: link, links: {} });
    }
    m = /^\/transactions\/([^/]+)\/notifications\/resend$/.exec(path);
    if (m && init.method === 'POST') return reply(202, undefined);
    m = /^\/transactions\/([^/]+)\/notifications$/.exec(path);
    if (m && init.method === 'GET') return reply(200, this.notifications);
    return error(404, 'NotFound');
  };
}

interface Run { code: number; lines: string[]; ozow: PretendOzow; hiddenAsked: string[]; lineAsked: string[]; secretsPut: { name: string; value: string }[] }
async function run(argv: string[], o: { ozow?: PretendOzow; hidden?: string[]; typed?: string[]; wranglerOk?: boolean; hiddenThrows?: boolean } = {}): Promise<Run> {
  const ozow = o.ozow ?? new PretendOzow();
  const lines: string[] = [];
  const hiddenAsked: string[] = [];
  const lineAsked: string[] = [];
  const secretsPut: { name: string; value: string }[] = [];
  const hidden = [...(o.hidden ?? [CLIENT_ID, CLIENT_SECRET, SITE_CODE])];
  const typed = [...(o.typed ?? [])];
  let n = 0;
  const deps: ToolDeps = {
    fetchFn: ozow.fetch,
    askHidden: async (q) => {
      hiddenAsked.push(q);
      if (o.hiddenThrows) throw new Error('Run this in a terminal window you type in. It will not read a secret from a pipe or a file.');
      return hidden.shift() ?? '';
    },
    askLine: async (q) => { lineAsked.push(q); return typed.shift() ?? ''; },
    out: (l) => lines.push(l),
    putWorkerSecret: async (name, value) => { secretsPut.push({ name, value }); return { ok: o.wranglerOk !== false }; },
    now: () => Date.UTC(2026, 10, 12, 10, 0, 0),
    randomHex: (bytes) => String((n += 1)).padStart(bytes * 2, '0').slice(-bytes * 2),
  };
  const code = await runTool(argv, deps);
  return { code, lines, ozow, hiddenAsked, lineAsked, secretsPut };
}
const text = (r: Run) => r.lines.join('\n');
const clean = (r: Run) => SECRETS.every((s) => !text(r).includes(s));

(async () => {
  // ---- arguments and help ----
  const help = await run([]);
  check('no command prints the help and exits 0; help names every command', help.code === 0 && ['webhook-list', 'webhook-create', 'webhook-secret', 'webhook-delete', 'replay-check', 'resend', 'notifications'].every((c) => text(help).includes(c)));
  const unknown = await run(['frobnicate']);
  check('an unknown command is refused (exit 2), asks for nothing and calls nobody', unknown.code === 2 && unknown.hiddenAsked.length === 0 && unknown.ozow.calls.length === 0);
  const badFlag = await run(['webhook-list', '--env', 'moon']);
  check('a bad --env is refused before anything is asked', badFlag.code === 2 && badFlag.hiddenAsked.length === 0 && badFlag.ozow.calls.length === 0);
  const parsed = parseArgs(['webhook-secret', '--env', 'staging', '--id', 'abc12345']);
  check('arguments: the command, the environment (staging by default) and --id are read', parsed.command === 'webhook-secret' && parsed.env === 'staging' && parsed.id === 'abc12345' && parseArgs(['webhook-list']).env === 'staging');
  check('webhook-delete, resend and notifications refuse to run without an id (exit 2, nothing asked)', (await Promise.all(['webhook-delete', 'resend', 'notifications'].map((c) => run([c])))).every((r) => r.code === 2 && r.hiddenAsked.length === 0));
  check('a --endpoint that is not a public https address is refused', (await run(['webhook-create', '--endpoint', 'http://localhost:3000/x'])).code === 2 && (await run(['webhook-create', '--endpoint', 'https://localhost/x'])).code === 2);

  // ---- the credentials ----
  const list0 = await run(['webhook-list']);
  check('credentials: asked at the hidden prompt only (client id, then client secret), never at a visible prompt, and webhook-list does not ask for a site code', list0.hiddenAsked.length === 2 && /Client ID/.test(list0.hiddenAsked[0]) && /Client secret/.test(list0.hiddenAsked[1]) && list0.lineAsked.length === 0);
  check('credentials: the staging base address is used by default, and the banner says STAGING', list0.ozow.calls.every((c) => c.url.startsWith(`${STAGING_BASE}/`)) && /STAGING/.test(text(list0)));
  const noHidden = await run(['webhook-list'], { hiddenThrows: true });
  check('credentials: a hidden prompt that cannot run (a pipe) stops the tool with its own words and calls nobody', noHidden.code === 2 && /terminal window/.test(text(noHidden)) && noHidden.ozow.calls.length === 0);
  const blank = await run(['webhook-list'], { hidden: ['', ''] });
  check('credentials: an empty client id or secret stops the tool before any call', blank.code === 2 && blank.ozow.calls.length === 0);
  const wrongSecret = await run(['webhook-list'], { hidden: [CLIENT_ID, 'not-the-secret'] });
  check('credentials: a refused token says so with the status and code only; the client id Ozow echoes in its error is not printed', wrongSecret.code === 1 && /HTTP 401 Unauthorized/.test(text(wrongSecret)) && clean(wrongSecret) && !text(wrongSecret).includes('was refused'));
  const noScope = new PretendOzow();
  noScope.scopesGranted.delete('webhooks');
  const noScopeRun = await run(['webhook-list'], { ozow: noScope });
  check('credentials: a client without the webhooks scope is told so in plain words', noScopeRun.code === 1 && /"webhooks" scope/.test(text(noScopeRun)) && clean(noScopeRun));

  // ---- webhook-create ----
  const created = await run(['webhook-create']);
  const hook = created.ozow.hooks[0];
  const post = created.ozow.calls.find((c) => c.method === 'POST' && c.url.endsWith('/webhooks'));
  check('webhook-create: ONE subscription for transaction.complete, message type full, at the Worker\'s webhook address', created.code === 0 && created.ozow.hooks.length === 1 && hook.eventType === 'transaction.complete' && hook.messageType === 'full' && hook.endpoint === DEFAULT_ENDPOINT && /\/api\/wallet\/webhook\/ozow$/.test(DEFAULT_ENDPOINT));
  check('webhook-create: it looked at the existing subscriptions first, asked for the webhooks scope, and sent an Idempotency-Key', created.ozow.calls.findIndex((c) => c.method === 'GET' && c.url.includes('/webhooks')) < created.ozow.calls.findIndex((c) => c === post) && created.ozow.tokenScopes.join() === 'webhooks' && /^tool-webhook-/.test(post?.headers['Idempotency-Key'] ?? ''));
  check('webhook-create: it prints the new id and the next step, and nothing secret', new RegExp(hook.id).test(text(created)) && /webhook-secret/.test(text(created)) && clean(created));
  const again = await run(['webhook-create'], { ozow: created.ozow });
  check('webhook-create: run a second time it refuses (exit 2), creates NOTHING, and names the existing one', again.code === 2 && again.ozow.hooks.length === 1 && /NOTHING was created/.test(text(again)) && text(again).includes(hook.id));
  const thin = new PretendOzow();
  thin.hooks.push({ id: '00000000-0000-4000-8000-0000000000aa', endpoint: DEFAULT_ENDPOINT, eventType: 'transaction.complete', messageType: 'thin' });
  const thinRun = await run(['webhook-create'], { ozow: thin });
  check('webhook-create: an existing THIN subscription is not replaced; the tool says to delete it and why (a thin message can never credit)', thinRun.code === 2 && thin.hooks.length === 1 && /not message type full/.test(text(thinRun)) && /webhook-delete/.test(text(thinRun)));
  const otherAddress = new PretendOzow();
  otherAddress.hooks.push({ id: '00000000-0000-4000-8000-0000000000bb', endpoint: 'https://elsewhere.example.test/hook', eventType: 'transaction.complete', messageType: 'full' });
  check('webhook-create: a subscription at another address does not count as a duplicate', (await run(['webhook-create'], { ozow: otherAddress })).ozow.hooks.length === 2);

  // ---- webhook-list ----
  const callsBefore = created.ozow.calls.length;
  const listed = await run(['webhook-list'], { ozow: created.ozow });
  check('webhook-list: shows the id, event, message type and address, changes nothing', listed.code === 0 && text(listed).includes(hook.id) && /message type full/.test(text(listed)) && listed.ozow.calls.slice(callsBefore).every((c) => c.method === 'GET' || c.url.endsWith('/token')));

  // ---- webhook-secret ----
  const sec = await run(['webhook-secret'], { ozow: created.ozow });
  check('webhook-secret: the secret goes to the Worker\'s secret store under the right name, exactly as Ozow gave it', sec.code === 0 && sec.secretsPut.length === 1 && sec.secretsPut[0].name === 'OZOW_WEBHOOK_SECRET' && sec.secretsPut[0].value === WEBHOOK_SECRET && WORKER_SECRET_NAME === 'OZOW_WEBHOOK_SECRET');
  check('webhook-secret: the secret appears in NO printed line (nor the client id, secret, site code or token), and the tool says it was not shown or written', clean(sec) && /not shown and not written to any file/.test(text(sec)));
  const secOnly = sec.ozow.calls.filter((c) => /\/secret$/.test(c.url));
  check('webhook-secret: it asked for the secret of the one subscription at our address', secOnly.length === 1 && secOnly[0].url.includes(hook.id));
  const noHook = await run(['webhook-secret']);
  check('webhook-secret: with no subscription yet it says to run webhook-create, and saves nothing', noHook.code === 2 && /webhook-create/.test(text(noHook)) && noHook.secretsPut.length === 0);
  const two = new PretendOzow();
  for (let i = 1; i <= 2; i += 1) two.hooks.push({ id: `00000000-0000-4000-8000-00000000000${i}`, endpoint: DEFAULT_ENDPOINT, eventType: 'transaction.complete', messageType: 'full' });
  const twoRun = await run(['webhook-secret'], { ozow: two });
  check('webhook-secret: with TWO subscriptions it refuses to guess and saves nothing; --id names one', twoRun.code === 2 && twoRun.secretsPut.length === 0 && /--id/.test(text(twoRun)) && (await run(['webhook-secret', '--id', '00000000-0000-4000-8000-000000000002'], { ozow: two })).secretsPut.length === 1);
  const wrangler = await run(['webhook-secret'], { ozow: created.ozow, wranglerOk: false });
  check('webhook-secret: if wrangler cannot save it the tool says so, still prints nothing of the secret, and does not claim success', wrangler.code === 1 && /wrangler could not save/.test(text(wrangler)) && clean(wrangler) && !/Saved into the Worker/.test(text(wrangler)));
  const shortOnes = new PretendOzow();
  shortOnes.hooks.push({ id: '00000000-0000-4000-8000-0000000000cc', endpoint: DEFAULT_ENDPOINT, eventType: 'transaction.complete', messageType: 'full' });
  shortOnes.shortSecret = true;
  const shortRun = await run(['webhook-secret'], { ozow: shortOnes });
  check('webhook-secret: something that does not look like a signing secret is NOT saved', shortRun.code === 1 && shortRun.secretsPut.length === 0);

  // ---- webhook-delete ----
  const toDelete = new PretendOzow();
  toDelete.hooks.push({ id: '00000000-0000-4000-8000-0000000000dd', endpoint: DEFAULT_ENDPOINT, eventType: 'transaction.complete', messageType: 'full' });
  const noType = await run(['webhook-delete', '00000000-0000-4000-8000-0000000000dd'], { ozow: toDelete, typed: ['yes'] });
  check('webhook-delete: shows what it is about to delete and deletes nothing unless "delete" is typed', noType.code === 2 && toDelete.hooks.length === 1 && /About to delete/.test(text(noType)) && noType.lineAsked.length === 1);
  const doDelete = await run(['webhook-delete', '00000000-0000-4000-8000-0000000000dd'], { ozow: toDelete, typed: ['delete'] });
  check('webhook-delete: typing "delete" deletes exactly that subscription', doDelete.code === 0 && toDelete.hooks.length === 0 && doDelete.ozow.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('0000000000dd')));
  check('webhook-delete: an id that is not there is refused and nothing is deleted', (await run(['webhook-delete', '00000000-0000-4000-8000-0000000000ee'], { ozow: toDelete, typed: ['delete'] })).code === 2);

  // ---- replay-check ----
  const rc = await run(['replay-check']);
  const payCalls = rc.ozow.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/payments'));
  const keys = payCalls.map((c) => c.headers['Idempotency-Key']);
  const bodies = payCalls.map((c) => JSON.parse(c.body ?? '{}'));
  check('replay-check: three payment requests; the first two carry the SAME key and the SAME bytes, the third the same key and a different amount', payCalls.length === 3 && new Set(keys).size === 1 && payCalls[0].body === payCalls[1].body && payCalls[2].body !== payCalls[0].body && bodies[0].amount.value === 50 && bodies[2].amount.value === 51);
  check('replay-check: the amount is R50 (the wallet minimum), in rand, ZA, the site code typed at the prompt, references of letters and digits only, an expiry 15 minutes ahead', bodies[0].amount.currency === 'ZAR' && bodies[0].region === 'ZA' && bodies[0].siteCode === SITE_CODE && /^[A-Za-z0-9]{1,20}$/.test(bodies[0].beneficiaryReference) && bodies[0].merchantReference.length <= 50 && bodies[0].expireAt === '2026-11-12T10:15:00Z');
  check('replay-check: a pass says so twice (the replay returned the original; a different body is a 409), exit 0, and asked for the payments scope and a site code', rc.code === 0 && /RESULT 1: PASS/.test(text(rc)) && /RESULT 2: PASS/.test(text(rc)) && rc.ozow.tokenScopes.join() === 'payments' && rc.hiddenAsked.length === 3 && /Site code/.test(rc.hiddenAsked[2]));
  check('replay-check: it prints ids, codes and the link\'s host, never the link itself, and nothing secret', clean(rc) && !/\/secure/.test(text(rc)) && /the SAME payment/.test(text(rc)) && /link identical/.test(text(rc)));
  const broken = new PretendOzow();
  broken.replayAs409 = true;
  const brokenRun = await run(['replay-check'], { ozow: broken });
  check('replay-check: if the replay is answered 409 it says NOT AS EXPECTED with the three lines to send, and exits 1', brokenRun.code === 1 && /RESULT 1: NOT AS EXPECTED/.test(text(brokenRun)) && /Call 2 .*409/.test(text(brokenRun)) && clean(brokenRun));
  const prod = await run(['replay-check', '--env', 'production']);
  check('replay-check: refuses production (exit 2) before it asks for anything', prod.code === 2 && prod.hiddenAsked.length === 0 && prod.lineAsked.length === 0 && prod.ozow.calls.length === 0);

  // ---- resend and notifications ----
  const rs = await run(['resend', '11111111-1111-4111-8111-111111111111']);
  check('resend: asks Ozow to resend that transaction\'s notification with the payments scope and reports HTTP 202', rs.code === 0 && rs.ozow.calls.some((c) => c.method === 'POST' && /\/transactions\/11111111-1111-4111-8111-111111111111\/notifications\/resend$/.test(c.url)) && rs.ozow.tokenScopes.join() === 'payments' && /HTTP 202/.test(text(rs)) && clean(rs));
  const nt = await run(['notifications', '11111111-1111-4111-8111-111111111111']);
  check('notifications: prints each attempt\'s message id, the status our Worker answered and the time, and the count answered with a success', nt.code === 0 && /2 delivery attempts, 1 answered/.test(text(nt)) && /msg_aaa.*200/.test(text(nt)) && /msg_bbb.*400/.test(text(nt)) && clean(nt));
  check('notifications: it does not print the Worker\'s reply text (only the status code)', !/Not accepted\./.test(text(nt)));

  // ---- production ----
  const prodList = await run(['webhook-list', '--env', 'production'], { typed: ['production'] });
  check('production: asks for the word "production" first, then uses Ozow\'s production address', prodList.code === 0 && prodList.lineAsked.length === 1 && /PRODUCTION/.test(text(prodList)) && prodList.ozow.calls.every((c) => c.url.startsWith(`${PRODUCTION_BASE}/`)));
  const prodNo = await run(['webhook-list', '--env', 'production'], { typed: ['no'] });
  check('production: anything but the word stops the tool before it asks for a credential or calls Ozow', prodNo.code === 2 && prodNo.hiddenAsked.length === 0 && prodNo.ozow.calls.length === 0);

  // ---- failures ----
  const down = new PretendOzow();
  down.failNetwork = true;
  const downRun = await run(['webhook-list'], { ozow: down });
  check('when Ozow cannot be reached the tool says so in plain words, prints nothing secret and changes nothing', downRun.code === 1 && /could not be reached/.test(text(downRun)) && clean(downRun));

  // ---- hygiene across every run above ----
  const everyCall = [list0, created, again, listed, sec, noHook, twoRun, wrangler, shortRun, doDelete, rc, brokenRun, rs, nt, prodList].flatMap((r) => r.ozow.calls);
  check('hygiene: every call went to Ozow\'s own hosts (nothing to our database or Worker, nothing anywhere else)', everyCall.length > 20 && everyCall.every((c) => ['one.ozow.com', 'stagingone.ozow.com'].includes(new URL(c.url).hostname)));
  check('hygiene: the access token and the client credentials were only ever sent to Ozow (the token endpoint or an Authorization header)', everyCall.every((c) => !/pretend-client-secret/.test(`${c.url}`) && (c.url.endsWith('/token') || /client_secret/.test(c.body ?? '') === false)));

  // ---- the file itself ----
  const src = read('scripts/ops/ozow-staging-tool.ts');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  check('the file reads no credential from the environment, a file or an argument (no process.env, no readFileSync, no --client options)', !/process\.env/.test(code) && !/readFileSync|readFile\(/.test(code) && !/--client|--secret|--site/.test(code));
  check('the hidden prompt refuses anything that is not a terminal (isTTY), and a secret is never written with console.log or to a file', /isTTY/.test(code) && !/console\.(log|error|info)\(/.test(code) && !/writeFile|appendFile|createWriteStream/.test(code));
  check('the only program it runs is `npx wrangler secret put <NAME>`, from the repository folder, with the value on standard input', (code.match(/spawn\(/g) ?? []).length === 1 && /npx wrangler secret put \$\{name\}/.test(code) && /stdio: \['pipe', 'inherit', 'inherit'\]/.test(code) && /child\.stdin\?\.write\(`\$\{value\}\\n`\)/.test(code));
  check('nothing key-shaped is written in the tool or its test (no sk_/pk_ live or test literal, no whsec_ followed by characters)', ![src, read('scripts/dev/ozow-staging-tool-test.ts')].some((s) => /\b(sk|pk)_(live|test)_[A-Za-z0-9]{6,}/.test(s) || /whsec_[A-Za-z0-9+/=]{6,}/.test(s.replace(/`whsec_\$\{[^`]*`/g, ''))));
  check('no wording in the tool offers "free" lessons or sessions', !/\bfree\b/i.test(src));
  check('the default webhook address is the Worker\'s webhook route over https and the tool is under scripts/ops (never shipped in the site)', /^https:\/\/[a-z0-9.-]+\/api\/wallet\/webhook\/ozow$/.test(DEFAULT_ENDPOINT) && fs.existsSync(new URL('../ops/ozow-staging-tool.ts', import.meta.url)));

  process.stdout.write(failures === 0 ? '\nALL OK\n' : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  process.stdout.write(`FAIL the test crashed: ${e?.stack ?? e}\n`);
  process.exit(1);
});
