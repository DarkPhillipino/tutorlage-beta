// Checks on the share card (24 Nov 2026, JOBS CARD, WEEKLY and FACE; PM lines 69 and 70): the two layouts and the four-subject boundary, the grouping by grade range
// with Odi's real seven subjects, a three-subject tutor, the caption (link on its own line, none on the picture), no QR code, the photo staying on her phone, the
// first-name capitals, the words that must never appear, and that the card code is loaded only from the lazy component (so only the Teach screen pays for it).
// Run: npx tsx scripts/dev/share-card-test.ts
import fs from 'node:fs';
import {
  PHOTO_ADVICE, SHARE_CARD_COPY, cardLayout, groupByGradeRange, launchCaption, nameForCard, parseWeeklyPost, weeklyCaption,
} from '../../src/lib/shareCard';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');
const sub = (subject: string, minGrade: string, maxGrade: string) => ({ subject, minGrade, maxGrade });

// Odi's real seven subjects, as her live page returned them on 24 Nov 2026 (in the order the page gives them)
const odi = [
  sub('English First Additional Language', 'Grade 4', 'Grade 12'),
  sub('English Home Language', 'Grade 4', 'Grade 12'),
  sub('Geography', 'Grade 10', 'Grade 12'),
  sub('Life Sciences', 'Grade 10', 'Grade 12'),
  sub('Mathematics', 'Grade 4', 'Grade 8'),
  sub('Natural Sciences and Technology', 'Grade 4', 'Grade 9'),
  sub('Social Sciences', 'Grade 4', 'Grade 9'),
];
// Amira's two, and a three-subject tutor
const amira = [sub('English Home Language', 'Grade 1', 'Grade 12'), sub('Geography', 'Grade 8', 'Grade 12')];
const three = [sub('Mathematics', 'Grade 8', 'Grade 12'), sub('Physical Sciences', 'Grade 8', 'Grade 12'), sub('Accounting', 'Grade 10', 'Grade 12')];
const four = [...three, sub('Geography', 'Grade 10', 'Grade 12')];

// ---- the layouts and the boundary ----
check('Odi (7 subjects) gets layout B', cardLayout(odi) === 'B');
check('Amira (2 subjects) gets layout A', cardLayout(amira) === 'A');
check('three subjects = layout A, four subjects = layout B (the boundary)', cardLayout(three) === 'A' && cardLayout(four) === 'B');
check('the same subject in two grade bands counts once', cardLayout([sub('Mathematics', 'Grade 4', 'Grade 7'), sub('Mathematics', 'Grade 8', 'Grade 12'), ...three.slice(1)]) === 'A');
check('no subjects at all is layout A', cardLayout([]) === 'A');

// ---- the grouping by grade range ----
const flat = (g: ReturnType<typeof groupByGradeRange>) => g.map((x) => `${x.range}: ${x.subjects.join(', ')}`).join(' | ');
const oddGroups = flat(groupByGradeRange(odi));
check(
  "Odi's card, widest range first, English joined",
  oddGroups === 'Grade 4 to 12: English | Grade 4 to 9: Natural Sciences and Technology, Social Sciences | Grade 4 to 8: Mathematics | Grade 10 to 12: Geography, Life Sciences',
  oddGroups,
);
check("Odi's seven subjects are all there (nothing cut off, none invented)", groupByGradeRange(odi).flatMap((g) => g.subjects).length === 6 && oddGroups.includes('English') && ['Geography', 'Life Sciences', 'Mathematics', 'Natural Sciences and Technology', 'Social Sciences'].every((s) => oddGroups.includes(s)));
check("Amira's card: one block per grade range", flat(groupByGradeRange(amira)) === 'Grade 1 to 12: English Home Language | Grade 8 to 12: Geography', flat(groupByGradeRange(amira)));
check('a three-subject tutor: two blocks, subjects sharing a range together', flat(groupByGradeRange(three)) === 'Grade 8 to 12: Mathematics, Physical Sciences | Grade 10 to 12: Accounting', flat(groupByGradeRange(three)));
check('one grade is "Grade 5"; Grade R sorts as the lowest', flat(groupByGradeRange([sub('Mathematics', 'Grade 5', 'Grade 5'), sub('Life Skills', 'Grade R', 'Grade 3')])) === 'Grade R to 3: Life Skills | Grade 5: Mathematics', flat(groupByGradeRange([sub('Mathematics', 'Grade 5', 'Grade 5'), sub('Life Skills', 'Grade R', 'Grade 3')])));
check('English is joined only when both share a range', flat(groupByGradeRange([sub('English Home Language', 'Grade 4', 'Grade 12'), sub('English First Additional Language', 'Grade 8', 'Grade 12')])) === 'Grade 4 to 12: English Home Language | Grade 8 to 12: English First Additional Language');
check('a tutor with no photo and no subjects makes no groups (the card is not offered)', groupByGradeRange([]).length === 0);

// ---- the caption: her link on its own line, nothing on the picture ----
check('first name gets capitals', nameForCard('odirile') === 'Odirile' && nameForCard('mary-ann') === 'Mary-Ann' && nameForCard('  amira ') === 'Amira');
const link = 'https://tutorlage.com/t/AMIRA';
const cap = launchCaption(link);
check("caption is the CEO's words with the link on its own line", cap === `I'm now tutoring online on Tutorlage. Please reshare this post to help support my business.\n${link}`, cap);
check('the caption does not list subjects', !/Mathematics|Geography|Subjects and grades/.test(cap));

const lib = read('src/lib/shareCard.ts');
const comp = read('src/components/ShareCard.tsx');
const libCode = lib.replace(/\/\/.*$/gm, '');
check('no QR code and no link drawn on the picture', !/qrcode|drawQr|Scan to see/i.test(libCode + comp) && !/fillText\([^)]*link/i.test(libCode));
check('the QR library is gone from the project', !/qrcode-generator/.test(read('package.json')));
check('the card text says TUTORLAGE small top-left (a brand drawn from the left padding)', /'TUTORLAGE'/.test(libCode) && /textAlign = 'left'/.test(libCode));

// ---- her photo stays on her phone ----
check('the photo code uploads and stores nothing', !/fetch\(|XMLHttpRequest|sendBeacon|\.upload\(|supabase|localStorage|sessionStorage|indexedDB|FileReader/.test(libCode + comp.replace(/\/\/.*$/gm, '')));
check('the photo advice is the CEO wording, under the picker', PHOTO_ADVICE === 'A photo of just you, shoulders up, in daylight, with a warm smile. No school or campus badges, no logos, no other people, no writing in the picture.' && /COPY\.photoAdvice/.test(comp));
check('the WhatsApp status privacy line is on the Teach screen near the button', SHARE_CARD_COPY.privacyLine === 'Before you post, check in WhatsApp status privacy that people can reshare your status.' && /COPY\.privacyLine/.test(comp));
check('the button says Share my profile', SHARE_CARD_COPY.share === 'Share my profile');
check('the picture is drawn again when she taps (so it carries her photo as it is now)', /await draw\(canvasRef\.current\)/.test(comp));

const files = [lib, comp].join('\n') + Object.values(SHARE_CARD_COPY).join('\n');
const banned = /\b(free|instant|instantly|wallet|vetted|certified|background[- ]check(ed)?)\b/i;
check('no banned word on the card or its text', !banned.test(files + cap), (files + cap).match(banned)?.[0] ?? '');
check('no price, earnings or surname on the card', !/\b(price|earn|income|surname|R\d)/i.test(libCode), '');
check('no campus on the card', !/campus/i.test(libCode.replace(PHOTO_ADVICE, '')));

const importers = ['src', 'admin/src'].flatMap((d) => {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(new URL(`${dir}/`, root), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`);
      else if (/\.(ts|tsx)$/.test(e.name) && /from '[^']*\/(shareCard|ShareCard)'|import\('[^']*\/(shareCard|ShareCard)'\)/.test(read(`${dir}/${e.name}`))) out.push(`${dir}/${e.name}`);
    }
  };
  walk(d);
  return out;
});
check('the card code is reached only through the lazy import', importers.sort().join(',') === 'src/components/PublicPageCard.tsx,src/components/ShareCard.tsx', importers.join(','));

// ---- the weekly post (same design and rules) ----
const w3 = weeklyCaption({ week: 2, lessons: 3 }, link);
const w1 = weeklyCaption({ week: 1, lessons: 1 }, link);
const w0 = weeklyCaption({ week: 4, lessons: 0 }, link);
check('weekly caption with lessons is the CEO wording, link on its own line', w3 === `Week 2: I taught 3 lessons. Thank you to the families who trusted me. Know a parent looking for a tutor? Please reshare this post.\n${link}`, w3);
check('one lesson reads "1 lesson"', w1.startsWith('Week 1: I taught 1 lesson.'), w1);
check('zero lessons switches to the thank-you caption, no week and no number', w0 === `Thank you to everyone who has supported me so far. I'm still looking for my first families. Please help me reach them by resharing this post, it would be greatly appreciated.\n${link}` && !/Week|taught/.test(w0), w0);
check('the numbers are read as whole counts only', parseWeeklyPost({ week: 3, lessons: 2 })?.lessons === 2 && parseWeeklyPost({ week: 0, lessons: 2 }) === null && parseWeeklyPost({ week: 1, lessons: -1 }) === null && parseWeeklyPost({ week: 1, lessons: 'x' }) === null && parseWeeklyPost(null) === null);
check('no banned word, price or earnings in the weekly captions', !banned.test(w3 + w1 + w0) && !/\b(price|earn|income|R\d)/i.test(w3 + w1 + w0));
check('the Monday notice and the page-live notice open the Teach screen', /'weekly_post_ready'/.test(read('src/lib/notificationTarget.ts')) && /'public_page_live'/.test(read('src/lib/notificationTarget.ts')));

process.exitCode = failures === 0 ? 0 : 1;
