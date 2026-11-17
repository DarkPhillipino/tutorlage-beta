// Checks on the CEO's Ozow Payments API pre-flight tool (scripts/ops/ozow-payments-check.ts), run against the PRETEND Ozow Payments API (scripts/dev/fake-ozow-payments.ts): no network, no
// real key, no money. It proves: the tool asks for the three values at a hidden prompt, makes exactly one TEST payment request (isTest true, never a real one) plus one status check, says in
// plain words what each answer means, never prints or stores what was typed, stops before Ozow on a typing slip, and stores the three values in the Worker only after Ozow accepted them and the
// CEO typed "save". Run: npx tsx scripts/dev/ozow-payments-check-test.ts
import fs from 'node:fs';
import { FakeClock } from './fake-ozow';
import { FAKE_PAYMENTS, FakeOzowPayments } from './fake-ozow-payments';
import { SECRET_NAMES, TEST_AMOUNT_RAND, runCheck } from '../ops/ozow-payments-check';
import type { ToolDeps } from '../ops/ozow-payments-check';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}\n`);
};

function rig(o: { typed?: string[]; line?: string; putOk?: boolean[]; mode?: Partial<FakeOzowPayments['mode']>; maxAmount?: number; privateKeyOfOzow?: string } = {}) {
  const clock = new FakeClock();
  const ozow = new FakeOzowPayments(clock, o.privateKeyOfOzow);
  Object.assign(ozow.mode, o.mode ?? {});
  if (o.maxAmount !== undefined) ozow.maxAmount = o.maxAmount;
  const out: string[] = [];
  const prompts: string[] = [];
  const lines: string[] = [];
  const puts: Array<{ name: string; value: string }> = [];
  const typed = o.typed ?? [FAKE_PAYMENTS.siteCode, FAKE_PAYMENTS.apiKey, FAKE_PAYMENTS.privateKey];
  let ti = 0;
  let pi = 0;
  const deps: ToolDeps = {
    fetchFn: ozow.fetch,
    askHidden: async (q) => {
      prompts.push(q);
      return typed[ti++] ?? '';
    },
    askLine: async (q) => {
      lines.push(q);
      return o.line ?? '';
    },
    out: (l) => out.push(l),
    putWorkerSecret: async (name, value) => {
      puts.push({ name, value });
      return { ok: (o.putOk ?? [])[pi++] ?? true };
    },
    now: clock.now,
    randomHex: (() => { let n = 0; return (bytes: number) => String(++n).repeat(bytes * 2).slice(0, bytes * 2).replace(/[^0-9a-f]/g, 'a'); })(),
  };
  return { ozow, out, prompts, lines, puts, deps, text: () => out.join('\n') };
}
const secrets = [FAKE_PAYMENTS.siteCode, FAKE_PAYMENTS.apiKey, FAKE_PAYMENTS.privateKey];
const noSecrets = (text: string) => secrets.every((s) => !text.includes(s));

(async () => {
  {
    const r = rig();
    const code = await runCheck([], r.deps);
    const post = r.ozow.calls.find((c) => c.method === 'POST');
    const body = JSON.parse(post?.body ?? '{}');
    check('good keys: exit 0 and "ACCEPTED", saying what that proves and that no money moved', code === 0 && /ACCEPTED/.test(r.text()) && /No money moved/.test(r.text()) && /Private Key work together/.test(r.text()));
    check('good keys: it asked for the three values at a HIDDEN prompt, in this order, and nothing else', r.prompts.length === 3 && /Site Code/.test(r.prompts[0]) && /API Key/.test(r.prompts[1]) && /Private Key/.test(r.prompts[2]) && r.lines.length === 0);
    check('good keys: exactly one payment request, and it is a TEST one (isTest true) of R35, never a real one; plus one status check asking for test transactions',
      r.ozow.count('POST', '/postpaymentrequest') === 1 && body.isTest === true && body.amount === '35.00' && TEST_AMOUNT_RAND === 35 && r.ozow.count('GET', '/GetTransactionByReference') === 1 && r.ozow.calls.find((c) => c.method === 'GET')?.query.isTest === 'true' && r.ozow.calls.length === 2);
    check('good keys: the request went to Ozow with the API key in the ApiKey header, and Ozow\'s (independent) hash check accepted it, so the Private Key is right', post?.headers.ApiKey === FAKE_PAYMENTS.apiKey && r.ozow.requests.size === 1 && !post?.body.includes(FAKE_PAYMENTS.privateKey));
    check('good keys: the reference is a one-off TL-CHK one (Ozow refuses a reference used in the last 24 hours), so running it twice works', /^TL-CHK[0-9A-F]{6}$/.test(body.transactionReference));
    check('good keys: nothing typed is on the screen (no site code, API key or private key), and the payment link is not printed', noSecrets(r.text()) && !/pay\.ozow\.com/.test(r.text()));
    check('good keys: with no --save nothing is stored and it says so', r.puts.length === 0 && /Nothing has been stored/.test(r.text()));
    const again = rig();
    await runCheck([], again.deps);
    check('good keys: it is safe to run twice (a different reference each time)', again.ozow.requests.size === 1);
  }
  for (const [label, o, expect] of [
    ['a wrong Private Key', { typed: [FAKE_PAYMENTS.siteCode, FAKE_PAYMENTS.apiKey, 'FAKE-some-other-private-key-1'] }, /hash/],
    ['a wrong API Key', { typed: [FAKE_PAYMENTS.siteCode, 'FAKE-some-other-api-key-0001', FAKE_PAYMENTS.privateKey] }, /API Key or the Site Code/],
    ['the account\'s amount limit', { maxAmount: 0.01 }, /AMOUNT.*R0\.01/],
    ['Ozow not having switched API payments on', { mode: { create: 'weird_error' as const } }, /send this whole screen|short code/],
    ['a 403 for the site', { mode: { create: '403' as const } }, /API Key or the Site Code/],
  ] as const) {
    const r = rig(o as any);
    const code = await runCheck([], r.deps);
    check(`${label}: exit 1, "NOT ACCEPTED", an explanation in plain words, nothing stored, nothing typed on screen`, code === 1 && /NOT ACCEPTED/.test(r.text()) && expect.test(r.text()) && r.puts.length === 0 && noSecrets(r.text()) && !/ACCEPTED\. Ozow took/.test(r.text()));
  }
  {
    const r = rig({ mode: { create: '500' } });
    const code = await runCheck([], r.deps);
    check('Ozow not answering clearly (a server error): "NO CLEAR ANSWER", exit 1, advice to wait and retry, and the status check is NOT made', code === 1 && /NO CLEAR ANSWER/.test(r.text()) && /run it again/.test(r.text()) && r.ozow.count('GET', '/GetTransactionByReference') === 0);
    const t = rig({ mode: { create: 'timeout' } });
    check('Ozow not answering at all: also a clear message, exit 1', (await runCheck([], t.deps)) === 1 && /NO CLEAR ANSWER/.test(t.text()));
  }
  {
    const r = rig({ mode: { check: '500' } });
    const code = await runCheck(['--save'], r.deps);
    check('the request accepted but the status check not answering: exit 1, says so, and --save does NOT offer to store anything', code === 1 && /ACCEPTED/.test(r.text()) && /status check did NOT answer cleanly/.test(r.text()) && r.lines.length === 0 && r.puts.length === 0);
  }
  for (const [label, typed] of [
    ['the same value typed for the API Key and the Private Key', [FAKE_PAYMENTS.siteCode, FAKE_PAYMENTS.apiKey, FAKE_PAYMENTS.apiKey]],
    ['a key with a space in it', [FAKE_PAYMENTS.siteCode, 'has a space in it', FAKE_PAYMENTS.privateKey]],
    ['an empty Site Code', ['', FAKE_PAYMENTS.apiKey, FAKE_PAYMENTS.privateKey]],
    ['a site code with odd characters', ['bad code!', FAKE_PAYMENTS.apiKey, FAKE_PAYMENTS.privateKey]],
  ] as const) {
    const r = rig({ typed: [...typed] });
    const code = await runCheck([], r.deps);
    check(`${label}: caught BEFORE Ozow is asked (nothing sent), with the problem named and no value printed`, code === 1 && r.ozow.calls.length === 0 && /not in the shape/.test(r.text()) && noSecrets(r.text()));
  }
  {
    const r = rig({ line: 'save' });
    const code = await runCheck(['--save'], r.deps);
    check('--save, Ozow accepts, the CEO types "save": the three values go to the Worker in order (site code, API key, private key), exactly as typed', code === 0 && r.puts.map((p) => p.name).join() === `${SECRET_NAMES.siteCode},${SECRET_NAMES.apiKey},${SECRET_NAMES.privateKey}` && r.puts[0].value === FAKE_PAYMENTS.siteCode && r.puts[1].value === FAKE_PAYMENTS.apiKey && r.puts[2].value === FAKE_PAYMENTS.privateKey);
    check('--save: it says each was stored and none of the values is printed', /Stored OZOW_SITE_CODE/.test(r.text()) && /Stored OZOW_API_KEY/.test(r.text()) && /Stored OZOW_PRIVATE_KEY/.test(r.text()) && noSecrets(r.text()) && r.lines.length === 1);
    const no = rig({ line: 'yes please' });
    check('--save: anything other than "save" stores nothing', (await runCheck(['--save'], no.deps)) === 0 && no.puts.length === 0 && /Nothing was stored/.test(no.text()));
    const bad = rig({ line: 'save', typed: [FAKE_PAYMENTS.siteCode, FAKE_PAYMENTS.apiKey, 'FAKE-some-other-private-key-1'] });
    check('--save with keys Ozow REFUSED: it never even asks, and stores nothing', (await runCheck(['--save'], bad.deps)) === 1 && bad.lines.length === 0 && bad.puts.length === 0);
    const half = rig({ line: 'save', putOk: [true, false, true] });
    const hc = await runCheck(['--save'], half.deps);
    check('--save when wrangler fails on the second value: it stops there, says which one and the command to run by hand, and does not store the third', hc === 1 && half.puts.length === 2 && /Could NOT store OZOW_API_KEY/.test(half.text()) && /wrangler secret put OZOW_API_KEY/.test(half.text()) && noSecrets(half.text()));
  }
  {
    const r = rig();
    check('an unknown option is refused before anything is asked', (await runCheck(['--live'], r.deps)) === 1 && r.prompts.length === 0 && r.ozow.calls.length === 0);
    const e = rig();
    e.deps.askHidden = async () => { throw new Error('Run this in a terminal window you type in. It will not read a secret from a pipe or a file (no terminal window found).'); };
    check('no terminal window (a pipe or a file): refused in plain words, nothing sent', (await runCheck([], e.deps)) === 1 && /terminal window/.test(e.text()) && e.ozow.calls.length === 0);
  }
  const src = fs.readFileSync(new URL('../ops/ozow-payments-check.ts', import.meta.url), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  check('the file never reads a setting from the environment or an argument, never writes a file, and never logs on its own (only through the scrubbed out())', !/process\.env/.test(code) && !/writeFile|appendFile|createWriteStream/.test(code) && !/console\./.test(code) && (code.match(/process\.stdout\.write/g) ?? []).length <= 4);
  check('it refuses a pipe: the hidden prompt needs a real terminal (isTTY and setRawMode)', /stdin\.isTTY/.test(code) && /setRawMode/.test(code));
  check('the only program it can run is wrangler secret put, with the value on standard input and not on the command line', (code.match(/spawn\(/g) ?? []).length === 1 && /spawn\(`npx wrangler secret put \$\{name\}`/.test(code) && /child\.stdin\?\.write/.test(code));
  check('it forces a TEST request: isTest true is in the configuration it builds, and nothing in the file can turn it off', /isTest: true/.test(code) && !/isTest: false/.test(code) && !/--live|--real/.test(code));
  check('no wording in the tool offers "free" lessons or sessions', !/free (lesson|session)/i.test(src));
  process.stdout.write(failures === 0 ? '\nALL OK\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
