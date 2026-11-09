import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// THE WAITING SCREEN after a lesson request is sent (the CEO, 9 Nov 2026), with the database PRETENDED (nothing here touches dev, production, the real Worker or
// any payment company; every database answer is made up by this file, like the Ozow phase 3 checks). Shows, on the five profiles:
//  - waiting: "Waiting for a tutor to accept", the lesson, the price on hold, "Cancel request" (asks first) and "View my sessions"; no "Back to Tutorlage";
//    the page only READS the payer's own request (and never the tutor's name, never the sessions table, while it waits);
//  - a tutor accepts: the SAME screen changes by itself (no reload) to the booked session with the tutor's name, the day and time in SAST, the subject and
//    "Cancel session"; the page then stops looking;
//  - ended: expired / declined / cancelled show one plain sentence (the CEO's: "No tutor accepted in time. Your R__ is back in your wallet.") and a button to
//    send a new request;
//  - cancelling a request, and cancelling a booked session, go through the two existing doors and the screen shows the result;
//  - an address with no id, a made-up id, someone else's id (the database returns nothing), nobody signed in, or a failing read: today's page, word for word;
//  - the pace (quick, slower, once a minute when the tab is hidden, a hard stop at 30 minutes with "Check now"), 375 px wide, axe (WCAG 2.2 AA) clean.
// What this does NOT show: a real tutor accepting a real request (needs two real accounts), the database's policies, or the real cancel functions.

const CORS = { 'access-control-allow-origin': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';
const REQ = '33333333-3333-4333-8333-333333333333';
const SES = '44444444-4444-4444-8444-444444444444';
const TUTOR = '55555555-5555-4555-8555-555555555555';
const CARD_REF = '66666666-6666-4666-8666-666666666666';
const T0 = new Date('2026-11-09T10:00:00Z');

type Row = Record<string, unknown>;
const requestRow = (over: Row = {}): Row => ({
  id: REQ, status: 'pending', payment_status: 'card_verified', tutor_id: null, resulting_session_id: null, requested_start: '2026-11-12T12:00:00Z', duration_hours: 1,
  charged_amount: 252, wallet_hold_rand: 252, paid_from_wallet: true, student_subject_enrollments: { subject_name: 'Mathematics' }, ...over,
});
const acceptedRow = (over: Row = {}): Row => requestRow({ status: 'accepted', payment_status: 'wallet_paid', tutor_id: TUTOR, resulting_session_id: SES, ...over });
const sessionRow = (over: Row = {}): Row => ({
  id: SES, status: 'scheduled', scheduled_start: '2026-11-12T12:00:00Z', duration_hours: 1, wallet_paid: true,
  tutor_profiles: { profiles: { full_name: 'Thandi Mokoena' } }, student_subject_enrollments: { subject_name: 'Mathematics' }, ...over,
});

const rowsOrOne = (route: Route, list: unknown[]) => {
  const wantsOne = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  return route.fulfill(wantsOne ? json(list[0] ?? null, list.length ? 200 : 406) : json(list));
};

interface Setup {
  // The single request row the page asks for (called on every read, counting from 1). null = the database returns nothing; 'fail' = the read fails.
  request?: (read: number) => Row | null | 'fail';
  session?: () => Row | null;
  // The card path: the request found by the card reference.
  byReference?: Row | null;
  // The made-up answer for the card check on the Worker.
  verify?: { status: string };
  onRpc?: (fn: string, body: string | null) => void;
}
interface Seen { supabase: string[]; requestReads: number; sessionReads: number; rpcs: Array<{ fn: string; body: string | null }>; referenceReads: number }

async function mock(page: Page, setup: Setup = {}): Promise<Seen> {
  const seen: Seen = { supabase: [], requestReads: 0, sessionReads: 0, rpcs: [], referenceReads: 0 };
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    seen.supabase.push(`${request.method()} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: 'Browser Test', role: 'student', avatar_url: null }]));
    if (/\/rpc\/my_date_of_birth/.test(url)) return route.fulfill(json('2000-01-01'));
    if (/\/rpc\/my_pending_acceptances/.test(url) || /\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return route.fulfill(json([]));
    if (/\/rpc\/wallet_open/.test(url)) return route.fulfill(json(false));
    if (/\/rpc\/(cancel_waiting_request|cancel_session)/.test(url)) {
      const fn = /\/rpc\/([a-z_]+)/.exec(url)![1];
      seen.rpcs.push({ fn, body: request.postData() });
      setup.onRpc?.(fn, request.postData());
      return route.fulfill(json(null));
    }
    if (/\/rest\/v1\/session_requests/.test(url)) {
      if (/[?&]paystack_reference=eq\./.test(url)) {
        seen.referenceReads += 1;
        return rowsOrOne(route, setup.byReference ? [setup.byReference] : []);
      }
      if (/[?&]id=eq\./.test(url)) {
        seen.requestReads += 1;
        const row = setup.request ? setup.request(seen.requestReads) : null;
        if (row === 'fail') return route.fulfill(json({ message: 'boom' }, 500));
        return rowsOrOne(route, row ? [row] : []);
      }
      return rowsOrOne(route, []);
    }
    if (/\/rest\/v1\/sessions/.test(url) && /[?&]id=eq\./.test(url)) {
      seen.sessionReads += 1;
      const row = setup.session ? setup.session() : null;
      return rowsOrOne(route, row ? [row] : []);
    }
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  if (setup.verify) {
    const verify = setup.verify;
    await page.route(/\/api\/payments\/verify\//, (route) => (route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } }) : route.fulfill(json(verify))));
  }
  return seen;
}

// Opens the page signed in (a made-up session), on Playwright's fake clock so the pace can be stepped. Time still flows by itself a little; the checks allow for it.
async function open(page: Page, setup: Setup, path: string, options: { signedIn?: boolean } = {}): Promise<Seen> {
  if (options.signedIn !== false) await signInFake(page);
  const seen = await mock(page, setup);
  await page.clock.install({ time: T0 });
  await page.goto(path);
  return seen;
}

// One step of the page's own clock, then wait until it has really asked again.
async function step(page: Page, seen: Seen, ms = 4000) {
  const before = seen.requestReads;
  await page.clock.runFor(ms);
  await expect.poll(() => seen.requestReads, { timeout: 10_000 }).toBeGreaterThan(before);
}

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
  expect(summary, `${label}: ${results.passes.length} rules passed, ${results.violations.length} violated`).toEqual([]);
}

const WALLET_URL = `/payment/callback?wallet=1&request=${REQ}`;
const FREE_URL = `/payment/callback?free=1&request=${REQ}`;
const WAITING_TITLE = 'Waiting for a tutor to accept';

async function noHorizontalScroll(page: Page, label: string) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide, `${label}: nothing sticks out sideways`).toBeLessThanOrEqual(0);
}

// ------------------------------------------------------------------ waiting ----------------------------------------------------------------------

test('a wallet request that nobody has taken: a waiting screen with the lesson, the price on hold, Cancel request and View my sessions, and no "Back to Tutorlage" (axe clean)', async ({ page, browserName, problems }) => {
  const seen = await open(page, { request: () => requestRow(), session: () => sessionRow() }, WALLET_URL);
  await expect(page.getByRole('heading', { name: WAITING_TITLE })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Your request is sent. This page updates by itself when a tutor accepts, so you can leave it open.')).toBeVisible();
  await expect(page.getByText('Mathematics · Thu 12 Nov, 14:00 SAST · 1h')).toBeVisible();
  await expect(page.locator('[data-request-facts]')).toContainText('R252');
  await expect(page.getByText('The price is on hold in your wallet. If nobody accepts in time, it goes straight back.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel request' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View my sessions' })).toBeVisible();
  await expect(page.getByText('Back to Tutorlage')).toHaveCount(0);
  await expect(page.getByText('Request sent', { exact: true })).toHaveCount(0);
  if (browserName === 'chromium') await axeClean(page, 'waiting screen');
  // It only READ: GETs of the payer's own request (this id AND this payer), with no tutor or profile column; the sessions table was never touched; no tutor's name.
  const reads = seen.supabase.filter((s) => s.includes('/rest/v1/session_requests'));
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every((s) => s.startsWith('GET ') && s.includes(`id=eq.${REQ}`) && s.includes(`requested_by_profile_id=eq.${ME}`))).toBe(true);
  expect(reads.some((s) => /tutor_profiles|full_name/.test(decodeURIComponent(s)))).toBe(false);
  expect(seen.sessionReads, 'no booking exists yet, so none is read').toBe(0);
  expect(seen.supabase.filter((s) => /^(POST|PATCH|PUT|DELETE) \/rest\/v1\//.test(s) && !s.includes('/rest/v1/profiles')), 'no write').toEqual([]);
  expect(seen.rpcs).toEqual([]);
  await expect(page.getByText('Thandi Mokoena')).toHaveCount(0);
  expect(problems.pageErrors).toEqual([]);
});

test('a free request that nobody has taken: the free wording, no price, no wallet', async ({ page }) => {
  await open(page, { request: () => requestRow({ paid_from_wallet: false, wallet_hold_rand: 0 }) }, FREE_URL);
  await expect(page.getByRole('heading', { name: WAITING_TITLE })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Free for now: you won't be charged. If nobody accepts in time, the request ends.")).toBeVisible();
  await expect(page.getByText(/wallet|On hold/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel request' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await expect(page.getByText('Cancel this request? It is a free session, so nothing is charged.')).toBeVisible();
});

// ------------------------------------------------------------------ a tutor accepts ---------------------------------------------------------------

test('a tutor accepts while the page is open: the SAME screen changes by itself to the booked session (name, day and time in SAST, subject, Cancel session), then it stops looking (axe clean)', async ({ page, browserName, problems }) => {
  const seen = await open(page, { request: (n) => (n < 2 ? requestRow() : acceptedRow()), session: () => sessionRow() }, WALLET_URL);
  await expect(page.getByRole('heading', { name: WAITING_TITLE })).toBeVisible({ timeout: 15_000 });
  const live = page.locator('[role="status"][aria-live="polite"]');
  await expect(live).toContainText(WAITING_TITLE);
  expect(seen.sessionReads).toBe(0);
  await page.clock.runFor(4000);
  await expect(page.getByRole('heading', { name: 'Your session is booked' })).toBeVisible({ timeout: 15_000 });
  // no reload: it is still the same address
  expect(page.url()).toContain('/payment/callback');
  await expect(live).toContainText('Thandi Mokoena accepted your request.');
  const facts = page.locator('[data-request-facts]');
  await expect(facts).toContainText('Thandi Mokoena');
  await expect(facts).toContainText('Thu 12 Nov, 14:00 SAST · 1h');
  await expect(facts).toContainText('Mathematics');
  await expect(page.getByText('Paid from your wallet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel session' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View my sessions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
  await expect(page.getByText('Back to Tutorlage')).toHaveCount(0);
  expect(seen.sessionReads, 'the booking is read once a tutor has accepted').toBeGreaterThanOrEqual(1);
  if (browserName === 'chromium') await axeClean(page, 'booked screen');
  // booked is settled: no more looking
  const reads = seen.requestReads;
  await page.clock.runFor(120_000);
  await page.waitForTimeout(200);
  expect(seen.requestReads, 'it stops looking once booked').toBe(reads);
  expect(problems.pageErrors).toEqual([]);
});

test('"A tutor said yes" while the booking is being finished, then the booked screen', async ({ page }) => {
  await open(page, { request: (n) => (n < 2 ? requestRow({ tutor_id: TUTOR }) : acceptedRow()), session: () => sessionRow() }, WALLET_URL);
  await expect(page.getByRole('heading', { name: 'A tutor said yes' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('We are finishing your booking. This page will show it in a moment.')).toBeVisible();
  await expect(page.getByText('Thandi Mokoena')).toHaveCount(0);
  await page.clock.runFor(4000);
  await expect(page.getByRole('heading', { name: 'Your session is booked' })).toBeVisible({ timeout: 15_000 });
});

test('accepted but the booking cannot be read by this person: it still says a tutor accepted and sends them to My sessions, with no error', async ({ page, problems }) => {
  await open(page, { request: () => acceptedRow(), session: () => null }, WALLET_URL);
  await expect(page.getByRole('heading', { name: 'Your session is booked' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('A tutor accepted your request. Open My sessions to see who and when.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'View my sessions' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(problems.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------ ended -------------------------------------------------------------------------

const ENDED: Array<[string, Row, string, string]> = [
  ['expired', requestRow({ status: 'expired' }), 'Your request has ended', 'No tutor accepted in time. Your R252 is back in your wallet.'],
  ['declined', requestRow({ status: 'declined' }), 'Your request has ended', 'The tutor could not take this request. Your R252 is back in your wallet.'],
  ['cancelled', requestRow({ status: 'cancelled' }), 'Request cancelled', 'Your request was cancelled. Your R252 is back in your wallet.'],
  ['expired (free)', requestRow({ status: 'expired', paid_from_wallet: false, wallet_hold_rand: 0 }), 'Your request has ended', 'No tutor accepted in time. You were not charged.'],
];
for (const [name, row, title, sentence] of ENDED) {
  test(`a request that ${name}: one plain sentence, "Send a new request", and it stops looking (axe clean)`, async ({ page, browserName, problems }) => {
    const seen = await open(page, { request: () => row }, name.includes('free') ? FREE_URL : WALLET_URL);
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(sentence, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send a new request' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View my sessions' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Cancel/ })).toHaveCount(0);
    await expect(page.getByText('Back to Tutorlage')).toHaveCount(0);
    if (browserName === 'chromium') await axeClean(page, `ended screen, ${name}`);
    const reads = seen.requestReads;
    await page.clock.runFor(120_000);
    await page.waitForTimeout(200);
    expect(seen.requestReads, 'it stops looking').toBe(reads);
    expect(problems.pageErrors).toEqual([]);
  });
}

test('"Send a new request" goes to the booking page; "View my sessions" opens Sessions & history and drops the word from the address', async ({ page }) => {
  await open(page, { request: () => requestRow({ status: 'expired' }) }, WALLET_URL);
  await page.getByRole('button', { name: 'View my sessions' }).click({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Sessions & history' })).toBeVisible({ timeout: 15_000 });
  expect(new URL(page.url()).search, 'the word is dropped from the address').not.toContain('view=');
  await page.goBack();
  await page.getByRole('button', { name: 'Send a new request' }).click({ timeout: 15_000 });
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', { timeout: 15_000 });
  expect(page.url()).not.toContain('/payment/callback');
});

test('a booked session that was cancelled (by the tutor) shows who cancelled and where the money went', async ({ page }) => {
  await open(page, { request: () => acceptedRow({ status: 'cancelled', payment_status: 'wallet_refunded' }), session: () => sessionRow({ status: 'cancelled_by_tutor' }) }, WALLET_URL);
  await expect(page.getByRole('heading', { name: 'This session was cancelled' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Your tutor cancelled this session. Your R252 went back into your wallet as credit.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a new request' })).toBeVisible();
});

// ------------------------------------------------------------------ cancelling --------------------------------------------------------------------

test('Cancel request asks first; "Keep it" cancels nothing; "Yes, cancel" uses the existing door and the screen shows the result', async ({ page, problems }) => {
  let phase: 'waiting' | 'cancelled' = 'waiting';
  const seen = await open(page, { request: () => (phase === 'waiting' ? requestRow() : requestRow({ status: 'cancelled' })), onRpc: () => { phase = 'cancelled'; } }, WALLET_URL);
  await page.getByRole('button', { name: 'Cancel request' }).click({ timeout: 15_000 });
  await expect(page.getByText('Cancel this request? The price on hold goes straight back into your wallet.')).toBeVisible();
  await page.getByRole('button', { name: 'Keep it' }).click();
  await expect(page.getByRole('button', { name: 'Cancel request' })).toBeVisible();
  expect(seen.rpcs, 'asking and keeping cancels nothing').toEqual([]);
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await page.getByRole('button', { name: 'Yes, cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Request cancelled' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Your request was cancelled. Your R252 is back in your wallet.')).toBeVisible();
  expect(seen.rpcs.map((c) => c.fn)).toEqual(['cancel_waiting_request']);
  expect(JSON.parse(seen.rpcs[0].body ?? '{}')).toEqual({ p_request_id: REQ });
  expect(problems.pageErrors).toEqual([]);
});

test('Cancel session asks first with the wallet wording, uses the existing door, and the screen shows the session cancelled and the money back', async ({ page, problems }) => {
  let phase: 'booked' | 'cancelled' = 'booked';
  const seen = await open(page, {
    request: () => (phase === 'booked' ? acceptedRow() : acceptedRow({ status: 'cancelled', payment_status: 'wallet_refunded' })),
    session: () => sessionRow({ status: phase === 'booked' ? 'scheduled' : 'cancelled_by_student' }),
    onRpc: () => { phase = 'cancelled'; },
  }, WALLET_URL);
  await page.getByRole('button', { name: 'Cancel session' }).click({ timeout: 15_000 });
  await expect(page.getByText('Cancel this session? The payment goes back into your wallet as credit.')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, cancel' }).click();
  await expect(page.getByRole('heading', { name: 'This session was cancelled' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('This session was cancelled. Your R252 went back into your wallet as credit.')).toBeVisible();
  expect(seen.rpcs.map((c) => c.fn)).toEqual(['cancel_session']);
  expect(JSON.parse(seen.rpcs[0].body ?? '{}')).toEqual({ p_session_id: SES, p_reason: null });
  expect(problems.pageErrors).toEqual([]);
});

test('a cancel the database refuses shows its plain sentence and the screen stays as it was', async ({ page }) => {
  const seen = await open(page, { request: () => requestRow() }, WALLET_URL);
  await page.route(/\/rpc\/cancel_waiting_request/, (route) => (route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    : route.fulfill(json({ message: 'This request can no longer be cancelled here. If a tutor has accepted it, cancel it from your upcoming sessions.' }, 400))));
  await page.getByRole('button', { name: 'Cancel request' }).click({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Yes, cancel' }).click();
  await expect(page.getByRole('alert')).toContainText('can no longer be cancelled here');
  await expect(page.getByRole('heading', { name: WAITING_TITLE })).toBeVisible();
  expect(seen.requestReads).toBeGreaterThan(0);
});

// ------------------------------------------------------------------ today's page --------------------------------------------------------------------

const TODAY_WALLET = "Your request is sent. The price is on hold in your wallet. If nobody accepts in time, it goes straight back. We'll let you know when a tutor accepts.";
async function expectTodaysPage(page: Page, text: string) {
  await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(text)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Tutorlage' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/Something went wrong|could not|error/i)).toHaveCount(0);
}

test('no request id in the address: today\'s page, word for word, and no look at any request', async ({ page, problems }) => {
  const seen = await open(page, { request: () => requestRow() }, '/payment/callback?wallet=1');
  await expectTodaysPage(page, TODAY_WALLET);
  expect(seen.requestReads).toBe(0);
  expect(problems.pageErrors).toEqual([]);
});

test('free, with no request id: today\'s page, word for word', async ({ page }) => {
  await open(page, {}, '/payment/callback?free=1');
  await expectTodaysPage(page, "Free for now: you won't be charged. Your request is now visible to qualifying tutors, and we'll let you know when one accepts.");
});

for (const bad of ['not-an-id', "'%20or%201=1--", '33333333-3333-4333-8333-33333333333', '../../x']) {
  test(`an address whose request is "${bad}" is not a real id: today's page, and the database is not asked about any request`, async ({ page }) => {
    const seen = await open(page, { request: () => requestRow() }, `/payment/callback?wallet=1&request=${bad}`);
    await expectTodaysPage(page, TODAY_WALLET);
    expect(seen.requestReads).toBe(0);
  });
}

test('someone else\'s request (the database returns nothing): today\'s page, no error, and it does not keep asking', async ({ page, problems }) => {
  const seen = await open(page, { request: () => null }, WALLET_URL);
  await expectTodaysPage(page, TODAY_WALLET);
  expect(seen.requestReads).toBe(1);
  await page.clock.runFor(60_000);
  await page.waitForTimeout(200);
  expect(seen.requestReads, 'nothing to wait for, so it does not keep looking').toBe(1);
  expect(problems.pageErrors).toEqual([]);
});

test('nobody signed in: today\'s page, word for word, and no look at any request', async ({ page }) => {
  const seen = await open(page, { request: () => requestRow() }, WALLET_URL, { signedIn: false });
  await expectTodaysPage(page, TODAY_WALLET);
  expect(seen.requestReads).toBe(0);
});

test('a request whose card check is not finished is not "sent": today\'s page', async ({ page }) => {
  await open(page, { request: () => requestRow({ payment_status: 'initiated' }) }, WALLET_URL);
  await expectTodaysPage(page, TODAY_WALLET);
});

test('the first look fails: today\'s page with no error, then the waiting screen as soon as a look works', async ({ page, problems }) => {
  const seen = await open(page, { request: (n) => (n < 3 ? 'fail' : requestRow()) }, WALLET_URL);
  await expectTodaysPage(page, TODAY_WALLET);
  await step(page, seen);
  await step(page, seen);
  await expect(page.getByRole('heading', { name: WAITING_TITLE })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('We could not check just now. We will keep trying.')).toHaveCount(0);
  expect(problems.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------ the card path ---------------------------------------------------------------

test('a card return finds the request by its card reference and becomes the waiting screen, with the card wording', async ({ page }) => {
  const seen = await open(page, { verify: { status: 'card_verified' }, byReference: { id: REQ }, request: () => requestRow({ paid_from_wallet: false, wallet_hold_rand: 0 }) }, `/payment/callback?reference=${CARD_REF}`);
  await expect(page.getByRole('heading', { name: WAITING_TITLE })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Your card is charged only when a tutor accepts. If nobody accepts in time, the request ends and you are not charged.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await expect(page.getByText('Cancel this request? You have not been charged.')).toBeVisible();
  expect(seen.supabase.some((s) => s.includes(`paystack_reference=eq.${CARD_REF}`) && s.includes(`requested_by_profile_id=eq.${ME}`))).toBe(true);
});

test('a card return whose request cannot be found is exactly today\'s card page', async ({ page }) => {
  await open(page, { verify: { status: 'card_verified' }, byReference: null }, `/payment/callback?reference=${CARD_REF}`);
  await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Your request is now visible to qualifying tutors. Your card is charged only when one accepts — we'll let you know. The R1 card check is being refunded.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Tutorlage' })).toBeVisible();
});

test('a card that did not go through is still the failure page', async ({ page }) => {
  await open(page, { verify: { status: 'failed' }, byReference: { id: REQ }, request: () => requestRow() }, `/payment/callback?reference=${CARD_REF}`);
  await expect(page.getByRole('heading', { name: "Your request wasn't sent" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: WAITING_TITLE })).toHaveCount(0);
});

// ------------------------------------------------------------------ the pace ----------------------------------------------------------------------

test('the pace: a tab that is hidden looks once a minute', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the pace');
  const seen = await open(page, { request: () => requestRow() }, WALLET_URL);
  await expect(page.getByRole('heading', { name: WAITING_TITLE })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await step(page, seen, 5000); // the look already planned (visible pace) happens, and plans the next one a minute away
  const reads = seen.requestReads;
  await page.clock.runFor(30_000);
  await page.waitForTimeout(250);
  expect(seen.requestReads, 'half a minute later: still no new look').toBe(reads);
  await step(page, seen, 35_000);
  expect(seen.requestReads).toBe(reads + 1);
});

test('the pace: after 30 minutes of waiting it stops by itself, says so, and "Check now" looks once more', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the pace');
  test.setTimeout(120_000);
  const seen = await open(page, { request: () => requestRow() }, WALLET_URL);
  await expect(page.getByRole('heading', { name: WAITING_TITLE })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  const stopNote = page.locator('[data-watch-stopped]');
  for (let i = 0; i < 60 && !(await stopNote.isVisible()); i += 1) {
    const before = seen.requestReads;
    await page.clock.runFor(60_000);
    for (let k = 0; k < 100 && seen.requestReads === before && !(await stopNote.isVisible()); k += 1) await page.waitForTimeout(20);
  }
  await expect(stopNote).toBeVisible({ timeout: 15_000 });
  await expect(stopNote).toContainText('We stopped checking automatically. Press Check now, or open My sessions at any time.');
  expect(seen.requestReads, 'about one look a minute for 30 minutes').toBeGreaterThanOrEqual(25);
  expect(seen.requestReads).toBeLessThanOrEqual(40);
  const stopped = seen.requestReads;
  await page.clock.runFor(10 * 60_000);
  await page.waitForTimeout(250);
  expect(seen.requestReads, 'stopped means stopped').toBe(stopped);
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect.poll(() => seen.requestReads, { timeout: 10_000 }).toBe(stopped + 1);
  await page.clock.runFor(10 * 60_000);
  await page.waitForTimeout(250);
  expect(seen.requestReads, 'one press, one look').toBe(stopped + 1);
});

test('the look keeps going while the answer is "waiting": quick for the first two minutes (every 4 seconds), then every 15 seconds', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the pace');
  const seen = await open(page, { request: () => requestRow() }, WALLET_URL);
  await expect(page.getByRole('heading', { name: WAITING_TITLE })).toBeVisible({ timeout: 15_000 });
  // 40 seconds of the page's own clock in 4-second steps: ten more looks
  const first = seen.requestReads;
  for (let i = 0; i < 10; i += 1) await step(page, seen, 4000);
  expect(seen.requestReads - first).toBeGreaterThanOrEqual(10);
  expect(seen.requestReads - first).toBeLessThanOrEqual(14);
});

// ------------------------------------------------------------------ small screens and the live region -------------------------------------------

test('375 px wide: waiting, booked and ended all fit with nothing sticking out sideways', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let n = 0;
  await open(page, {
    request: () => {
      n += 1;
      return n === 1 ? requestRow() : n === 2 ? acceptedRow() : requestRow({ status: 'expired' });
    },
    session: () => sessionRow({ tutor_profiles: { profiles: { full_name: 'Nokuthula Mkhwanazi-Van Der Merwe' } } }),
  }, WALLET_URL);
  await expect(page.getByRole('heading', { name: WAITING_TITLE })).toBeVisible({ timeout: 15_000 });
  await noHorizontalScroll(page, 'waiting');
  await expect(page.getByRole('button', { name: 'Cancel request' })).toBeInViewport();
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await expect(page.getByRole('button', { name: 'Yes, cancel' })).toBeVisible();
  await noHorizontalScroll(page, 'waiting, asking');
  await page.clock.runFor(4000);
  await expect(page.getByRole('heading', { name: 'Your session is booked' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-request-facts]')).toContainText('Nokuthula Mkhwanazi-Van Der Merwe');
  await noHorizontalScroll(page, 'booked');
});

test('the words that change sit in one polite live region (a screen reader hears the change)', async ({ page }) => {
  await open(page, { request: (n) => (n < 2 ? requestRow() : requestRow({ status: 'expired' })) }, WALLET_URL);
  const live = page.locator('[role="status"][aria-live="polite"]');
  await expect(live).toHaveCount(1);
  await expect(live).toContainText(WAITING_TITLE, { timeout: 15_000 });
  await page.clock.runFor(4000);
  await expect(live).toContainText('No tutor accepted in time. Your R252 is back in your wallet.', { timeout: 15_000 });
  await expect(live).toHaveAttribute('aria-atomic', 'true');
});
