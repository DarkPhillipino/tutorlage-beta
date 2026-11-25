import type { Page } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// THE BOOKING-TIME GAP (JOB FIT, 25 Nov 2026), the part a browser can show with the database MOCKED (nothing here touches dev or production): a learner who came
// from a tutor's link sees the tutor's working hours beside "Booking with", is told plainly when the database refuses the request, and has one tap to change the
// time or to send the same request to any available tutor. What this does NOT show: the database rule itself (supabase/tests/addressed_fit_linked.sql does).

const CORS = { 'access-control-allow-origin': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';
const TUTOR = '22222222-2222-4222-8222-222222222222';
const HOURS = 'Saturday and Sunday, 09:00 to 13:00';
const REFUSAL = "This tutor isn't available at that time. Choose another time, or send the request to any available tutor.";

interface Seen { inserts: Record<string, unknown>[]; sends: unknown[] }

async function openBooking(page: Page, opts: { others: number; refuseAt: 'insert' | 'send' }): Promise<Seen> {
  const seen: Seen = { inserts: [], sends: [] };
  await signInFake(page);
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: 'Browser Test', role: 'student', avatar_url: null }]));
    if (/\/rpc\/my_date_of_birth/.test(url)) return route.fulfill(json('2000-01-01'));
    if (/\/rpc\/my_pending_acceptances/.test(url) || /\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return route.fulfill(json([]));
    if (/\/rpc\/my_linked_tutor/.test(url)) return route.fulfill(json({ tutor_id: TUTOR, first_name: 'Tessa', hours: HOURS }));
    if (/\/rpc\/card_checkout_available/.test(url)) return route.fulfill(json(false));
    if (/\/rpc\/wallet_open/.test(url)) return route.fulfill(json(true));
    if (/\/rpc\/wallet_online_available/.test(url)) return route.fulfill(json(false));
    if (/\/rest\/v1\/wallets/.test(url)) {
      const one = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      const row = { available_rand: 900, held_rand: 0 };
      return route.fulfill(json(one ? row : [row]));
    }
    if (/\/rpc\/available_price_levels/.test(url)) return route.fulfill(json(opts.others > 0 ? [{ level_id: '1A', tier_id: 1, tier_name: 'Starter', price: 100, currency_code: 'ZAR', tutors: opts.others }] : []));
    if (/\/rest\/v1\/sub_tier_definitions/.test(url)) {
      return route.fulfill(json([{ id: '1A', tier_id: 1, max_allowed_rate: 100, min_hours: 0, min_rating: 0, min_repeat_rate_pct: 0, min_written_reviews: 0, min_distinct_students_uplift: 0, required_grade_uplift_pct: 0, tier_definitions: { public_name: 'Starter', positioning_quote: '', currency_code: 'ZAR' } }]));
    }
    if (/\/rest\/v1\/session_requests/.test(url) && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      seen.inserts.push(body);
      if (body.requested_tutor_id && opts.refuseAt === 'insert') return route.fulfill(json({ code: 'P0001', message: REFUSAL, details: null, hint: null }, 400));
      const row = { id: `33333333-3333-4333-8333-33333333333${seen.inserts.length}`, requested_start: body.requested_start, charged_amount: 100 };
      return route.fulfill(json((request.headers()['accept'] ?? '').includes('vnd.pgrst.object') ? row : [row], 201));
    }
    if (/\/rpc\/send_request_wallet/.test(url)) {
      seen.sends.push(request.postDataJSON());
      if (opts.refuseAt === 'send' && seen.sends.length === 1) return route.fulfill(json({ code: 'P0001', message: REFUSAL, details: 'addressed_tutor', hint: null }, 400));
      return route.fulfill(json({ mode: 'wallet', held_rand: 100 }));
    }
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Book with Tessa' }).click({ timeout: 15_000 });
  return seen;
}

async function chooseAndPay(page: Page) {
  await page.locator('[data-level="1A"]').click();
  await page.getByRole('button', { name: /Pay R100 from your credit/ }).click();
}

test('from the link: the working hours show; a refused time is told plainly, nothing is sent, and one tap sends it to any available tutor', async ({ page, problems }) => {
  const seen = await openBooking(page, { others: 2, refuseAt: 'insert' });
  await expect(page.locator('[data-tutor-hours]')).toHaveText(`Tessa's working hours (South African time): ${HOURS}.`);
  await chooseAndPay(page);
  const box = page.locator('[data-addressed-refusal]');
  await expect(page.getByRole('alert')).toContainText(REFUSAL);
  await expect(box).toContainText('Nothing was sent and no credit was held.');
  await expect(box.getByRole('button', { name: 'Change the time' })).toBeVisible();
  await expect(page.getByRole('alert')).toBeInViewport();
  expect(seen.sends, 'no credit asked for after a refusal').toHaveLength(0);
  await box.getByRole('button', { name: 'Send to any available tutor' }).click();
  await expect.poll(() => seen.sends.length).toBe(1);
  expect(seen.inserts).toHaveLength(2);
  expect(seen.inserts[0].requested_tutor_id).toBe(TUTOR);
  expect(seen.inserts[1]).not.toHaveProperty('requested_tutor_id');
  await expect(page).toHaveURL(/payment\/callback\?wallet=1/);
  expect(problems.pageErrors, 'no uncaught error').toEqual([]);
});

test('refused at the moment of sending: the same plain words and choices; "Change the time" opens the schedule', async ({ page }) => {
  const seen = await openBooking(page, { others: 1, refuseAt: 'send' });
  await chooseAndPay(page);
  const box = page.locator('[data-addressed-refusal]');
  await expect(box).toContainText('Nothing was sent and no credit was held.');
  await box.getByRole('button', { name: 'Change the time' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(seen.inserts).toHaveLength(1);
});

test('no other tutor counted: no send to anyone is offered, only a new time or the other options', async ({ page }) => {
  const seen = await openBooking(page, { others: 0, refuseAt: 'insert' });
  await chooseAndPay(page);
  const box = page.locator('[data-addressed-refusal]');
  await expect(box.getByRole('button', { name: 'Send to any available tutor' })).toHaveCount(0);
  await expect(box.getByRole('button', { name: 'See other options' })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Change the time' })).toBeVisible();
  expect(seen.sends).toHaveLength(0);
});
