import { test, expect, signInFake } from './fixtures';

// RUN 7 (24 Nov 2026): the tutor's own photo on the Teach screen. Hermetic: the database and the private folder are answered here. Proves: a tutor sees the card; she chooses a picture, frames it in the circle (drag and zoom),
// and what is sent is ONE 512 px JPEG into her own folder and then the one "submit" call; her screen then says it was sent and that nothing has changed; a signed-in learner sees no card.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';

async function open(page: import('@playwright/test').Page, role: 'tutor' | 'student', calls: string[], uploads: { size: number; type: string }[]) {
  await signInFake(page);
  // record what the browser's own JPEG encoder made (the request body can be cut short by the test tool in some browsers)
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.toBlob;
    (window as unknown as { __jpeg: { size: number; type: string; w: number; h: number }[] }).__jpeg = [];
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string, q?: number) {
      const c = this;
      return orig.call(this, (b) => { if (b) (window as unknown as { __jpeg: { size: number; type: string; w: number; h: number }[] }).__jpeg.push({ size: b.size, type: b.type, w: c.width, h: c.height }); cb(b); }, type, q);
    };
  });
  let pending = false;
  await page.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const rpc = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(url)?.[1];
    if (/\/storage\/v1\/object\/tutor-photos\//.test(url)) {
      const body = request.postDataBuffer();
      uploads.push({ size: body?.length ?? 0, type: request.headers()['content-type'] ?? '' });
      calls.push(`storage ${decodeURIComponent(url.split('/tutor-photos/')[1])}`);
      return route.fulfill(json({ Key: 'tutor-photos/x' }));
    }
    if (/\/rest\/v1\/profiles\?/.test(url)) return route.fulfill(json([{ id: ME, full_name: 'Zzodi Tutor', role, avatar_url: null }]));
    if (rpc === 'my_date_of_birth') return route.fulfill(json('1985-05-05'));
    if (rpc === 'my_pending_acceptances') return route.fulfill(json([]));
    if (rpc === 'my_needs_surname') return route.fulfill(json(false));
    if (rpc === 'my_photo') { calls.push('my_photo'); return route.fulfill(json(role === 'tutor' ? { is_tutor: true, approved: null, pending, rejected: false } : { is_tutor: false })); }
    if (rpc === 'submit_my_photo') { calls.push(`submit ${JSON.stringify(request.postDataJSON())}`); pending = true; return route.fulfill({ status: 204, headers: CORS }); }
    if (/\/rest\/v1\/tutor_profiles/.test(url) && role === 'tutor') return route.fulfill(json({ id: ME, headline: null, hourly_rate: 100, currency_code: 'ZAR', is_verified: true, onboarding_status: 'approved', avg_rating: 0, total_reviews_count: 0, total_completed_hours: 0, total_sessions_completed: 0, teaching_mode: 'online', is_dispatch_active: false, current_sub_tier_id: null, repeat_student_rate_pct: 0, avg_grade_uplift_pct: 0, qualified_uplift_students_count: 0, institution_id: null, profiles: { full_name: 'Zzodi Tutor', avatar_url: null }, tutor_subject_competencies: [], tier_definitions: null, schools_institutions: null }));
    if (/\/rest\/v1\/(policy_acceptances|parent_student_links)/.test(url)) return route.fulfill(json([]));
    if (/\/rest\/v1\/tutor_onboarding/.test(url)) return route.fulfill(json({ track: 'qualified', grandfathered: true, consented_at: null, consent_version: null }));
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
  await page.goto('/');
  if (page.viewportSize() && page.viewportSize()!.width < 640) await page.getByRole('button', { name: /^Teach$/ }).last().click();
  else await page.getByRole('navigation').getByRole('button', { name: 'Teach' }).first().click();
}

test.describe('the tutor\'s own photo', () => {
  test('a tutor frames a picture in the circle and sends it: one 512 px JPEG to her own folder, then it is pending', async ({ page, problems }) => {
    const calls: string[] = [];
    const uploads: { size: number; type: string }[] = [];
    await open(page, 'tutor', calls, uploads);
    const card = page.getByTestId('my-photo-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('looked at by us before anyone else can see it');
    await expect(card).toContainText('You have no photo on your page or card.');
    await expect(card.getByRole('button', { name: 'Remove my photo' })).toHaveCount(0);

    // a picture the browser makes: 900 x 600 PNG with a face-like circle
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 900; c.height = 600;
      const x = c.getContext('2d')!;
      x.fillStyle = '#9fb7d0'; x.fillRect(0, 0, 900, 600);
      x.fillStyle = '#e0b090'; x.beginPath(); x.arc(450, 250, 120, 0, Math.PI * 2); x.fill();
      return c.toDataURL('image/png');
    });
    await page.getByTestId('my-photo-file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
    const canvas = page.getByTestId('my-photo-canvas');
    await expect(canvas).toBeVisible();
    // drag and zoom
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 140, box.y + 140);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 120, { steps: 4 });
    await page.mouse.up();
    await page.getByTestId('my-photo-zoom').fill('2');
    await page.getByRole('button', { name: 'Send this photo to be checked' }).click();
    await expect(page.getByTestId('my-photo-waiting')).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Until then nothing has changed on your page or card');
    expect(calls.filter((c) => c.startsWith('storage'))).toEqual([`storage ${ME}/pending.jpg`]);
    expect(calls.filter((c) => c.startsWith('submit'))).toEqual([`submit {"p_path":"${ME}/pending.jpg"}`]);
    expect(uploads.length).toBe(1);
    const made = await page.evaluate(() => (window as unknown as { __jpeg: { size: number; type: string; w: number; h: number }[] }).__jpeg);
    expect(made.length).toBe(1);
    expect(made[0]).toMatchObject({ type: 'image/jpeg', w: 512, h: 512 });
    expect(made[0].size).toBeGreaterThan(1000);
    expect(made[0].size).toBeLessThan(2 * 1024 * 1024);
    await expect(card.getByRole('button', { name: 'Remove my photo' })).toBeVisible();
    expect(problems.pageErrors ?? []).toEqual([]);
  });

  test('a refused file type is turned away in plain words and nothing is sent', async ({ page }) => {
    const calls: string[] = [];
    await open(page, 'tutor', calls, []);
    await expect(page.getByTestId('my-photo-card')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('my-photo-file').setInputFiles({ name: 'me.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(page.getByRole('alert').filter({ hasText: 'Please choose a JPG, PNG or WebP photo.' })).toBeVisible();
    expect(calls.filter((c) => c.startsWith('storage') || c.startsWith('submit'))).toEqual([]);
  });

  test('anyone who is not a tutor sees no photo card', async ({ page }) => {
    const calls: string[] = [];
    await open(page, 'student', calls, []);
    await expect(page.locator('#root h1, #root h2').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('my-photo-card')).toHaveCount(0);
  });
});
