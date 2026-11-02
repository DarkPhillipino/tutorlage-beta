import type { Page } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// SA-LOCALE-01 (CEO, 1 Nov 2026): a session time is shown in South African time and says SAST, whatever zone the browser is in; money is in
// whole rands. A made-up signed-in student (never accepted by any server) whose browser is set to NEW YORK time, with one booked session at
// 12:00 UTC (14:00 SAST) and one bell notice. What this does NOT show: a tutor's screens, the booking form, the database's own notice text.
const CORS = { 'access-control-allow-origin': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

test.use({ timezoneId: 'America/New_York', locale: 'en-US' });

async function openAsStudentWithOneSession(page: Page) {
  await signInFake(page);
  const startsAt = new Date(Date.now() + 3 * 86_400_000);
  startsAt.setUTCHours(12, 0, 0, 0); // 14:00 in South Africa, 08:00 in New York
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: '00000000-0000-4000-8000-000000000001', full_name: 'Browser Test', role: 'student', avatar_url: null }]));
    if (/\/rpc\/my_date_of_birth/.test(url)) return route.fulfill(json('2000-01-01'));
    if (/\/rpc\/my_pending_acceptances/.test(url) || /\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return route.fulfill(json([]));
    if (/\/rest\/v1\/sessions\?/.test(url)) {
      return route.fulfill(json([{
        id: '00000000-0000-4000-8000-0000000000aa',
        scheduled_start: startsAt.toISOString(),
        duration_hours: 1.5,
        status: 'scheduled',
        meeting_url: null,
        tutor_profiles: { profiles: { full_name: 'Test Tutor' } },
        student_subject_enrollments: { subject_name: 'Mathematics' },
      }]));
    }
    if (/\/rest\/v1\/notifications\?/.test(url)) {
      return route.fulfill(json([{ id: 'n1', type: 'session_booked', title: 'You have an upcoming session', body: 'Session with Aisha (Maths), Fri 20 Nov 14:00 SAST. Open Sessions.', created_at: '2026-11-01T22:30:00.000Z', read_at: null }]));
    }
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/');
  await expect(page.locator('header').getByText('Tutorlage').first()).toBeVisible({ timeout: 15_000 });
}

test('signed-in student in New York: the booked session says 14:00 SAST, the bell says SAST, no rand amount shows .00', async ({ page, isMobile, problems }) => {
  test.skip(isMobile, 'the tab buttons are in the desktop header (hidden on a phone)');
  await openAsStudentWithOneSession(page);
  // The "You have 1 upcoming session" line under the welcome opens the list of booked sessions.
  await page.getByRole('button', { name: /upcoming session/ }).click();
  await expect(page.getByText(/14:00 SAST · 1\.5h/), 'the session at 12:00 UTC reads 14:00 SAST while the browser is on New York time').toBeVisible();
  const body = await page.evaluate(() => document.body.innerText);
  expect(body).not.toMatch(/08:00/); // New York's reading of the same moment
  expect(body).not.toMatch(/R\s?\d+\.00\b/);

  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByText(/Sun 1 Nov, 00:30 SAST|Mon 2 Nov, 00:30 SAST/)).toBeVisible();
  expect(problems.pageErrors).toEqual([]);
  await page.screenshot({ path: 'test-results/sa-time-bell.png' });
});
