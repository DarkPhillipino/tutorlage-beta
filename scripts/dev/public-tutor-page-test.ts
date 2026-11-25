// Checks on the tutor's public page /t/CODE (CEO, 24 Nov 2026; job P slice 1; migration 20261124120000). Run: npx tsx scripts/dev/public-tutor-page-test.ts
// Proves, on the pure words in src/lib/publicTutorPage.ts and by reading the sources: the grades read in words; the database's answer is understood tolerantly (an error, a throw or an odd value all mean "no page");
// the price reads "R... an hour"; the profile link and the booking addresses are right (Book goes to /t/CODE/book, never to the start page); the page says noindex, nofollow, robots.txt disallows /t/,
// the sitemap has no /t/ entry; the page shows only the approved photo, no "checked" section and reads no table; the level card shows only this tutor's own basis; none of the words say "vetted", "certified",
// "background-checked", "free" or "instant"; the routes exist. The database half is proved by supabase/tests/public_tutor_profile.sql and tutor_page_booking.sql.
import { readFileSync } from 'node:fs';
import { PUBLIC_PAGE_COPY, bookPath, fetchMyPublicProfile, fetchPublicPage, gradesInWords, parsePublicPage, priceLine, profileLink, setMyPublicProfile, tutorSubtitle } from '../../src/lib/publicTutorPage';
import { PAGE_META } from '../../src/lib/pageMeta';
import { robotsTxt, sitemapXml } from '../postbuild';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` ${detail}`}`);
  if (!ok) failed += 1;
};
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const good = {
  code: 'TESSA', first_name: 'Tessa', level_id: '1A', level_name: 'Foundation', price: 250, currency: 'ZAR',
  subjects: [{ subject: 'Mathematics', min_grade: 'Grade 8', max_grade: 'Grade 12' }, { foo: 1 }, 5],
  tier_line: null, basis: { kind: 'credential', label: 'Student teacher enrolled in a B.Ed or PGCE (proof of enrolment)' }, discount: { percent: 10, lessons: 3 }, hours: 'Monday to Friday, 5pm to 11pm', taking_requests: true,
};

async function main() {
  // words
  check('grades: a range, one grade, a grade R start, and the plain words for a non-grade end',
    gradesInWords('Grade 8', 'Grade 12') === 'Grades 8 to 12' && gradesInWords('Grade 5', 'Grade 5') === 'Grade 5' && gradesInWords('Grade R', 'Grade 6') === 'Grades R to 6'
    && gradesInWords('Grade 10', 'Adult / Professional Development') === 'Grade 10 to Adult / Professional Development');
  const range = (...r: [string, string][]) => tutorSubtitle(r.map(([minGrade, maxGrade]) => ({ minGrade, maxGrade })));
  check('the line under the name is the lowest to the highest grade of the approved subjects, else the old words', range(['Grade 4', 'Grade 12'], ['Grade 4', 'Grade 9'], ['Grade 10', 'Grade 12']) === 'Tutor for Grades 4 to 12'
    && range(['Grade 10', 'Grade 12'], ['Grade R', 'Grade 3']) === 'Tutor for Grades R to 12' && range(['Grade 5', 'Grade 5']) === 'Tutor for Grade 5' && range() === 'Tutor on Tutorlage'
    && range(['Grade 8', 'Grade 12'], ['Grade 10', 'Adult / Professional Development']) === 'Tutor on Tutorlage' && range(['', '']) === 'Tutor on Tutorlage');
  check('the price reads in rands, an hour', priceLine({ price: 250, currency: 'ZAR' }) === 'R250 an hour' && priceLine({ price: 1250, currency: 'ZAR' }).endsWith('250 an hour') && priceLine({ price: 1250, currency: 'ZAR' }).startsWith('R1'));
  check('the profile link and the booking address are right (Book goes to this tutor\'s booking page)', profileLink('TESSA') === 'https://tutorlage.com/t/TESSA' && bookPath('TESSA') === '/t/TESSA/book' && bookPath('A B') === '/t/A%20B/book');

  // the answer
  const p = parsePublicPage(good);
  check('a good answer is understood; odd subject entries are dropped', !!p && p.firstName === 'Tessa' && p.subjects.length === 1 && p.subjects[0].minGrade === 'Grade 8' && p.takingRequests && p.hours === 'Monday to Friday, 5pm to 11pm' && p.price === 250 && p.discount?.percent === 10 && p.tierLine === null);
  check('the basis is the tutor\'s own credential label', p?.basis?.kind === 'credential' && p.basis.label === 'Student teacher enrolled in a B.Ed or PGCE (proof of enrolment)');
  const rec = parsePublicPage({ ...good, basis: { kind: 'record', min_hours: 10, min_rating: 4.8, min_repeat_rate_pct: 0, min_reviews: 0, min_uplift_students: 0, required_uplift_pct: 0, outside_hours: false } })?.basis;
  const outside = parsePublicPage({ ...good, basis: { kind: 'record', min_hours: 10, outside_hours: true } })?.basis;
  check('a level reached by record shows that level\'s minimums; hours from outside are not called taught on Tutorlage', rec?.kind === 'record' && rec.lines.join('|') === '10 or more hours taught on Tutorlage|Rated 4.8 or higher' && outside?.kind === 'record' && outside.lines[0] === '10 or more hours of teaching');
  check('no basis, an odd basis or an empty one shows nothing', parsePublicPage({ ...good, basis: null })?.basis === null && parsePublicPage({ ...good, basis: { kind: 'credential' } })?.basis === null && parsePublicPage({ ...good, basis: { kind: 'record' } })?.basis === null && parsePublicPage({ ...good, basis: 'x' })?.basis === null);
  check('no page for null, an empty answer, a missing code or name, or a non-object', parsePublicPage(null) === null && parsePublicPage({}) === null && parsePublicPage({ first_name: 'A' }) === null && parsePublicPage({ code: 'A' }) === null && parsePublicPage('x') === null);
  check('a photo is accepted only as a small JPEG data address (anything else is dropped)', parsePublicPage({ ...good, photo: 'data:image/jpeg;base64,/9j/4AAQ' })?.photo === 'data:image/jpeg;base64,/9j/4AAQ' && parsePublicPage({ ...good, photo: 'https://x.test/a.jpg' })?.photo === null && parsePublicPage({ ...good, photo: 'data:image/svg+xml;base64,AAAA' })?.photo === null && parsePublicPage({ ...good, photo: 'javascript:alert(1)' })?.photo === null && parsePublicPage(good)?.photo === null);
  check('no hours means no hours line and not taking requests', (() => { const q = parsePublicPage({ ...good, hours: null, taking_requests: false }); return !!q && q.hours === null && !q.takingRequests; })());
  const ok = { rpc: async (fn: string, args?: Record<string, unknown>) => ({ data: fn === 'public_tutor_page' && args?.p_code === 'TESSA' ? good : null, error: null }) };
  check('the page is asked for by its code, through the one public function', (await fetchPublicPage(ok, 'TESSA'))?.firstName === 'Tessa' && (await fetchPublicPage(ok, 'NOPE')) === null);
  check('an error or a throw is "no page", never a crash', (await fetchPublicPage({ rpc: async () => ({ data: good, error: { message: 'x' } }) }, 'TESSA')) === null && (await fetchPublicPage({ rpc: async () => { throw new Error('down'); } }, 'TESSA')) === null);

  // the tutor's switch
  const me = await fetchMyPublicProfile({ rpc: async () => ({ data: { is_tutor: true, code: 'TESSA', can_be_public: true, is_public: false }, error: null }) });
  check('the tutor\'s own state is read', !!me && me.isTutor && me.code === 'TESSA' && me.canBePublic && !me.isPublic);
  check('a failed read of the switch shows nothing', (await fetchMyPublicProfile({ rpc: async () => ({ data: null, error: { message: 'x' } }) })) === null && (await fetchMyPublicProfile({ rpc: async () => { throw new Error('x'); } })) === null);
  check('switching sends the one boolean and reports nothing when it worked', await setMyPublicProfile({ rpc: async (fn, a) => ({ data: null, error: fn === 'set_my_public_profile' && a?.p_public === true ? null : { message: 'wrong' } }) }, true) === null);
  check('a refusal is told in plain words, anything else as a try-again line', (await setMyPublicProfile({ rpc: async () => ({ data: null, error: { message: 'Your page can be switched on once you are approved' } }) }, true)) === PUBLIC_PAGE_COPY.cantYet
    && (await setMyPublicProfile({ rpc: async () => { throw new Error('x'); } }, false)) === 'Could not change your page. Try again.');

  // the words
  const c = PUBLIC_PAGE_COPY;
  const allWords = JSON.stringify(c) + [c.bookNote('A'), c.discountNote(10, 3), c.notTaking('A'), c.hoursNote('A'), c.recordHeading('A')].join(' ');
  check('the discount is said of a new parent or learner account only; the time is asked for and booked only on acceptance; no other tutor is offered',
    c.discountNote(10, 3) === 'A new parent or learner account created from this page pays 10% less on its first 3 lessons.' && /booked only when A accepts/.test(c.hoursNote('A')) && !/another tutor|any tutor/i.test(allWords));
  check('no "vetted", "certified", "background-checked", "free", "instant" or "wallet" in the page words', !/vetted|certified|background|\bfree\b|instant|wallet/i.test(allWords) && !/vetted|certified|background/i.test(read('src/pages/TutorPublicPage.tsx') + read('src/components/TutorLevelCard.tsx')));
  check('the consent line says what is shown (the photo only once approved), that there is no surname, and that it can be switched off at once', /first name, your subjects and grades, your level and price, the qualification, study or other basis your level rests on, your weekly hours/.test(PUBLIC_PAGE_COPY.consent)
    && /your photo once the company has approved it\. No surname and no contact details/.test(PUBLIC_PAGE_COPY.consent) && !/No photo/.test(PUBLIC_PAGE_COPY.consent) && /switch it off at any time and the page disappears at once/.test(PUBLIC_PAGE_COPY.consent));
  check('it never names a school, campus or faculty, nor claims "instant"', !/school|campus|faculty|university/i.test(allWords));

  // the page and its surroundings
  const page = code('src/pages/TutorPublicPage.tsx');
  check('the page says noindex, nofollow itself', /useNoIndex\(\);/.test(page) && /'noindex,nofollow'/.test(read('src/lib/publicTutorHooks.ts')));
  const shell = code('src/components/LinkShell.tsx');
  check('the page shows only the approved photo (from the page answer), no intro, no "checked" section, and reads no table itself', (shell.match(/<img/g) ?? []).length === 1 && /photo=\{page\.photo\}/.test(page) && !/<img|avatar|intro|headline|checked/i.test(page) && !/\.from\(/.test(page) && !/\.insert\(|\.update\(|\.delete\(/.test(page));
  check('Book goes to this tutor\'s booking page, never to the start page or a code link', /to=\{bookPath\(page\.code\)\}/.test(page) && !/tutorCodeLink|\?code=/.test(page));
  check('the Book button and its notes are inside the one level card, which stays in view in two columns from 1024 px',
    /<TutorLevelCard page=\{page\}>[\s\S]*data-book[\s\S]*data-discount[\s\S]*<\/TutorLevelCard>/.test(page) && /lg:sticky lg:top-4/.test(page) && /<LinkShell wide /.test(page) && /\{children\}\s*<\/section>/.test(code('src/components/TutorLevelCard.tsx')));
  check('the colour rule is in the frame: a navy header and hero panel, cream page', /<header className="bg-\[#0F172A\]/.test(shell) && /bg-\[#0F172A\] text-white" data-hero/.test(shell) && /bg-\[#FAF7F2\]/.test(shell));
  check('robots.txt disallows /t/ and the sitemap has no /t/ entry', /^Disallow: \/t\/$/m.test(robotsTxt(PAGE_META)) && !/\/t\//.test(sitemapXml(PAGE_META)) && !PAGE_META.some((m) => m.path.startsWith('/t/')));
  const main = read('src/main.tsx');
  check('the routes /t/:code, /book and /signup exist, before the catch-all', /<Route path="\/t\/:code" element=\{<TutorPublicPage \/>\} \/>/.test(main) && /<Route path="\/t\/:code\/book"/.test(main) && /<Route path="\/t\/:code\/signup"/.test(main) && main.indexOf('/t/:code/signup') < main.indexOf('path="*"'));
  const teach = read('src/components/TeachGoScreen.tsx');
  check('the Teach screen has the card and says it is WAVE-marked', /<PublicPageCard \/>/.test(teach) && /WAVE-MARKED/.test(teach));
  const card = code('src/components/PublicPageCard.tsx');
  check('the card needs the tick before it switches on, and offers copy and switch off once public', /disabled=\{busy \|\| !ticked\}/.test(card) && /COPY\.copy/.test(card) && /COPY\.switchOff/.test(card) && !/\.from\(/.test(card));
  const mig = read('supabase/migrations/20261124120000_public_tutor_profile.sql');
  check('the database function is open to a visitor; the switch and the helpers are not; the table is closed', /grant execute on function public\.public_tutor_page\(text\) to anon, authenticated/.test(mig)
    && /revoke all on table public\.tutor_public_profile from public, anon, authenticated, service_role/.test(mig) && /revoke all on function public\.set_my_public_profile\(boolean\) from public, anon/.test(mig));

  console.log(failed === 0 ? '\nAll public-page checks passed.' : `\n${failed} public-page check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
