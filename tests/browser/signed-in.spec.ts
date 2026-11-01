import type { Page } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// FUNC-STATES-01 / SA-NETWORK-01, the signed-in half: a made-up signed-in STUDENT (never accepted by any server) opens the real app while the
// database is answered by the test in one of three ways, and every top-level tab is opened. The bar: no uncaught error, never the "Something
// went wrong" crash screen, always words on screen. What this does NOT show: any tutor, parent or admin screen, any write, the booking itself.
//  - empty:   every list the app asks for is empty (a brand-new account, nobody has signed up yet);
//  - failing: every read except the person's own profile and account checks answers 500;
//  - hanging: the same reads never answer (a phone with one bar of signal).
type Mode = 'empty' | 'failing' | 'hanging';

const CORS = { 'access-control-allow-origin': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

async function openAsStudent(page: Page, mode: Mode) {
  await signInFake(page);
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    // The person's own profile and the account gate's questions are always answered, so the app is let in.
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: '00000000-0000-4000-8000-000000000001', full_name: 'Browser Test', role: 'student', avatar_url: null }]));
    if (/\/rpc\/my_date_of_birth/.test(url)) return route.fulfill(json('2000-01-01'));
    if (/\/rpc\/my_pending_acceptances/.test(url) || /\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return route.fulfill(json([]));
    if (mode === 'hanging') return; // never answered
    if (mode === 'failing') return route.fulfill(json({ message: 'boom', code: 'XX000' }, 500));
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/');
  await expect(page.locator('header').getByText('Tutorlage').first()).toBeVisible({ timeout: 15_000 });
}

async function everyTab(page: Page): Promise<string[]> {
  const buttons = page.locator('header nav > button');
  const count = await buttons.count();
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const name = ((await buttons.nth(i).innerText()) || '').trim();
    names.push(name);
    await buttons.nth(i).click();
    await page.waitForTimeout(400);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    const words = await bodyWords(page);
    console.log(`  tab "${name}": ${words.length} characters of page text, starts: ${JSON.stringify(words.slice(0, 110))}`);
    expect(words.length, `tab "${name}" shows words besides the header and footer`).toBeGreaterThan(20);
  }
  return names;
}

// The page's text without the header and the footer (so a header alone cannot make a blank page look full).
async function bodyWords(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector('#root')!.cloneNode(true) as HTMLElement;
    root.querySelectorAll('header, footer').forEach((e) => e.remove());
    return (root.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

for (const mode of ['empty', 'failing', 'hanging'] as const) {
  test(`signed-in student, database ${mode}: the app opens, every tab opens, no crash screen, no uncaught error`, async ({ page, problems, isMobile }) => {
    test.skip(isMobile, 'the tab buttons are in the desktop header (hidden on a phone)');
    await openAsStudent(page, mode);
    const tabs = await everyTab(page);
    expect(tabs.length, 'the header has tabs').toBeGreaterThan(1);
    console.log(`[${mode}] tabs opened: ${tabs.join(', ')}`);
    expect(problems.pageErrors).toEqual([]);
    expect(await page.getByText('Something went wrong').count()).toBe(0);
  });
}

// SA-NETWORK-01 / FUNC-STATES-01 (the fix of 1 Nov 2026, src/lib/readTimeout.ts): with the database never answering, the Learn tab's
// "School results" panel used to stay on "Loading…" for ever. Reads are now given up on after 30 seconds, and the panel shows the plain
// sentence and its "Try again" button. This runs the real 30 seconds, once, in chromium.
test('signed-in student, database never answers: after 30 seconds the School results panel leaves "Loading…" and offers "Try again"', async ({ page, isMobile, browserName, problems }) => {
  test.skip(isMobile || browserName !== 'chromium', 'a 30 second wait: run once, in chromium');
  test.setTimeout(90_000);
  await openAsStudent(page, 'hanging');
  await page.locator('header nav > button').first().click();
  await expect(page.getByText('Loading…').first(), 'while waiting, a loading line is shown').toBeVisible();
  await expect.poll(async () => bodyWords(page), { timeout: 50_000, intervals: [2000], message: 'the panel gives up and says so' }).toContain('This is taking too long. Check your connection, then try again.');
  await expect(page.getByRole('button', { name: 'Try again' }).first()).toBeVisible();
  expect(await bodyWords(page), 'no "Loading…" is left in the School results panel').not.toMatch(/School results \(optional\)\s*Loading…/);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  expect(problems.pageErrors).toEqual([]);
  // "Try again" asks again (a new request leaves the browser) and the page stays usable.
  const before = problems.failedRequests.length;
  await page.getByRole('button', { name: 'Try again' }).first().click();
  await expect(page.getByText('Loading…').first()).toBeVisible();
  expect(problems.failedRequests.length).toBeGreaterThanOrEqual(before);
});

// SA-NETWORK-01, signed-in double submit: the school-results consent button is a WRITE. Two taps in the same instant must send one write.
test('signed-in student: a double tap on "Add school results" sends the consent once', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the tab buttons are in the desktop header (hidden on a phone)');
  await openAsStudent(page, 'empty');
  // Registered after the general answers, so it wins (the newest registration is asked first).
  let writes = 0;
  await page.route(/\/rpc\/give_school_results_consent/, async (route) => {
    writes += 1;
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill(json(null));
  });
  await page.locator('header nav > button').first().click();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Add school results' }).dblclick();
  await page.waitForTimeout(1500);
  expect(writes).toBe(1);
});
test('signed-in student, database failing: a failed list says so in words (not an endless spinner)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the tab buttons are in the desktop header (hidden on a phone)');
  await openAsStudent(page, 'failing');
  await page.locator('header nav > button').first().click();
  await page.waitForTimeout(2500);
  const text = (await bodyWords(page)).toLowerCase();
  expect(/couldn.?t|could not|try again|retry|failed|went wrong|unavailable/.test(text) || /no .* (yet|available)/.test(text), 'the first tab says what went wrong or that nothing is there').toBe(true);
});
