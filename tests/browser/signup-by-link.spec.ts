import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// THE ONE-STEP TUTOR SIGN-UP FROM THE PERSONAL LINK (job T, 18 Nov 2026). Hermetic: the Worker's two routes and the database are answered here; nothing real is called.
//  * the Worker says the link can make the account already confirmed: the person sees their details, "Is this the right email?", a password and the Terms; the one create call carries only
//    the token, the password and the version words; then they are signed in with the row's email;
//  * the Worker says no, fails, or is missing the route (the switch is off): the ordinary sign-up, unchanged;
//  * "No, change my details" and a link the Worker refuses at the last moment hand over to the ordinary form with the details filled in;
//  * the Terms stay unticked and a bad password never reaches the Worker.

const TOKEN = '0123456789abcdef0123456789abcdef';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const DETAILS = { available: true, firstName: 'Thandi', surname: 'Nkosi', email: 'thandi@example.invalid', phone: '0821234567', dateOfBirth: '1995-03-02' };
const PASSWORD = 'correct horse battery';

interface Seen { check: unknown[]; create: unknown[]; signIn: unknown[]; signUp: unknown[] }

async function mock(page: Page, opts: {
  check?: { status?: number; body: unknown } | 'fail';
  create?: { status?: number; body: unknown };
  signIn?: 'ok' | 'refuse';
}): Promise<Seen> {
  const seen: Seen = { check: [], create: [], signIn: [], signUp: [] };
  await page.route('**/api/signup/tutor-by-link/check', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    seen.check.push(request.postDataJSON());
    if (opts.check === 'fail') return route.abort('failed');
    const a = opts.check ?? { body: { available: false } };
    return route.fulfill({ status: a.status ?? 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(a.body) });
  });
  await page.route('**/api/signup/tutor-by-link', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    seen.create.push(request.postDataJSON());
    const a = opts.create ?? { body: { ok: true, email: DETAILS.email } };
    return route.fulfill({ status: a.status ?? 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(a.body) });
  });
  await page.route(/\/auth\/v1\/token\?grant_type=password/, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    seen.signIn.push(request.postDataJSON());
    if (opts.signIn === 'refuse') return route.fulfill({ status: 400, contentType: 'application/json', headers: CORS, body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }) });
    const user = { id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: DETAILS.email, email_confirmed_at: '2026-11-18T08:00:00Z', app_metadata: {}, user_metadata: { role: 'tutor' }, created_at: '2026-11-18T08:00:00Z' };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ access_token: 'a.b.c', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user }) });
  });
  await page.route(/\/auth\/v1\/signup/, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    seen.signUp.push(request.postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ id: '00000000-0000-4000-8000-0000000000bb', email: DETAILS.email, identities: [{}] }) });
  });
  await page.route(/\/rpc\/current_policy_versions/, (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify([{ terms_version: '2026-11-17', privacy_version: '2026-11-17', guardian_consent_version: '2026-11-17' }]) }));
  return seen;
}

async function fillAndSubmit(page: Page, opts: { password?: string; confirm?: string; tick?: boolean } = {}) {
  await page.locator('#link-password').fill(opts.password ?? PASSWORD);
  await page.locator('#link-confirm-password').fill(opts.confirm ?? opts.password ?? PASSWORD);
  if (opts.tick !== false) await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create Tutor Account' }).click();
}

test.describe('the one-step tutor sign-up from the personal link', () => {
  test('the Worker says yes: details, "Is this the right email?", password, Terms; one create call with only the token, password and versions; then signed in with the row\'s email', async ({ page, problems }) => {
    const seen = await mock(page, { check: { body: DETAILS } });
    await page.goto(`/signup/tutor?k=${TOKEN}&src=f1-n1`);
    const form = page.locator('[data-link-signup="form"]');
    await expect(form).toBeVisible();
    await expect(form.locator('[data-link-details]')).toContainText('Thandi Nkosi');
    await expect(form.locator('[data-link-email]')).toHaveText('thandi@example.invalid');
    await expect(form.locator('[data-link-details]')).toContainText('2 March 1995');
    await expect(form.locator('[data-link-email-question]')).toContainText('Is this the right email?');
    await expect(form.locator('[data-link-email-question]')).toContainText('do not need to confirm it by email');
    await expect(form.getByRole('button', { name: 'No, change my details' })).toBeVisible();
    // the ordinary boxes are not there, and the two acts that stay the person's own are untouched
    await expect(page.locator('#firstName')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await expect(page.locator('#link-password')).toHaveValue('');
    expect(seen.check).toEqual([{ token: TOKEN }]);

    await fillAndSubmit(page);
    await expect.poll(() => seen.create.length).toBe(1);
    expect(seen.create[0]).toEqual({ token: TOKEN, password: PASSWORD, acceptedTermsVersion: '2026-11-17', acceptedPrivacyVersion: '2026-11-17' });
    await expect.poll(() => seen.signIn.length).toBe(1);
    expect((seen.signIn[0] as { email: string; password: string }).email).toBe('thandi@example.invalid');
    expect((seen.signIn[0] as { email: string; password: string }).password).toBe(PASSWORD);
    expect(seen.signUp, 'the browser\'s own sign-up (which sends a confirmation email) is not called').toEqual([]);
    await expect.poll(() => new URL(page.url()).pathname).not.toMatch(/^\/signup/);
    expect(new URL(page.url()).search).not.toContain(TOKEN);
    expect(problems.pageErrors).toEqual([]);
  });

  test('the Terms must be ticked and the two passwords must match: nothing reaches the Worker until they do', async ({ page }) => {
    const seen = await mock(page, { check: { body: DETAILS } });
    await page.goto(`/signup/tutor?k=${TOKEN}`);
    await expect(page.locator('[data-link-signup="form"]')).toBeVisible();
    await fillAndSubmit(page, { tick: false });
    await expect(page.getByRole('alert')).toContainText('accept the Terms of Service');
    await fillAndSubmit(page, { confirm: 'something else entirely' });
    await expect(page.getByRole('alert')).toContainText(/match/i);
    await page.locator('#link-password').fill('short');
    await page.locator('#link-confirm-password').fill('short');
    await page.getByRole('button', { name: 'Create Tutor Account' }).click();
    await expect(page.getByRole('alert')).toContainText(/at least 8/);
    expect(seen.create).toEqual([]);
  });

  test('a refusal that keeps the link usable (a password that is too easy) is shown in the Worker\'s words, on the same page', async ({ page }) => {
    const seen = await mock(page, { check: { body: DETAILS }, create: { status: 422, body: { code: 'weak_password', error: 'That password is too easy to guess. Choose a longer one.' } } });
    await page.goto(`/signup/tutor?k=${TOKEN}`);
    await expect(page.locator('[data-link-signup="form"]')).toBeVisible();
    await fillAndSubmit(page);
    await expect(page.getByRole('alert')).toContainText('too easy to guess');
    await expect(page.locator('[data-link-signup="form"]')).toBeVisible();
    expect(seen.signIn).toEqual([]);
  });

  test('a link the Worker refuses at the last moment (used, lapsed, switch off): the ordinary form with the details filled in and a plain note about the confirmation email', async ({ page }) => {
    const seen = await mock(page, { check: { body: DETAILS }, create: { status: 409, body: { code: 'unavailable', error: 'x' } } });
    await page.goto(`/signup/tutor?k=${TOKEN}`);
    await expect(page.locator('[data-link-signup="form"]')).toBeVisible();
    await fillAndSubmit(page);
    await expect(page.locator('[data-switch-note]')).toContainText('confirmation email');
    await expect(page.locator('#firstName')).toHaveValue('Thandi');
    await expect(page.locator('#surname')).toHaveValue('Nkosi');
    await expect(page.locator('#email')).toHaveValue('thandi@example.invalid');
    await expect(page.locator('#dateOfBirth')).toHaveValue('1995-03-02');
    await expect(page.locator('[data-link-signup]')).toHaveCount(0);
    expect(seen.signIn).toEqual([]);
  });

  test('"No, change my details": the ordinary form with the details filled in, nothing created, and the ordinary submit still sends the confirmation email', async ({ page }) => {
    const seen = await mock(page, { check: { body: DETAILS } });
    await page.goto(`/signup/tutor?k=${TOKEN}`);
    await page.getByRole('button', { name: 'No, change my details' }).click();
    await expect(page.locator('[data-switch-note]')).toContainText('confirmation email');
    await expect(page.locator('#email')).toHaveValue('thandi@example.invalid');
    await page.locator('#email').fill('thandi.new@example.invalid');
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#confirmPassword').fill(PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create Tutor Account' }).click();
    await expect.poll(() => seen.signUp.length).toBe(1);
    expect(seen.create, 'the Worker\'s create route is never called from the ordinary form').toEqual([]);
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  });

  test('the account was made but the sign-in failed: "Your account is ready" with a way to sign in', async ({ page }) => {
    await mock(page, { check: { body: DETAILS }, signIn: 'refuse' });
    await page.goto(`/signup/tutor?k=${TOKEN}`);
    await expect(page.locator('[data-link-signup="form"]')).toBeVisible();
    await fillAndSubmit(page);
    await expect(page.locator('[data-link-signup="ready"]')).toContainText('Your account is ready');
    await expect(page.getByRole('link', { name: 'Go to Sign In' })).toHaveAttribute('href', '/signin/tutor');
  });

  for (const [name, check] of [['the Worker says not available (the switch is off)', { body: { available: false } }], ['the Worker has no such route (404)', { status: 404, body: { error: 'Not found' } }], ['the Worker is unreachable', 'fail'], ['the Worker answers something odd', { body: { available: 'yes' } }]] as const) {
    test(`${name}: the ordinary sign-up, unchanged, no message, no error`, async ({ page, problems }) => {
      const seen = await mock(page, { check });
      await page.route(/\/rpc\/founding_signup_prefill/, (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ first_name: 'Thandi', surname: 'Nkosi', email: 'thandi@example.invalid', phone: '0821234567', date_of_birth: '1995-03-02' }) }));
      await page.goto(`/signup/tutor?k=${TOKEN}`);
      await expect(page.locator('#firstName')).toHaveValue('Thandi');
      await expect(page.locator('[data-prefilled="true"]')).toContainText('Check them, choose a password');
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.locator('[data-link-signup]')).toHaveCount(0);
      await expect(page.locator('[data-switch-note]')).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(seen.check).toEqual([{ token: TOKEN }]);
      expect(problems.pageErrors).toEqual([]);
    });
  }

  test('no link, or a link on the learner or parent sign-up, asks the Worker nothing', async ({ page }) => {
    const seen = await mock(page, { check: { body: DETAILS } });
    await page.goto('/signup/tutor');
    await page.waitForLoadState('networkidle');
    await page.goto(`/signup/parent?k=${TOKEN}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/signup/student?k=${TOKEN}`);
    await page.waitForLoadState('networkidle');
    await page.goto('/signup/tutor?k=thandi%40example.invalid');
    await page.waitForLoadState('networkidle');
    expect(seen.check).toEqual([]);
    await expect(page.locator('#firstName')).toHaveValue('');
  });
});
