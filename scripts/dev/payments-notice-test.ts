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
check('on the booking screen the notice is shown only when the switch is on, and the send button is off then', /\{PAYMENTS_NOT_OPEN && !freeOpen && !walletMode && \(\s*<p role="status" data-payments-not-open[\s\S]{0,260}\{PAYMENTS_NOT_OPEN_NOTICE\}/.test(prices) && /disabled=\{isSending \|\| \(PAYMENTS_NOT_OPEN && !freeOpen && !walletMode\)\}/.test(prices));
check('the send handler refuses too (not only the disabled button)', /const handleSendRequest = async \(\) => \{\s*if \(PAYMENTS_NOT_OPEN && !freeOpen && !walletMode\) return;/.test(prices));
// 1 Nov 2026: found that the live bundle was built WITHOUT the switch (its compiled constant was false, so booking was open on tutorlage.com
// although payments are dropped). The deploy workflow now sets it; delete that one line (and flip this check) when payments return.
check('the deploy workflow sets the switch to "1" (payments are dropped; remove the line when they return)', /^\s*VITE_PAYMENTS_NOT_OPEN: "1"\s*$/m.test(workflow));

// The tutor's bank-details box (asks for bank details and a typed ID or passport number) is hidden while the switch is on (CEO, 1 Nov 2026).
const teachingPanel = read('src/components/TeachingProfilePanel.tsx');
const queue = read('src/components/AvailableRequestsQueue.tsx');
check('Teaching tab: the bank-details box shows only when payments are open', /\{!PAYMENTS_NOT_OPEN && <PayoutAccountPanel tutorId=\{tutor\.id\} \/>\}/.test(teachingPanel) && !/^\s*<PayoutAccountPanel/m.test(teachingPanel));
// 1 Nov 2026 (batch 2): a second tap in the same instant must not send a second request (the button's disabled state is read a render late).
check('the send handler also refuses while a send is under way (an instant flag, not only the disabled button), and clears it only on failure', /const sendingRef = useRef\(false\)/.test(prices) && /if \(PAYMENTS_NOT_OPEN && !freeOpen && !walletMode\) return;\s*if \(walletMode && !walletEnough\) return;\s*if \(sendingRef\.current\) return;/.test(prices) && /sendingRef\.current = true;\s*setIsSending\(true\)/.test(prices) && /sendingRef\.current = false;\s*setIsSending\(false\)/.test(prices));
check('request queue: the bank-details box is asked for only when payments are open', /const needsPayoutAccount = !PAYMENTS_NOT_OPEN && /.test(queue));
check('request queue: while payments are closed the tutor is told so instead (nothing to add, nothing hidden silently)', /\{PAYMENTS_NOT_OPEN && !freeOpen && visibleRequests\.length > 0 && !visibleRequests\.every\(\(r\) => walletIds\.has\(r\.id\) \|\| freeIds\.has\(r\.id\)\) && \(\s*<p role="status" data-payments-not-open-tutor/.test(queue));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
// A failing check must fail the run: this test printed FAIL lines and still exited 0, so `npm run regress` counted it as a pass (found 3 Nov 2026).
process.exitCode = failures === 0 ? 0 : 1;
