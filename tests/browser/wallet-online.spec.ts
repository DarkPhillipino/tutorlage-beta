import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// PAY BY BANK, INSTANT (Ozow phase 3 of 3, 9 Nov 2026): the screens, with the database AND the Worker both PRETENDED (nothing here touches dev, production, the
// real Worker or any payment company; the "bank page" is a made-up address answered by the test). Covers, on the five profiles:
//  - the choice in Add money appears only when the database says so; with the function missing, or "no", the screen is exactly the old bank transfer, no error;
//  - "Pay by bank, instant" makes the top-up, asks the Worker with NO body and no amount, and goes to the address the Worker returns; a failure says so in plain
//    words and offers the bank transfer; "Bank transfer, checked by a person" is the old flow, unchanged, with its pilot notice;
//  - the return page: "Checking your payment", reads only the payer's OWN row (GET) every 3 s, shows the result, and after a minute "Still waiting..." with
//    "Check now"; it never writes; signed out it shows a sign-in button;
//  - the wallet page lines for an online top-up, in words, with "Continue to your bank" and "Check now".
// What this does NOT show: the real bank page, the real Worker, the provider's message arriving, a real credit (needs the real Worker and provider).

const CORS = { 'access-control-allow-origin': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';
const ONLINE_ID = '22222222-2222-4222-8222-222222222222';
const MANUAL_ID = '11111111-1111-4111-8111-111111111111';
const BANK_PAGE = 'https://pay.example.test/checkout/abc123';

const rowsOrOne = (route: Route, list: unknown[]) => {
  const wantsOne = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  return route.fulfill(wantsOne ? json(list[0] ?? null, list.length ? 200 : 406) : json(list));
};

type Online = 'yes' | 'no' | 'missing';
type Row = Record<string, unknown>;
const onlineRow = (status: string, extra: Row = {}): Row => ({
  id: ONLINE_ID, reference: 'TL-ONLN22', amount_rand: 200, status, method: 'online', received_rand: status === 'successful' ? 200 : null,
  decision_comment: null, created_at: '2026-11-09T10:00:00Z', decided_at: status === 'awaiting_payment' ? null : '2026-11-09T10:05:00Z', proof_attached_at: null, ...extra,
});

interface WorkerCall { method: string; path: string; authorization: string | undefined; body: string | null }
interface Setup {
  online?: Online;
  // The list on the wallet page.
  topups?: Row[];
  // The single row the return page asks for (called on every read).
  byId?: (read: number) => Row | null;
  // What the pretend Worker answers.
  start?: (n: number) => { status: number; body: unknown };
  check?: (n: number) => { status: number; body: unknown };
}
interface Seen { supabase: string[]; worker: WorkerCall[]; reads: number }

async function mock(page: Page, setup: Setup = {}): Promise<Seen> {
  const seen: Seen = { supabase: [], worker: [], reads: 0 };
  const startCount = { n: 0 };
  const checkCount = { n: 0 };
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    seen.supabase.push(`${request.method()} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: 'Browser Test', role: 'student', avatar_url: null }]));
    if (/\/rpc\/my_date_of_birth/.test(url)) return route.fulfill(json('2000-01-01'));
    if (/\/rpc\/my_pending_acceptances/.test(url) || /\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return route.fulfill(json([]));
    if (/\/rpc\/wallet_open/.test(url)) return route.fulfill(json(true));
    if (/\/rpc\/wallet_online_available/.test(url)) {
      if (setup.online === 'missing') return route.fulfill(json({ code: 'PGRST202', message: 'Could not find the function in the schema cache' }, 404));
      return route.fulfill(json(setup.online === 'yes'));
    }
    if (/\/rpc\/create_online_topup/.test(url)) return route.fulfill(json({ topup_id: ONLINE_ID, reference: 'TL-ONLN22', amount_rand: 200, status: 'awaiting_payment', method: 'online' }));
    if (/\/rpc\/wallet_payment_details/.test(url)) return route.fulfill(json({ open: true, bank_name: 'Test Bank', account_holder: 'Tutorlage (Pty) Ltd', account_number: '1234567890', branch_code: '250655', account_type: 'Cheque', min_rand: 50, max_rand: 5000, cap_rand: 10000 }));
    if (/\/rpc\/create_wallet_topup/.test(url)) return route.fulfill(json({ topup_id: MANUAL_ID, reference: 'TL-ABC234', amount_rand: 200, status: 'awaiting_proof' }));
    if (/\/rpc\/topup_pilot_notice/.test(url)) return route.fulfill(json(null));
    if (/\/rest\/v1\/wallets/.test(url)) return rowsOrOne(route, [{ available_rand: 320, held_rand: 0 }]);
    if (/\/rest\/v1\/wallet_topups/.test(url)) {
      if (/[?&]id=eq\./.test(url)) {
        seen.reads += 1;
        const row = setup.byId ? setup.byId(seen.reads) : null;
        return rowsOrOne(route, row ? [row] : []);
      }
      return rowsOrOne(route, setup.topups ?? []);
    }
    if (/\/rest\/v1\/wallet_ledger/.test(url)) return rowsOrOne(route, []);
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.route('**/api/wallet/topups/*/*', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const path = new URL(request.url()).pathname;
    seen.worker.push({ method: request.method(), path, authorization: request.headers()['authorization'], body: request.postData() });
    if (path.endsWith('/start-online')) {
      startCount.n += 1;
      const answer = setup.start ? setup.start(startCount.n) : { status: 200, body: { redirect_url: BANK_PAGE, expires_at: '2026-11-09T11:00:00Z', resumed: false } };
      return route.fulfill(json(answer.body, answer.status));
    }
    checkCount.n += 1;
    const answer = setup.check ? setup.check(checkCount.n) : { status: 200, body: { result: 'checked', status: 'awaiting_payment', transactions: 0 } };
    return route.fulfill(json(answer.body, answer.status));
  });
  // The made-up bank page: whatever the test is sent to is answered here, so nothing leaves the machine.
  await page.route('https://pay.example.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Bank page</title></head><body><h1>Bank page</h1></body></html>' }));
  return seen;
}

async function openWallet(page: Page, setup: Setup): Promise<Seen> {
  await signInFake(page);
  const seen = await mock(page, setup);
  await page.goto('/');
  const chip = page.locator('[data-wallet-chip]');
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible({ timeout: 15_000 });
  return seen;
}

async function amountThenContinue(page: Page, rand: string) {
  await page.getByRole('button', { name: 'Add money' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add money to your wallet' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Amount to add, in rand').fill(rand);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  return dialog;
}

// `include` limits the scan to the part this work built: a scan of the whole wallet page also meets older text there (small grey notes on the cream
// background) that is a few shades short of the contrast rule, and an open window dims the page behind it. Those are in the report, not hidden.
async function axeClean(page: Page, label: string, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  const results = await (include ? builder.include(include) : builder).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
  expect(summary, `${label}: ${results.passes.length} rules passed, ${results.violations.length} violated`).toEqual([]);
}

// A minute on the page's own clock (Playwright's fake clock, installed BEFORE the page is opened): three seconds at a time, and after each step wait until the
// page has really asked again (the answer to a look is a real network round trip, and the page's next timer is only set after it). Stops when the page
// has given up looking and shows "Check now".
async function passTheMinute(page: Page, seen: Seen) {
  const waiting = page.getByRole('button', { name: 'Check now' });
  await expect.poll(() => seen.reads, { timeout: 15_000 }).toBeGreaterThan(0);
  for (let i = 0; i < 40 && !(await waiting.isVisible()); i += 1) {
    const before = seen.reads;
    await page.clock.runFor(3000);
    for (let k = 0; k < 150 && seen.reads === before && !(await waiting.isVisible()); k += 1) await page.waitForTimeout(20);
  }
  await expect(waiting).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------- Add money ------------------------------------------------------------------------

test('the database says the choice is open: Add money offers both ways to pay after the amount (axe clean)', async ({ page, browserName, problems }) => {
  const seen = await openWallet(page, { online: 'yes' });
  const dialog = await amountThenContinue(page, '200');
  await expect(dialog.getByText('How would you like to pay?').first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Pay by bank, instant/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Bank transfer, checked by a person/ })).toBeVisible();
  await expect(dialog.getByText('R200', { exact: true })).toBeVisible();
  // nothing has been created or started yet: choosing is what does that
  expect(seen.supabase.filter((s) => /create_online_topup|create_wallet_topup/.test(s))).toEqual([]);
  expect(seen.worker).toEqual([]);
  await expect(page.getByText(/ozow|payfast|paystack|peach|\bfree\b/i)).toHaveCount(0);
  if (browserName === 'chromium') await axeClean(page, 'Add money, the choice', '[data-add-money]');
  expect(problems.pageErrors).toEqual([]);
});

test('"Pay by bank, instant": makes the top-up, asks the Worker with NO body and no amount, then goes to the address the Worker returned', async ({ page, problems }) => {
  const seen = await openWallet(page, { online: 'yes' });
  const dialog = await amountThenContinue(page, '200');
  await dialog.getByRole('button', { name: /Pay by bank, instant/ }).click();
  await page.waitForURL(BANK_PAGE, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Bank page' })).toBeVisible();
  const created = seen.supabase.findIndex((s) => s.includes('/rpc/create_online_topup'));
  expect(created, 'the top-up is made through create_online_topup').toBeGreaterThan(-1);
  expect(seen.supabase.some((s) => s.includes('/rpc/create_wallet_topup')), 'the bank-transfer top-up is not made').toBe(false);
  expect(seen.worker.length, 'the Worker is asked once').toBe(1);
  const call = seen.worker[0];
  expect(call.method).toBe('POST');
  expect(call.path).toBe(`/api/wallet/topups/${ONLINE_ID}/start-online`);
  expect(call.authorization ?? '', 'the payer comes from the sign-in token').toMatch(/^Bearer .+/);
  expect(call.body, 'the browser sends no amount and nothing else').toBeNull();
  expect(problems.pageErrors).toEqual([]);
});

test('"Bank transfer, checked by a person": the old flow, unchanged, with the pilot notice, and no call to the Worker', async ({ page, problems }) => {
  const seen = await openWallet(page, { online: 'yes' });
  const dialog = await amountThenContinue(page, '200');
  await dialog.getByRole('button', { name: /Bank transfer, checked by a person/ }).click();
  await expect(dialog.getByText('TL-ABC234').first()).toBeVisible();
  await expect(dialog.getByText('Test Bank')).toBeVisible();
  await expect(dialog.getByText('1234567890')).toBeVisible();
  await expect(dialog.getByText(/Tutorlage is in its pilot/)).toBeVisible();
  await expect(dialog.getByLabel('Proof of payment')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send proof of payment' })).toBeDisabled();
  expect(seen.supabase.some((s) => s.includes('/rpc/create_wallet_topup'))).toBe(true);
  expect(seen.supabase.some((s) => s.includes('/rpc/create_online_topup'))).toBe(false);
  expect(seen.worker).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
});

for (const online of ['no', 'missing'] as const) {
  test(`the choice is ${online === 'no' ? 'closed' : 'not built into the database yet'}: Add money is exactly the old bank transfer and shows no error`, async ({ page, problems }) => {
    const seen = await openWallet(page, { online });
    await page.getByRole('button', { name: 'Add money' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add money to your wallet' });
    await expect(dialog.getByText('You add money by bank transfer. Choose how much, from R50 to R5000. We then show you where to pay and the reference to use.')).toBeVisible();
    await dialog.getByLabel('Amount to add, in rand').fill('200');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('TL-ABC234').first()).toBeVisible();
    await expect(dialog.getByText('Test Bank')).toBeVisible();
    await expect(page.getByText('How would you like to pay?')).toHaveCount(0);
    await expect(page.getByText(/Pay by bank, instant/)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    expect(seen.worker).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
  });
}

test('the Worker cannot start the payment: plain words, nothing taken, the same top-up is tried again, and the bank transfer is one click away', async ({ page, problems }) => {
  const seen = await openWallet(page, {
    online: 'yes',
    start: (n) => (n === 1 ? { status: 502, body: { error: 'PROCESSOR SAYS NO', code: 'busy_or_not', detail: 'x' } } : { status: 200, body: { redirect_url: BANK_PAGE, resumed: true } }),
  });
  const dialog = await amountThenContinue(page, '200');
  await dialog.getByRole('button', { name: /Pay by bank, instant/ }).click();
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText("We could not open your bank's payment page. Nothing was taken from you. You can try again, or pay by bank transfer instead.");
  await expect(alert).not.toContainText(/PROCESSOR|busy_or_not|502/);
  // both ways are still there; "Try again" is the same button
  await expect(dialog.getByRole('button', { name: /Bank transfer, checked by a person/ })).toBeEnabled();
  await dialog.getByRole('button', { name: /Pay by bank, instant/ }).click();
  await page.waitForURL(BANK_PAGE, { timeout: 15_000 });
  expect(seen.supabase.filter((s) => s.includes('/rpc/create_online_topup')).length, 'the second try reuses the top-up').toBe(1);
  expect(seen.worker.map((c) => c.path)).toEqual([`/api/wallet/topups/${ONLINE_ID}/start-online`, `/api/wallet/topups/${ONLINE_ID}/start-online`]);
  expect(problems.pageErrors).toEqual([]);
});

test('the Worker says it is busy: asks the person to wait a few seconds, not an error code', async ({ page }) => {
  await openWallet(page, { online: 'yes', start: () => ({ status: 409, body: { error: 'x', code: 'busy', retry_after_seconds: 3 } }) });
  const dialog = await amountThenContinue(page, '200');
  await dialog.getByRole('button', { name: /Pay by bank, instant/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('Your payment is being set up. Please wait a few seconds and try again.');
});

test('"Pay by bank transfer" instead, after the online payment could not start, makes the usual top-up for the same amount', async ({ page }) => {
  const seen = await openWallet(page, { online: 'yes', start: () => ({ status: 503, body: { error: 'x', code: 'not_configured' } }) });
  const dialog = await amountThenContinue(page, '200');
  await dialog.getByRole('button', { name: /Pay by bank, instant/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('Paying with your bank is not available right now. Please pay by bank transfer instead.');
  await dialog.getByRole('button', { name: /Bank transfer, checked by a person/ }).click();
  await expect(dialog.getByText('TL-ABC234').first()).toBeVisible();
  expect(seen.supabase.some((s) => s.includes('/rpc/create_wallet_topup'))).toBe(true);
});

// ---------------------------------------------------------------- the return page ---------------------------------------------------------------

test('the return page: "Checking your payment", then (the bank has confirmed) "Payment received" with the amount in rand; it only READS', async ({ page, browserName, problems }) => {
  await signInFake(page);
  const seen = await mock(page, { byId: (read) => (read < 2 ? onlineRow('awaiting_payment') : onlineRow('successful')) });
  await page.goto(`/wallet/topup-return?topup=${ONLINE_ID}`);
  await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Please wait while we check that your payment has reached us.')).toBeVisible();
  if (browserName === 'chromium') await axeClean(page, 'return page, checking');
  // the second read (3 seconds later) finds the top-up paid
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('R200 has been added to your wallet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go to your wallet' })).toBeVisible();
  if (browserName === 'chromium') await axeClean(page, 'return page, paid');
  // it only ever read: every database call was a GET of the payer's own top-up (or the sign-in and profile reads), and nothing was written
  const writes = seen.supabase.filter((s) => /^(POST|PATCH|PUT|DELETE) \/rest\/v1\/(?!profiles)/.test(s) || /\/rpc\/(?!my_|wallet_open)/.test(s));
  expect(writes, 'no write and no function call that could credit').toEqual([]);
  expect(seen.supabase.filter((s) => s.includes('/rest/v1/wallet_topups')).every((s) => s.startsWith('GET ') && s.includes(`id=eq.${ONLINE_ID}`) && s.includes(`profile_id=eq.${ME}`))).toBe(true);
  expect(seen.worker, 'the Worker is not asked at all unless the person presses Check now').toEqual([]);
  expect(problems.pageErrors).toEqual([]);
});

test('"Go to your wallet" opens the wallet', async ({ page }) => {
  await signInFake(page);
  await mock(page, { byId: () => onlineRow('successful') });
  await page.goto(`/wallet/topup-return?topup=${ONLINE_ID}`);
  await page.getByRole('button', { name: 'Go to your wallet' }).click({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible({ timeout: 15_000 });
  expect(page.url(), 'the word is dropped from the address').not.toContain('view=');
});

test('a minute with no answer: "Still waiting. We will tell you here and in your bell the moment it arrives." with Check now; the page looked every 3 seconds', async ({ page, browserName, problems }) => {
  await signInFake(page);
  const seen = await mock(page, { byId: () => onlineRow('awaiting_payment') });
  await page.clock.install({ time: new Date('2026-11-09T10:00:00Z') });
  await page.goto(`/wallet/topup-return?topup=${ONLINE_ID}`);
  await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible({ timeout: 15_000 });
  await passTheMinute(page, seen);
  await expect(page.getByText('Still waiting. We will tell you here and in your bell the moment it arrives.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Check now' })).toBeVisible();
  expect(seen.reads, 'one look about every 3 seconds for 60 seconds').toBeGreaterThanOrEqual(18);
  expect(seen.reads).toBeLessThanOrEqual(23);
  const readsWhenStopped = seen.reads;
  await page.clock.runFor(30_000);
  await page.waitForTimeout(100);
  expect(seen.reads, 'it stops looking after the minute').toBe(readsWhenStopped);
  if (browserName === 'chromium') await axeClean(page, 'return page, still waiting');
  expect(problems.pageErrors).toEqual([]);
});

test('"Check now" asks the Worker (no body), reads the row again and shows the money when it has arrived; a second press too soon says how long to wait', async ({ page }) => {
  await signInFake(page);
  let paid = false;
  const seen = await mock(page, {
    byId: () => onlineRow(paid ? 'successful' : 'awaiting_payment'),
    check: (n) => {
      if (n === 1) return { status: 429, body: { error: 'x', code: 'wait', retry_after_seconds: 9 } };
      paid = true;
      return { status: 200, body: { result: 'checked', status: 'successful', transactions: 1 } };
    },
  });
  await page.clock.install({ time: new Date('2026-11-09T10:00:00Z') });
  await page.goto(`/wallet/topup-return?topup=${ONLINE_ID}`);
  await passTheMinute(page, seen);
  const checkNow = page.getByRole('button', { name: 'Check now' });
  await expect(checkNow).toBeVisible({ timeout: 15_000 });
  await checkNow.click();
  await expect(page.locator('[data-check-note]')).toHaveText('Please wait 9 seconds, then try again.');
  await checkNow.click();
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('R200 has been added to your wallet.')).toBeVisible();
  expect(seen.worker.map((c) => `${c.method} ${c.path}`)).toEqual([`POST /api/wallet/topups/${ONLINE_ID}/check`, `POST /api/wallet/topups/${ONLINE_ID}/check`]);
  expect(seen.worker.every((c) => c.body === null && /^Bearer /.test(c.authorization ?? ''))).toBe(true);
});

test('"Check now" when nothing has arrived says so, and the page stays waiting', async ({ page }) => {
  await signInFake(page);
  const seen = await mock(page, { byId: () => onlineRow('awaiting_payment') });
  await page.clock.install({ time: new Date('2026-11-09T10:00:00Z') });
  await page.goto(`/wallet/topup-return?topup=${ONLINE_ID}`);
  await passTheMinute(page, seen);
  await page.getByRole('button', { name: 'Check now' }).click({ timeout: 15_000 });
  await expect(page.locator('[data-check-note]')).toHaveText('We checked just now. Nothing has arrived yet.');
  await expect(page.getByText('Still waiting. We will tell you here and in your bell the moment it arrives.')).toBeVisible();
});

const SETTLED: Array<[string, Row | null, string, string]> = [
  ['unsuccessful', onlineRow('unsuccessful', { decision_comment: 'INTERNAL note: provider said X' }), 'Payment not completed', 'The payment did not go through. Nothing was added to your wallet.'],
  ['cancelled', onlineRow('cancelled', { decision_comment: 'INTERNAL note' }), 'Payment cancelled', 'Cancelled. Nothing was added to your wallet.'],
  ['missing', null, 'We could not find this payment', 'Open your wallet to see all your top-ups.'],
];
for (const [name, row, title, body] of SETTLED) {
  test(`the return page for a top-up that is ${name}: plain words, no stored comment, a way to the wallet`, async ({ page, problems }) => {
    await signInFake(page);
    await mock(page, { byId: () => row });
    await page.goto(`/wallet/topup-return?topup=${ONLINE_ID}`);
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(body)).toBeVisible();
    await expect(page.getByText(/INTERNAL|provider said/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Go to your wallet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
  });
}

test('an address with no real top-up id is "not found" and the database is not even asked', async ({ page }) => {
  await signInFake(page);
  const seen = await mock(page, { byId: () => onlineRow('successful') });
  await page.goto('/wallet/topup-return?topup=not-an-id');
  await expect(page.getByRole('heading', { name: 'We could not find this payment' })).toBeVisible({ timeout: 15_000 });
  expect(seen.supabase.filter((s) => s.includes('wallet_topups'))).toEqual([]);
  await page.goto('/wallet/topup-return');
  await expect(page.getByRole('heading', { name: 'We could not find this payment' })).toBeVisible({ timeout: 15_000 });
});

test('the address cannot make a payment look paid: success words in the address change nothing', async ({ page }) => {
  await signInFake(page);
  await mock(page, { byId: () => onlineRow('awaiting_payment') });
  await page.goto(`/wallet/topup-return?topup=${ONLINE_ID}&status=successful&paid=true&result=Successful&amount=999`);
  await expect(page.getByRole('heading', { name: 'Checking your payment' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Payment received|added to your wallet/)).toHaveCount(0);
});

test('nobody signed in: a sign-in button, no database read, no crash (axe clean)', async ({ page, browserName, problems }) => {
  const seen = await mock(page, { byId: () => onlineRow('successful') });
  await page.goto(`/wallet/topup-return?topup=${ONLINE_ID}`);
  await expect(page.getByRole('heading', { name: 'Sign in to see your payment' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('If you have paid, your money is added to your wallet as soon as your bank confirms it. Sign in to see it.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).waitFor();
  expect(seen.supabase.filter((s) => s.includes('wallet_topups'))).toEqual([]);
  if (browserName === 'chromium') await axeClean(page, 'return page, signed out');
  expect(problems.pageErrors).toEqual([]);
});

// ---------------------------------------------------------------- the wallet page -----------------------------------------------------------------

const LIST: Row[] = [
  onlineRow('awaiting_payment', { id: ONLINE_ID }),
  onlineRow('successful', { id: 'a1', reference: 'TL-PAID22', amount_rand: 500, received_rand: 500, created_at: '2026-11-08T10:00:00Z' }),
  onlineRow('unsuccessful', { id: 'a2', reference: 'TL-FAIL22', amount_rand: 100, decision_comment: 'We could not start the online payment', created_at: '2026-11-07T10:00:00Z' }),
  onlineRow('cancelled', { id: 'a3', reference: 'TL-CANC22', amount_rand: 150, decision_comment: 'The online payment window ended without a successful payment', created_at: '2026-11-06T10:00:00Z' }),
  { id: 'm1', reference: 'TL-MANU22', amount_rand: 300, status: 'proof_sent', method: 'eft', received_rand: null, decision_comment: null, created_at: '2026-11-05T10:00:00Z', decided_at: null, proof_attached_at: '2026-11-05T10:05:00Z' },
];

test('the wallet page lists online top-ups in plain words, with Continue to your bank and Check now only where they belong (axe clean)', async ({ page, browserName, problems }) => {
  await openWallet(page, { online: 'yes', topups: LIST });
  const waiting = page.locator('[data-topup="awaiting_payment"]');
  await expect(waiting).toContainText('R200');
  await expect(waiting).toContainText('Waiting for your bank');
  await expect(waiting.getByRole('button', { name: 'Continue to your bank' })).toBeVisible();
  await expect(waiting.getByRole('button', { name: 'Check now' })).toBeVisible();
  await expect(page.getByText('Paid by bank and added to your wallet')).toBeVisible();
  await expect(page.getByText('The payment did not go through. Nothing was added to your wallet.')).toBeVisible();
  await expect(page.getByText('Cancelled. Nothing was added to your wallet.')).toBeVisible();
  // the stored comments are for our records and are never shown for an online top-up
  await expect(page.getByText(/We could not start the online payment|payment window ended/)).toHaveCount(0);
  // the bank-transfer line is the same as before
  await expect(page.locator('[data-topup="proof_sent"]')).toContainText('waiting for a person to check it');
  await expect(page.getByRole('button', { name: 'Continue to your bank' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(1);
  await expect(page.getByText(/awaiting_payment|unsuccessful|online\b.*top-up|ozow/i)).toHaveCount(0);
  if (browserName === 'chromium') await axeClean(page, 'wallet page, the top-up lines', '[data-topup]');
  expect(problems.pageErrors).toEqual([]);
});

test('"Continue to your bank" on the wallet page asks the Worker for the same payment page and goes there', async ({ page }) => {
  const seen = await openWallet(page, { online: 'yes', topups: LIST, start: () => ({ status: 200, body: { redirect_url: BANK_PAGE, resumed: true } }) });
  await page.locator('[data-topup="awaiting_payment"]').getByRole('button', { name: 'Continue to your bank' }).click();
  await page.waitForURL(BANK_PAGE, { timeout: 15_000 });
  expect(seen.worker.map((c) => `${c.method} ${c.path} ${c.body}`)).toEqual([`POST /api/wallet/topups/${ONLINE_ID}/start-online null`]);
});

test('"Continue to your bank" for a payment that has expired says so in plain words and reads the list again', async ({ page }) => {
  const seen = await openWallet(page, { online: 'yes', topups: LIST, start: () => ({ status: 409, body: { error: 'x', code: 'closed', status: 'awaiting_payment', why: 'expired' } }) });
  const before = seen.supabase.filter((s) => s.includes('/rest/v1/wallet_topups')).length;
  await page.locator('[data-topup="awaiting_payment"]').getByRole('button', { name: 'Continue to your bank' }).click();
  await expect(page.locator('[data-online-note]')).toHaveText('This payment can no longer be started. Nothing was taken from you. Start a new top-up, or pay by bank transfer instead.');
  await expect.poll(() => seen.supabase.filter((s) => s.includes('/rest/v1/wallet_topups')).length).toBeGreaterThan(before);
});

test('"Check now" on the wallet page asks the Worker and reads the list again', async ({ page }) => {
  const seen = await openWallet(page, { online: 'yes', topups: LIST });
  const before = seen.supabase.filter((s) => s.includes('/rest/v1/wallet_topups')).length;
  await page.locator('[data-topup="awaiting_payment"]').getByRole('button', { name: 'Check now' }).click();
  await expect(page.locator('[data-online-note]')).toHaveText('We checked just now. Nothing has arrived yet.');
  expect(seen.worker.map((c) => `${c.method} ${c.path} ${c.body}`)).toEqual([`POST /api/wallet/topups/${ONLINE_ID}/check null`]);
  await expect.poll(() => seen.supabase.filter((s) => s.includes('/rest/v1/wallet_topups')).length).toBeGreaterThan(before);
});

test('with the choice closed, the wallet page and the old transfer lines are unchanged and there are no online buttons', async ({ page }) => {
  await openWallet(page, { online: 'no', topups: [LIST[4]] });
  await expect(page.locator('[data-topup="proof_sent"]')).toContainText('waiting for a person to check it');
  await expect(page.getByRole('button', { name: 'Continue to your bank' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
});
