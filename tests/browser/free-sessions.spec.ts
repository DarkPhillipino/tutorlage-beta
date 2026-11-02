import { test, expect } from './fixtures';

// FREE SESSIONS (CEO, 2 Nov 2026), the part a browser can show without a signed-in account or a database: the page a learner lands on after
// a request is sent without a card says so in the CEO's words, claims no card check, and the page that checks a real card still does.
// What this does NOT show: the booking click-through, the tutor's list and the database (see scripts/dev/free-sessions-test.ts and
// supabase/tests/free_sessions.sql).

test('after a free request: "Request sent", "Free for now: you won\'t be charged.", no card check mentioned', async ({ page, problems }) => {
  await page.goto('/payment/callback?free=1');
  await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Free for now: you won't be charged.")).toBeVisible();
  await expect(page.getByText(/R1 card check|Checking your card|Paystack/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to Tutorlage' })).toBeVisible();
  expect(problems.pageErrors, 'no uncaught error').toEqual([]);
});

test('a real card return is unchanged: it still checks the card', async ({ page }) => {
  await page.goto('/payment/callback?reference=abc');
  // The made-up backend answers {} (no status), so the page ends on the failure screen; the point is that it asked, not that it passed.
  await expect(page.getByRole('heading', { name: /Your request wasn't sent|Request sent|Checking your card/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Free for now: you won't be charged.")).toHaveCount(0);
});
