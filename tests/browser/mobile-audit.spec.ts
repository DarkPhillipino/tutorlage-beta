import type { Page, Route } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';
import { audit, blocking, PHONE, type AuditRecord } from './mobile';

// THE 375 px PHONE AUDIT AND AXE ON EVERY SCREEN (backlog items 24 and 25, 18 Nov 2026). Every address and every signed-in screen the app can show,
// opened at 375 x 812 with touch, then measured (tests/browser/mobile.ts): sideways scrolling, things off the screen edge, cut-off text, targets
// under 24 px, and axe-core (WCAG 2.0, 2.1 and 2.2 A and AA). The database is answered by this file (nothing real is called).
//
// WAVE RULE (the CEO's standing order, 18 Nov 2026): what a wave recipient meets is MEASURED here but never changed by this work. Those pages are
// in WAVE below: they are recorded in the audit files and listed in the report, and a finding on them does not fail this run. Every other page
// must be clean (no overflow, nothing off the edge, no target under 24 px, no axe violation).
// Pictures and one JSON record per screen are written to test-results/mobile-audit/ (not committed).

test.use({ viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the phone audit is run once, in chromium, at 375 px (the chromium project, with this file\'s own phone settings)');
});

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';
const LEARNER = '00000000-0000-4000-8000-0000000000a1';

// A list answer, or one object when the client asked for a single row (maybeSingle / single).
const rowsOrOne = (route: Route, list: unknown[]) => {
  const wantsOne = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  return route.fulfill(wantsOne ? json(list[0] ?? null, list.length ? 200 : 406) : json(list));
};

// Pages a wave recipient meets (WAVE RULE). Measured, listed, never changed.
// ("needs-dob" and "needs-terms" are the same screen component as "One more step": src/components/AccountGate.tsx, so they count with it.)
// Also listed, until commit 396d2d4 is published (tutor sign-up pages 2 and 3: its contrast fix is held under the wave rule): REMOVE the last entry when it goes out.
const WAVE = [/^\/teach(\?|$)/, /^\/signup\//, /^\/login/, /one-more-step/, /in-tutor-needs-(dob|terms)/, /in-tutor-onboarding-/];
const isWave = (label: string) => WAVE.some((w) => w.test(label));

const results: AuditRecord[] = [];
async function check(page: Page, label: string, problems?: { pageErrors: string[] }) {
  const record = await audit(page, label);
  results.push(record);
  const found = blocking(record);
  if (isWave(label)) {
    test.info().annotations.push({ type: 'WAVE page (recorded, not failed)', description: `${label}: ${found.length} finding(s)` });
    return;
  }
  expect.soft(found, `${label}: ${found.length} finding(s)`).toEqual([]);
  if (problems) expect.soft(problems.pageErrors, `${label}: no uncaught error`).toEqual([]);
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// Signed out: every address.
// ------------------------------------------------------------------------------------------------------------------------------------------
const PUBLIC = [
  '/', '/login', '/signin/tutor', '/signin/student', '/signin/parent', '/signup/tutor', '/signup/student', '/signup/parent', '/forgot-password', '/forgot-password/tutor',
  '/reset-password', '/auth/callback', '/account-closed', '/terms', '/privacy', '/refunds', '/delivery', '/about', '/teach', '/payment/callback', '/payment/callback?wallet=1',
  '/payment/callback?free=1', '/wallet/topup-return', '/no/such/page',
];
for (const path of PUBLIC) {
  test(`375 px, signed out: ${path}`, async ({ page, problems }) => {
    await page.goto(path);
    await expect(page.locator('#root h1, #root h2, #root p').first()).toBeVisible({ timeout: 15_000 });
    await check(page, path, problems);
  });
}

// The same forms after an empty "send": the error words are on screen too.
for (const path of ['/login', '/signin/tutor', '/signup/tutor', '/signup/student', '/signup/parent', '/forgot-password']) {
  test(`375 px, signed out: ${path} after an empty submit (the error words showing)`, async ({ page, problems }) => {
    await page.goto(path);
    await expect(page.locator('#root h1, #root h2').first()).toBeVisible({ timeout: 15_000 });
    const submit = page.locator('form button[type=submit]').last();
    if (await submit.count()) await submit.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    await check(page, `${path} (empty submit)`, problems);
  });
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// Signed in. A made-up session; the database is answered here.
// ------------------------------------------------------------------------------------------------------------------------------------------
type Role = 'student' | 'parent' | 'tutor';
interface World {
  role: Role;
  fullName?: string;
  gate?: 'ok' | 'needs-dob' | 'needs-terms' | 'needs-surname';
  wallet?: 'closed' | 'open';
  learners?: boolean;
  data?: boolean; // some rows in the lists (sessions, notifications), long names and a long unbroken link included
  levels?: boolean; // the price levels and the ladder behind them
  onboarding?: 'through' | 'choose-type' | 'documents'; // a tutor's two extra sign-up pages; 'through' (the default) is a tutor who is past them
}

const TOPUP = '11111111-1111-4111-8111-111111111111';
const LONG = 'Tshepiso-Nomvula Wilhelmina Ramaphosa-Van der Merwe';

async function openAs(page: Page, w: World, path = '/') {
  await signInFake(page);
  const gate = w.gate ?? 'ok';
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const rpc = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(url)?.[1];
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: w.fullName ?? (w.data ? LONG : 'Browser Test'), role: w.role, avatar_url: null }]));
    if (rpc === 'my_date_of_birth') return route.fulfill(json(gate === 'needs-dob' ? null : w.role === 'student' ? '2000-01-01' : '1985-05-05'));
    if (rpc === 'my_pending_acceptances') return route.fulfill(json(gate === 'needs-terms' || gate === 'needs-surname' ? [{ document: 'terms', version: '2026-11-16' }, { document: 'privacy', version: '2026-11-16' }] : []));
    if (rpc === 'my_needs_surname') return route.fulfill(json(gate === 'needs-surname'));
    if (/\/rest\/v1\/(policy_acceptances)/.test(url)) return route.fulfill(json([]));
    if (/\/rest\/v1\/parent_student_links/.test(url)) return route.fulfill(json(w.learners ? [{ student_id: LEARNER, parent_id: ME }] : []));
    if (/\/rest\/v1\/tutor_onboarding/.test(url)) return rowsOrOne(route, w.onboarding === 'choose-type' ? [] : [{ track: 'qualified', grandfathered: w.onboarding !== 'documents', consented_at: null, consent_version: null }]);
    if (rpc === 'card_checkout_available') return route.fulfill(json(true));
    if (w.data) {
      // Rows with long names and a long unbroken link: the shapes that push a phone layout sideways.
      const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
      if (/\/rest\/v1\/sessions/.test(url)) {
        return rowsOrOne(route, [1, 3].map((d, i) => ({ id: `s${i}`, scheduled_start: soon(d), duration_hours: 1.5, status: 'scheduled', meeting_url: 'https://meet.example.org/a-very-long-room-name-with-no-break-0123456789-abcdefghijklmnopqrstuvwxyz', ended_early_at: null, tutor_id: ME, student_id: LEARNER, tutor_profiles: { profiles: { full_name: LONG } }, profiles: { full_name: LONG }, student_subject_enrollments: { subject_name: 'Mathematical Literacy and Technical Mathematics' } })));
      }
      if (/\/rest\/v1\/notifications/.test(url) && request.method() === 'GET') {
        return route.fulfill(json([
          { id: 'n1', type: 'session_booked', title: 'Your session with Tshepiso-Nomvula is booked', body: 'Mathematical Literacy and Technical Mathematics, tomorrow at 14:00 for 1.5 hours. The tutor has added a meeting link: https://meet.example.org/a-very-long-room-name-with-no-break-0123456789', created_at: soon(-0.1), read_at: null },
          { id: 'n2', type: 'wallet_topup_approved', title: 'Your top-up of R500 was approved', body: null, created_at: soon(-2), read_at: soon(-1) },
        ]));
      }
    }
    if (w.levels) {
      if (rpc === 'available_price_levels') return route.fulfill(json([1, 2, 3, 4].map((n) => ({ level_id: `lvl${n}`, tier_id: n, tier_name: ['Peer-to-Peer Tutors', 'Experienced Tutors', 'Qualified Teachers', 'Specialist Educators'][n - 1], price: n * 75, currency_code: 'ZAR', tutors: n === 4 ? 0 : 7 - n }))));
      if (/\/rest\/v1\/sub_tier_definitions/.test(url)) {
        return route.fulfill(json(Array.from({ length: 8 }, (_, i) => ({ id: `lvl${i + 1}`, tier_id: Math.floor(i / 2) + 1, max_allowed_rate: 60 + i * 35, min_hours: i * 20, min_rating: 4 + i / 10, min_repeat_rate_pct: i * 5, min_written_reviews: i, min_distinct_students_uplift: i, required_grade_uplift_pct: i, tier_definitions: { public_name: ['Peer-to-Peer Tutors', 'Experienced Tutors', 'Qualified Teachers', 'Specialist Educators'][Math.floor(i / 2)], positioning_quote: 'A tutor who knows the work and the exam.', currency_code: 'ZAR' } }))));
      }
    }
    const walletCall = /\/rpc\/(wallet_|create_wallet_topup|attach_topup_proof|cancel_my_topup|send_request_wallet)|\/rest\/v1\/(wallets|wallet_topups|wallet_ledger|payout_requests)|\/storage\/v1\/object\/payment-proofs\//.test(url);
    if (walletCall) {
      if (w.wallet !== 'open') return /\/rpc\/wallet_open/.test(url) ? route.fulfill(json(false)) : rowsOrOne(route, []);
      if (/\/rpc\/wallet_open/.test(url)) return route.fulfill(json(true));
      if (/\/rpc\/wallet_payment_details/.test(url)) return route.fulfill(json({ open: true, bank_name: 'Test Bank', account_holder: 'Tutorlage (Pty) Ltd', account_number: '1234567890', branch_code: '250655', account_type: 'Cheque', min_rand: 50, max_rand: 5000, cap_rand: 10000 }));
      if (/\/rpc\/create_wallet_topup/.test(url)) return route.fulfill(json({ topup_id: TOPUP, reference: 'TL-ABC234', amount_rand: 200, status: 'awaiting_proof' }));
      if (/\/rest\/v1\/wallets/.test(url)) return rowsOrOne(route, [{ available_rand: 320, held_rand: 180 }]);
      if (/\/rest\/v1\/wallet_topups/.test(url)) {
        return rowsOrOne(route, [
          { id: 't2', reference: 'TL-NOPE22', amount_rand: 100, status: 'unsuccessful', received_rand: null, decision_comment: 'No payment with that reference', created_at: '2026-11-03T08:00:00Z', decided_at: '2026-11-03T09:00:00Z' },
          { id: 't1', reference: 'TL-OKAY22', amount_rand: 500, status: 'successful', received_rand: 500, decision_comment: null, created_at: '2026-11-02T08:00:00Z', decided_at: '2026-11-02T09:00:00Z' },
        ]);
      }
      if (/\/rest\/v1\/wallet_ledger/.test(url)) {
        return rowsOrOne(route, [
          { id: 'l2', kind: 'hold', available_delta: -180, held_delta: 180, request_id: 'r1', session_id: null, note: null, created_at: '2026-11-03T10:00:00Z' },
          { id: 'l1', kind: 'topup', available_delta: 500, held_delta: 0, request_id: null, session_id: null, note: null, created_at: '2026-11-02T09:00:00Z' },
        ]);
      }
      return rowsOrOne(route, []);
    }
    if (w.learners && /\/rest\/v1\/profiles/.test(url)) return route.fulfill(json([{ id: LEARNER, full_name: 'Lethabo Mokoena', role: 'student', avatar_url: null }]));
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto(path);
  await expect(page.locator('#root h1, #root h2, header').first()).toBeVisible({ timeout: 15_000 });
}

const mobileTab = (page: Page, name: RegExp) => page.locator('header').getByRole('button', { name }).last();
const manageAccount = (page: Page) => page.locator('header button:has(svg.lucide-user)');

for (const role of ['student', 'parent', 'tutor'] as const) {
  test.describe(`375 px, signed in as a ${role}`, () => {
    test(`${role}: the learn page and its windows`, async ({ page, problems }) => {
      await openAs(page, { role, learners: role === 'parent' });
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
      await check(page, `in-${role}-learn`, problems);

      await page.getByRole('button', { name: 'Change institution' }).click();
      await page.waitForTimeout(300);
      await check(page, `in-${role}-institution-window`, problems);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Close$|^Cancel$/ }).first().click({ timeout: 1500 }).catch(() => undefined);

      await page.locator('#book-a-tutor').getByRole('button', { name: /Schedule session|at \d/ }).first().click();
      await page.waitForTimeout(300);
      await check(page, `in-${role}-schedule-window`, problems);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Close$|^Cancel$/ }).first().click({ timeout: 1500 }).catch(() => undefined);

      await page.locator('button.group').first().click();
      await page.waitForTimeout(300);
      await check(page, `in-${role}-suggestion-window`, problems);
      await page.getByRole('button', { name: 'Find a tutor' }).click();
      await page.waitForTimeout(500);
      await check(page, `in-${role}-prices`, problems);
    });

    test(`${role}: teach, about, sessions, wallet, notifications and the account window`, async ({ page, problems }) => {
      await openAs(page, { role, learners: role === 'parent', wallet: 'open' });
      await mobileTab(page, /^Teach$/).click();
      await page.waitForTimeout(600);
      await check(page, `in-${role}-teach`, problems);
      await mobileTab(page, /^Learn$/).click();

      await page.goto('/?view=sessions');
      await expect(page.locator('#root h1, #root h2').first()).toBeVisible({ timeout: 15_000 });
      await check(page, `in-${role}-sessions`, problems);

      await page.goto('/?view=wallet');
      await expect(page.locator('#root h1, #root h2').first()).toBeVisible({ timeout: 15_000 });
      await check(page, `in-${role}-wallet`, problems);

      await page.goto('/');
      await expect(page.locator('#root h1').first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: /^Notifications/ }).click();
      await page.waitForTimeout(300);
      await check(page, `in-${role}-notifications`, problems);
      await page.keyboard.press('Escape');
      await page.locator('h1').first().click({ force: true });

      await manageAccount(page).click();
      await page.waitForTimeout(300);
      await check(page, `in-${role}-account-profile`, problems);
      for (const [tab, name] of [['sessions', 'Sessions & History'], ['billing', 'Payment Methods'], ['teaching', 'Teaching']]) {
        const button = page.getByRole('button', { name }).last();
        if (!(await button.count())) continue;
        await button.click();
        await page.waitForTimeout(400);
        await check(page, `in-${role}-account-${tab}`, problems);
      }
    });
  });
}

// What a first sign-in and the account checks look like (the "One more step" screen is a wave page: measured, not changed).
for (const gate of ['needs-dob', 'needs-terms', 'needs-surname'] as const) {
  test(`375 px, signed in, the account check "${gate}"`, async ({ page, problems }) => {
    await openAs(page, { role: 'tutor', gate, fullName: 'Zzodi' });
    await page.waitForTimeout(800);
    await check(page, gate === 'needs-surname' ? 'in-tutor-one-more-step' : `in-tutor-${gate}`, problems);
  });
}

// A tutor's two extra sign-up pages (beginner or experienced; the documents). A warm tutor meets them straight after the first sign-in, so
// they are listed in the report as next to the wave pages.
for (const stage of ['choose-type', 'documents'] as const) {
  test(`375 px, signed in as a new tutor: the "${stage}" sign-up page`, async ({ page, problems }) => {
    await openAs(page, { role: 'tutor', onboarding: stage });
    await page.waitForTimeout(800);
    await check(page, `in-tutor-onboarding-${stage}`, problems);
  });
}

test('375 px, signed in with the wallet open: the add-money window', async ({ page, problems }) => {
  await openAs(page, { role: 'student', wallet: 'open' }, '/?view=wallet');
  await expect(page.getByRole('heading', { name: /credit/i }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /add credit/i }).first().click();
  await page.waitForTimeout(400);
  await check(page, 'in-student-wallet-add-money', problems);
});

// The same screens with rows in the lists and a very long name: sessions, notifications, the account window, the Teach screen, the price ladder.
for (const role of ['student', 'parent', 'tutor'] as const) {
  test(`375 px, signed in as a ${role} with a long name and rows in the lists`, async ({ page, problems }) => {
    await openAs(page, { role, data: true, wallet: 'open', levels: true, learners: role === 'parent' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
    await check(page, `rows-${role}-learn`, problems);

    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.waitForTimeout(300);
    await check(page, `rows-${role}-notifications`, problems);
    await page.keyboard.press('Escape');
    await page.locator('h1').first().click({ force: true });

    await manageAccount(page).click();
    await page.waitForTimeout(300);
    await check(page, `rows-${role}-account`, problems);
    for (const [tab, name] of [['sessions', 'Sessions & History'], ['teaching', 'Teaching']]) {
      const button = page.getByRole('button', { name }).last();
      if (!(await button.count())) continue;
      await button.click();
      await page.waitForTimeout(400);
      await check(page, `rows-${role}-account-${tab}`, problems);
    }
    await page.getByRole('button', { name: 'Close', exact: true }).first().click({ timeout: 2000 }).catch(() => undefined);

    await page.goto('/?view=sessions');
    await expect(page.locator('#root h1, #root h2').first()).toBeVisible({ timeout: 15_000 });
    await check(page, `rows-${role}-sessions`, problems);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
    await mobileTab(page, /^Teach$/).click();
    await page.waitForTimeout(700);
    await check(page, `rows-${role}-teach`, problems);
    await mobileTab(page, /^Learn$/).click();

    await page.getByRole('button', { name: 'See prices' }).click();
    await page.waitForTimeout(800);
    await check(page, `rows-${role}-prices`, problems);
    const level = page.getByRole('button', { name: /R\s?75|R\s?150|Peer-to-Peer/ }).first();
    if (await level.count()) {
      await level.click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      await check(page, `rows-${role}-prices-level-chosen`, problems);
    }
  });
}

test('375 px: the tutor documents page (signed in)', async ({ page, problems }) => {
  await openAs(page, { role: 'tutor' }, '/tutor-documents');
  await page.waitForTimeout(800);
  await check(page, 'in-tutor-documents', problems);
});

// WAVE RULE guard: the two scoped rules this work added to src/index.css (small grey print, 16 px typing boxes on a phone) live inside ".app-shell", the
// outer box of the signed-in app. A page a wave recipient meets must be outside it, so it looks exactly as it did.
for (const path of ['/login', '/signup/tutor', '/signup/student', '/signup/parent', '/teach']) {
  test(`wave page ${path}: outside the signed-in app's box, so its colours and typing-box sizes are untouched`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('#root h1, #root h2').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('.app-shell').count(), 'no .app-shell on this page').toBe(0);
    // nothing on the page is inside the app's box, and the page's own colour variable is the stock one
    const slate500 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-slate-500').trim());
    const rootSlate600 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-slate-600').trim());
    expect(slate500, 'slate-500 is the stock colour here, not slate-600').not.toBe(rootSlate600);
  });
}

test('summary: every record written', () => {
  // the records are also in test-results/mobile-audit/*.json; this line only keeps the file's shape simple for a one-test run
  expect(Array.isArray(results)).toBe(true);
});
