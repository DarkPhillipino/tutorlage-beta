// The week-one share card (CEO, 24 Nov 2026; PM line 62, JOB CARD): a 9:16 picture a tutor posts on her WhatsApp status, and the caption that goes with it.
// What is on it: TUTORLAGE, her first name, her subjects and grades, her link and a QR code of the link. Never a price, earnings, a surname, a contact detail or a campus.
// Pure text helpers live here (tested); the drawing needs a canvas and is only reached from the lazy ShareCard component on the Teach screen, so none of this
// (nor the QR code library) is loaded anywhere else.
import { capitaliseName, gradesInWords, type PublicPageSubject } from './publicTutorPage';

export const CARD_W = 1080;
export const CARD_H = 1920;
const MAX_LINES = 6;

// Capitalise the first letter of each part of a first name ("odirile" -> "Odirile", "mary-ann" -> "Mary-Ann"); the rest is left as typed.
export const nameForCard = capitaliseName;

// One line per subject: "Mathematics: Grades 8 to 12". The same subject twice (two grade bands) is shown twice, as she set it.
export function subjectLines(subjects: PublicPageSubject[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of subjects) {
    const line = `${s.subject.trim()}: ${gradesInWords(s.minGrade, s.maxGrade)}`;
    if (!s.subject.trim() || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

// The lines drawn on the card: at most MAX_LINES, the last one saying how many more there are.
export function cardSubjectLines(subjects: PublicPageSubject[]): string[] {
  const all = subjectLines(subjects);
  if (all.length <= MAX_LINES) return all;
  return [...all.slice(0, MAX_LINES - 1), `and ${all.length - (MAX_LINES - 1)} more on my profile`];
}

// "Mathematics (Grades 8 to 12), Physical Sciences (Grades 10 to 12)"
export function subjectsInSentence(subjects: PublicPageSubject[]): string {
  return subjectLines(subjects).map((l) => l.replace(/: /, ' (') + ')').join(', ');
}

// The launch caption, in the CEO's words, copied in one tap.
export function launchCaption(subjects: PublicPageSubject[], link: string): string {
  return `I'm now tutoring online on Tutorlage. Subjects and grades: ${subjectsInSentence(subjects)}. My profile: ${link}. Please reshare this post to help support my business.`;
}

export const SHARE_CARD_COPY = {
  heading: 'Your share card',
  how: 'Post this picture on your WhatsApp status with the caption below. Change the words as you like.',
  download: 'Save the card',
  share: 'Share the card',
  copyCaption: 'Copy the caption',
  copied: 'Copied',
  captionLabel: 'Caption',
  making: 'Making your card…',
  weeklyHeading: 'Your weekly post',
  weeklyHow: 'Made from your real numbers: the lessons you completed in the last 7 days. Post it on your WhatsApp status and change the words as you like.',
  failed: 'Could not make the card on this phone. You can still copy your link above.',
  alt: 'Your share card: Tutorlage, your first name, your subjects and grades, and a QR code of your profile link.',
} as const;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(t).width > maxWidth) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Draws the card on a canvas of CARD_W x CARD_H. The QR code library is loaded here, on demand.
export async function drawShareCard(canvas: HTMLCanvasElement, input: { firstName: string; subjects: PublicPageSubject[]; link: string }): Promise<void> {
  const qrModule = await import('qrcode-generator');
  const qrcode = (qrModule as unknown as { default?: typeof import('qrcode-generator') }).default ?? (qrModule as unknown as typeof import('qrcode-generator'));
  const qr = qrcode(0, 'M');
  qr.addData(input.link);
  qr.make();

  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const green = '#15803D';
  const ink = '#0F172A';

  ctx.fillStyle = '#FAF7F2';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = green;
  ctx.fillRect(0, 0, CARD_W, 24);
  ctx.fillRect(0, CARD_H - 24, CARD_W, 24);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = green;
  ctx.font = `800 84px ${font}`;
  ctx.fillText('TUTORLAGE', CARD_W / 2, 230);

  ctx.fillStyle = ink;
  ctx.font = `600 52px ${font}`;
  ctx.fillText("I'm now tutoring online", CARD_W / 2, 420);
  ctx.font = `800 120px ${font}`;
  let name = nameForCard(input.firstName) || 'Your tutor';
  while (ctx.measureText(name).width > CARD_W - 140 && name.length > 3) name = name.slice(0, -1);
  ctx.fillText(name, CARD_W / 2, 560);

  ctx.fillStyle = green;
  ctx.font = `700 40px ${font}`;
  ctx.fillText('Subjects and grades', CARD_W / 2, 680);

  ctx.fillStyle = ink;
  ctx.font = `500 44px ${font}`;
  let y = 760;
  for (const line of cardSubjectLines(input.subjects)) {
    for (const part of wrap(ctx, line, CARD_W - 160)) {
      ctx.fillText(part, CARD_W / 2, y);
      y += 62;
    }
    y += 10;
  }

  drawQrAndLink(ctx, qr, input.link, 1180);
}

type Qr = { getModuleCount(): number; isDark(r: number, c: number): boolean };

// The QR code (white square, quiet zone included, centred), "Scan to see my profile" and the link, from y = qy down.
function drawQrAndLink(ctx: CanvasRenderingContext2D, qr: Qr, link: string, qy: number): void {
  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const count = qr.getModuleCount();
  const quiet = 4;
  const cell = Math.floor(520 / (count + quiet * 2));
  const size = cell * (count + quiet * 2);
  const qx = Math.round((CARD_W - size) / 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(qx, qy, size, size);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (qr.isDark(r, c)) ctx.fillRect(qx + (c + quiet) * cell, qy + (r + quiet) * cell, cell, cell);
    }
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = `600 40px ${font}`;
  ctx.fillText('Scan to see my profile', CARD_W / 2, qy + size + 80);
  ctx.fillStyle = '#15803D';
  ctx.font = `700 44px ${font}`;
  ctx.fillText(link.replace(/^https?:\/\//, ''), CARD_W / 2, qy + size + 150);
}

// ---- The weekly card (JOB WEEKLY): her REAL numbers, counts only ----------------------------------------------------------------------------------------
// Lessons COMPLETED in the last 7 days (the database counts them; never scheduled, never invented). No price, earnings, learner or family detail.
export interface WeeklyPost { week: number; lessons: number }

export function parseWeeklyPost(data: unknown): WeeklyPost | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const week = Number(d.week);
  const lessons = Number(d.lessons);
  if (!Number.isInteger(week) || week < 1 || !Number.isInteger(lessons) || lessons < 0) return null;
  return { week, lessons };
}

export function lessonsWord(n: number): string {
  return n === 1 ? '1 lesson' : `${n} lessons`;
}

export function weeklyCaption(post: WeeklyPost, link: string): string {
  if (post.lessons >= 1) {
    return `Week ${post.week}: I taught ${lessonsWord(post.lessons)}. Thank you to the families who trusted me. ${link}. Know a parent looking for a tutor? Please reshare this post.`;
  }
  return `Thank you to everyone who has supported me so far. I'm still looking for my first families. Please help me reach them by resharing this post, it would be greatly appreciated. ${link}`;
}

export async function drawWeeklyCard(canvas: HTMLCanvasElement, input: { firstName: string; post: WeeklyPost; link: string }): Promise<void> {
  const qrModule = await import('qrcode-generator');
  const qrcode = (qrModule as unknown as { default?: typeof import('qrcode-generator') }).default ?? (qrModule as unknown as typeof import('qrcode-generator'));
  const qr = qrcode(0, 'M');
  qr.addData(input.link);
  qr.make();
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const green = '#15803D';
  const ink = '#0F172A';
  ctx.fillStyle = '#FAF7F2';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = green;
  ctx.fillRect(0, 0, CARD_W, 24);
  ctx.fillRect(0, CARD_H - 24, CARD_W, 24);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = green;
  ctx.font = `800 84px ${font}`;
  ctx.fillText('TUTORLAGE', CARD_W / 2, 230);
  ctx.fillStyle = ink;
  ctx.font = `800 100px ${font}`;
  let name = nameForCard(input.firstName) || 'Your tutor';
  while (ctx.measureText(name).width > CARD_W - 140 && name.length > 3) name = name.slice(0, -1);
  ctx.fillText(name, CARD_W / 2, 420);
  ctx.fillStyle = green;
  ctx.font = `700 56px ${font}`;
  ctx.fillText(`Week ${input.post.week}`, CARD_W / 2, 510);
  if (input.post.lessons >= 1) {
    ctx.fillStyle = ink;
    ctx.font = `800 300px ${font}`;
    ctx.fillText(String(input.post.lessons), CARD_W / 2, 800);
    ctx.font = `600 60px ${font}`;
    ctx.fillText(input.post.lessons === 1 ? 'lesson taught this week' : 'lessons taught this week', CARD_W / 2, 890);
    ctx.font = `500 46px ${font}`;
    ctx.fillText('Thank you to the families who trusted me', CARD_W / 2, 1010);
  } else {
    ctx.fillStyle = ink;
    ctx.font = `800 76px ${font}`;
    ctx.fillText('Thank you', CARD_W / 2, 740);
    ctx.font = `500 46px ${font}`;
    ctx.fillText('to everyone who has supported me', CARD_W / 2, 830);
    ctx.fillText("I'm still looking for my first families", CARD_W / 2, 920);
    ctx.fillText('Please reshare this post', CARD_W / 2, 1010);
  }
  drawQrAndLink(ctx, qr, input.link, 1180);
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png');
  });
}
