import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// THE SUGGESTIONS BOX AND THE TOP-UP PILOT NOTICE (CEO, 5 Nov 2026), the part a browser can show with the database MOCKED (nothing here touches dev or
// production):
//  - a signed-in student sees the Suggestions box on the learn page just above the footer, and the old five-card grid is headed "Ways to learn";
//    from 9 Nov 2026 the same box is on the Teach page too (both sides);
//  - the box sends exactly { user_id, body } to platform_suggestions, shows the thank-you, keeps the text when the database refuses (5 a day, table not
//    there yet), and is not on the other screens (wallet, sessions, prices);
//  - with the wallet "open" (made-up answers): the wallet page and the Add-money window show the pilot notice (built-in words, the row's own times,
//    or nothing when switched off) and a top-up that has its proof says "Sent 14:05 SAST, waiting for a person to check it".
// What this does NOT show: the database rules (supabase/tests/platform_suggestions.sql), the admin page, or a real upload.

const CORS = { 'access-control-allow-origin': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';
const TOPUP = '11111111-1111-4111-8111-111111111111';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const rowsOrOne = (route: Route, list: unknown[]) => {
  const wantsOne = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  return route.fulfill(wantsOne ? json(list[0] ?? null, list.length ? 200 : 406) : json(list));
};

interface Sent { method: string; url: string; body: string }

// A signed-in student. `suggestion` says how the database answers a send; `notice` how it answers the pilot-notice question; `wallet` opens the wallet.
async function openAsStudent(
  page: Page,
  opts: { suggestion?: 'ok' | 'limit' | 'missing'; notice?: 'default' | 'custom' | 'off' | 'missing'; wallet?: boolean; sent?: Sent[] } = {},
) {
  const { suggestion = 'ok', notice = 'default', wallet = false, sent = [] } = opts;
  await signInFake(page);
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: 'Browser Test', role: 'student', avatar_url: null }]));
    if (/\/rpc\/my_date_of_birth/.test(url)) return route.fulfill(json('2000-01-01'));
    if (/\/rpc\/my_pending_acceptances/.test(url) || /\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return route.fulfill(json([]));

    if (/\/rest\/v1\/platform_suggestions/.test(url)) {
      sent.push({ method: request.method(), url, body: request.postData() ?? '' });
      if (suggestion === 'limit') return route.fulfill(json({ code: '54000', message: 'You can send up to 5 suggestions a day. Please try again tomorrow.' }, 400));
      if (suggestion === 'missing') return route.fulfill(json({ code: 'PGRST205', message: "Could not find the table 'public.platform_suggestions' in the schema cache" }, 404));
      return route.fulfill({ status: 201, headers: CORS, body: '' });
    }

    if (/\/rpc\/topup_pilot_notice/.test(url)) {
      if (notice === 'missing') return route.fulfill(json({ code: 'PGRST202', message: 'Could not find the function public.topup_pilot_notice in the schema cache' }, 404));
      if (notice === 'custom') return route.fulfill(json({ enabled: true, times: '2 hours, 08:00 to 18:00' }));
      if (notice === 'off') return route.fulfill(json({ enabled: false }));
      return route.fulfill(json(null));
    }

    const walletCall = /\/rpc\/(wallet_|create_wallet_topup|attach_topup_proof|cancel_my_topup|send_request_wallet)|\/rest\/v1\/(wallets|wallet_topups|wallet_ledger|payout_requests)|\/storage\/v1\/object\/payment-proofs\//.test(url);
    if (walletCall) {
      if (!wallet) return /\/rpc\/wallet_open/.test(url) ? route.fulfill(json(false)) : rowsOrOne(route, []);
      if (/\/rpc\/wallet_open/.test(url)) return route.fulfill(json(true));
      if (/\/rpc\/wallet_payment_details/.test(url)) return route.fulfill(json({ open: true, bank_name: 'Test Bank', account_holder: 'Tutorlage (Pty) Ltd', account_number: '1234567890', branch_code: '250655', account_type: 'Cheque', min_rand: 50, max_rand: 5000, cap_rand: 10000 }));
      if (/\/rpc\/create_wallet_topup/.test(url)) return route.fulfill(json({ topup_id: TOPUP, reference: 'TL-ABC234', amount_rand: 200, status: 'awaiting_proof' }));
      if (/\/rpc\/attach_topup_proof/.test(url)) return route.fulfill(json(null));
      if (/\/storage\/v1\/object\/payment-proofs\//.test(url)) return route.fulfill(json({ Key: `payment-proofs/${ME}/${TOPUP}.png` }));
      if (/\/rest\/v1\/wallets/.test(url)) return rowsOrOne(route, [{ available_rand: 320, held_rand: 0 }]);
      if (/\/rest\/v1\/wallet_topups/.test(url)) {
        return rowsOrOne(route, [
          { id: 't1', reference: 'TL-WAIT22', amount_rand: 300, status: 'proof_sent', received_rand: null, decision_comment: null, created_at: '2026-11-03T11:50:00Z', decided_at: null, proof_attached_at: '2026-11-03T12:05:00Z' },
        ]);
      }
      return rowsOrOne(route, []);
    }
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/');
  await expect(page.locator('header').getByText('Tutorlage').first()).toBeVisible({ timeout: 15_000 });
}

const BOX = '[data-platform-suggestion-box]';

test('the Suggestions box sits just above the footer on the learn page, and the old grid is headed "Ways to learn"', async ({ page, problems }) => {
  await openAsStudent(page);
  const box = page.locator(BOX);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await expect(box.getByRole('heading', { name: 'Suggestions', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ways to learn', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Suggestions', exact: true })).toHaveCount(1);
  await expect(box.getByText("Please don't include other people's personal details.")).toBeVisible();
  await expect(box.getByRole('button', { name: 'Send suggestion' })).toBeDisabled();
  const boxY = (await box.boundingBox())!.y;
  const footerY = (await page.locator('footer').last().boundingBox())!.y;
  expect(boxY, 'the box is above the footer').toBeLessThan(footerY);
  const gridY = (await page.getByRole('heading', { name: 'Ways to learn', exact: true }).boundingBox())!.y;
  expect(boxY, 'and below the five cards').toBeGreaterThan(gridY);
  expect(problems.pageErrors).toEqual([]);
});

test('sending: exactly user_id and body go to platform_suggestions, then the thank-you; "Send another" brings the box back', async ({ page, problems }) => {
  const sent: Sent[] = [];
  await openAsStudent(page, { sent });
  const box = page.locator(BOX);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.getByLabel('Your suggestion').fill('  Please add more Afrikaans tutors  ');
  await expect(box.getByText('/ 1000')).toBeVisible();
  await box.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(box.locator('[data-suggestion-sent]')).toBeVisible({ timeout: 15_000 });
  await expect(box.getByText('Thank you. Your suggestion has been sent to the Tutorlage team.')).toBeVisible();
  await expect(box.getByLabel('Your suggestion')).toHaveCount(0);
  expect(sent.length, 'one request to platform_suggestions').toBe(1);
  expect(sent[0].method).toBe('POST');
  expect(JSON.parse(sent[0].body)).toEqual({ user_id: ME, body: 'Please add more Afrikaans tutors' });
  await box.getByRole('button', { name: 'Send another suggestion' }).click();
  await expect(box.getByLabel('Your suggestion')).toHaveValue('');
  expect(problems.pageErrors).toEqual([]);
});

test('the 5-a-day refusal is said in plain words and the text stays in the box', async ({ page }) => {
  await openAsStudent(page, { suggestion: 'limit' });
  const box = page.locator(BOX);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.getByLabel('Your suggestion').fill('One more idea');
  await box.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(box.getByRole('alert')).toHaveText('You can send up to 5 suggestions a day. Please try again tomorrow.');
  await expect(box.getByLabel('Your suggestion')).toHaveValue('One more idea');
  await expect(box.locator('[data-suggestion-sent]')).toHaveCount(0);
});

test('before the database change is applied the person is told it is not open yet, and keeps what they wrote', async ({ page }) => {
  await openAsStudent(page, { suggestion: 'missing' });
  const box = page.locator(BOX);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.getByLabel('Your suggestion').fill('An idea');
  await box.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(box.getByRole('alert')).toHaveText('Suggestions are not open yet. Please try again later.');
  await expect(box.getByLabel('Your suggestion')).toHaveValue('An idea');
});

test('the box is on both sides, the learn page and the Teach page (same box, same sending), and on no other screen', async ({ page, problems, isMobile }) => {
  test.skip(isMobile, 'the tab bar is not shown on a phone (signed-in.spec.ts skips its tab walk there for the same reason)');
  const sent: Sent[] = [];
  await openAsStudent(page, { sent, wallet: true });
  await expect(page.locator(BOX)).toBeVisible({ timeout: 15_000 });
  await page.locator('header nav').getByRole('button', { name: 'Teach', exact: true }).click();
  const box = page.locator(BOX);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(box.getByRole('heading', { name: 'Suggestions', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Suggestions', exact: true })).toHaveCount(1);
  const boxY = (await box.boundingBox())!.y;
  const footerY = (await page.locator('footer').last().boundingBox())!.y;
  expect(boxY, 'the box is above the footer on the Teach page too').toBeLessThan(footerY);
  await box.getByLabel('Your suggestion').fill('A Teach-side idea');
  await box.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(box.locator('[data-suggestion-sent]')).toBeVisible({ timeout: 15_000 });
  expect(sent.length, 'one request to platform_suggestions').toBe(1);
  expect(JSON.parse(sent[0].body)).toEqual({ user_id: ME, body: 'A Teach-side idea' });
  // Not on another screen: the wallet page has no box.
  await page.locator('[data-wallet-chip]').click();
  await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(BOX)).toHaveCount(0);
  await page.locator('header nav').getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(page.locator(BOX)).toBeVisible();
  expect(problems.pageErrors).toEqual([]);
});

test('axe finds no WCAG A/AA violation in the Suggestions box (empty, with an error, and after sending) or in the pilot notice', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'axe is run in chromium (desktop and the Android phone profile); the markup is the same in every browser');
  await openAsStudent(page, { suggestion: 'limit', wallet: true });
  const scan = async (selector: string, what: string) => {
    const results = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
    expect(summary, `${what}: ${results.passes.length} rules passed`).toEqual([]);
  };
  const box = page.locator(BOX);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await scan(BOX, 'the empty box');
  await box.getByLabel('Your suggestion').fill('One more idea');
  await box.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(box.getByRole('alert')).toBeVisible();
  await scan(BOX, 'the box with a refusal');
  await page.locator('[data-wallet-chip]').click();
  await expect(page.locator('[data-pilot-notice]')).toBeVisible({ timeout: 15_000 });
  await scan('[data-pilot-notice]', 'the pilot notice');
  await scan('[data-waiting-line]', 'the waiting line');
});

test('typed tags are never rendered: the markup stays text', async ({ page }) => {
  const sent: Sent[] = [];
  await openAsStudent(page, { sent });
  const box = page.locator(BOX);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.getByLabel('Your suggestion').fill('<img src=x onerror=window.__pwned=1><b>bold</b>');
  await expect(box.locator('img, b')).toHaveCount(0);
  await box.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(box.locator('[data-suggestion-sent]')).toBeVisible({ timeout: 15_000 });
  expect(JSON.parse(sent[0].body).body).toBe('<img src=x onerror=window.__pwned=1><b>bold</b>');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

for (const [notice, expected] of [
  ['default', 'Tutorlage is in its pilot, so every bank transfer is checked by a person: usually within 6 hours (08:00 to 20:00; a transfer sent later is checked by 10:00 the next morning). We are building instant payments. A tutor is only paid after your session is complete.'],
  ['missing', 'Tutorlage is in its pilot, so every bank transfer is checked by a person: usually within 6 hours (08:00 to 20:00; a transfer sent later is checked by 10:00 the next morning). We are building instant payments. A tutor is only paid after your session is complete.'],
  ['custom', 'Tutorlage is in its pilot, so every bank transfer is checked by a person: usually within 2 hours, 08:00 to 18:00. We are building instant payments. A tutor is only paid after your session is complete.'],
] as const) {
  test(`wallet open, notice "${notice}": the wallet page, the Add-money window and the waiting line`, async ({ page, problems }) => {
    await openAsStudent(page, { wallet: true, notice });
    const chip = page.locator('[data-wallet-chip]');
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.click();
    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-pilot-notice]')).toHaveText(expected);
    await expect(page.locator('[data-waiting-line]')).toHaveText(/^Sent .*14:05 SAST, waiting for a person to check it$/);
    await expect(page.getByText('Proof sent. We are checking your transfer, usually within one business day.')).toHaveCount(0);
    // The older "We check transfers by hand. You could receive your money within one business day..." is retired (9 Nov): no second time on the page.
    await expect(page.getByText(/one business day/)).toHaveCount(0);
    await expect(page.getByText('If it is taking too long, please contact support by clicking the Help button at the top of the page.')).toBeVisible();

    await page.getByRole('button', { name: 'Add money' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add money to your wallet' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-pilot-notice]')).toHaveText(expected);
    await dialog.getByLabel('Amount to add, in rand').fill('200');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('TL-ABC234').first()).toBeVisible();
    await expect(dialog.locator('[data-pilot-notice]')).toHaveText(expected);
    await dialog.getByLabel('Proof of payment').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG_BYTES });
    await dialog.getByRole('button', { name: 'Send proof of payment' }).click();
    await expect(dialog.locator('[data-proof-sent]')).toBeVisible();
    await expect(dialog.locator('[data-waiting-line]')).toHaveText(/^Sent \d\d:\d\d SAST, waiting for a person to check it$/);
    // The sent step carries the pilot notice (the one place the waiting time is written); the retired "within one business day" sentence is gone.
    await expect(dialog.locator('[data-pilot-notice]')).toHaveText(expected);
    await expect(dialog.getByText(/business day/)).toHaveCount(0);
    await expect(dialog.getByText('If it is taking too long, please contact support by clicking the Help button at the top of the page.')).toBeVisible();
    expect(problems.pageErrors).toEqual([]);
  });
}

test('wallet open, notice switched off in the row: no notice anywhere, the rest is unchanged', async ({ page }) => {
  await openAsStudent(page, { wallet: true, notice: 'off' });
  await page.locator('[data-wallet-chip]').click();
  await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-wallet-balance]')).toContainText('R320');
  await expect(page.locator('[data-pilot-notice]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add money' }).click();
  await expect(page.getByRole('dialog', { name: 'Add money to your wallet' })).toBeVisible();
  await expect(page.locator('[data-pilot-notice]')).toHaveCount(0);
});

test('wallet closed: no pilot notice and nothing about top-ups on the learn page', async ({ page }) => {
  await openAsStudent(page, { wallet: false });
  await page.waitForTimeout(800);
  await expect(page.locator('[data-pilot-notice]')).toHaveCount(0);
  await expect(page.getByText(/Add money|waiting for a person to check it/)).toHaveCount(0);
});
