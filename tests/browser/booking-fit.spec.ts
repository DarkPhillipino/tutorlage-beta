import { test, expect, signInFake } from './fixtures';

// THE HOME PAGE OF A FAMILY THAT CAME WITH A TUTOR'S CODE (since 25 Nov 2026, PM line 79), database MOCKED (nothing here touches dev or production): the one button goes to that tutor's own
// booking page, and the name is capitalised. The booking page itself, with its refusal and what it never offers, is tests/browser/tutor-link.spec.ts; the database rules are
// supabase/tests/addressed_fit_linked.sql and tutor_page_booking.sql.

const CORS = { 'access-control-allow-origin': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';

test('the home banner capitalises the name and its button opens the booking page of that tutor', async ({ page, problems }) => {
  await signInFake(page);
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: 'Browser Test', role: 'student', avatar_url: null }]));
    if (/\/rpc\/my_date_of_birth/.test(url)) return route.fulfill(json('2000-01-01'));
    if (/\/rpc\/my_pending_acceptances/.test(url) || /\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return route.fulfill(json([]));
    if (/\/rpc\/my_linked_tutor/.test(url)) return route.fulfill(json({ tutor_id: '22222222-2222-4222-8222-222222222222', first_name: 'tessa', code: 'TESSA', hours: 'Saturday, 09:00 to 13:00' }));
    if (/\/rpc\/(public_tutor_page|tutor_booking_page)/.test(url)) {
      return route.fulfill(json({ code: 'TESSA', first_name: 'Tessa', tutor_id: '22222222-2222-4222-8222-222222222222', level_id: '1A', level_name: 'Rising Tutors', price: 50, currency: 'ZAR', subjects: [], hours: null, taking_requests: false }));
    }
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/');
  await expect(page.locator('[data-link-tutor]')).toContainText("You came from Tessa's page.", { timeout: 15_000 });
  await page.getByRole('button', { name: 'Book with Tessa' }).click();
  await expect(page).toHaveURL(/\/t\/TESSA\/book$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Book with Tessa' })).toBeVisible();
  await expect(page.getByText(/any available tutor|Not Tessa/i)).toHaveCount(0);
  expect(problems.pageErrors, 'no uncaught error').toEqual([]);
});
