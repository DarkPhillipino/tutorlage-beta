import type { Page } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// SEEDING THE WARM TUTORS (17 Nov 2026). Hermetic: the database is answered here, nothing real is called.
//  * a tutor account made for someone from the founding list holds a first name only: on first sign-in the app asks, on one screen, for the SURNAME, the DATE OF BIRTH and the
//    Terms + Privacy tick, saves nothing until all three are right, and the Terms tick is never pre-ticked;
//  * a tutor with a surname, a date of birth and an acceptance goes straight in; a database without the new surname function behaves as before;
//  * Manage Account has a "Change password" button that asks Supabase to email a link to the signed-in person's own address (never a typed password).

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const UID = '00000000-0000-4000-8000-000000000001';
const DOCS = [{ document: 'terms', version: '2026-11-16' }, { document: 'privacy', version: '2026-11-16' }];

interface World {
  fullName: string;
  role: 'tutor' | 'student';
  dob: string | null;
  needsSurname: boolean | 'missing';
  pending: typeof DOCS | [];
  calls: string[];
  bodies: Record<string, unknown>;
}

async function openAs(page: Page, w: World) {
  await signInFake(page);
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const rpc = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(url)?.[1];
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: UID, full_name: w.fullName, role: w.role, avatar_url: null }]));
    if (rpc === 'my_date_of_birth') return route.fulfill(json(w.dob));
    if (rpc === 'my_pending_acceptances') return route.fulfill(json(w.pending));
    if (rpc === 'my_needs_surname') return w.needsSurname === 'missing' ? route.fulfill(json({ code: 'PGRST202', message: 'Could not find the function public.my_needs_surname' }, 404)) : route.fulfill(json(w.needsSurname));
    if (rpc === 'set_my_surname') { w.calls.push('set_my_surname'); w.bodies.set_my_surname = request.postDataJSON(); w.needsSurname = false; return route.fulfill({ status: 204, headers: CORS }); }
    if (rpc === 'set_my_date_of_birth') { w.calls.push('set_my_date_of_birth'); w.bodies.set_my_date_of_birth = request.postDataJSON(); w.dob = (request.postDataJSON() as { p_dob: string }).p_dob; return route.fulfill({ status: 204, headers: CORS }); }
    if (rpc === 'accept_current_policies') { w.calls.push('accept_current_policies'); w.pending = []; return route.fulfill({ status: 204, headers: CORS }); }
    if (/\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return route.fulfill(json([]));
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/');
}

const world = (over: Partial<World> = {}): World => ({ fullName: 'Zzodi', role: 'tutor', dob: null, needsSurname: true, pending: DOCS, calls: [], bodies: {}, ...over });
const isoYearsAgo = (years: number): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('a tutor account made for someone from the list: first sign-in', () => {
  test('the "One more step" screen asks for the surname, the date of birth and the Terms tick; nothing is pre-ticked; nothing is saved until all three are right', async ({ page, problems }) => {
    const w = world();
    await openAs(page, w);
    await expect(page.getByRole('heading', { name: 'One more step' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Before you start, we need a couple of details.')).toBeVisible();
    await expect(page.getByLabel('Surname')).toBeVisible();
    await expect(page.getByLabel('Date of birth')).toBeVisible();
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await expect(page.getByRole('link', { name: 'Terms of Service' })).toBeVisible();
    // Terms not ticked: refused in words and nothing is sent
    await page.getByLabel('Surname').fill('Zzfamily');
    await page.getByLabel('Date of birth').fill(isoYearsAgo(30));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Please accept the Terms of Service and the Privacy Policy to continue.')).toBeVisible();
    expect(w.calls).toEqual([]);
    // all three right: the three saves, in order, and the screen goes
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'One more step' })).toHaveCount(0, { timeout: 15_000 });
    expect(w.calls).toEqual(['set_my_surname', 'set_my_date_of_birth', 'accept_current_policies']);
    expect(w.bodies.set_my_surname).toEqual({ p_surname: 'Zzfamily' });
    expect(w.bodies.set_my_date_of_birth).toEqual({ p_dob: isoYearsAgo(30) });
    expect(problems.pageErrors).toEqual([]);
  });

  test('under 18 is refused with the sign-up\'s tutor words and NOTHING is saved (not even the surname)', async ({ page }) => {
    const w = world();
    await openAs(page, w);
    await expect(page.getByRole('heading', { name: 'One more step' })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Surname').fill('Zzfamily');
    await page.getByLabel('Date of birth').fill(isoYearsAgo(17));
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText("Tutors on Tutorlage need to be 18 or older")).toBeVisible();
    expect(w.calls).toEqual([]);
  });

  test('a surname with angle brackets is refused in words and nothing is saved', async ({ page }) => {
    const w = world();
    await openAs(page, w);
    await expect(page.getByRole('heading', { name: 'One more step' })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Surname').fill('Zz<b>');
    await page.getByLabel('Date of birth').fill(isoYearsAgo(30));
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter your surname.')).toBeVisible();
    expect(w.calls).toEqual([]);
  });

  test('a tutor who already has a surname, a date of birth and the acceptance goes straight in (no gate)', async ({ page }) => {
    const w = world({ fullName: 'Tee Normal', needsSurname: false, dob: '1990-05-15', pending: [] });
    await openAs(page, w);
    await expect.poll(async () => (await page.locator('#root').innerText()).trim().length, { timeout: 15_000 }).toBeGreaterThan(20);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'One more step' })).toHaveCount(0);
    await expect(page.getByLabel('Surname')).toHaveCount(0);
    expect(w.calls).toEqual([]);
  });

  test('a database without the surname function (not yet applied) behaves exactly as before: no surname box, only what is missing is asked', async ({ page }) => {
    const w = world({ needsSurname: 'missing' });
    await openAs(page, w);
    await expect(page.getByRole('heading', { name: 'One more step' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Surname')).toHaveCount(0);
    await expect(page.getByLabel('Date of birth')).toBeVisible();
  });

  test('the same database (no surname function) with the date of birth and the acceptance already there: straight in, as before', async ({ page }) => {
    const w = world({ needsSurname: 'missing', dob: '1990-05-15', pending: [] });
    await openAs(page, w);
    await expect.poll(async () => (await page.locator('#root').innerText()).trim().length, { timeout: 15_000 }).toBeGreaterThan(20);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'One more step' })).toHaveCount(0);
  });
});

test.describe('Manage Account: change your password by email', () => {
  async function openManageAccount(page: Page) {
    const w = world({ fullName: 'Browser Test', role: 'student', needsSurname: false, dob: '2000-01-01', pending: [] });
    await openAs(page, w);
    await expect(page.locator('header').getByText('Tutorlage').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('header button', { hasText: 'Manage Account' }).click();
    await expect(page.getByText('Primary Campus Institution')).toBeVisible();
  }

  test('"Change password" asks Supabase to email a reset link to the signed-in person\'s own address, aimed at the Set a new password page; no password is typed', async ({ page, problems }) => {
    const sent: { url: string; body: { email?: string } }[] = [];
    await openManageAccount(page);
    await page.route(/\/auth\/v1\/recover/, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      sent.push({ url: route.request().url(), body: route.request().postDataJSON() as { email?: string } });
      return route.fulfill(json({}));
    });
    await expect(page.locator('[data-change-password]')).toContainText('We email a link to browser-test@example.invalid');
    await expect(page.locator('[data-change-password] input')).toHaveCount(0);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('We have sent a link to browser-test@example.invalid. Open it to choose a new password, then sign in with the new one.')).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0].body.email).toBe('browser-test@example.invalid');
    expect(decodeURIComponent(sent[0].url)).toMatch(/redirect_to=https?:\/\/[^&]*\/reset-password/);
    await expect(page.getByRole('button', { name: /Send it again in \d+s/ })).toBeDisabled();
    expect(problems.pageErrors).toEqual([]);
  });

  test('too many tries (429) says so in words and does not claim a link was sent', async ({ page }) => {
    await openManageAccount(page);
    await page.route(/\/auth\/v1\/recover/, (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill(json({ code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' }, 429)));
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Too many tries' })).toBeVisible();
    await expect(page.getByText('We have sent a link')).toHaveCount(0);
  });

  test('no network: "We could not reach Tutorlage" and the button stays usable', async ({ page }) => {
    await openManageAccount(page);
    await page.route(/\/auth\/v1\/recover/, (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.abort('connectionreset'));
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'We could not reach Tutorlage' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change password' })).toBeEnabled();
  });
});
