import { writeFileSync, mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, signInFake } from './fixtures';

// THE LAYOUT OF THE TUTOR PAGES ON REAL SCREEN SIZES (PM line 80, 25 Nov 2026). The database is MOCKED and the people are made up. The sizes are PAGE areas (a browser with its bars), and the
// made-up tutor has SEVEN subjects with long names and grade ranges: a tall test screen with two subjects hid the fault once.
// On the first screen, without scrolling: the navy band ends at or above 32 percent of the height; on /t/CODE the price per hour and the whole "Book a lesson" button are there; sign-in shows the
// heading, the two choices, e-mail and password (and "Sign In" from 1280x585 up); sign-up shows the heading, the two choices and the first fields; the booking page shows the first choice to make;
// cream and white are the largest area and nothing scrolls sideways.
// With RUN10_SCREENS=<folder> the pictures are saved there (first screen and full page) with the measurements in measurements-*.json.

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const ME = '00000000-0000-4000-8000-000000000001';
const TUTOR = '22222222-2222-4222-8222-222222222222';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const subject = (name: string, min: number, max: number) => ({ subject: name, min_grade: `Grade ${min}`, max_grade: `Grade ${max}` });

const SEVEN = [
  subject('English First Additional Language', 4, 12), subject('English Home Language', 4, 12), subject('Natural Sciences and Technology', 4, 9),
  subject('Social Sciences', 4, 9), subject('Mathematics', 4, 8), subject('Geography', 10, 12), subject('Life Sciences', 10, 12),
];
const PAGE = {
  code: 'NOMA', first_name: 'Nomathemba', level_id: '2D', level_name: 'Academic Mentors', tier_line: null as string | null, price: 290, currency: 'ZAR',
  basis: { kind: 'credential', label: 'Student teacher enrolled in a B.Ed or PGCE (proof of enrolment)' } as unknown, discount: { percent: 10, lessons: 3 },
  subjects: SEVEN, hours: 'Monday to Friday, 3pm to 9pm; Saturday, 8am to 5pm; Sunday, 10am to 2pm', taking_requests: true, photo: null as string | null,
};
const LONGEST = {
  tier_line: 'Tutors with a strong record on Tutorlage, an honours degree in the subject, or a teaching qualification.',
  basis: { kind: 'record', min_hours: 200, min_rating: 4.8, min_repeat_rate_pct: 40, min_reviews: 25, min_uplift_students: 0, required_uplift_pct: 0, outside_hours: false },
};

const PHONES = [[360, 640], [390, 750]] as const;
// 1024x600 is not in the PM's list: it is the narrowest width with two columns.
const LAPTOPS = [[1024, 600], [1280, 585], [1366, 650], [1536, 730], [1920, 950]] as const;
const SIZES = [...PHONES, ...LAPTOPS] as const;
const SHOT_SIZES = ['360x640', '390x750', '1280x585', '1920x950'];

interface Opts { photo?: boolean; role?: 'parent' | 'student'; learners?: number; phone?: boolean; tutor?: Partial<typeof PAGE> }

// A drawn stand-in for a tutor's photo: no real person.
async function drawnPhoto(page: Page): Promise<string> {
  await page.goto('/about');
  return page.evaluate(() => {
    const c = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    const g = c.getContext('2d')!;
    g.fillStyle = '#FAF7F2';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#64748b';
    g.beginPath();
    g.arc(128, 100, 52, 0, 7);
    g.arc(128, 270, 110, 0, 7);
    g.fill();
    return c.toDataURL('image/jpeg', 0.85);
  });
}

async function world(page: Page, o: Opts = {}) {
  const photo = o.photo ? await drawnPhoto(page) : null;
  const tutor = { ...PAGE, ...o.tutor, photo };
  const role = o.role ?? 'parent';
  const kids = ['Sipho', 'Lerato'].slice(0, o.learners ?? 1);
  await page.route(/\.(supabase\.co|workers\.dev)\//, async (route) => {
    const request = route.request();
    const url = request.url();
    const one = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const rows = (list: unknown[]) => route.fulfill(json(one ? (list[0] ?? null) : list));
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (/\/rpc\/public_tutor_page/.test(url)) return route.fulfill(json(tutor));
    if (/\/rpc\/tutor_booking_page/.test(url)) return route.fulfill(json({ ...tutor, tutor_id: TUTOR }));
    if (/\/rpc\/tutor_page_times/.test(url)) return route.fulfill(json({ now_ok: false, days: [{ date: day(3), times: ['08:00', '08:30'] }] }));
    if (/\/rest\/v1\/grade_levels/.test(url)) return rows(Array.from({ length: 12 }, (_, i) => ({ name: `Grade ${i + 1}` })));
    if (/\/rest\/v1\/profiles\?/.test(url)) return rows([{ id: ME, full_name: 'Browser Test', role, avatar_url: null }]);
    if (/\/rpc\/my_date_of_birth/.test(url)) return route.fulfill(json('1985-01-01'));
    if (/\/rpc\/my_needs_surname/.test(url)) return route.fulfill(json(false));
    if (/\/rest\/v1\/parent_student_links/.test(url)) {
      if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...CORS, 'content-range': '*/0' } });
      return rows(role === 'parent' ? kids.map((name, i) => ({ student_id: `44444444-4444-4444-8444-44444444444${i}`, relationship: 'mother', can_book_sessions: true, student_profiles: { first_name: name, surname: 'Madeup', grade_level: 'Grade 9' } })) : []);
    }
    if (/\/rest\/v1\/guardian_consents/.test(url)) return rows(kids.map((_, i) => ({ learner_profile_id: `44444444-4444-4444-8444-44444444444${i}`, withdrawn_at: null })));
    if (/\/rest\/v1\/parent_profiles/.test(url)) return rows([{ phone_number: o.phone === false ? '' : '081 234 5678' }]);
    if (/\/rest\/v1\/student_profiles/.test(url)) return rows([{ grade_level: 'Grade 10' }]);
    if (/\/rpc\/card_checkout_available/.test(url)) return route.fulfill(json(false));
    if (/\/rpc\/wallet_open/.test(url)) return route.fulfill(json(true));
    if (/\/rpc\/wallet_online_available/.test(url)) return route.fulfill(json(false));
    if (/\/rpc\/my_promo_quote/.test(url)) return route.fulfill(json({ applies: false }));
    if (/\/rpc\/check_promo_code/.test(url)) return route.fulfill(json({ valid: true, percent: 10, lessons: 3 }));
    if (/\/rest\/v1\/wallets/.test(url)) return rows([{ available_rand: 900, held_rand: 0 }]);
    return route.fulfill(json(/\/rpc\//.test(url) ? null : []));
  });
}

// What is on the first screen: where the navy band ends, whether anything scrolls sideways, and the share of cream and white, navy and green in the picture of that screen.
async function screenFacts(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const shot = (await page.screenshot()).toString('base64');
  const colours = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data;
    const near = (i: number, r: number, gg: number, b: number) => Math.abs(px[i] - r) <= 6 && Math.abs(px[i + 1] - gg) <= 6 && Math.abs(px[i + 2] - b) <= 6;
    let light = 0, navy = 0, green = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (near(i, 255, 255, 255) || near(i, 250, 247, 242)) light += 1;
      else if (near(i, 15, 23, 42)) navy += 1;
      else if (near(i, 21, 128, 61)) green += 1;
    }
    const n = px.length / 4;
    return { light: Math.round((light / n) * 1000) / 10, navy: Math.round((navy / n) * 1000) / 10, green: Math.round((green / n) * 1000) / 10 };
  }, shot);
  const band = await page.evaluate(() => {
    const hero = document.querySelector('[data-hero]')!.getBoundingClientRect();
    return { bottom: Math.round(hero.bottom), height: window.innerHeight, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  return { band: band.bottom, percent: Math.round((band.bottom / band.height) * 1000) / 10, sideways: band.sideways, ...colours };
}

// The top and bottom of the first element that matches, in screen pixels.
async function edges(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} is on the page`).not.toBeNull();
  return { top: Math.round(box!.y), bottom: Math.round(box!.y + box!.height) };
}

const record: Record<string, unknown> = {};
function note(project: string, key: string, value: unknown) {
  record[key] = value;
  const folder = process.env.RUN10_SCREENS;
  if (!folder) return;
  mkdirSync(folder, { recursive: true });
  writeFileSync(`${folder}/measurements-${project}-${key.replace(/[^a-z0-9-]+/gi, '_')}.json`, JSON.stringify(value));
}

async function picture(page: Page, name: string, size: string) {
  const folder = process.env.RUN10_SCREENS;
  if (!folder || !SHOT_SIZES.includes(size) || test.info().project.name !== 'chromium') return;
  mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: `${folder}/${name}-${size}.png` });
  await page.screenshot({ path: `${folder}/${name}-${size}-full.png`, fullPage: true });
}

// Soft checks, so one run reports every size that fails.
function passMarks(where: string, facts: Awaited<ReturnType<typeof screenFacts>>) {
  expect.soft(facts.percent, `${where}: the navy band ends at ${facts.percent}% of the screen`).toBeLessThanOrEqual(32);
  expect.soft(facts.sideways, `${where}: no sideways scroll`).toBeLessThanOrEqual(0);
  // "Clearly the largest": at least one and a half times the navy and the green. The rest of a screen is grey typing boxes, text, a photo and (booking page) a warning box.
  expect.soft(facts.light, `${where}: cream and white ${facts.light}% is clearly the largest area (navy ${facts.navy}%, green ${facts.green}%)`).toBeGreaterThan(Math.max(40, 1.5 * facts.navy, 1.5 * facts.green));
}
function onScreen(where: string, what: string, e: { top: number; bottom: number }, height: number) {
  expect.soft(e.top, `${where}: ${what} starts on the screen`).toBeGreaterThanOrEqual(0);
  expect.soft(e.bottom, `${where}: ${what} ends at ${e.bottom}, the screen at ${height}`).toBeLessThanOrEqual(height);
}

for (const withPhoto of [true, false]) {
  const label = withPhoto ? 'with a photo' : 'without a photo';

  test(`public page ${label}: band, price and the whole Book button on the first screen at every size`, async ({ page, problems }, info) => {
    test.setTimeout(120_000);
    await world(page, { photo: withPhoto });
    for (const [width, height] of SIZES) {
      const size = `${width}x${height}`;
      await page.setViewportSize({ width, height });
      await page.goto('/t/NOMA');
      await expect(page.getByRole('link', { name: 'Book a lesson' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('tutor-photo')).toHaveCount(withPhoto ? 1 : 0);
      const facts = await screenFacts(page);
      const price = await edges(page, '[data-price]');
      const button = await edges(page, '[data-book]');
      const subjects = await edges(page, '[data-subjects] li');
      note(info.project.name, `public-${withPhoto ? 'photo' : 'nophoto'}-${size}`, { ...facts, price, button, firstSubject: subjects });
      passMarks(`public ${size} ${label}`, facts);
      onScreen(`public ${size}`, 'the price', price, height);
      onScreen(`public ${size}`, 'the Book button', button, height);
      expect.soft(facts.green, `public ${size}: green shows on the first screen`).toBeGreaterThan(0.5);
      await expect.soft(page.locator('[data-hero]')).toContainText('Tutor for Grades 4 to 12');
      const left = await page.locator('[data-subjects]').boundingBox();
      const card = await page.locator('[data-level-card]').boundingBox();
      if (width >= 1024) {
        expect.soft(card!.x, `public ${size}: two columns, the card on the right`).toBeGreaterThan(left!.x + left!.width);
        onScreen(`public ${size}`, 'the first subject', subjects, height);
      } else {
        expect.soft(card!.y + card!.height, `public ${size}: the card comes above the subjects`).toBeLessThanOrEqual(left!.y);
        const hours = await page.locator('[data-hours]').boundingBox();
        expect.soft(hours!.y, `public ${size}: hours after the subjects`).toBeGreaterThan(left!.y);
      }
      await picture(page, `1-public-page-${withPhoto ? 'photo' : 'no-photo'}`, size);
    }
    expect(problems.pageErrors).toEqual([]);
  });
}

test('public page on laptops: the card stays in view while a long page scrolls, with the longest card (tier line and record)', async ({ page, problems }, info) => {
  test.setTimeout(120_000);
  const many = [...SEVEN, ...Array.from({ length: 30 }, (_, i) => subject(`Made-up subject number ${i + 1}`, 4, 12))];
  await world(page, { tutor: { subjects: many, ...LONGEST } });
  for (const [width, height] of LAPTOPS) {
    const size = `${width}x${height}`;
    await page.setViewportSize({ width, height });
    await page.goto('/t/NOMA');
    await expect(page.getByRole('link', { name: 'Book a lesson' })).toBeVisible({ timeout: 15_000 });
    onScreen(`long page ${size}`, 'the Book button before scrolling', await edges(page, '[data-book]'), height);
    for (const part of [0.5, 1]) {
      const moved = await page.evaluate((p) => {
        window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * p);
        return window.scrollY;
      }, part);
      expect(moved, `long page ${size} really scrolls`).toBeGreaterThan(50);
      await page.waitForTimeout(150);
      const price = await edges(page, '[data-price]');
      const button = await edges(page, '[data-book]');
      note(info.project.name, `sticky-${size}-${part}`, { scrolled: Math.round(moved), price, button });
      onScreen(`long page ${size} scrolled ${part}`, 'the price', price, height);
      onScreen(`long page ${size} scrolled ${part}`, 'the Book button', button, height);
    }
  }
  expect(problems.pageErrors).toEqual([]);
});

test('public page on phones: the longest card still has the Book button on the first screen', async ({ page, problems }, info) => {
  await world(page, { photo: true, tutor: LONGEST });
  for (const [width, height] of PHONES) {
    const size = `${width}x${height}`;
    await page.setViewportSize({ width, height });
    await page.goto('/t/NOMA');
    await expect(page.getByRole('link', { name: 'Book a lesson' })).toBeVisible({ timeout: 15_000 });
    const button = await edges(page, '[data-book]');
    note(info.project.name, `longest-${size}`, { button });
    onScreen(`longest card ${size}`, 'the Book button', button, height);
  }
  expect(problems.pageErrors).toEqual([]);
});

test('sign-in and sign-up: the band, and what must show without scrolling', async ({ page, problems }, info) => {
  test.setTimeout(120_000);
  await world(page, { photo: true });
  for (const [width, height] of SIZES) {
    const size = `${width}x${height}`;
    await page.setViewportSize({ width, height });

    await page.goto('/t/NOMA/book');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 15_000 });
    let facts = await screenFacts(page);
    const signIn: Record<string, { top: number; bottom: number }> = {
      heading: await edges(page, '[data-link-signin] h2'),
      choices: await edges(page, '[data-role-picker]'),
      email: await edges(page, '#email'),
      password: await edges(page, '#password'),
      button: await edges(page, '[data-link-signin] button[type=submit]'),
    };
    note(info.project.name, `signin-${size}`, { ...facts, ...signIn });
    passMarks(`sign-in ${size}`, facts);
    for (const [what, e] of Object.entries(signIn)) if (what !== 'button' || width >= 1280) onScreen(`sign-in ${size}`, what, e, height);
    await picture(page, '2-sign-in', size);

    await page.goto('/t/NOMA/signup');
    await expect(page.getByLabel('First name')).toBeVisible({ timeout: 15_000 });
    facts = await screenFacts(page);
    const signUp = {
      heading: await edges(page, '[data-link-signup-card] h2'),
      choices: await edges(page, '[data-role-picker]'),
      firstName: await edges(page, '#firstName'),
      surname: await edges(page, '#surname'),
    };
    note(info.project.name, `signup-${size}`, { ...facts, ...signUp });
    passMarks(`sign-up ${size}`, facts);
    for (const [what, e] of Object.entries(signUp)) onScreen(`sign-up ${size}`, what, e, height);
    await picture(page, '3-sign-up', size);
  }
  expect(problems.pageErrors).toEqual([]);
});

const BOOKERS: { name: string; opts: Opts; first: string }[] = [
  { name: 'a parent with one learner', opts: { role: 'parent', learners: 1, photo: true }, first: '#your-learners button[aria-pressed]' },
  { name: 'a parent with two learners', opts: { role: 'parent', learners: 2 }, first: '#your-learners button[aria-pressed]' },
  { name: 'a parent who has no phone number saved', opts: { role: 'parent', learners: 1, phone: false }, first: '#your-learners input[type=tel]' },
  { name: 'a learner account', opts: { role: 'student', photo: true }, first: '#lessonSubject' },
];
for (const booker of BOOKERS) {
  test(`booking page for ${booker.name}: the band, and the first choice on the first screen`, async ({ page, problems }, info) => {
    test.setTimeout(120_000);
    await world(page, booker.opts);
    await signInFake(page);
    for (const [width, height] of SIZES) {
      const size = `${width}x${height}`;
      await page.setViewportSize({ width, height });
      await page.goto('/t/NOMA/book');
      await expect(page.locator(booker.first).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-level-card]')).toHaveCount(1);
      if (booker.opts.learners === 1 && booker.opts.phone !== false) await expect(page.getByRole('button', { name: /Booking for Sipho/ })).toBeVisible();
      const facts = await screenFacts(page);
      const first = await edges(page, booker.first);
      const subjectChoice = await edges(page, '#lessonSubject');
      note(info.project.name, `booking-${booker.name.replace(/\s+/g, '-')}-${size}`, { ...facts, first, subjectChoice });
      passMarks(`booking (${booker.name}) ${size}`, facts);
      onScreen(`booking (${booker.name}) ${size}`, 'the first choice', first, height);
      if (booker.name === 'a parent with one learner') await picture(page, '4-booking-page', size);
      if (booker.name === 'a learner account') await picture(page, '4-booking-page-learner', size);
    }
    expect(problems.pageErrors).toEqual([]);
  });
}
