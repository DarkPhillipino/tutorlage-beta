import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// P5-a (CEO, 21 Nov 2026): on a page with a left side and a right side, the LEFT side stays in view while only the right side scrolls.
// The two such pages in the app are the learner home (the booking card on the left, the suggestions on the right) and the prices page
// (the search card on the left, the prices on the right). Built as position: sticky on the left column from lg (1024 px) up; below that the
// sides stack as before. Checked here, in the five browser profiles plus three set widths:
//  - from 1024 px up: after the page scrolls, the left column is still in view, held under the 64 px header; and when the left side is taller
//    than the screen it scrolls by itself (its own scroll box);
//  - at 768 px and 375 px (and in the two phone profiles): nothing is sticky, nothing scrolls inside a scrolling page, no sideways scroll;
//  - the reading and focus order is the same as the markup order (left before right) and axe finds no WCAG A/AA violation.
// The database is answered by this file (nothing real is called).

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';
const rowsOrOne = (route: Route, list: unknown[]) => {
  const wantsOne = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  return route.fulfill(wantsOne ? json(list[0] ?? null, list.length ? 200 : 406) : json(list));
};

async function openAsStudent(page: Page) {
  await signInFake(page);
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const rpc = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(url)?.[1];
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: 'Browser Test', role: 'student', avatar_url: null }]));
    if (rpc === 'my_date_of_birth') return route.fulfill(json('2000-01-01'));
    if (rpc === 'my_pending_acceptances') return route.fulfill(json([]));
    if (rpc === 'card_checkout_available') return route.fulfill(json(true));
    if (rpc === 'available_price_levels') return route.fulfill(json([1, 2, 3, 4].map((n) => ({ level_id: `lvl${n}`, tier_id: n, tier_name: ['Peer-to-Peer Tutors', 'Experienced Tutors', 'Qualified Teachers', 'Specialist Educators'][n - 1], price: n * 75, currency_code: 'ZAR', tutors: n === 4 ? 0 : 7 - n }))));
    if (/\/rest\/v1\/sub_tier_definitions/.test(url)) {
      return route.fulfill(json(Array.from({ length: 8 }, (_, i) => ({ id: `lvl${i + 1}`, tier_id: Math.floor(i / 2) + 1, max_allowed_rate: 60 + i * 35, min_hours: i * 20, min_rating: 4 + i / 10, min_repeat_rate_pct: i * 5, min_written_reviews: i, min_distinct_students_uplift: i, required_grade_uplift_pct: i, tier_definitions: { public_name: ['Peer-to-Peer Tutors', 'Experienced Tutors', 'Qualified Teachers', 'Specialist Educators'][Math.floor(i / 2)], positioning_quote: 'A tutor who knows the work and the exam.', currency_code: 'ZAR' } }))));
    }
    if (/\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return rowsOrOne(route, []);
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
}

async function openPrices(page: Page) {
  await openAsStudent(page);
  await page.getByRole('button', { name: 'See prices' }).click();
  await expect(page.getByRole('button', { name: /Back to search/ })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
}

const PAGES = [
  { name: 'learner home', open: openAsStudent },
  { name: 'prices page', open: openPrices },
] as const;

const leftSide = (page: Page) => page.locator('[class*="lg:sticky"]');

// What the browser computed for the left column.
async function leftState(page: Page) {
  return leftSide(page).evaluate((el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { position: s.position, overflowY: s.overflowY, top: Math.round(r.top), bottom: Math.round(r.bottom), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
}

// A tall right-hand side is needed to scroll the page; make sure of it, so the check never passes just because the page was short.
async function makeRightTall(page: Page) {
  await page.evaluate(() => {
    const left = document.querySelector('[class*="lg:sticky"]') as HTMLElement;
    const right = left.nextElementSibling as HTMLElement;
    const filler = document.createElement('div');
    filler.setAttribute('data-test-filler', '1');
    filler.style.height = '1800px';
    right.appendChild(filler);
  });
}

for (const p of PAGES) {
  test.describe(p.name, () => {
    test(`wide screen: the left side stays in view while the page scrolls`, async ({ page, problems }, testInfo) => {
      const width = page.viewportSize()!.width;
      test.skip(width < 1024, 'stacked below 1024 px: checked in the next test');
      await p.open(page);
      expect(await leftSide(page).count(), 'one left side').toBe(1);
      await makeRightTall(page);
      const before = await leftState(page);
      expect(before.position).toBe('sticky');
      await page.evaluate(() => window.scrollTo(0, 700));
      await page.waitForTimeout(250);
      const after = await leftState(page);
      expect(after.top, `${testInfo.project.name}: the left side is held 80 px from the top (under the 64 px header), not scrolled away`).toBe(80);
      expect(after.bottom, 'and still on the screen').toBeLessThanOrEqual(page.viewportSize()!.height);
      // The right side did scroll: the page moved.
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
      expect(problems.pageErrors).toEqual([]);
    });

    test(`wide screen: a left side taller than the screen scrolls by itself`, async ({ page }) => {
      const width = page.viewportSize()!.width;
      test.skip(width < 1024, 'stacked below 1024 px');
      await page.setViewportSize({ width, height: 360 });
      await p.open(page);
      await makeRightTall(page);
      const state = await leftState(page);
      expect(state.overflowY).toBe('auto');
      expect(state.scrollHeight, 'the left side is taller than its box').toBeGreaterThan(state.clientHeight);
      expect(state.clientHeight, 'its box fits the screen below the header').toBeLessThanOrEqual(360 - 80);
      // the last thing on the left can be reached by scrolling the left box alone
      await leftSide(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
      expect(await leftSide(page).evaluate((el) => el.scrollTop), 'the left box scrolled by itself').toBeGreaterThan(0);
    });

    test(`stacked widths (phone profiles, 768 px, 375 px): nothing sticky, no scroll box inside the page, no sideways scroll`, async ({ page, browserName }, testInfo) => {
      const widths = page.viewportSize()!.width >= 1024 ? [768, 375] : [page.viewportSize()!.width];
      test.skip(page.viewportSize()!.width >= 1024 && browserName !== 'chromium', 'the set widths are tried in chromium; the phone profiles try their own');
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await p.open(page);
        const state = await leftState(page);
        expect(state.position, `${testInfo.project.name} ${width}px: not sticky`).toBe('static');
        expect(state.overflowY, `${width}px: no scroll box of its own`).toBe('visible');
        expect(state.scrollHeight, `${width}px: the left side shows in full`).toBe(state.clientHeight);
        const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflowX, `${width}px: no sideways scroll`).toBeLessThanOrEqual(0);
        // stacked: the right side starts below the left side
        const order = await leftSide(page).evaluate((el) => {
          const right = el.nextElementSibling as HTMLElement;
          return { leftBottom: el.getBoundingClientRect().bottom, rightTop: right.getBoundingClientRect().top };
        });
        expect(order.rightTop, `${width}px: stacked, left then right`).toBeGreaterThanOrEqual(order.leftBottom - 1);
      }
    });

    test(`reading order and focus order are unchanged: the left side comes before the right side`, async ({ page }) => {
      await p.open(page);
      const result = await leftSide(page).evaluate((el) => {
        const right = el.nextElementSibling as HTMLElement;
        const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
        const lastLeft = Array.from(el.querySelectorAll(focusable)).pop();
        const firstRight = right.querySelector(focusable);
        return {
          leftBeforeRight: !!(el.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING),
          focusOk: !lastLeft || !firstRight || !!(lastLeft.compareDocumentPosition(firstRight) & Node.DOCUMENT_POSITION_FOLLOWING),
          noTabindexAdded: el.getAttribute('tabindex') === null,
        };
      });
      expect(result).toEqual({ leftBeforeRight: true, focusOk: true, noTabindexAdded: true });
    });

    test(`axe finds no WCAG A/AA violation`, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'axe is run in chromium (desktop and the Android phone profile)');
      await p.open(page);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
      expect(summary, `${results.passes.length} rules passed, ${results.violations.length} violated`).toEqual([]);
    });
  });
}

// axe with the left side scrolling by itself (the tall-left case, where "scrollable region must be keyboard accessible" could bite).
test('axe, left side taller than the screen (its own scroll box): no violation', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium' || page.viewportSize()!.width < 1024, 'chromium, wide screen only');
  await page.setViewportSize({ width: 1280, height: 360 });
  await openPrices(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
