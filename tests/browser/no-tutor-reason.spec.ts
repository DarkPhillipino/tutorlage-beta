import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// P5-b (CEO, 21 Nov 2026): when a learner's choice has no tutor, the prices page says WHY, in three ways, and what time frames are open. The database
// is answered by this file (the function no_tutor_reason is proved in supabase/tests/no_tutor_reason.sql, not here). Checked in the five profiles:
// the words, the red of case 1 (with an icon and the words), the time frames, "not a promise", the old words when the database cannot answer
// (function missing), no sideways scroll at phone width, and axe (colour contrast included) with no violation.

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';

type Answer = { kind: 'answer'; body: unknown } | { kind: 'missing' } | { kind: 'failing' };

async function openPrices(page: Page, answer: Answer, calls: { args: Record<string, unknown> }[] = []) {
  await signInFake(page);
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const rpc = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(url)?.[1];
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: 'Browser Test', role: 'student', avatar_url: null }]));
    if (rpc === 'my_date_of_birth') return route.fulfill(json('2000-01-01'));
    if (rpc === 'my_pending_acceptances') return route.fulfill(json([]));
    if (rpc === 'card_checkout_available') return route.fulfill(json(true));
    if (rpc === 'available_price_levels') return route.fulfill(json([]));
    if (rpc === 'no_tutor_reason') {
      calls.push({ args: request.postDataJSON() as Record<string, unknown> });
      if (answer.kind === 'missing') return route.fulfill(json({ code: 'PGRST202', message: 'Could not find the function public.no_tutor_reason(p_grade, p_hours, p_start, p_subject) in the schema cache' }, 404));
      if (answer.kind === 'failing') return route.fulfill(json({ code: 'XX000', message: 'boom' }, 500));
      return route.fulfill(json(answer.body));
    }
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'See prices' }).click();
  await expect(page.getByRole('button', { name: /Back to search/ })).toBeVisible({ timeout: 10_000 });
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function axeClean(page: Page, browserName: string) {
  if (browserName !== 'chromium') return;
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} e.g. ${v.nodes[0]?.target.join(' ')}`), 'axe, colour contrast included').toEqual([]);
}

test('case 1: nobody teaches the subject: "No tutor available for this subject." in red, with an icon', async ({ page, browserName, problems }) => {
  const calls: { args: Record<string, unknown> }[] = [];
  await openPrices(page, { kind: 'answer', body: { case: 'no_subject', windows: [] } }, calls);
  const message = page.locator('[data-no-tutor-case="no_subject"]');
  await expect(message).toHaveText('No tutor available for this subject.');
  // Tailwind 4 states its reds as oklch; red-700 is rgb(185, 28, 28), the same colour.
  expect(await message.evaluate((el) => getComputedStyle(el).color), 'red-700').toMatch(/^(rgb\(185, 28, 28\)|oklch\(0\.505 0\.213 27)/);
  expect(await message.locator('svg').count(), 'an icon as well as the words').toBe(1);
  expect(calls.length, 'the function was asked').toBeGreaterThan(0);
  expect(Object.keys(calls[0].args).sort(), 'it is asked for the subject, grade, start and length only').toEqual(['p_grade', 'p_hours', 'p_start', 'p_subject']);
  expect(await noSideways(page)).toBeLessThanOrEqual(0);
  await axeClean(page, browserName);
  expect(problems.pageErrors).toEqual([]);
});

test('case 2: every tutor is booked: "They\'re all fully booked at the moment."', async ({ page, browserName }) => {
  await openPrices(page, { kind: 'answer', body: { case: 'fully_booked', windows: [] } });
  await expect(page.locator('[data-no-tutor-case="fully_booked"]')).toHaveText("They're all fully booked at the moment.");
  await expect(page.getByText('No tutor available for this subject.')).toHaveCount(0);
  expect(await noSideways(page)).toBeLessThanOrEqual(0);
  await axeClean(page, browserName);
});

test('case 3: a tutor is open at other times: the sentence, then the time frames in SAST (online), soonest first, and "not a promise"', async ({ page, browserName }) => {
  const windows = [
    { date: '2026-11-24', from: '10:00', end_date: '2026-11-24', to: '16:00', place: 'online' },
    { date: '2026-11-25', from: '12:00', end_date: '2026-11-25', to: '15:00', place: 'online' },
    { date: '2026-11-26', from: '09:00', end_date: '2026-11-26', to: '24:00', place: 'online' },
  ];
  await openPrices(page, { kind: 'answer', body: { case: 'other_time', windows } });
  const box = page.locator('[data-no-tutor-case="other_time"]');
  await expect(box).toContainText('No tutor is available at the time or date you chose. Please change your time to one of the following time frames:');
  const items = box.getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveText('Tue 24 Nov, 10:00 to 16:00 SAST, online');
  await expect(items.nth(1)).toHaveText('Wed 25 Nov, 12:00 to 15:00 SAST, online');
  await expect(items.nth(2)).toHaveText('Thu 26 Nov, 09:00 to 24:00 SAST, online');
  await expect(box).toContainText('not a promise');
  expect(await noSideways(page)).toBeLessThanOrEqual(0);
  await axeClean(page, browserName);
});

for (const [name, answer] of [['missing (migration not applied yet)', { kind: 'missing' }], ['failing', { kind: 'failing' }], ['unreadable', { kind: 'answer', body: { nonsense: true } }]] as const) {
  test(`the database's answer is ${name}: the page keeps the words it had before, no crash`, async ({ page, problems }) => {
    await openPrices(page, answer);
    await expect(page.getByText('No tutor can take this request yet')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await expect(page.locator('[data-no-tutor-case]')).toHaveCount(0);
    expect(problems.pageErrors).toEqual([]);
  });
}
