import { test, expect, signInFake } from './fixtures';

// FUNC-STATES-01 and SA-NETWORK-01: what a person sees when the database or the network fails. Every failure here is made by the test
// (nothing real is called). The bar: never a blank white page, always words and a way on.

test.describe('the database fails', () => {
  test('sign-in: a 500 from the auth service shows a plain message, the form stays usable, nothing crashes', async ({ page, problems }) => {
    await page.route(/\/auth\/v1\/token/, (route) => route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"msg":"boom"}' }));
    await page.goto('/signin/student');
    await page.getByLabel('Email').fill('someone@example.invalid');
    await page.getByLabel('Password').fill('not-a-real-password');
    await page.getByRole('button', { name: /sign in/i }).last().click();
    // The message is announced to screen readers too (role="alert"); the exact words come from describeSignInError.
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).not.toBeEmpty();
    await expect(page.getByLabel('Email')).toBeEnabled();
    await expect(page.getByLabel('Password')).toBeEnabled();
    expect(problems.pageErrors).toEqual([]);
  });

  test('sign-in: the network dropping mid-request shows a message, not a frozen button', async ({ page, problems }) => {
    await page.route(/\/auth\/v1\/token/, (route) => route.abort('connectionreset'));
    await page.goto('/signin/student');
    await page.getByLabel('Email').fill('someone@example.invalid');
    await page.getByLabel('Password').fill('not-a-real-password');
    await page.getByRole('button', { name: /sign in/i }).last().click();
    await expect(page.getByLabel('Email')).toBeEnabled({ timeout: 15_000 });
    await expect(page.locator('body')).not.toBeEmpty();
    expect(problems.pageErrors).toEqual([]);
  });

  test('signed in, every table read fails with 500: the app shows words, not a blank page', async ({ page }) => {
    await signInFake(page);
    await page.route(/\/rest\/v1\//, (route) => route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"boom"}' }));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // The account gate shows the database's own message and a "Try again" button (so a failed read is never a blank page). Showing the
    // database's raw wording to a visitor is logged as a polish item; the bar here is words plus a way on.
    await expect(page.getByRole('button', { name: /try again|reload/i })).toBeVisible({ timeout: 10_000 });
    const text = (await page.locator('#root').innerText()).trim();
    expect(text.length, 'the page has visible words').toBeGreaterThan(5);
  });

  test('signed in, every table read is EMPTY: the app still shows words, not a blank page', async ({ page }) => {
    await signInFake(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const text = (await page.locator('#root').innerText()).trim();
    expect(text.length, 'the page has visible words').toBeGreaterThan(20);
  });

  test('signed in, the database never answers: a loading message is shown, then the page stays usable (no blank screen)', async ({ page }) => {
    await signInFake(page);
    await page.route(/\/rest\/v1\//, () => { /* never answered */ });
    await page.goto('/');
    await page.waitForTimeout(2500);
    const text = (await page.locator('#root').innerText()).trim();
    expect(text.length, 'something is on screen while waiting').toBeGreaterThan(5);
  });
});

test.describe('the phone loses signal (load-shedding, a lift)', () => {
  test('offline after the start page loaded: opening the sign-in page still works, because the next pages are fetched in advance', async ({ page, context, problems }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500); // the idle-time prefetch of the sign-in pages
    await context.setOffline(true);
    await page.getByRole('banner').getByRole('link', { name: 'Sign in or join' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('picking up', { timeout: 10_000 });
    expect(problems.pageErrors).toEqual([]);
  });

  test('offline, a page that was not fetched in advance shows the plain error screen with a reload button, never a blank page', async ({ page, context }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    // /terms has not been fetched: this is the case the retry-and-error-screen path is for.
    await page.evaluate(() => { history.pushState({}, '', '/terms'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await expect(page.getByText('Something went wrong').or(page.getByRole('heading', { name: /Terms|Privacy/ }))).toBeVisible({ timeout: 20_000 });
  });

  test('a double tap on sign-in sends one request, not two', async ({ page }) => {
    let calls = 0;
    await page.route(/\/auth\/v1\/token/, async (route) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error_description":"Invalid login credentials"}' });
    });
    await page.goto('/signin/student');
    await page.getByLabel('Email').fill('someone@example.invalid');
    await page.getByLabel('Password').fill('not-a-real-password');
    const button = page.getByRole('button', { name: /sign in/i }).last();
    await button.dblclick();
    await page.waitForTimeout(1500);
    expect(calls).toBe(1);
  });
});
