// Checks on the week-one share card (24 Nov 2026, JOB CARD): the caption text, the subject lines, the first-name capitals, the words that must never appear, and that the
// card code is loaded only from the lazy component (so only the Teach screen pays for it). Run: npx tsx scripts/dev/share-card-test.ts
import fs from 'node:fs';
import { SHARE_CARD_COPY, cardSubjectLines, launchCaption, nameForCard, subjectLines, subjectsInSentence } from '../../src/lib/shareCard';

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

process.exitCode = failures === 0 ? 0 : 1;
