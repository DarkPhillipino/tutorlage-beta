import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// THE WAITING LIST IS THE FIRST STAGE OF SIGN-UP (CEO, 17 Nov 2026). Hermetic: every database answer is made here (nothing real is called).
//  * the join form (/teach) asks first name, surname and a date of birth, refuses under 18 the way the sign-up does, and sends them;
//  * the personal link (/signup/tutor?k=<token>) fills the tutor sign-up from what the database answers, ticks nothing, leaves the password to the person;
//  * an older row (no surname, no date of birth), a bad or used token, a failing database, no token and a learner or parent page all behave as the plain sign-up does.

const TOKEN = '0123456789abcdef0123456789abcdef';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const FULL = { first_name: 'Thandi', surname: 'Nkosi', email: 'thandi@example.invalid', phone: '0821234567', date_of_birth: '1995-03-02' };

// Answers one database function (a POST to /rest/v1/rpc/<name>); returns the bodies it was called with.
async function answerRpc(page: Page, name: string, answer: () => { status?: number; body: unknown; delayMs?: number }): Promise<{ bodies: unknown[] }> {
  const seen: { bodies: unknown[] } = { bodies: [] };
  await page.route(new RegExp(`/rest/v1/rpc/${name}(\\?|$)`), async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    seen.bodies.push(request.postDataJSON());
    const a = answer();
    if (a.delayMs) await new Promise((r) => setTimeout(r, a.delayMs));
    return route.fulfill({ status: a.status ?? 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(a.body) });
  });
  return seen;
}

const isoYearsAgo = (years: number): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('the personal link fills the tutor sign-up', () => {
  test('a person from the list: the boxes fill in, nothing is ticked, the password boxes are empty, one call with only the token', async ({ page, problems }) => {
    const seen = await answerRpc(page, 'founding_signup_prefill', () => ({ body: FULL }));
    await page.goto(`/signup/tutor?k=${TOKEN}&src=f1-n1`);
    await expect(page.locator('#firstName')).toHaveValue('Thandi');
    await expect(page.locator('#surname')).toHaveValue('Nkosi');
    await expect(page.locator('#email')).toHaveValue('thandi@example.invalid');
    await expect(page.locator('#phoneNumber')).toHaveValue('0821234567');
    await expect(page.locator('#dateOfBirth')).toHaveValue('1995-03-02');
    await expect(page.locator('[data-prefilled="true"]')).toContainText('Check them, choose a password and accept the Terms');
    await expect(page.getByText('This is the email you gave the list')).toBeVisible();
    // the two acts that stay theirs
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await expect(page.locator('#password')).toHaveValue('');
    await expect(page.locator('#confirmPassword')).toHaveValue('');
    expect(seen.bodies).toEqual([{ p_token: TOKEN }]);
    // nothing about the person is in the address, and nothing was logged as a problem
    expect(new URL(page.url()).search).toBe(`?k=${TOKEN}&src=f1-n1`);
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors.filter((m) => !/Failed to load resource|policy_versions|current_policy/i.test(m))).toEqual([]);
  });

  test('an older row (no surname, no date of birth): those two stay empty and are typed, everything else is filled', async ({ page }) => {
    await answerRpc(page, 'founding_signup_prefill', () => ({ body: { first_name: 'Odi', surname: null, email: 'odi@example.invalid', phone: '0829876543', date_of_birth: null } }));
    await page.goto(`/signup/tutor?k=${TOKEN}`);
    await expect(page.locator('#firstName')).toHaveValue('Odi');
    await expect(page.locator('#email')).toHaveValue('odi@example.invalid');
    await expect(page.locator('#phoneNumber')).toHaveValue('0829876543');
    await expect(page.locator('#surname')).toHaveValue('');
    await expect(page.locator('#dateOfBirth')).toHaveValue('');
    await expect(page.getByRole('checkbox')).not.toBeChecked();
  });

  test('a bad, used or unknown token (the database answers null): the plain empty sign-up, no message, no error wall', async ({ page, problems }) => {
    const seen = await answerRpc(page, 'founding_signup_prefill', () => ({ body: null }));
    await page.goto(`/signup/tutor?k=${TOKEN}`);
    await expect.poll(() => seen.bodies.length).toBe(1);
    await expect(page.locator('#firstName')).toHaveValue('');
    await expect(page.locator('#email')).toHaveValue('');
    await expect(page.locator('[data-prefilled]')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Join Tutorlage' })).toBeVisible();
    expect(problems.pageErrors).toEqual([]);
  });

  test('the database failing (500) or missing the function: still the plain empty sign-up, usable', async ({ page }) => {
    await answerRpc(page, 'founding_signup_prefill', () => ({ status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.founding_signup_prefill' } }));
    await page.goto(`/signup/tutor?k=${TOKEN}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-prefilled]')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.locator('#firstName').fill('Typed');
    await expect(page.locator('#firstName')).toHaveValue('Typed');
  });

  test('a token that is not 32 hex characters (an email, a name) is never sent to the database', async ({ page }) => {
    const seen = await answerRpc(page, 'founding_signup_prefill', () => ({ body: FULL }));
    await page.goto('/signup/tutor?k=thandi%40example.invalid');
    await page.waitForLoadState('networkidle');
    expect(seen.bodies).toEqual([]);
    await expect(page.locator('#firstName')).toHaveValue('');
  });

  test('the sign-up with no link asks the database nothing and is the form it has always been', async ({ page }) => {
    const seen = await answerRpc(page, 'founding_signup_prefill', () => ({ body: FULL }));
    await page.goto('/signup/tutor');
    await page.waitForLoadState('networkidle');
    expect(seen.bodies).toEqual([]);
    await expect(page.locator('#firstName')).toHaveValue('');
    await expect(page.locator('#dateOfBirth')).toHaveValue('');
  });

  test('learner and parent sign-ups ignore a link', async ({ page }) => {
    const seen = await answerRpc(page, 'founding_signup_prefill', () => ({ body: FULL }));
    await page.goto(`/signup/parent?k=${TOKEN}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/signup/student?k=${TOKEN}`);
    await page.waitForLoadState('networkidle');
    expect(seen.bodies).toEqual([]);
    await expect(page.locator('#firstName')).toHaveValue('');
  });

  test('a box the person already typed in is never overwritten when the answer arrives late', async ({ page }) => {
    await answerRpc(page, 'founding_signup_prefill', () => ({ body: FULL, delayMs: 1500 }));
    await page.goto(`/signup/tutor?k=${TOKEN}`);
    await page.locator('#firstName').fill('Thandiwe');
    await page.locator('#email').fill('mine@example.invalid');
    await expect(page.locator('#surname')).toHaveValue('Nkosi', { timeout: 10_000 });
    await expect(page.locator('#firstName')).toHaveValue('Thandiwe');
    await expect(page.locator('#email')).toHaveValue('mine@example.invalid');
    await expect(page.getByText('This is the email you gave the list')).toHaveCount(0);
  });
});

test('while the gate is off, /teach offers sign-up: no form, and See more tells how to start', async ({ page, problems }) => {
  await answerRpc(page, 'founding_gate_public', () => ({ body: false }));
  await page.goto('/teach?src=f1');
  await expect(page.getByRole('heading', { level: 1, name: 'Get paid to tutor' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#f-firstName')).toHaveCount(0);
  await page.getByRole('button', { name: 'See more' }).click();
  await expect(page.getByText('Proven hours you have tutored outside Tutorlage count towards the hours a level needs.')).toBeVisible();
  await expect(page.getByText('Bookings are not promised.')).toBeVisible();
  await expect(page.getByText('place opens', { exact: false })).toHaveCount(0);
  await expect(page.locator('[data-sign-up]')).toHaveCount(2);
  await page.locator('[data-sign-up]').first().click();
  await expect(page).toHaveURL(/\/signup\/tutor$/);
  expect(problems.pageErrors).toEqual([]);
});

test.describe('the join form is the first stage of sign-up', () => {
  async function openJoinForm(page: Page) {
    await answerRpc(page, 'founding_gate_public', () => ({ body: true })); // the list and its form are shown while the gate is on
    await page.route(/\/rest\/v1\/subjects/, (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify([{ name: 'Mathematics' }]) }));
    await page.route(/\/rest\/v1\/grade_levels/, (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify([{ name: 'Grade 8' }, { name: 'Grade 12' }]) }));
    await page.goto('/teach?src=f1-n1');
    await expect(page.locator('#f-subject-0')).toBeVisible({ timeout: 15_000 });
  }
  async function fillJoinForm(page: Page, dateOfBirth: string) {
    await page.locator('#f-firstName').fill('Thandi');
    await page.locator('#f-surname').fill('Nkosi');
    await page.locator('#f-whatsapp').fill('082 123 4567');
    await page.locator('#f-email').fill('thandi@example.invalid');
    if (dateOfBirth) await page.locator('#f-dob').fill(dateOfBirth);
    await page.locator('#f-subject-0').selectOption('Mathematics');
    await page.locator('#f-from-0').selectOption('Grade 8');
    await page.locator('#f-to-0').selectOption('Grade 12');
    await page.getByLabel('None yet').check();
    await page.getByLabel('Not yet', { exact: true }).check();
    await page.getByLabel('Up to 10', { exact: true }).check();
    await page.getByLabel('Yes', { exact: true }).check();
    await page.locator('#f-consent-contact').check();
  }

  test('it asks first name, surname and date of birth (no "I am 18" tick, no password) and sends them with the old fields too', async ({ page, problems }) => {
    const seen = await answerRpc(page, 'join_founding_list', () => ({ body: { ok: true } }));
    await openJoinForm(page);
    await expect(page.getByText('First name *')).toBeVisible();
    await expect(page.getByText('Surname *')).toBeVisible();
    await expect(page.getByText('Date of birth *')).toBeVisible();
    await expect(page.getByLabel('I am 18 or older')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await fillJoinForm(page, isoYearsAgo(30));
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#founding-done')).toBeVisible();
    expect(seen.bodies).toHaveLength(1);
    const p = (seen.bodies[0] as { p: Record<string, unknown> }).p;
    expect(p).toMatchObject({ first_name: 'Thandi', surname: 'Nkosi', date_of_birth: isoYearsAgo(30), full_name: 'Thandi Nkosi', is_adult: true, code_name: 'Thandi', email: 'thandi@example.invalid', whatsapp: '082 123 4567' });
    expect(problems.pageErrors).toEqual([]);
  });

  test('under 18 is refused with the sign-up\'s own words and nothing is sent', async ({ page }) => {
    const seen = await answerRpc(page, 'join_founding_list', () => ({ body: { ok: true } }));
    await openJoinForm(page);
    await fillJoinForm(page, isoYearsAgo(17));
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText("Tutors on Tutorlage need to be 18 or older")).toBeVisible();
    await expect(page.locator('#founding-done')).toHaveCount(0);
    expect(seen.bodies).toEqual([]);
  });

  test('a missing date of birth, first name or surname is refused in words and nothing is sent', async ({ page }) => {
    const seen = await answerRpc(page, 'join_founding_list', () => ({ body: { ok: true } }));
    await openJoinForm(page);
    await fillJoinForm(page, '');
    await page.locator('#f-firstName').fill('');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Please enter your first name.')).toBeVisible();
    await expect(page.getByText('Enter your real date of birth.')).toBeVisible();
    expect(seen.bodies).toEqual([]);
  });
});
