// Checks on the tutor's public page /t/CODE (CEO, 24 Nov 2026; job P slice 1; migration 20261124120000). Run: npx tsx scripts/dev/public-tutor-page-test.ts
// Proves, on the pure words in src/lib/publicTutorPage.ts and by reading the sources: the grades read in words; the database's answer is understood tolerantly (an error, a throw or an odd value all mean "no page");
// the price reads "R... an hour"; the profile link and the Book link are the right addresses (Book is the same sign-up link her code link has always been); the page says noindex, nofollow, robots.txt disallows /t/,
// the sitemap has no /t/ entry; the page shows no photo, no intro and reads no table; none of the words say "vetted", "certified", "background-checked", "free" or "instant"; the route exists; the only change to
// the Teach screen is the card. The database half (who sees what, the checked lines, the hours in words, consent and withdrawal) is proved by supabase/tests/public_tutor_profile.sql.
import { readFileSync } from 'node:fs';
import { PUBLIC_PAGE_COPY, bookLink, fetchMyPublicProfile, fetchPublicPage, gradesInWords, parsePublicPage, priceLine, profileLink, setMyPublicProfile } from '../../src/lib/publicTutorPage';
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
  checked: ['ID checked', 7, 'Police clearance checked, November 2026'], hours: 'Monday to Friday, 5pm to 11pm', taking_requests: true,
};

async function main() {
  // words
  check('grades: a range, one grade, a grade R start, and the plain words for a non-grade end',
    gradesInWords('Grade 8', 'Grade 12') === 'Grades 8 to 12' && gradesInWords('Grade 5', 'Grade 5') === 'Grade 5' && gradesInWords('Grade R', 'Grade 6') === 'Grades R to 6'
    && gradesInWords('Grade 10', 'Adult / Professional Development') === 'Grade 10 to Adult / Professional Development');
  check('the price reads in rands, an hour', priceLine({ price: 250, currency: 'ZAR' }) === 'R250 an hour' && priceLine({ price: 1250, currency: 'ZAR' }).endsWith('250 an hour') && priceLine({ price: 1250, currency: 'ZAR' }).startsWith('R1'));
  check('the profile link and the Book link are the right addresses (Book = her code link, relative)', profileLink('TESSA') === 'https://tutorlage.com/t/TESSA' && bookLink('TESSA') === '/?code=TESSA' && bookLink('A B') === '/?code=A%20B');

  // the answer
  const p = parsePublicPage(good);
  check('a good answer is understood; odd subject and check entries are dropped', !!p && p.firstName === 'Tessa' && p.subjects.length === 1 && p.subjects[0].minGrade === 'Grade 8' && p.checked.length === 2 && p.takingRequests && p.hours === 'Monday to Friday, 5pm to 11pm' && p.price === 250);
  check('no page for null, an empty answer, a missing code or name, or a non-object', parsePublicPage(null) === null && parsePublicPage({}) === null && parsePublicPage({ first_name: 'A' }) === null && parsePublicPage({ code: 'A' }) === null && parsePublicPage('x') === null);
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
  const allWords = JSON.stringify(PUBLIC_PAGE_COPY);
  check('no "vetted", "certified", "background-checked", "free" or "instant" in the page words', !/vetted|certified|background|\bfree\b|instant/i.test(allWords) && !/vetted|certified|background/i.test(read('src/pages/TutorPublicPage.tsx')));
  check('the consent line says what is shown, that there is no photo or surname, and that it can be switched off at once', /first name, your subjects and grades, your level and price, the checks we have done and your weekly hours/.test(PUBLIC_PAGE_COPY.consent)
    && /No photo, no surname, no contact details/.test(PUBLIC_PAGE_COPY.consent) && /switch it off at any time and the page disappears at once/.test(PUBLIC_PAGE_COPY.consent));
  check('it never names a school, campus or faculty, nor claims "instant"', !/school|campus|faculty|university/i.test(allWords));

  // the page and its surroundings
  const page = code('src/pages/TutorPublicPage.tsx');
  check('the page says noindex, nofollow itself', /'noindex,nofollow'/.test(page));
  check('the page shows no photo and no intro, and reads no table itself', !/<img|avatar|intro|headline/i.test(page) && !/\.from\(/.test(page) && !/\.insert\(|\.update\(|\.delete\(/.test(page));
  check('Book is the sign-up link with her code (the sign-up flow itself is not touched)', /href=\{bookLink\(page\.code\)\}/.test(page));
  check('robots.txt disallows /t/ and the sitemap has no /t/ entry', /^Disallow: \/t\/$/m.test(robotsTxt(PAGE_META)) && !/\/t\//.test(sitemapXml(PAGE_META)) && !PAGE_META.some((m) => m.path.startsWith('/t/')));
  const main = read('src/main.tsx');
  check('the route /t/:code exists, before the catch-all', /<Route path="\/t\/:code" element=\{<TutorPublicPage \/>\} \/>/.test(main) && main.indexOf('/t/:code') < main.indexOf('path="*"'));
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
