import { PAGE_META, metaForPath, SITE_ORIGIN } from '../../src/lib/pageMeta';
import { test, expect, cspViolations } from './fixtures';

// FUNC-XBROWSER-01 (runs in chromium, firefox, webkit, an Android phone and an iPhone), FE-CONSOLE-01, FE-SPA-ROUTING-01.

// Addresses a visitor can open directly without being signed in and without a link carrying a secret.
const OPEN = ['/', '/login', '/signin/student', '/signin/tutor', '/signin/parent', '/signup/student', '/signup/tutor', '/signup/parent', '/forgot-password', '/forgot-password/tutor', '/terms', '/privacy', '/refunds', '/delivery'];

test.describe('public pages open directly', () => {
  for (const path of OPEN) {
    test(`${path}: status 200, its own title, canonical address and robots line, and it shows something`, async ({ page }) => {
      const meta = metaForPath(path)!;
      const response = await page.goto(path);
      expect(response?.status(), 'the host answers with a real page, not a 404').toBe(200);
      await expect(page).toHaveTitle(meta.title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', meta.description);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', meta.index ? 'index,follow' : 'noindex');
      if (meta.index) await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_ORIGIN}${path === '/' ? '/' : path}`);
      await expect(page.locator('#root h1, #root h2').first()).toBeVisible();
    });

    test(`${path}: no console errors, no uncaught errors, no failed requests, no Content-Security-Policy violations`, async ({ page, problems }) => {
      await page.goto(path);
      await expect(page.locator('#root h1, #root h2').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await cspViolations(page)).toEqual([]);
      expect(problems.consoleErrors).toEqual([]);
      expect(problems.pageErrors).toEqual([]);
      expect(problems.failedRequests).toEqual([]);
    });
  }

  test('refreshing a deep link keeps the page', async ({ page }) => {
    await page.goto('/signup/tutor');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/signup\/tutor$/);
    await expect(page).toHaveTitle('Become a tutor | Tutorlage');
  });
});

test.describe('addresses nobody built', () => {
  // (An unknown role such as /signup/teacher is not in this list on purpose: sign-up falls back to the student form for it.)
  for (const path of ['/no/such/page', '/teach', '/index.htm', '/signup/tutor/extra']) {
    test(`${path}: the host answers 404 and the app says so plainly, with a way on`, async ({ page, problems }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { name: "We can't find that page" })).toBeVisible();
      await expect(page).toHaveTitle('Page not found | Tutorlage');
      await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', 'noindex');
      await expect(page.getByRole('link', { name: 'Go to the start page' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Sign in or join' })).toBeVisible();
      expect(problems.pageErrors).toEqual([]);
    });
  }

  test('the way on from the not-found page leads to the start page', async ({ page }) => {
    await page.goto('/no/such/page');
    await page.getByRole('link', { name: 'Go to the start page' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Send one request');
  });
});

test.describe('a visitor who is not signed in', () => {
  for (const path of ['/tutor-documents', '/room', '/room/AB12-CD34']) {
    test(`${path} sends them to the sign-in page, and the page never shows signed-in content`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('picking up');
    });
  }

  test('the start page: the sign-in and sign-up links work, and the legal links open the legal pages', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Send one request. A tutor who fits accepts it.');
    for (const [name, url] of [['Terms of Service', /\/terms$/], ['Privacy Policy', /\/privacy$/], ['Refund Policy', /\/refunds$/], ['Delivery Policy', /\/delivery$/]] as const) {
      await page.goto('/');
      await page.getByRole('contentinfo').getByRole('link', { name }).click();
      await expect(page).toHaveURL(url);
    }
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Sign in or join' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await page.getByRole('main').getByRole('link', { name: 'Become a tutor' }).first().click();
    await expect(page).toHaveURL(/\/signup\/tutor$/);
  });

  test('the start page does not scroll sideways, and its text is readable (no text smaller than 12px)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'horizontal overflow in pixels').toBeLessThanOrEqual(0);
    const tiny = await page.evaluate(() => [...document.querySelectorAll('main *, footer *')].filter((e) => e.children.length === 0 && (e.textContent ?? '').trim() && parseFloat(getComputedStyle(e).fontSize) < 12).length);
    expect(tiny).toBe(0);
  });
});

test.describe('the build', () => {
  test('sitemap.xml and robots.txt exist, name only public pages, and the share image loads', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    for (const p of PAGE_META.filter((m) => m.index)) expect(xml).toContain(`<loc>${SITE_ORIGIN}${p.path === '/' ? '/' : p.path}</loc>`);
    expect(xml).not.toMatch(/reset-password|payment|auth\/callback/);
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    const image = await request.get('/og-image.png');
    expect(image.status()).toBe(200);
    expect(image.headers()['content-type']).toBe('image/png');
    for (const file of ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png']) expect((await request.get(file)).status(), file).toBe(200);
  });

  test('no source maps are served', async ({ request, page }) => {
    await page.goto('/');
    const scripts = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src));
    expect(scripts.length).toBeGreaterThan(0);
    for (const src of scripts) {
      const body = await (await request.get(src)).text();
      expect(body, src).not.toMatch(/sourceMappingURL=/);
      expect((await request.get(`${src}.map`)).status(), `${src}.map`).toBe(404);
    }
  });
});
