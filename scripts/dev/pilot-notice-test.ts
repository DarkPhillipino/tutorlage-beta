// Checks on the PILOT NOTICE of the bank-transfer top-up and the "waiting" line (plan section 8.4; CEO's answers of 5 Nov 2026). Run: npx tsx scripts/dev/pilot-notice-test.ts
// Proves, with a fake database client, rendered markup and by reading the source and the migration text: the built-in words are the plan's wording and equal the
// starting row the migration inserts; the row (any JSON) is understood tolerantly: a missing row, an error, a throw or an odd value all give the built-in
// words, and only "enabled": false hides the notice; {times} is filled in; the notice is drawn as plain text (never HTML); the waiting line reads
// "Sent 14:05 SAST, waiting for a person to check it" in South African time, naming the day when it is not today; the Add-money screen shows the notice
// before paying and the waiting line after sending, the wallet page shows both; the top-up read asks for the time the proof was sent; no new text says "free".
// It does NOT prove the database function (supabase/tests/platform_suggestions.sql, group N) or the screens in a real browser.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  DEFAULT_PILOT_NOTICE, DEFAULT_PILOT_TEXT, DEFAULT_PILOT_TIMES, fetchPilotNotice, resolvePilotNotice, waitingLine,
} from '../../src/lib/topupNotice';
import { PilotNoticeView } from '../../src/components/PilotNoticeView';
import { fetchTopups, type WalletClient } from '../../src/lib/wallet';

const rootRequire = createRequire(new URL('../../package.json', import.meta.url));
const React = rootRequire('react') as typeof import('react');
const render = (rootRequire('react-dom/server') as typeof import('react-dom/server')).renderToStaticMarkup;

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MIGRATION = read('supabase/migrations/20261105120000_platform_suggestions.sql');

type Answer = { data: unknown; error: { code?: string; message?: string } | null };
const clientWith = (rpc: (fn: string) => Answer | Promise<Answer>): Pick<WalletClient, 'rpc'> => ({ rpc: async (fn: string) => rpc(fn) });

async function main() {
  // ---- the built-in words ----
  check('the built-in notice is the plan\'s wording with the times filled in',
    DEFAULT_PILOT_NOTICE.enabled && DEFAULT_PILOT_NOTICE.text === `Tutorlage is in its pilot, so every bank transfer is checked by a person: usually within ${DEFAULT_PILOT_TIMES}. We are building instant payments. A tutor is only paid after your session is complete.`);
  check('it says every transfer is checked by a person, that instant payments are being built, and that a tutor is paid only after the session',
    /every bank transfer is checked by a person/.test(DEFAULT_PILOT_NOTICE.text) && /We are building instant payments\./.test(DEFAULT_PILOT_NOTICE.text) && /A tutor is only paid after your session is complete\./.test(DEFAULT_PILOT_NOTICE.text));
  check('it promises no date ("in the coming weeks") and never says free', !/coming weeks|soon|free/i.test(DEFAULT_PILOT_NOTICE.text + DEFAULT_PILOT_TIMES));
  const seededTimes = /'times', '([^']+)'/.exec(MIGRATION)?.[1];
  const seededText = /'text', '([^']+)'/.exec(MIGRATION)?.[1];
  check('the built-in words equal the starting row the migration inserts (so a missing row and the seeded row read the same)', seededTimes === DEFAULT_PILOT_TIMES && seededText === DEFAULT_PILOT_TEXT, `${seededTimes} | ${seededText}`);

  // ---- understanding the row (any JSON) ----
  const same = (v: unknown) => JSON.stringify(resolvePilotNotice(v)) === JSON.stringify(DEFAULT_PILOT_NOTICE);
  check('no row, null, a number, a list or an empty value all give the built-in words', same(null) && same(undefined) && same(42) && same(true) && same([]) && same(['a']) && same('') && same('   '));
  check('the seeded row itself reads as the built-in words', same({ enabled: true, times: DEFAULT_PILOT_TIMES, text: DEFAULT_PILOT_TEXT }));
  check('only "times" changed: the built-in sentence with the CEO\'s times',
    resolvePilotNotice({ times: '2 hours, 08:00 to 18:00' }).text === 'Tutorlage is in its pilot, so every bank transfer is checked by a person: usually within 2 hours, 08:00 to 18:00. We are building instant payments. A tutor is only paid after your session is complete.');
  check('"text" with {times} twice: both are replaced', resolvePilotNotice({ times: '1 day', text: 'Checked by a person within {times} (not {times} on Sundays).' }).text === 'Checked by a person within 1 day (not 1 day on Sundays).');
  check('"text" without {times} is shown as it is', resolvePilotNotice({ text: 'Transfers are checked by hand.' }).text === 'Transfers are checked by hand.');
  check('a plain text value is taken as the whole notice', resolvePilotNotice('Transfers are checked by hand today.').text === 'Transfers are checked by hand today.' && resolvePilotNotice('Transfers are checked by hand today.').enabled);
  const hidden = resolvePilotNotice({ enabled: false, times: 'x' });
  check('"enabled": false hides the notice, and nothing else does', !hidden.enabled && hidden.text === '' && resolvePilotNotice({ enabled: 'no' }).enabled && resolvePilotNotice({ enabled: 0 }).enabled && resolvePilotNotice({}).enabled);
  check('an odd field falls back on its own: a number or empty "times", a list or an over-long "text", a too-long "times"',
    resolvePilotNotice({ times: 5 }).text === DEFAULT_PILOT_NOTICE.text && resolvePilotNotice({ times: '  ' }).text === DEFAULT_PILOT_NOTICE.text && resolvePilotNotice({ text: ['x'] }).text === DEFAULT_PILOT_NOTICE.text
    && resolvePilotNotice({ text: 'x'.repeat(601) }).text === DEFAULT_PILOT_NOTICE.text && resolvePilotNotice({ times: 'x'.repeat(201) }).text === DEFAULT_PILOT_NOTICE.text);

  // ---- asking the database (tolerant) ----
  let asked = '';
  const ok = await fetchPilotNotice(clientWith((fn) => { asked = fn; return { data: { times: '4 hours' }, error: null }; }));
  check('it asks topup_pilot_notice() and reads the answer', asked === 'topup_pilot_notice' && /usually within 4 hours\./.test(ok.text));
  const asDefault = (n: { enabled: boolean; text: string }) => JSON.stringify(n) === JSON.stringify(DEFAULT_PILOT_NOTICE);
  check('a database without the function (an error) gives the built-in notice', asDefault(await fetchPilotNotice(clientWith(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.topup_pilot_notice' } })))));
  check('no row (the function answers null) gives the built-in notice', asDefault(await fetchPilotNotice(clientWith(() => ({ data: null, error: null })))));
  check('a thrown error (the network) gives the built-in notice', asDefault(await fetchPilotNotice(clientWith(() => { throw new Error('Failed to fetch'); }))));
  check('a switched-off row hides it', !(await fetchPilotNotice(clientWith(() => ({ data: { enabled: false }, error: null })))).enabled);

  // ---- drawn ----
  const view = (n: Parameters<typeof PilotNoticeView>[0]['notice']) => render(React.createElement(PilotNoticeView, { notice: n }));
  const shown = view(DEFAULT_PILOT_NOTICE);
  check('the notice is drawn as a note with the words', /role="note"/.test(shown) && /data-pilot-notice/.test(shown) && shown.includes('every bank transfer is checked by a person'));
  check('nothing is drawn while loading (null) or when it is switched off', view(null) === '' && view({ enabled: false, text: '' }) === '' && view({ enabled: true, text: '' }) === '');
  const nasty = view({ enabled: true, text: '<b>x</b><script>alert(1)</script>' });
  check('the words are printed as plain text, never as HTML', !/<script>/.test(nasty) && !/<b>x/.test(nasty) && nasty.includes('&lt;script&gt;'));
  const container = code('src/components/PilotNotice.tsx');
  check('the notice shows nothing until the answer arrives, so the built-in words never flash before the real ones', /useState<PilotNoticeValue \| null>\(null\)/.test(container) && /fetchPilotNotice\(walletDb\)/.test(container));
  check('no new file uses dangerouslySetInnerHTML', !/dangerouslySetInnerHTML|innerHTML/.test(container + code('src/components/PilotNoticeView.tsx') + code('src/lib/topupNotice.ts')));

  // ---- the waiting line ----
  const sentAt = '2026-11-05T12:05:00Z'; // 14:05 in South Africa
  const noon = Date.parse('2026-11-05T13:00:00Z');
  check('today: "Sent 14:05 SAST, waiting for a person to check it"', waitingLine(sentAt, noon) === 'Sent 14:05 SAST, waiting for a person to check it', waitingLine(sentAt, noon));
  check('an earlier day names the day', waitingLine(sentAt, Date.parse('2026-11-06T09:00:00Z')) === 'Sent Thu 5 Nov, 14:05 SAST, waiting for a person to check it', waitingLine(sentAt, Date.parse('2026-11-06T09:00:00Z')));
  check('the day is the South African day: 22:30 UTC is already tomorrow in South Africa', waitingLine('2026-11-05T22:30:00Z', Date.parse('2026-11-06T08:00:00Z')) === 'Sent 00:30 SAST, waiting for a person to check it', waitingLine('2026-11-05T22:30:00Z', Date.parse('2026-11-06T08:00:00Z')));
  check('no time to show: the time is left out, the line still reads', waitingLine(null) === 'Sent, waiting for a person to check it' && waitingLine('not a date') === 'Sent, waiting for a person to check it' && waitingLine(undefined) === 'Sent, waiting for a person to check it');

  // ---- the top-up read asks for the time the proof was sent ----
  const selects: string[] = [];
  const db: WalletClient = {
    rpc: async () => ({ data: null, error: null }),
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = (...a: unknown[]) => { if (m === 'select') selects.push(String(a[0])); return b; };
      b.then = (res: (v: Answer) => unknown) => Promise.resolve({ data: [{ id: 't1', reference: 'TL-ABCDEF', amount_rand: 300, status: 'proof_sent', received_rand: null, decision_comment: null, created_at: '2026-11-05T11:50:00Z', decided_at: null, proof_attached_at: sentAt }, { id: 't2', reference: 'TL-GHJKMN', amount_rand: 100, status: 'awaiting_proof', received_rand: null, decision_comment: null, created_at: '2026-11-05T11:00:00Z', decided_at: null, proof_attached_at: null }], error: null }).then(res);
      return b;
    },
    storage: { from: () => ({ upload: async () => ({ data: {}, error: null }) }) },
  };
  const topups = await fetchTopups(db, 'p1');
  check('the top-up read asks for proof_attached_at (a named column, never select *) and gives it as proofSentAt, null while the proof is awaited',
    /proof_attached_at/.test(selects[0] ?? '') && !/\*/.test(selects[0] ?? '') && topups[0].proofSentAt === sentAt && topups[1].proofSentAt === null);

  // ---- the screens ----
  const modal = code('src/components/AddMoneyModal.tsx');
  const amountStep = modal.slice(modal.indexOf("step === 'amount' ?"), modal.indexOf("step === 'pay' && topup ?"));
  const payStep = modal.slice(modal.indexOf("step === 'pay' && topup ?"), modal.indexOf('data-proof-sent'));
  check('the Add-money screen shows the pilot notice before paying: on the amount step and on the bank-details step', /<PilotNotice \/>/.test(amountStep) && /<PilotNotice \/>/.test(payStep));
  check('after the proof is sent it shows the waiting line with the time it was sent (kept from the moment of sending), then the pilot notice (the one place the time is written), then the contact-support sentence',
    /setSentAt\(new Date\(\)\.toISOString\(\)\);\s*setStep\('sent'\)/.test(modal) && /\{waitingLine\(sentAt\)\}/.test(modal) && modal.indexOf('waitingLine(sentAt)') < modal.indexOf('WALLET_COPY.proofSentLine}</p>\n            </div>')
    && modal.indexOf('waitingLine(sentAt)') < modal.indexOf('<PilotNotice />', modal.indexOf('data-proof-sent')) && modal.indexOf('<PilotNotice />', modal.indexOf('data-proof-sent')) < modal.indexOf('WALLET_COPY.proofSentLine}</p>\n            </div>'));
  // The older "We check transfers by hand. You could receive your money within one business day..." (and the status line's "usually within one business day") is
  // retired (PM, 9 Nov 2026): the screens may not promise a second, older time beside the notice. (Tutor payouts and the Terms are a different matter, left as they are.)
  const walletLib = code('src/lib/wallet.ts');
  const topupWords = [/proofSentLine:\s*'([^']*)'/.exec(walletLib)?.[1] ?? '', /proofSentUsually:\s*'([^']*)'/.exec(walletLib)?.[1] ?? ''];
  check('no older waiting time is left in the top-up words: neither "one business day" nor "We check transfers by hand"', topupWords.every((w) => w.length > 0 && !/business day|hours|working day|by hand/i.test(w)) && /Help button at the top of the page/.test(topupWords[0]), topupWords.join(' | '));
  const page = code('src/components/WalletPage.tsx');
  check('the wallet page shows the notice while the wallet is open, and the waiting line on every top-up that has its proof sent',
    /\{walletOpen && <PilotNotice \/>\}/.test(page) && /t\.status === 'proof_sent' \?[\s\S]{0,120}waitingLine\(t\.proofSentAt\)/.test(page));
  // (the price variable is matched loosely: the promo-code work passes the price after a discount, and that is still "what is missing for the lesson")
  check('the booking page already fills the amount with what is missing for the lesson (never below the minimum), and shows the price before asking for money',
    /suggestedRand=\{wallet\.state\.status === 'ready' \? shortfall\(\w+, wallet\.state\.available\) : null\}/.test(code('src/components/PricesPage.tsx')) && /shortfallSentence|rand0\(price\)/.test(code('src/components/WalletPayBox.tsx')));

  // ---- the database half it relies on ----
  check('the migration adds topup_pilot_notice() for signed-in people only, reading the setting topup_pilot_notice (not a wallet_ key)',
    /create or replace function public\.topup_pilot_notice\(\)/.test(MIGRATION) && /revoke all on function public\.topup_pilot_notice\(\) from public, anon;/.test(MIGRATION)
    && /grant execute on function public\.topup_pilot_notice\(\) to authenticated;/.test(MIGRATION) && /setting_key = 'topup_pilot_notice'/.test(MIGRATION) && !/'wallet_topup_pilot/.test(MIGRATION));
  check('the starting row is inserted only when missing (on conflict do nothing), so the CEO\'s edit is never overwritten', /on conflict \(setting_key\) do nothing;/.test(MIGRATION));

  // ---- new text ----
  check('nothing new offers "free" lessons or sessions', !/\bfree\b/i.test([container, code('src/components/PilotNoticeView.tsx'), code('src/lib/topupNotice.ts')].join('\n')));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
