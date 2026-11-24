// Checks on the week-one share card (24 Nov 2026, JOB CARD): the caption text, the subject lines, the first-name capitals, the words that must never appear, and that the
// card code is loaded only from the lazy component (so only the Teach screen pays for it). Run: npx tsx scripts/dev/share-card-test.ts
import fs from 'node:fs';
import { SHARE_CARD_COPY, cardSubjectLines, launchCaption, nameForCard, parseWeeklyPost, subjectLines, weeklyCaption, subjectsInSentence } from '../../src/lib/shareCard';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

const subs = [
  { subject: 'Mathematics', minGrade: 'Grade 8', maxGrade: 'Grade 12' },
  { subject: 'Physical Sciences', minGrade: 'Grade 10', maxGrade: 'Grade 12' },
];
check('subject lines say subject and grades', subjectLines(subs).join('|') === 'Mathematics: Grades 8 to 12|Physical Sciences: Grades 10 to 12', subjectLines(subs).join('|'));
check('the same subject line twice is shown once', subjectLines([subs[0], subs[0]]).length === 1);
check('sentence form', subjectsInSentence(subs) === 'Mathematics (Grades 8 to 12), Physical Sciences (Grades 10 to 12)', subjectsInSentence(subs));
const link = 'https://tutorlage.com/t/AMIRA';
const cap = launchCaption(subs, link);
check('caption is the CEO\'s wording', cap === `I'm now tutoring online on Tutorlage. Subjects and grades: Mathematics (Grades 8 to 12), Physical Sciences (Grades 10 to 12). My profile: ${link}. Please reshare this post to help support my business.`, cap);
const many = Array.from({ length: 9 }, (_v, i) => ({ subject: `Subject ${i + 1}`, minGrade: 'Grade 1', maxGrade: 'Grade 7' }));
const lines = cardSubjectLines(many);
check('at most six lines on the card, the last says how many more', lines.length === 6 && lines[5] === 'and 4 more on my profile', lines.join('|'));
check('first name gets capitals', nameForCard('odirile') === 'Odirile' && nameForCard('mary-ann') === 'Mary-Ann' && nameForCard('  amira ') === 'Amira');

const files = ['src/lib/shareCard.ts', 'src/components/ShareCard.tsx'].map(read).join('\n') + Object.values(SHARE_CARD_COPY).join('\n');
const banned = /\b(free|instant|instantly|wallet|vetted|certified|background[- ]check(ed)?)\b/i;
check('no banned word on the card or its text', !banned.test(files + cap), (files + cap).match(banned)?.[0] ?? '');
check('no price, earnings or surname on the card', !/\b(price|earn|income|surname|R\d)/i.test(read('src/lib/shareCard.ts').replace(/\/\/.*$/gm, '')), '');

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
check('the QR library is imported only on demand', /await import\('qrcode-generator'\)/.test(read('src/lib/shareCard.ts')) && !/^import .*qrcode-generator/m.test(read('src/lib/shareCard.ts')));

// ---- the weekly post (JOB WEEKLY) ----
const w3 = weeklyCaption({ week: 2, lessons: 3 }, link);
const w1 = weeklyCaption({ week: 1, lessons: 1 }, link);
const w0 = weeklyCaption({ week: 4, lessons: 0 }, link);
check('weekly caption with lessons is the CEO wording', w3 === `Week 2: I taught 3 lessons. Thank you to the families who trusted me. ${link}. Know a parent looking for a tutor? Please reshare this post.`, w3);
check('one lesson reads "1 lesson"', w1.startsWith('Week 1: I taught 1 lesson.'), w1);
check('zero lessons switches to the thank-you caption, no week and no number', w0 === `Thank you to everyone who has supported me so far. I'm still looking for my first families. Please help me reach them by resharing this post, it would be greatly appreciated. ${link}` && !/Week|taught/.test(w0), w0);
check('the numbers are read as whole counts only', parseWeeklyPost({ week: 3, lessons: 2 })?.lessons === 2 && parseWeeklyPost({ week: 0, lessons: 2 }) === null && parseWeeklyPost({ week: 1, lessons: -1 }) === null && parseWeeklyPost({ week: 1, lessons: 'x' }) === null && parseWeeklyPost(null) === null);
check('no banned word, price or earnings in the weekly captions', !banned.test(w3 + w1 + w0) && !/\b(price|earn|income|R\d)/i.test(w3 + w1 + w0));
check('the Monday notice and the page-live notice open the Teach screen', /'weekly_post_ready'/.test(read('src/lib/notificationTarget.ts')) && /'public_page_live'/.test(read('src/lib/notificationTarget.ts')));

process.exitCode = failures === 0 ? 0 : 1;
