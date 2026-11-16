import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// A SESSION THAT ENDS EARLY (the CEO, 15 Nov 2026), with the database PRETENDED (nothing here touches dev, production, the Worker or a payment company;
// every database answer is made up by this file, like the waiting-screen checks). Shows:
//  - learner: "Is everything alright?" with "Yes, all fine" and "No, report a problem"; Yes calls acknowledge_early_end; No opens the EXISTING Report a problem form
//    and sending it calls report_session_problem; a tutor who left only seconds ago, an answered check-in, or a session with no early end show nothing (axe clean, 375 px);
//  - tutor: "You ended the session early. You can mark it complete from <end time> SAST." and no Mark complete button before then.
// What this does NOT show: the database trigger, the lock inside complete_session, the bell message (supabase/tests/session_early_end.sql, rolled back).

const CORS = { 'access-control-allow-origin': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';
const TUTOR = '55555555-5555-4555-8555-555555555555';
const SES = '44444444-4444-4444-8444-444444444444';
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

type Row = Record<string, unknown>;
type Rpc = { fn: string; body: string | null };
// A one-hour session that started 20 minutes ago.
const sessionRow = (over: Row = {}): Row => ({
  id: SES, student_id: ME, tutor_id: TUTOR, scheduled_start: minutesAgo(20), duration_hours: 1, status: 'scheduled', meeting_url: null,
  ended_early_at: null, early_end_ack_at: null, profiles: { full_name: 'Sam Learner' },
  tutor_profiles: { profiles: { full_name: 'Thandi Mokoena' } }, student_subject_enrollments: { subject_name: 'Mathematics' }, ...over,
});

async function open(page: Page, role: 'student' | 'tutor', rows: () => Row[], rpcs: Rpc[], onRpc?: (fn: string) => void) {
  await signInFake(page);
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: 'Browser Test', role, avatar_url: null }]));
    if (/\/rpc\/my_date_of_birth/.test(url)) return route.fulfill(json('2000-01-01'));
    if (/\/rpc\/my_pending_acceptances/.test(url) || /\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return route.fulfill(json([]));
    if (/\/rpc\/(acknowledge_early_end|report_session_problem)/.test(url)) {
      const fn = /\/rpc\/([a-z_]+)/.exec(url)![1];
      rpcs.push({ fn, body: request.postData() });
      onRpc?.(fn);
      return route.fulfill(json(null));
    }
    if (/\/rest\/v1\/tutor_onboarding/.test(url)) return route.fulfill(json({ track: 'experienced', grandfathered: true, consented_at: null, consent_version: null }));
    if (/\/rest\/v1\/sessions/.test(url)) return route.fulfill(json(rows()));
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/?view=sessions');
}

async function axeClean(page: Page, label: string, scope: string) {
  const results = await new AxeBuilder({ page }).include(scope).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
  expect(summary, `${label}: ${results.passes.length} rules passed`).toEqual([]);
}

test('learner: the tutor left five minutes ago: "Is everything alright?" with two answers; Yes, all fine tells the database and the question goes (axe clean, 375 px)', async ({ page, problems }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const rpcs: Rpc[] = [];
  let answered = false;
  await open(page, 'student', () => [sessionRow({ ended_early_at: minutesAgo(5), early_end_ack_at: answered ? minutesAgo(0) : null })], rpcs, (fn) => { if (fn === 'acknowledge_early_end') answered = true; });
  const box = page.locator('[data-early-end-check-in]');
  await expect(box).toBeVisible({ timeout: 15_000 });
  await expect(box.getByText('Is everything alright?', { exact: true })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Yes, all fine' })).toBeVisible();
  await expect(box.getByRole('button', { name: 'No, report a problem' })).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide, 'nothing sticks out sideways').toBeLessThanOrEqual(0);
  await axeClean(page, 'check-in', '[data-early-end-check-in]');
  await box.getByRole('button', { name: 'Yes, all fine' }).click();
  await expect(box).toHaveCount(0);
  expect(rpcs.map((r) => r.fn)).toEqual(['acknowledge_early_end']);
  expect(rpcs[0].body).toContain(SES);
  expect(problems.pageErrors, 'no uncaught error').toEqual([]);
});

test('learner: "No, report a problem" opens the existing Report a problem form, and sending it reports the session', async ({ page }) => {
  const rpcs: Rpc[] = [];
  await open(page, 'student', () => [sessionRow({ ended_early_at: minutesAgo(5) })], rpcs);
  const box = page.locator('[data-early-end-check-in]');
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.getByRole('button', { name: 'No, report a problem' }).click();
  await expect(box.getByLabel('What went wrong')).toBeVisible();
  await box.getByPlaceholder('What happened? A sentence or two is enough.').fill('The tutor left after ten minutes');
  await box.getByRole('button', { name: /send/i }).click();
  await expect.poll(() => rpcs.map((r) => r.fn)).toEqual(['report_session_problem']);
  expect(rpcs[0].body).toContain(SES);
});

for (const [label, over] of [
  ['the tutor left only seconds ago (a reload)', { ended_early_at: new Date(Date.now() - 10_000).toISOString() }],
  ['it was already answered', { ended_early_at: minutesAgo(5), early_end_ack_at: minutesAgo(1) }],
  ['the session did not end early', {}],
] as const) {
  test(`learner: nothing is asked when ${label}`, async ({ page }) => {
    await open(page, 'student', () => [sessionRow(over)], []);
    await expect(page.getByText(/Mathematics with Thandi Mokoena/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-early-end-check-in]')).toHaveCount(0);
  });
}

test('tutor: "You ended the session early. You can mark it complete from <end time> SAST." and no Mark complete button', async ({ page, problems }) => {
  await open(page, 'tutor', () => [sessionRow({ ended_early_at: minutesAgo(1) })], []);
  const note = page.locator('[data-early-end]');
  await expect(note).toBeVisible({ timeout: 15_000 });
  await expect(note).toContainText(/You ended the session early\. You can mark it complete from .*\d{2}:\d{2} SAST\./);
  await expect(page.getByRole('button', { name: 'Mark session complete' })).toHaveCount(0);
  await expect(page.locator('[data-complete-from]'), 'the ordinary hint is replaced by the early-end message').toHaveCount(0);
  await axeClean(page, 'tutor early end', '[data-early-end]');
  expect(problems.pageErrors, 'no uncaught error').toEqual([]);
});

test('tutor: a session that did not end early shows the ordinary hint and no early-end message', async ({ page }) => {
  await open(page, 'tutor', () => [sessionRow()], []);
  await expect(page.locator('[data-complete-from]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-early-end]')).toHaveCount(0);
});
