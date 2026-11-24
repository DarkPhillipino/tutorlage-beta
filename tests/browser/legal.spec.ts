import { test, expect, databaseOrigin, signInFake } from './fixtures';

// Release gate rows LEGAL-CONSENT-01, LEGAL-PRIVACY-01 and LEGAL-MINORS-01 (24 Nov 2026, queue 8 / U3c).
// What these prove, and what they do not:
//  * They run the FINISHED build with made-up answers from the tests (fixtures.ts): no real database is touched.
//  * LEGAL-CONSENT-01: the app has no analytics, advertising or tracking script and no cookie banner is needed because it sets
//    no cookie. The test lists EVERY request each public page makes and fails on any host that is not our own page host, our
//    database or our payments/rooms API; it also fails if a page sets a cookie or loads a script from another host.
//  * LEGAL-PRIVACY-01: every public page and every sign-up page carries a link to the Privacy Policy, and the policy page opens
//    and says what it processes. Whether the text MATCHES the real processing is a reading by a person, not a test.
//  * LEGAL-MINORS-01 (screens): the sign-up refuses a tutor or a parent under 18 in words, and a learner under 18 cannot finish
//    sign-up alone (no password boxes, a hand-over to a parent). The camera rule and the database half are proved by
//    scripts/dev/camera-rule-test.ts and supabase/tests/7k_*.sql, not here.

const PUBLIC_PAGES = ['/', '/login', '/signin/student', '/signin/tutor', '/signin/parent', '/signup/student', '/signup/tutor', '/signup/parent', '/forgot-password', '/teach', '/about', '/terms', '/privacy', '/refunds', '/delivery'];

const ownHosts = (): string[] => {
  const db = new URL(databaseOrigin()).hostname;
  return ['127.0.0.1', 'localhost', db];
};

const isOurs = (url: string): boolean => {
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return true;
  const host = new URL(url).hostname;
  return ownHosts().includes(host) || host.endsWith('.supabase.co') || host.endsWith('.workers.dev');
};

test.describe('LEGAL-CONSENT-01: nothing leaves for a third party before any consent', () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path}: every request goes to our own page host, our database or our API; no cookie; no third-party script`, async ({ page, context }) => {
      const urls: string[] = [];
      page.on('request', (r) => urls.push(r.url()));
      await page.goto(path);
      await expect(page.locator('#root h1, #root h2').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState('networkidle');
      const foreign = urls.filter((u) => !isOurs(u));
      expect(foreign, 'requests to a host that is not ours').toEqual([]);
      const scriptHosts = await page.evaluate(() => [...document.querySelectorAll('script[src], link[rel="stylesheet"][href], iframe[src], img[src]')].map((e) => (e as HTMLElement & { src?: string; href?: string }).src || (e as HTMLLinkElement).href));
      expect(scriptHosts.filter((u) => u && !isOurs(u)), 'script, style, frame or image from a host that is not ours').toEqual([]);
      expect(await context.cookies(), 'the app sets no cookie before consent').toEqual([]);
    });
  }
});

test.describe('LEGAL-PRIVACY-01: the privacy notice is reachable from every page and every sign-up', () => {
  // FOUND 24 Nov 2026: these five pages carry no link to the Privacy Policy (the footer is not on them). They are WAVE pages (/login,
  // first sign-in), so they are NOT changed without the PM's line. test.fail() keeps the suite honest: it records the defect and turns
  // red the day someone adds the link (then delete the name from this list).
  const NO_PRIVACY_LINK_YET = ['/login', '/signin/student', '/signin/tutor', '/signin/parent', '/forgot-password'];
  for (const path of PUBLIC_PAGES.filter((p) => p !== '/privacy')) {
    test(`${path}: carries a link to the Privacy Policy`, async ({ page }) => {
      test.fail(NO_PRIVACY_LINK_YET.includes(path), 'known defect (WAVE page, waits for the PM): no Privacy link on this page');
      await page.goto(path);
      await expect(page.locator('#root h1, #root h2').first()).toBeVisible({ timeout: 15_000 });
      const links = page.locator('a[href="/privacy"], a[href$="/privacy"]');
      await expect(links.first(), `${path} has a link to /privacy`).toBeAttached();
    });
  }

  for (const role of ['student', 'tutor', 'parent']) {
    test(`/signup/${role}: the acceptance box names the Privacy Policy and is not pre-ticked`, async ({ page }) => {
      await page.goto(`/signup/${role}`);
      await expect(page.getByLabel('Date of birth')).toBeVisible({ timeout: 15_000 });
      // learners under 18 do not see the box; an adult date opens the password and acceptance part
      await page.getByLabel('Date of birth').fill('1990-01-15');
      const box = page.getByRole('checkbox').first();
      await expect(box).toBeVisible();
      await expect(box).not.toBeChecked();
      await expect(page.locator('a[href="/privacy"]').first()).toBeVisible();
    });
  }

  test('/privacy opens, answers 200 and describes what is processed', async ({ page }) => {
    const response = await page.goto('/privacy');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /privacy/i }).first()).toBeVisible();
    const text = (await page.locator('#root').innerText()).toLowerCase();
    for (const word of ['personal information', 'under 18', 'delete', 'information regulator']) expect(text, `the notice mentions "${word}"`).toContain(word);
  });

  test('signed in (made-up session): the footer still links to the Privacy Policy', async ({ page }) => {
    await signInFake(page);
    await page.goto('/');
    await expect(page.locator('#root h1, #root h2').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('a[href="/privacy"]').first()).toBeAttached();
  });
});

test.describe('LEGAL-MINORS-01: what a person under 18 meets on the sign-up screens', () => {
  const isoYearsAgo = (years: number): string => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d.toISOString().slice(0, 10);
  };

  test('a learner under 18 cannot finish alone: no password boxes, a hand-over to a parent or guardian', async ({ page }) => {
    await page.goto('/signup/student');
    await page.getByLabel('Date of birth').fill(isoYearsAgo(14));
    await expect(page.getByText('Ask a parent or guardian to set up your account')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Create a parent or guardian account/ })).toBeVisible();
  });

  test('a learner of 18 or more gets the normal form (the rule turns on age, not on role)', async ({ page }) => {
    await page.goto('/signup/student');
    await page.getByLabel('Date of birth').fill(isoYearsAgo(19));
    await expect(page.getByText('Ask a parent or guardian to set up your account')).toHaveCount(0);
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  });

  for (const [role, sentence] of [['tutor', "Tutors on Tutorlage need to be 18 or older"], ['parent', 'Parent and guardian accounts need to be 18 or older.']] as const) {
    test(`a ${role} under 18 is refused in words and nothing is sent to the database`, async ({ page }) => {
      const calls: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && /\/auth\/v1\/signup/.test(r.url())) calls.push(r.url());
      });
      await page.goto(`/signup/${role}`);
      await page.getByLabel('First name').fill('Test');
      await page.getByLabel('Surname').fill('Person');
      await page.getByLabel('Email').fill('minor-test@example.invalid');
      await page.getByLabel('Phone number').fill('0710000000');
      await page.getByLabel('Date of birth').fill(isoYearsAgo(16));
      await page.getByLabel('Password', { exact: true }).fill('A-long-test-password-1');
      await page.getByLabel('Confirm password').fill('A-long-test-password-1');
      await page.getByRole('checkbox').first().check();
      await page.locator('button[type="submit"]').click();
      await expect(page.getByText(sentence)).toBeVisible();
      expect(calls, 'no sign-up request was made').toEqual([]);
    });
  }
});
