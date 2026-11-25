import type { Page } from '@playwright/test';
import { test, expect, signInFake, databaseOrigin } from './fixtures';

// FROM A TUTOR'S PAGE TO BOOKING THAT TUTOR (PM line 79, 25 Nov 2026), the part a browser can show with the database MOCKED (nothing here touches dev or production; the people are made up):
// a signed-out parent, a signed-out learner and a signed-in older parent account walk from /t/CODE to the tutor's booking page and nowhere else. What this does NOT show: the database rules
// (supabase/tests/tutor_page_booking.sql does), real e-mail delivery and Google's own pages. With RUN9_SCREENS=<folder> the screenshot test saves PNGs of the four screens there.

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => ({ status, contentType: 'application/json', headers: { ...CORS, ...extra }, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';
const TUTOR = '22222222-2222-4222-8222-222222222222';
const CHILD = '44444444-4444-4444-8444-444444444444';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const PAGE = {
  code: 'TESSA', first_name: 'Tessa', level_id: '2C', level_name: 'Academic Mentors', tier_line: null, price: 280, currency: 'ZAR',
  basis: { kind: 'credential', label: 'Student teacher enrolled in a B.Ed or PGCE (proof of enrolment)' }, discount: { percent: 10, lessons: 3 },
  subjects: [{ subject: 'English Home Language', min_grade: 'Grade 1', max_grade: 'Grade 12' }, { subject: 'Geography', min_grade: 'Grade 8', max_grade: 'Grade 12' }],
  hours: 'Saturday and Sunday, 8am to 5pm', taking_requests: true, photo: null as string | null,
};
const GRADES = ['Grade R', ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)].map((name) => ({ name }));

interface World { role: 'parent' | 'student' | 'tutor'; inserts: Record<string, unknown>[]; signups: Record<string, unknown>[]; refuse?: boolean; onConfirm?: boolean; credit?: number; confirms: Record<string, unknown>[]; confirmFails?: 'refused' | 'lost' }

function fakeSession(metadata: Record<string, unknown> = {}) {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'browser-test@example.invalid', app_metadata: {}, user_metadata: metadata, created_at: '2026-01-01T00:00:00Z' };
  return { access_token: `${b({ alg: 'none', typ: 'JWT' })}.${b({ sub: ME, exp, role: 'authenticated' })}.x`, refresh_token: 'not-a-real-token', token_type: 'bearer', expires_in: 86400, expires_at: exp, user };
}

async function world(page: Page, opts: Partial<World> = {}, photo: string | null = null): Promise<World> {
  const w: World = { role: 'parent', inserts: [], signups: [], confirms: [], ...opts };
  const tutor = { ...PAGE, photo, books_on_confirm: !!w.onConfirm };
  await page.route(/\.(supabase\.co|workers\.dev)\//, async (route) => {
    const request = route.request();
    const url = request.url();
    const one = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const rows = (list: unknown[]) => route.fulfill(json(one ? (list[0] ?? null) : list));
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (/\/auth\/v1\/signup/.test(url)) {
      w.signups.push(request.postDataJSON() as Record<string, unknown>);
      return route.fulfill(json(fakeSession((request.postDataJSON() as { data?: Record<string, unknown> }).data ?? {})));
    }
    if (/\/auth\/v1\/token/.test(url)) return route.fulfill(json(fakeSession()));
    if (/\/auth\/v1\/user/.test(url)) return route.fulfill(json(fakeSession().user));
    if (/\/rpc\/confirm_page_booking/.test(url)) {
      w.confirms.push(request.postDataJSON() as Record<string, unknown>);
      if (w.confirmFails === 'refused') return route.fulfill(json({ code: 'P0001', message: "Tessa isn't available at that time. Choose another time." }, 400));
      if (w.confirmFails === 'lost' && w.confirms.length === 1) return route.abort();
      return route.fulfill(json({ booked: true, request_id: 'r-1', session_id: 's-1', paid_rand: 280, discount_rand: 0, available_rand: (w.credit ?? 900) - 280 }));
    }
    if (/\/rpc\/public_tutor_page/.test(url)) return route.fulfill(json(tutor));
    if (/\/rpc\/tutor_booking_page/.test(url)) return route.fulfill(json({ ...tutor, tutor_id: TUTOR }));
    if (/\/rpc\/tutor_page_times/.test(url)) return route.fulfill(json({ now_ok: false, days: [{ date: day(3), times: ['08:00', '08:30', '09:00'] }, { date: day(4), times: ['10:00'] }] }));
    if (/\/rest\/v1\/grade_levels/.test(url)) return rows(GRADES);
    if (/\/rest\/v1\/profiles\?/.test(url)) return rows([{ id: ME, full_name: 'Browser Test', role: w.role, avatar_url: null }]);
    if (/\/rpc\/my_date_of_birth/.test(url)) return route.fulfill(json('1985-01-01'));
    if (/\/rpc\/my_needs_surname/.test(url)) return route.fulfill(json(false));
    if (/\/rest\/v1\/parent_student_links/.test(url)) {
      if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...CORS, 'content-range': '*/0' } });
      return rows(w.role === 'parent' ? [{ student_id: CHILD, relationship: 'mother', can_book_sessions: true, student_profiles: { first_name: 'Sipho', surname: 'Madeup', grade_level: 'Grade 9' } }] : []);
    }
    if (/\/rest\/v1\/guardian_consents/.test(url)) return rows([{ learner_profile_id: CHILD, withdrawn_at: null }]);
    if (/\/rest\/v1\/parent_profiles/.test(url)) return rows([{ phone_number: '081 234 5678' }]);
    if (/\/rest\/v1\/student_profiles/.test(url)) return rows([{ grade_level: 'Grade 10' }]);
    if (/\/rest\/v1\/student_subject_enrollments/.test(url)) return rows(request.method() === 'POST' ? [{ id: '55555555-5555-4555-8555-555555555555' }] : []);
    if (/\/rpc\/card_checkout_available/.test(url)) return route.fulfill(json(false));
    if (/\/rpc\/wallet_open/.test(url)) return route.fulfill(json(true));
    if (/\/rpc\/wallet_online_available/.test(url)) return route.fulfill(json(false));
    if (/\/rpc\/my_promo_quote/.test(url)) return route.fulfill(json({ applies: false }));
    if (/\/rpc\/check_promo_code/.test(url)) return route.fulfill(json({ valid: true, percent: 10, lessons: 3 }));
    if (/\/rest\/v1\/wallets/.test(url)) return rows([{ available_rand: w.credit ?? 900, held_rand: 0 }]);
    if (/\/rest\/v1\/session_requests/.test(url) && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      w.inserts.push(body);
      if (w.refuse) return route.fulfill(json({ code: 'P0001', message: "This tutor isn't available at that time. Choose another time, or send the request to any available tutor.", details: null, hint: null }, 400));
      return route.fulfill(json({ id: '33333333-3333-4333-8333-333333333333', requested_start: body.requested_start, charged_amount: 280 }, 201));
    }
    if (/\/rpc\/send_request_wallet/.test(url)) return route.fulfill(json({ mode: 'wallet', held_rand: 280 }));
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  return w;
}

async function signedInAs(page: Page, metadata: Record<string, unknown> = {}) {
  const ref = new URL(databaseOrigin()).hostname.split('.')[0];
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem('zz-signed')) {
      localStorage.setItem(key, value);
      sessionStorage.setItem('zz-signed', '1');
    }
  }, [`sb-${ref}-auth-token`, JSON.stringify(fakeSession(metadata))] as const);
}

// Nothing on the path offers another tutor, a tutor account or another price.
async function onlyThisTutor(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/any available tutor|Become a tutor|Not Tessa|tutors? can take|tutors? available|What we have checked|R50\b/i);
  expect(text).not.toMatch(/\b(free|instant|wallet|vetted|certified|background-checked)\b/i);
}

async function chooseLesson(page: Page) {
  await page.getByLabel('Subject', { exact: true }).selectOption('Geography');
  await page.getByLabel('Grade', { exact: true }).selectOption('Grade 10');
  await page.getByLabel('Day', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Time (South African time)').selectOption('08:30');
}

test('the public page: navy bar and hero, one level card with the tutor\'s own credential, no checked section, Book goes to the booking address', async ({ page, problems }) => {
  await world(page);
  await page.goto('/t/TESSA');
  await expect(page.getByRole('heading', { level: 1, name: 'Tessa' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('header')).toHaveCSS('background-color', 'rgb(15, 23, 42)');
  await expect(page.locator('[data-hero]')).toHaveCSS('background-color', 'rgb(15, 23, 42)');
  await expect(page.locator('[data-level-card]')).toHaveCount(1);
  await expect(page.locator('[data-level-card]')).toContainText('R280');
  await expect(page.locator('[data-level-basis="credential"]')).toContainText('Student teacher enrolled in a B.Ed or PGCE (proof of enrolment)');
  await expect(page.getByText('booked only when Tessa accepts')).toBeVisible();
  await expect(page.locator('[data-discount]')).toHaveText('A new parent or learner account created from this page pays 10% less on its first 3 lessons.');
  await onlyThisTutor(page);
  await page.getByRole('link', { name: 'Book a lesson' }).click();
  await expect(page).toHaveURL(/\/t\/TESSA\/book$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(problems.pageErrors).toEqual([]);
});

test('signed-out parent: sign-in card, create account with the two choices, then straight to the booking page and a request to this tutor only', async ({ page, problems }) => {
  const w = await world(page, { role: 'parent' });
  await page.goto('/t/TESSA');
  await page.getByRole('link', { name: 'Book a lesson' }).click({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Parent or guardian' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Learner' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/t/TESSA');
  await page.getByRole('button', { name: 'Parent or guardian' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await onlyThisTutor(page);
  await page.getByRole('link', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/t\/TESSA\/signup$/);
  await expect(page.getByRole('button', { name: 'Parent or guardian' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: 'Privacy Policy' }).last()).toBeVisible();
  await onlyThisTutor(page);
  await page.getByLabel('First name').fill('Made');
  await page.getByLabel('Surname').fill('Up');
  await page.getByLabel('Email').fill('made.up@example.invalid');
  await page.getByLabel('Date of birth').fill('1985-01-01');
  await page.getByLabel('Password', { exact: true }).fill('made-up-pass-1');
  await page.getByLabel('Confirm password').fill('made-up-pass-1');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/t\/TESSA\/book$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Book with Tessa' })).toBeVisible();
  const sent = w.signups[0] as { data: Record<string, unknown> };
  expect(sent.data).toMatchObject({ role: 'parent', signup_code: 'TESSA', book_tutor_code: 'TESSA', date_of_birth: '1985-01-01' });
  await expect(page.getByRole('button', { name: /Booking for Sipho/ })).toBeVisible();
  await expect(page.locator('[data-tutor-hours]')).toContainText('Saturday and Sunday, 8am to 5pm');
  await expect(page.locator('[data-wait-note]')).toContainText('Tessa has up to 48 hours to accept');
  await expect(page.getByLabel('Subject', { exact: true }).locator('option')).toHaveText(['Choose a subject', 'English Home Language', 'Geography']);
  await expect(page.locator('[data-level-card]')).toHaveCount(1);
  await chooseLesson(page);
  await onlyThisTutor(page);
  await page.getByRole('button', { name: 'Pay R280 from your credit' }).click();
  await expect(page).toHaveURL(/payment\/callback\?wallet=1&request=.*&tutor=TESSA/);
  expect(w.inserts).toHaveLength(1);
  expect(w.inserts[0]).toMatchObject({ requested_tutor_id: TUTOR, student_id: CHILD, requested_by_profile_id: ME, min_sub_tier_id: '2C', institution_id: null, via_tutor_page: true });
  expect(w.inserts[0]).not.toHaveProperty('curriculum_id');
  expect(problems.pageErrors).toEqual([]);
});

test('signed-out learner: signs in with a password and sees the booking page in the same place; a refusal offers only a new time', async ({ page, problems }) => {
  const w = await world(page, { role: 'student', refuse: true });
  await page.goto('/t/TESSA/book');
  await page.getByRole('button', { name: 'Learner' }).click({ timeout: 15_000 });
  await page.getByLabel('Email or sign-in name').fill('madeup.learner');
  await page.getByLabel('Password', { exact: true }).fill('made-up-pass-1');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Book with Tessa' })).toBeVisible();
  await expect(page).toHaveURL(/\/t\/TESSA\/book$/);
  await chooseLesson(page);
  await page.getByRole('button', { name: 'Pay R280 from your credit' }).click();
  const box = page.locator('[data-booking-refusal]');
  await expect(box).toContainText("Tessa isn't available at that time. Choose another time.");
  await expect(box).toContainText('Nothing was sent and no credit was held.');
  await expect(box.getByRole('button')).toHaveText(['Change the time']);
  await onlyThisTutor(page);
  expect(w.inserts[0]).toMatchObject({ requested_tutor_id: TUTOR, student_id: ME });
  expect(problems.pageErrors).toEqual([]);
});

test('signed-in older parent account: Book goes straight to the booking page, with no home page and no banner', async ({ page, problems }) => {
  await world(page, { role: 'parent' });
  await signInFake(page);
  await page.goto('/t/TESSA');
  await page.getByRole('link', { name: 'Book a lesson' }).click({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/t\/TESSA\/book$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Book with Tessa' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your learners' })).toBeVisible();
  await expect(page.getByText(/You came from|Welcome back/)).toHaveCount(0);
  await onlyThisTutor(page);
  expect(problems.pageErrors).toEqual([]);
});

test('after e-mail confirmation the new account lands on the booking page, once', async ({ page, problems }) => {
  await world(page, { role: 'student' });
  await signedInAs(page, { book_tutor_code: 'TESSA' });
  await page.goto('/login');
  await expect(page).toHaveURL(/\/t\/TESSA\/book$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Book with Tessa' })).toBeVisible();
  expect(problems.pageErrors).toEqual([]);
});

test('a tutor account is told lessons are booked from a parent or learner account', async ({ page, problems }) => {
  await world(page, { role: 'tutor' });
  await signInFake(page);
  await page.goto('/t/TESSA/book');
  await expect(page.getByText('Lessons are booked from a parent or learner account.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Subject', { exact: true })).toHaveCount(0);
  expect(problems.pageErrors).toEqual([]);
});

// BOOKED ON CONFIRM (PM line 81 C): a tutor who has accepted the new Terms. Nothing is sent until "Confirm booking".
async function toConfirmStep(page: Page) {
  await signedInAs(page);
  await page.goto('/t/TESSA/book');
  await chooseLesson(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Check your booking' })).toBeVisible();
}

test('booked on confirm: the confirm step shows the lesson, price, credit left and the cancelling rule, then "Booked"; no request is sent', async ({ page, problems }) => {
  const w = await world(page, { onConfirm: true });
  await toConfirmStep(page);
  const facts = page.locator('[data-confirm-step]');
  for (const words of ['Tessa', 'Sipho Madeup', 'Geography', 'Grade 10', '08:30 to 09:30', 'R280', 'R620', 'Until a session starts, you can cancel it yourself from your sessions list and the full price goes back to your credit at once.', 'We always refund in full when the tutor cancels, or does not turn up.']) await expect(facts).toContainText(words);
  await expect(facts).not.toContainText(/accept|request/i);
  expect(w.confirms.length).toBe(0);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Geography');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByRole('heading', { name: 'Booked' })).toBeVisible();
  await expect(page.locator('[data-booked]')).toContainText('R620');
  await expect(page.getByRole('link', { name: 'Open my sessions' })).toBeVisible();
  expect(w.confirms.length).toBe(1);
  expect(w.confirms[0]).toMatchObject({ p_tutor: TUTOR, p_student: CHILD, p_level: '2C', p_hours: 1, p_expected_rand: 280 });
  expect(String(w.confirms[0].p_start)).toContain('T06:30:00');
  expect(w.inserts.length).toBe(0);
  await onlyThisTutor(page);
  expect(problems.pageErrors).toEqual([]);
});

test('booked on confirm: a refusal says nothing was booked; a lost answer is retried with the same reference', async ({ page }) => {
  const w = await world(page, { onConfirm: true, confirmFails: 'lost' });
  await toConfirmStep(page);
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByRole('alert')).toContainText('you will not be charged twice');
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByRole('heading', { name: 'Booked' })).toBeVisible();
  expect(w.confirms.length).toBe(2);
  expect(w.confirms[1].p_reference).toBe(w.confirms[0].p_reference);
  w.confirmFails = 'refused';
  await page.getByRole('button', { name: 'Book another lesson' }).click();
  await chooseLesson(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByRole('alert')).toContainText("Tessa isn't available at that time. Choose another time. Nothing was booked and no credit was taken.");
});

test('booked on confirm: too little credit shows how to add it and cannot be confirmed', async ({ page }) => {
  const w = await world(page, { onConfirm: true, credit: 100 });
  await signedInAs(page);
  await page.goto('/t/TESSA/book');
  await chooseLesson(page);
  await expect(page.locator('[data-wallet-pay]')).toContainText('R180', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Add (credit|money)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  expect(w.confirms.length + w.inserts.length).toBe(0);
});

for (const [width, height] of [[360, 640], [1280, 585]] as const) {
  test(`booked on confirm: the confirm step and "Booked" at ${width}x${height} keep the button on the first screen`, async ({ page, browserName }, info) => {
    await page.setViewportSize({ width, height });
    await world(page, { onConfirm: true });
    await toConfirmStep(page);
    await page.waitForTimeout(400);
    const folder = process.env.SHOTS_DIR && info.project.name === 'chromium' && browserName === 'chromium' ? process.env.SHOTS_DIR : null;
    if (folder) {
      await page.screenshot({ path: `${folder}/2-confirm-${width}x${height}.png` });
      await page.screenshot({ path: `${folder}/2-confirm-${width}x${height}-full.png`, fullPage: true });
    }
    const band = await page.locator('[data-hero]').boundingBox();
    expect((band!.y + band!.height) / height).toBeLessThanOrEqual(0.32);
    const price = await page.locator('[data-lesson-facts]').getByText('R280', { exact: true }).boundingBox();
    expect(price!.y + price!.height).toBeLessThanOrEqual(height);
    const button = await page.getByRole('button', { name: 'Confirm booking' }).boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(height);
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByRole('heading', { name: 'Booked' })).toBeVisible();
    await page.waitForTimeout(400);
    if (folder) {
      await page.screenshot({ path: `${folder}/3-booked-${width}x${height}.png` });
      await page.screenshot({ path: `${folder}/3-booked-${width}x${height}-full.png`, fullPage: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('screenshots of the four screens at 390 and 1920 wide', async ({ page, browserName }, info) => {
  const folder = process.env.RUN9_SCREENS;
  test.skip(!folder || info.project.name !== 'chromium' || browserName !== 'chromium', 'only on request');
  test.setTimeout(120_000);
  // A drawn stand-in for a tutor's photo: no real person.
  await page.goto('/about');
  const photo = await page.evaluate(() => {
    const c = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    const g = c.getContext('2d')!;
    g.fillStyle = '#FAF7F2';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#64748b';
    g.beginPath();
    g.arc(128, 100, 52, 0, 7);
    g.arc(128, 270, 110, 0, 7);
    g.fill();
    return c.toDataURL('image/jpeg', 0.85);
  });
  const w = await world(page, { role: 'parent' }, photo);
  for (const [width, height] of [[390, 844], [1920, 1080]] as const) {
    await page.setViewportSize({ width, height });
    const shot = async (name: string) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${folder}/${name}-${width}.png` });
      await page.screenshot({ path: `${folder}/${name}-${width}-full.png`, fullPage: true });
    };
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto('/t/TESSA');
    await expect(page.getByRole('link', { name: 'Book a lesson' })).toBeVisible();
    await shot('1-public-page');
    await page.getByRole('link', { name: 'Book a lesson' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await shot('2-sign-in');
    await page.getByRole('link', { name: 'Create account' }).click();
    await expect(page.getByLabel('First name')).toBeVisible();
    await shot('3-sign-up');
    await page.goto('/t/TESSA/book');
    await page.getByRole('button', { name: 'Parent or guardian' }).click();
    await page.getByLabel('Email', { exact: true }).fill('made.up@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('made-up-pass-1');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('button', { name: /Booking for Sipho/ })).toBeVisible();
    await chooseLesson(page);
    await expect(page.getByRole('button', { name: 'Pay R280 from your credit' })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('4-booking-page');
  }
  expect(w.inserts).toHaveLength(0);
});
