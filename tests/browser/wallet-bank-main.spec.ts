import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// THE BANK AS THE MAIN WAY TO PAY on the booking page (Ozow Option A, CEO 12 Nov 2026), on the five profiles, with the database AND the Worker both PRETENDED
// (nothing here touches dev, production, the real Worker or any payment company; the "bank page" is a made-up address answered by the test). Covers:
//  - when the database says the bank choice is open for this person AND the Worker says online payments are set up, the price panel leads with the wallet and
//    the bank ("Pay R180 from your wallet", or the shortfall and "Add money by bank"); the card is folded under "Pay with a card instead", with its own Paystack
//    test note; the old "See more" is gone;
//  - the "Test mode" note for the bank shows ONLY when the Worker says `test: true`, and never beside a live payment;
//  - "Add money by bank" goes straight to the bank (no "How would you like to pay?" question first), asking the Worker with NO body and no amount; when the bank
//    cannot be opened the plain message and "Bank transfer, checked by a person" are on screen;
//  - every doubt leaves the card as the main way, exactly as before: the choice closed, its function missing, the Worker not set up, answering an error, or
//    not answering; and then the Worker is asked nothing at all (an ordinary payer costs no extra call) or only the one public question.
// What this does NOT show: the real bank page, the real Worker, a real payment, a real credit, the request actually being sent (needs the real Worker and database).

const CORS = { 'access-control-allow-origin': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';
const ONLINE_ID = '22222222-2222-4222-8222-222222222222';
const BANK_PAGE = 'https://pay.example.test/checkout/abc123';
const NOTE_START = 'Test mode: you will pay on Ozow\'s practice bank page with the demo login. No real money is taken, and the money added to your wallet is pretend money.';

const rowsOrOne = (route: Route, list: unknown[]) => {
  const wantsOne = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  return route.fulfill(wantsOne ? json(list[0] ?? null, list.length ? 200 : 406) : json(list));
};

type Online = 'yes' | 'no' | 'missing';
type Env = 'staging' | 'production' | 'not_set_up' | 'error' | 'old_worker' | 'odd' | 'down';
interface Setup {
  online: Online;
  env?: Env;
  balance?: number;
  start?: { status: number; body: unknown };
}
interface Seen { supabase: string[]; worker: { method: string; path: string; authorization: string | undefined; body: string | null }[]; rpcBodies: string[] }

// Every database call the booking page and the wallet make is answered here; anything not listed gets an empty answer.
async function mock(page: Page, setup: Setup): Promise<Seen> {
  const seen: Seen = { supabase: [], worker: [], rpcBodies: [] };
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    seen.supabase.push(`${request.method()} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
    if (/\/rpc\//.test(url)) seen.rpcBodies.push(`${url.replace(/^.*\/rpc\//, '')} ${request.postData() ?? ''}`);
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
    if (/\/rpc\/topup_pilot_notice/.test(url)) return route.fulfill(json(null));
    if (/\/rpc\/available_price_levels/.test(url)) return route.fulfill(json([{ level_id: '1A', tier_id: 1, tier_name: 'Foundation', price: 180, currency_code: 'ZAR', tutors: 3 }]));
    if (/\/rest\/v1\/sub_tier_definitions/.test(url)) {
      return route.fulfill(json([{
        id: '1A', tier_id: 1, max_allowed_rate: 180, min_hours: 0, min_rating: 0, min_repeat_rate_pct: 0, min_written_reviews: 0, min_distinct_students_uplift: 0, required_grade_uplift_pct: 0,
        tier_definitions: { public_name: 'Foundation', positioning_quote: 'Where every tutor starts.', currency_code: 'ZAR' },
      }]));
    }
    if (/\/rest\/v1\/wallets/.test(url)) return rowsOrOne(route, [{ available_rand: setup.balance ?? 320, held_rand: 0 }]);
    if (/\/rest\/v1\/(wallet_topups|wallet_ledger)/.test(url)) return rowsOrOne(route, []);
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.route('**/api/wallet/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const path = new URL(request.url()).pathname;
    seen.worker.push({ method: request.method(), path, authorization: request.headers()['authorization'], body: request.postData() });
    if (path.endsWith('/online-environment')) {
      switch (setup.env ?? 'staging') {
        case 'staging': return route.fulfill(json({ configured: true, provider: 'ozow', test: true }));
        case 'production': return route.fulfill(json({ configured: true, provider: 'ozow', test: false }));
        case 'not_set_up': return route.fulfill(json({ error: 'Paying with your bank is not available right now.', code: 'not_configured' }, 503));
        case 'error': return route.fulfill(json({ error: 'x' }, 500));
        case 'old_worker': return route.fulfill(json({ error: 'Not found' }, 404));
        case 'odd': return route.fulfill(json({ configured: true, provider: 'ozow', test: 'true' }));
        case 'down': return route.abort('failed');
      }
    }
    if (path.endsWith('/start-online')) {
      const a = setup.start ?? { status: 200, body: { redirect_url: BANK_PAGE, expires_at: '2026-11-09T11:00:00Z', resumed: false } };
      return route.fulfill(json(a.body, a.status));
    }
    return route.fulfill(json({ result: 'checked', status: 'awaiting_payment', transactions: 0 }));
  });
  await page.route('https://pay.example.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Bank page</title></head><body><h1>Bank page</h1></body></html>' }));
  return seen;
}

// Home -> "1-on-1 Tutoring" -> "Find a tutor" (opens the prices page) -> the Level 1A card -> the price panel of the request.
async function openPricePanel(page: Page, setup: Setup): Promise<Seen> {
  await signInFake(page);
  const seen = await mock(page, setup);
  await page.goto('/');
  await page.getByRole('button', { name: /1-on-1 Tutoring/ }).click({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Find a tutor' }).click({ timeout: 20_000 });
  await page.locator('[data-level="1A"]').click({ timeout: 20_000 });
  await expect(page.getByText('R180', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  return seen;
}

const SAVE_CARD = /Save card & send request/;
const envAsks = (seen: Seen) => seen.worker.filter((c) => c.path.endsWith('/online-environment'));

test('the bank leads (Worker says TEST): the wallet box is open, "Pay R180 from your wallet", the test note, the card folded under "Pay with a card instead" (axe clean)', async ({ page, browserName, problems }) => {
  const seen = await openPricePanel(page, { online: 'yes', env: 'staging', balance: 320 });
  const main = page.locator('[data-bank-main]');
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-test-mode-bank]')).toHaveText(NOTE_START);
  await expect(page.getByRole('button', { name: 'Pay R180 from your wallet' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-wallet-pay]')).toContainText('Your wallet: R320');
  // The old arrangement is gone: no "See more" fold for the wallet, and the card is folded, not shown.
  await expect(page.locator('[data-wallet-toggle]')).toHaveCount(0);
  const toggle = page.locator('[data-card-toggle]');
  await expect(toggle).toHaveText('Pay with a card instead');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: SAVE_CARD })).toHaveCount(0);
  await expect(page.locator('[data-test-mode]')).toHaveCount(0);
  if (browserName === 'chromium') {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).include('[data-bank-main]').analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ')})`), 'axe on the bank-first payment part').toEqual([]);
  }
  // Opening the fold shows the card way exactly as it was, with its own Paystack test note.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: SAVE_CARD })).toBeVisible();
  await expect(page.locator('[data-test-mode]')).toHaveText('Test mode: use a Paystack test card. No real money is taken.');
  // The Worker was asked the one public question once: a GET, no sign-in header, no body.
  const asks = envAsks(seen);
  expect(asks.length, 'the Worker is asked once').toBe(1);
  expect(asks[0].method).toBe('GET');
  expect(asks[0].authorization, 'no token goes with it').toBeUndefined();
  expect(asks[0].body).toBeNull();
  expect(problems.pageErrors).toEqual([]);
});

test('the bank leads on the LIVE system (Worker says test false): the same page, and NO test note anywhere above the card fold', async ({ page, problems }) => {
  await openPricePanel(page, { online: 'yes', env: 'production', balance: 320 });
  await expect(page.locator('[data-bank-main]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Pay R180 from your wallet' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-test-mode-bank]')).toHaveCount(0);
  await expect(page.getByText(/Test mode|No real money|pretend money|practice bank/)).toHaveCount(0);
  expect(problems.pageErrors).toEqual([]);
});

test('too little in the wallet: the shortfall and "Add money by bank"; the bank opens at once for the amount, asking the Worker with no body, and no "How would you like to pay?" question comes first', async ({ page, problems }) => {
  const seen = await openPricePanel(page, { online: 'yes', env: 'staging', balance: 50 });
  await expect(page.getByRole('button', { name: 'Pay R180 from your wallet' })).toHaveCount(0);
  await expect(page.locator('[data-wallet-pay]')).toContainText('Your wallet: R50', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Add money by bank' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add money to your wallet' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Amount to add, in rand')).toHaveValue('130');
  await dialog.getByLabel('Amount to add, in rand').fill('200');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(BANK_PAGE, { timeout: 15_000 });
  const made = seen.rpcBodies.filter((b) => b.startsWith('create_online_topup'));
  expect(made.length, 'one online top-up was made').toBe(1);
  expect(made[0]).toContain('"p_amount":200');
  const starts = seen.worker.filter((c) => c.path.endsWith('/start-online'));
  expect(starts.length, 'the Worker was asked to start the payment once').toBe(1);
  expect(starts[0].method).toBe('POST');
  expect(starts[0].body, 'no amount and no payer go to the Worker').toBeNull();
  expect(starts[0].authorization).toMatch(/^Bearer /);
  expect(seen.rpcBodies.some((b) => b.startsWith('create_wallet_topup')), 'no manual transfer was made').toBe(false);
  expect(problems.pageErrors).toEqual([]);
});

test('the bank cannot be opened: the plain message and "Bank transfer, checked by a person" are right there', async ({ page, problems }) => {
  await openPricePanel(page, { online: 'yes', env: 'staging', balance: 50, start: { status: 502, body: { error: 'x', code: 'start_failed' } } });
  await page.getByRole('button', { name: 'Add money by bank' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add money to your wallet' });
  await dialog.getByLabel('Amount to add, in rand').fill('200');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText(/We could not open your bank's payment page\. Nothing was taken from you\./)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole('button', { name: /Bank transfer, checked by a person/ })).toBeVisible();
  await expect(page).not.toHaveURL(BANK_PAGE);
  expect(problems.pageErrors).toEqual([]);
});

test('the choice is closed for this person: the card is the main way exactly as before ("See more" under it, the Paystack note), and the Worker is asked nothing', async ({ page, problems }) => {
  const seen = await openPricePanel(page, { online: 'no', env: 'staging' });
  await expect(page.getByRole('button', { name: SAVE_CARD })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-test-mode]')).toHaveText('Test mode: use a Paystack test card. No real money is taken.');
  await expect(page.locator('[data-wallet-toggle]')).toHaveText(/See more/);
  await expect(page.locator('[data-bank-main]')).toHaveCount(0);
  await expect(page.locator('[data-test-mode-bank]')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(seen.worker.length, 'an ordinary payer costs the Worker no call at all').toBe(0);
  expect(problems.pageErrors).toEqual([]);
});

test('the choice is not built into the database yet: the card is the main way, no error on the page', async ({ page, problems }) => {
  const seen = await openPricePanel(page, { online: 'missing', env: 'staging' });
  await expect(page.getByRole('button', { name: SAVE_CARD })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-bank-main]')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(seen.worker.length).toBe(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  expect(problems.pageErrors).toEqual([]);
});

for (const env of ['not_set_up', 'error', 'old_worker', 'odd', 'down'] as const) {
  test(`the database says yes but the Worker answers "${env}": the card stays the main way, no test note, no error`, async ({ page, problems }) => {
    const seen = await openPricePanel(page, { online: 'yes', env });
    await expect(page.getByRole('button', { name: SAVE_CARD })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => envAsks(seen).length, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await expect(page.locator('[data-bank-main]')).toHaveCount(0);
    await expect(page.locator('[data-test-mode-bank]')).toHaveCount(0);
    await expect(page.locator('[data-wallet-toggle]')).toHaveText(/See more/);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
}
