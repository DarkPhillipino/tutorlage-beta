import type { Page, Route } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// WALLETS (CEO, 2 Nov 2026), phase 3, the part a browser can show with the database MOCKED (nothing here touches dev or production, and the
// wallet switch is never turned on anywhere):
//  - the page a learner lands on after a request is paid from the wallet says so and claims no card check;
//  - with the wallet closed, or its functions missing from the database, the signed-in app shows nothing new and does not crash;
//  - with the wallet "open" (the database answers are made up here): the header chip, the Wallet page (balance, on hold, top-ups in words,
//    history in words), Add money -> the reference and bank details -> the proof file is sent -> the 24-hour wording.
// What this does NOT show: a real upload into the private bucket, the booking click-through with a wallet, any tutor screen, the database rules.

const CORS = { 'access-control-allow-origin': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';
const TOPUP = '11111111-1111-4111-8111-111111111111';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

// A list answer, or one object when the client asked for a single row (maybeSingle / single).
const rowsOrOne = (route: Route, list: unknown[]) => {
  const wantsOne = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  return route.fulfill(wantsOne ? json(list[0] ?? null, list.length ? 200 : 406) : json(list));
};

type Wallet = 'closed' | 'missing' | 'open';

async function openAsStudent(page: Page, wallet: Wallet, seen: string[] = []) {
  await signInFake(page);
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    seen.push(`${request.method()} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
    // The person's own profile and the account gate's questions are always answered, so the app is let in.
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: 'Browser Test', role: 'student', avatar_url: null }]));
    if (/\/rpc\/my_date_of_birth/.test(url)) return route.fulfill(json('2000-01-01'));
    if (/\/rpc\/my_pending_acceptances/.test(url) || /\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return route.fulfill(json([]));
    // The wallet's own questions.
    const walletCall = /\/rpc\/(wallet_|create_wallet_topup|attach_topup_proof|cancel_my_topup|send_request_wallet)|\/rest\/v1\/(wallets|wallet_topups|wallet_ledger|payout_requests)|\/storage\/v1\/object\/payment-proofs\//.test(url);
    if (walletCall) {
      if (wallet === 'missing') return route.fulfill(json({ code: 'PGRST202', message: 'Could not find the function in the schema cache' }, 404));
      if (wallet === 'closed') return /\/rpc\/wallet_open/.test(url) ? route.fulfill(json(false)) : rowsOrOne(route, []);
      if (/\/rpc\/wallet_open/.test(url)) return route.fulfill(json(true));
      if (/\/rpc\/wallet_payment_details/.test(url)) return route.fulfill(json({ open: true, bank_name: 'Test Bank', account_holder: 'Tutorlage (Pty) Ltd', account_number: '1234567890', branch_code: '250655', account_type: 'Cheque', min_rand: 50, max_rand: 5000, cap_rand: 10000 }));
      if (/\/rpc\/create_wallet_topup/.test(url)) return route.fulfill(json({ topup_id: TOPUP, reference: 'TL-ABC234', amount_rand: 200, status: 'awaiting_proof' }));
      if (/\/rpc\/attach_topup_proof/.test(url)) return route.fulfill(json(null));
      if (/\/storage\/v1\/object\/payment-proofs\//.test(url)) return route.fulfill(json({ Key: `payment-proofs/${ME}/${TOPUP}.png` }));
      if (/\/rest\/v1\/wallets/.test(url)) return rowsOrOne(route, [{ available_rand: 320, held_rand: 180 }]);
      if (/\/rest\/v1\/wallet_topups/.test(url)) {
        return rowsOrOne(route, [
          { id: 't2', reference: 'TL-NOPE22', amount_rand: 100, status: 'unsuccessful', received_rand: null, decision_comment: 'No payment with that reference', created_at: '2026-11-03T08:00:00Z', decided_at: '2026-11-03T09:00:00Z' },
          { id: 't1', reference: 'TL-OKAY22', amount_rand: 500, status: 'successful', received_rand: 500, decision_comment: null, created_at: '2026-11-02T08:00:00Z', decided_at: '2026-11-02T09:00:00Z' },
        ]);
      }
      if (/\/rest\/v1\/wallet_ledger/.test(url)) {
        return rowsOrOne(route, [
          { id: 'l2', kind: 'hold', available_delta: -180, held_delta: 180, request_id: 'r1', session_id: null, note: null, created_at: '2026-11-03T10:00:00Z' },
          { id: 'l1', kind: 'topup', available_delta: 500, held_delta: 0, request_id: null, session_id: null, note: null, created_at: '2026-11-02T09:00:00Z' },
        ]);
      }
      return rowsOrOne(route, []);
    }
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/');
  await expect(page.locator('header').getByText('Tutorlage').first()).toBeVisible({ timeout: 15_000 });
}

test('after a request paid from the wallet: "Request sent", the price is on hold, no card check mentioned', async ({ page, problems }) => {
  await page.goto('/payment/callback?wallet=1');
  await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/on hold in your wallet/)).toBeVisible();
  await expect(page.getByText(/R1 card check|Checking your card|Paystack|Free for now/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to Tutorlage' })).toBeVisible();
  expect(problems.pageErrors, 'no uncaught error').toEqual([]);
});

test('the free-session page and the card return are unchanged', async ({ page }) => {
  await page.goto('/payment/callback?free=1');
  await expect(page.getByText("Free for now: you won't be charged.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/on hold in your wallet/)).toHaveCount(0);
});

for (const wallet of ['closed', 'missing'] as const) {
  test(`signed-in student, wallet ${wallet}: no wallet chip, no wallet text, no crash`, async ({ page, problems }) => {
    await openAsStudent(page, wallet);
    await page.waitForTimeout(800);
    await expect(page.locator('[data-wallet-chip]')).toHaveCount(0);
    await expect(page.getByText(/Your wallet|Add money|Wallet/)).toHaveCount(0);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
  });
}

test('signed-in student, wallet open: chip -> Wallet page (balance, on hold, top-ups and history in words) -> Add money -> reference -> proof sent', async ({ page, problems }) => {
  const seen: string[] = [];
  await openAsStudent(page, 'open', seen);
  const chip = page.locator('[data-wallet-chip]');
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await expect(chip).toContainText('R320', { timeout: 15_000 });
  await chip.click();

  await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-wallet-balance]')).toContainText('R320', { timeout: 15_000 });
  await expect(page.locator('[data-wallet-balance]')).toContainText('R180 on hold');
  await expect(page.getByText('Money in your wallet is for lessons. To take it out, contact support.')).toBeVisible();
  await expect(page.getByText('Not received: No payment with that reference')).toBeVisible();
  await expect(page.getByText('Added to your wallet', { exact: true })).toBeVisible();
  await expect(page.locator('[data-wallet-history]')).toContainText('On hold for your request');
  await expect(page.locator('[data-wallet-history]')).toContainText('Top-up added');

  await page.getByRole('button', { name: 'Add money' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add money to your wallet' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Amount to add, in rand').fill('10');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText('Add between R50 and R5000 at a time.')).toBeVisible();
  await dialog.getByLabel('Amount to add, in rand').fill('200');
  await dialog.getByRole('button', { name: 'Continue' }).click();

  await expect(dialog.getByText('TL-ABC234').first()).toBeVisible();
  await expect(dialog.getByText('Test Bank')).toBeVisible();
  await expect(dialog.getByText('1234567890')).toBeVisible();
  // A text file pretending to be a PDF is refused before anything is sent.
  await dialog.getByLabel('Proof of payment').setInputFiles({ name: 'proof.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is only text') });
  await expect(dialog.getByText('Send the proof as a PDF, JPG or PNG file.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send proof of payment' })).toBeDisabled();
  // A real PNG header is accepted: upload first, then the database is told.
  await dialog.getByLabel('Proof of payment').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG_BYTES });
  await dialog.getByRole('button', { name: 'Send proof of payment' }).click();
  await expect(dialog.locator('[data-proof-sent]')).toBeVisible();
  // The older "We check transfers by hand. You could receive your money within one business day..." is retired (9 Nov 2026): the pilot notice holds the time.
  await expect(dialog.getByText(/business day/)).toHaveCount(0);
  await expect(dialog.getByText(/Help button at the top of the page/)).toBeVisible();

  const upload = seen.findIndex((s) => s.startsWith('POST') && s.includes(`/storage/v1/object/payment-proofs/${ME}/${TOPUP}.png`));
  const attach = seen.findIndex((s) => s.includes('/rpc/attach_topup_proof'));
  expect(upload, 'the file is uploaded to the payer\'s own folder').toBeGreaterThan(-1);
  expect(attach, 'the database is told after the upload').toBeGreaterThan(upload);
  expect(problems.pageErrors).toEqual([]);
});
