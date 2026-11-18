import type { Page, Route } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';
import { audit, blocking, PHONE } from './mobile';

// THE TUTOR'S WORKING-HOURS EDITOR (J4, 18 Nov 2026): tick days, one time range, one Save. At 375 x 812 with touch, in chromium, with a database
// answered by this file (a small in-memory table of tutor_availability: nothing real is called). It proves: the CEO's example (Mon to Fri 17:00 to 23:00,
// then Sat and Sun 19:00 to 23:00) takes two Saves and writes seven rows; the screen says the hours repeat every week; the week view shows each day;
// an end before the start is refused in words and writes nothing; overlapping ranges join; "Clear day" and "Remove" take rows away; the screen has no
// sideways scroll, no target under 24 px and no axe violation (WCAG 2.0, 2.1 and 2.2 A and AA) with rows in it and with a message showing.
// Run it on a finished build:  npm run build  then  npx playwright test tests/browser/availability.spec.ts --project=chromium
test.use({ viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'run once, in chromium, at 375 px');
});

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';

interface Row { id: string; tutor_id: string; day_of_week: number; start_time: string; end_time: string }

async function open(page: Page, seed: Row[] = []) {
  const table: Row[] = [...seed];
  const writes: { method: string; body: unknown; url: string }[] = [];
  let next = 100;
  await signInFake(page);
  await page.route(/\.supabase\.co\//, async (route: Route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const rpc = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(url)?.[1];
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: 'Browser Test', role: 'tutor', avatar_url: null }]));
    if (rpc === 'my_date_of_birth') return route.fulfill(json('1985-05-05'));
    if (rpc === 'my_pending_acceptances') return route.fulfill(json([]));
    if (rpc === 'my_needs_surname') return route.fulfill(json(false));
    if (rpc === 'card_checkout_available') return route.fulfill(json(true));
    if (/\/rest\/v1\/tutor_onboarding/.test(url)) return route.fulfill(json({ track: 'qualified', grandfathered: true, consented_at: null, consent_version: null }));
    if (/\/rest\/v1\/tutor_profiles/.test(url)) {
      return route.fulfill(json({ id: ME, headline: 'Maths and science', hourly_rate: 150, currency_code: 'ZAR', is_verified: true, onboarding_status: 'approved', avg_rating: 0, total_reviews_count: 0, total_completed_hours: 0, total_sessions_completed: 0, teaching_mode: 'online', is_dispatch_active: true, current_sub_tier_id: null, repeat_student_rate_pct: 0, avg_grade_uplift_pct: 0, qualified_uplift_students_count: 0, institution_id: null, profiles: { full_name: 'Browser Test', avatar_url: null }, tutor_subject_competencies: [], tier_definitions: null, schools_institutions: null }));
    }
    if (/\/rest\/v1\/tutor_availability/.test(url)) {
      if (request.method() === 'GET') return route.fulfill(json(table.map((r) => ({ id: r.id, day_of_week: r.day_of_week, start_time: r.start_time, end_time: r.end_time }))));
      if (request.method() === 'POST') {
        const body = JSON.parse(request.postData() ?? '[]') as Omit<Row, 'id'>[];
        writes.push({ method: 'POST', body, url });
        for (const b of body) table.push({ ...b, id: `row${next++}`, start_time: `${b.start_time}:00`, end_time: `${b.end_time}:00` });
        return route.fulfill({ status: 201, headers: CORS, body: '' });
      }
      if (request.method() === 'DELETE') {
        const ids = /id=in\.\(([^)]*)\)/.exec(decodeURIComponent(url))?.[1].split(',').map((s) => s.replace(/"/g, '')) ?? [];
        writes.push({ method: 'DELETE', body: ids, url });
        for (const id of ids) { const i = table.findIndex((r) => r.id === id); if (i >= 0) table.splice(i, 1); }
        return route.fulfill({ status: 204, headers: CORS, body: '' });
      }
    }
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/');
  await expect(page.locator('#root h1, #root h2, header').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('header button:has(svg.lucide-user)').click();
  await page.getByRole('button', { name: 'Teaching' }).last().click();
  await expect(page.getByText('Your hours repeat every week until you change them', { exact: false })).toBeVisible({ timeout: 10_000 });
  return { table, writes };
}

const day = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).first(); // the day chips read Mon, Tue ...
const startOf = (page: Page) => page.getByLabel('From');
const endOf = (page: Page) => page.getByLabel('Until');

test('the CEO\'s example: Mon to Fri 17:00 to 23:00, then Sat and Sun 19:00 to 23:00, two Saves, seven rows, repeating every week', async ({ page, problems }) => {
  const { table, writes } = await open(page);
  await expect(page.getByText('No working hours yet')).toBeVisible();

  await page.getByRole('button', { name: 'Weekdays' }).click();
  await startOf(page).selectOption('17:00');
  await endOf(page).selectOption('23:00');
  await expect(page.getByText('Monday to Friday, 17:00 to 23:00, every week.')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Saved: Monday to Friday, 17:00 to 23:00\. This repeats every week/)).toBeVisible();
  expect(table.length).toBe(5);
  expect(writes.filter((w) => w.method === 'POST').length, 'one insert request for the five days').toBe(1);

  await page.getByRole('button', { name: 'Weekends' }).click();
  await startOf(page).selectOption('19:00');
  await endOf(page).selectOption('23:00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Saved: Saturday and Sunday, 19:00 to 23:00/)).toBeVisible();
  expect(table.length).toBe(7);
  const week = page.getByLabel('Your week');
  await expect(week.getByText('17:00 to 23:00')).toHaveCount(5);
  await expect(week.getByText('19:00 to 23:00')).toHaveCount(2);
  expect(problems.pageErrors).toEqual([]);

  const record = await audit(page, 'availability-with-rows');
  expect(blocking(record), 'availability editor with seven days of hours: no overflow, no small target, no axe violation').toEqual([]);
});

test('an end before the start is refused in words and writes nothing; no ticked day is refused too', async ({ page }) => {
  const { table, writes } = await open(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Tick at least one day.');
  await day(page, 'Mon').click();
  await startOf(page).selectOption('17:00');
  await endOf(page).selectOption('09:30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('The end time must be after the start time.');
  expect(table.length).toBe(0);
  expect(writes.length).toBe(0);
  const record = await audit(page, 'availability-with-error');
  expect(blocking(record), 'with the error showing').toEqual([]);
});

test('overlapping ranges join into one; Clear day and Remove take rows away; Change replaces one range', async ({ page }) => {
  const seed: Row[] = [
    { id: 'a1', tutor_id: ME, day_of_week: 1, start_time: '09:00:00', end_time: '12:00:00' },
    { id: 'a2', tutor_id: ME, day_of_week: 1, start_time: '14:00:00', end_time: '16:00:00' },
    { id: 'a3', tutor_id: ME, day_of_week: 2, start_time: '09:00:00', end_time: '12:00:00' },
  ];
  const { table } = await open(page, seed);
  const week = page.getByLabel('Your week');
  await expect(week.getByText('09:00 to 12:00')).toHaveCount(2);

  // Monday 11:00 to 15:00 overlaps both Monday ranges: one row 09:00 to 16:00 is left, Tuesday is untouched.
  await day(page, 'Mon').click();
  await startOf(page).selectOption('11:00');
  await endOf(page).selectOption('15:00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Saved: Monday, 11:00 to 15:00/)).toBeVisible();
  expect(table.filter((r) => r.day_of_week === 1).map((r) => `${r.start_time}-${r.end_time}`)).toEqual(['09:00:00-16:00:00']);
  expect(table.filter((r) => r.day_of_week === 2).length).toBe(1);

  // Change Tuesday's range to 10:00 to 13:00.
  await page.getByRole('button', { name: 'Change Tuesday 09:00 to 12:00' }).click();
  await expect(page.getByText('Change Tuesday 09:00 to 12:00', { exact: true }).first()).toBeVisible();
  await startOf(page).selectOption('10:00');
  await endOf(page).selectOption('13:00');
  await page.getByRole('button', { name: 'Save change' }).click();
  await expect(page.getByText(/Saved: Tuesday, 10:00 to 13:00/)).toBeVisible();
  expect(table.filter((r) => r.day_of_week === 2).map((r) => `${r.start_time}-${r.end_time}`)).toEqual(['10:00:00-13:00:00']);

  // Remove Monday's range, in one tap.
  await page.getByRole('button', { name: 'Remove Monday 09:00 to 16:00' }).click();
  await expect(page.getByText('Removed Monday 09:00 to 16:00.')).toBeVisible();
  expect(table.filter((r) => r.day_of_week === 1).length).toBe(0);

  // Clear everything: needs a second tap.
  await page.getByRole('button', { name: 'Clear all days' }).click();
  await page.getByRole('button', { name: 'Yes, clear all' }).click();
  await expect(page.getByText('All your working hours were cleared.')).toBeVisible();
  expect(table.length).toBe(0);
});
