// Checks on the "Payments are not open yet" notice (CEO, 20 Oct 2026, answer D3): while the payment account is on Paystack test keys the
// booking screen says so and its send button is off; by default (no switch set) booking is exactly as before. Run:
//   npx tsx scripts/dev/payments-notice-test.ts
// Also proved by building twice (switch unset: the notice is behind a runtime false; VITE_PAYMENTS_NOT_OPEN=1: the compiled page always
// shows it), 20 Oct 2026.
import fs from 'node:fs';
import { PAYMENTS_NOT_OPEN, PAYMENTS_NOT_OPEN_NOTICE } from '../../src/lib/features';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

const features = read('src/lib/features.ts');
const prices = read('src/components/PricesPage.tsx');
const workflow = read('.github/workflows/deploy-pages.yml');

check('the notice is the CEO\'s own line, word for word', PAYMENTS_NOT_OPEN_NOTICE === 'Payments are not open yet. Booking opens soon.');
check('by default (no switch set, and under Node where there is no import.meta.env) booking is open as before', PAYMENTS_NOT_OPEN === false);
check('the switch is a deploy variable read as exactly "1", not a code edit', /PAYMENTS_NOT_OPEN = import\.meta\.env\?\.VITE_PAYMENTS_NOT_OPEN === '1'/.test(features));
check('on the booking screen the notice is shown only when the switch is on, and the send button is off then', /\{PAYMENTS_NOT_OPEN && \(\s*<p role="status" data-payments-not-open[\s\S]{0,260}\{PAYMENTS_NOT_OPEN_NOTICE\}/.test(prices) && /disabled=\{isSending \|\| PAYMENTS_NOT_OPEN\}/.test(prices));
check('the send handler refuses too (not only the disabled button)', /const handleSendRequest = async \(\) => \{\s*if \(PAYMENTS_NOT_OPEN\) return;/.test(prices));
check('nothing publishes it on yet: the deploy workflow does not set the switch until the move to tutorlage.com (remove this check then)', !/VITE_PAYMENTS_NOT_OPEN/.test(workflow));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
