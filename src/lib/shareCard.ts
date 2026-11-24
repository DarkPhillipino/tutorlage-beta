// The share card (CEO, 24 Nov 2026; PM lines 62, 69, 70): a 9:16 picture a tutor posts on her WhatsApp status, and the caption that goes with it.
// What is on it: TUTORLAGE small top-left, her face (an optional photo of her own, in a circle), her first name, her subjects and grades. NOTHING ELSE:
// no QR code and no link on the picture (the link lives in the caption, where WhatsApp makes it tappable). Never a price, earnings, a surname, a contact detail or a campus.
// Two layouts by how many subjects she covers: three or fewer = A (larger type), four or more = B (compact); both group the subjects by grade range, widest first.
// Pure text helpers live here (tested); the drawing needs a canvas and is only reached from the lazy ShareCard component on the Teach screen.
// Her photo is read, cropped and drawn in her own phone and never uploaded, stored or sent (PM line 69).
import { capitaliseName, gradesInWords, type PublicPageSubject } from './publicTutorPage';

export const CARD_W = 1080;
export const CARD_H = 1920;
// Four subjects or more = layout B (the CEO's rule, line 70).
export const LAYOUT_B_FROM = 4;

// Capitalise the first letter of each part of a first name ("odirile" -> "Odirile", "mary-ann" -> "Mary-Ann"); the rest is left as typed.
export const nameForCard = capitaliseName;

export type CardLayout = 'A' | 'B';

function distinctNames(subjects: PublicPageSubject[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of subjects) {
    const n = s.subject.trim();
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

// How many different subjects she covers decides the layout (the same subject in two grade bands counts once).
export function cardLayout(subjects: PublicPageSubject[]): CardLayout {
  return distinctNames(subjects).length >= LAYOUT_B_FROM ? 'B' : 'A';
}

// "Grade 4 to 12", "Grade 10 to 12", "Grade 5" (one grade).
export function gradeRangeLabel(min: string, max: string): string {
  return gradesInWords(min, max).replace(/^Grades /, 'Grade ');
}

// "Grade 8" -> 8, "Grade R" -> 0, anything else -> null
function gradeNumber(g: string): number | null {
  const m = /^Grade\s+(\S+)$/i.exec(g.trim());
  if (!m) return null;
  if (/^r$/i.test(m[1])) return 0;
  const n = Number(m[1]);
  return Number.isInteger(n) ? n : null;
}

export interface GradeGroup { range: string; subjects: string[] }

const isEnglishHome = (n: string) => /^english\b.*\bhome language\b/i.test(n);
const isEnglishFal = (n: string) => /^english\b.*\bfirst additional language\b/i.test(n);

// Subjects grouped by grade range, widest range first, subjects that share a range merged into one group. When both English subjects share a range they
// are written "English, Home Language and First Additional Language" in layout B only (PM line 71); layout A keeps the names as the page gives them. Only the subjects and ranges the public page returns: nothing is invented.
export const ENGLISH_BOTH = 'English, Home Language and First Additional Language';

export function groupByGradeRange(subjects: PublicPageSubject[], layout: CardLayout = 'B'): GradeGroup[] {
  const groups: { range: string; width: number; min: number; subjects: string[] }[] = [];
  for (const s of subjects) {
    const name = s.subject.trim();
    if (!name) continue;
    const range = gradeRangeLabel(s.minGrade, s.maxGrade);
    let g = groups.find((x) => x.range === range);
    if (!g) {
      const lo = gradeNumber(s.minGrade);
      const hi = gradeNumber(s.maxGrade);
      g = { range, width: lo !== null && hi !== null ? hi - lo : 99, min: lo ?? -1, subjects: [] };
      groups.push(g);
    }
    if (!g.subjects.some((x) => x.toLowerCase() === name.toLowerCase())) g.subjects.push(name);
  }
  for (const g of groups) {
    const h = g.subjects.findIndex(isEnglishHome);
    const f = g.subjects.findIndex(isEnglishFal);
    if (layout === 'B' && h >= 0 && f >= 0) {
      const first = Math.min(h, f);
      g.subjects = g.subjects.filter((_n, i) => i !== h && i !== f);
      g.subjects.splice(first, 0, ENGLISH_BOTH);
    }
  }
  groups.sort((a, b) => b.width - a.width || a.min - b.min);
  return groups.map((g) => ({ range: g.range, subjects: g.subjects }));
}

// The launch caption: the CEO's words, then her link on its own line (WhatsApp makes it tappable). The subjects are on the card, not in the caption.
export function launchCaption(link: string): string {
  return `I'm now tutoring online on Tutorlage. Please reshare this post to help support my business.\n${link}`;
}

export const PHOTO_ADVICE = 'A photo of just you, shoulders up, in daylight, with a warm smile. No school or campus badges, no logos, no other people, no writing in the picture.';

export const SHARE_CARD_COPY = {
  heading: 'Your share card',
  how: 'Tap Share my profile to post this picture on your WhatsApp status. The link goes in the caption, so people can tap it. Change the words as you like.',
  privacyLine: 'Before you post, check in WhatsApp status privacy that people can reshare your status.',
  photoHeading: 'Your photo (optional)',
  photoAdvice: PHOTO_ADVICE,
  photoStays: 'Your photo stays on your phone. It is only drawn onto your card here; it is not uploaded or saved anywhere.',
  photoTake: 'Take a photo',
  photoChoose: 'Choose a photo',
  photoRemove: 'Remove my photo',
  photoFailed: 'Could not use that picture. Please choose a JPG, PNG or WebP photo.',
  download: 'Save the card',
  share: 'Share my profile',
  copyCaption: 'Copy the caption',
  copied: 'Copied',
  captionLabel: 'Caption',
  making: 'Making your card…',
  weeklyHeading: 'Your weekly post',
  weeklyHow: 'Made from your real numbers: the lessons you completed in the last 7 days. Post it on your WhatsApp status and change the words as you like.',
  failed: 'Could not make the card on this phone. You can still copy your link above.',
  alt: 'Your share card: Tutorlage, your face if you added a photo, your first name, and your subjects and grades.',
} as const;

// ---- drawing ---------------------------------------------------------------------------------------------------------------------------------------------
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const BG = '#0F6E56';
const INK = '#E1F5EE';
const SOFT = '#5DCAA5';
// The design (reference page, 360 x 640) drawn at three times its size on the real 1080 x 1920 card.
const PAD_X = 66;
const PAD_TOP = 78;
const PAD_BOTTOM = 78;
const INNER_W = CARD_W - PAD_X * 2;
const BRAND_SIZE = 39;
const MIN_GAP = 36;

export interface Row { text: string; size: number; weight: number; color: string; mt: number; lh: number; left?: boolean }

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
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

interface Measured { row: Row; lines: string[] }

function measure(ctx: CanvasRenderingContext2D, rows: Row[]): { items: Measured[]; height: number } {
  let height = 0;
  const items: Measured[] = rows.map((row, i) => {
    ctx.font = `${row.weight} ${row.size}px ${FONT}`;
    const lines = wrap(ctx, row.text, INNER_W);
    height += (i === 0 ? 0 : row.mt) + lines.length * Math.round(row.size * row.lh);
    return { row, lines };
  });
  return { items, height };
}

export interface CardPhoto { source: CanvasImageSource }

// The rows of the subjects block. Layout A (the design's 360 px at 3 times): name 32 px semi-bold, then one bold 18 px grade line per range with the subjects under it, centred.
// Layout B: name 40 px centred, then groups left-aligned (bold 16 px range, subjects under it). `s` shrinks the group type (1 = the design size) when many groups must fit.
export function subjectRows(name: string, groups: GradeGroup[], layout: CardLayout, s: number): Row[] {
  if (layout === 'A') {
    const rows: Row[] = [{ text: name, size: 96, weight: 600, color: INK, mt: 0, lh: 1.15 }];
    groups.forEach((g, i) => {
      rows.push({ text: g.range, size: Math.round(54 * s), weight: 700, color: '#FFFFFF', mt: i === 0 ? 24 : Math.round(24 * s), lh: 1.2 });
      rows.push({ text: g.subjects.join(', '), size: Math.round(54 * s), weight: 400, color: INK, mt: 0, lh: 1.3 });
    });
    return rows;
  }
  const size = Math.round(48 * s);
  const rows: Row[] = [];
  groups.forEach((g, i) => {
    rows.push({ text: g.range, size, weight: 600, color: '#FFFFFF', mt: i === 0 ? 0 : Math.round(33 * s), lh: 1.2, left: true });
    rows.push({ text: g.subjects.join(', '), size, weight: 400, color: INK, mt: 0, lh: 1.35, left: true });
  });
  return rows;
}

function fitName(ctx: CanvasRenderingContext2D, raw: string, size: number, weight: number): string {
  ctx.font = `${weight} ${size}px ${FONT}`;
  let name = nameForCard(raw) || 'Your tutor';
  while (ctx.measureText(name).width > INNER_W && name.length > 3) name = name.slice(0, -1);
  return name;
}

function drawBrand(ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.font = `500 ${BRAND_SIZE}px ${FONT}`;
  let x = PAD_X;
  for (const ch of 'TUTORLAGE') {
    ctx.fillText(ch, x, PAD_TOP);
    x += ctx.measureText(ch).width + 12;
  }
}

function drawFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, d: number, photo: CardPhoto | null, initial: string): void {
  const r = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
  if (photo) {
    ctx.clip();
    ctx.drawImage(photo.source, cx - r, cy - r, d, d);
  } else {
    ctx.fillStyle = BG;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(d * 0.5)}px ${FONT}`;
    ctx.fillText(initial, cx, cy + d * 0.03);
  }
  ctx.restore();
}

function paintRows(ctx: CanvasRenderingContext2D, items: Measured[], top: number): void {
  let y = top;
  ctx.textBaseline = 'top';
  items.forEach((it, i) => {
    if (i > 0) y += it.row.mt;
    ctx.font = `${it.row.weight} ${it.row.size}px ${FONT}`;
    ctx.fillStyle = it.row.color;
    ctx.textAlign = it.row.left ? 'left' : 'center';
    const x = it.row.left ? PAD_X : CARD_W / 2;
    const step = Math.round(it.row.size * it.row.lh);
    for (const line of it.lines) {
      ctx.fillText(line, x, y + (step - it.row.size) / 2);
      y += step;
    }
  });
}

// Layout A (and the weekly card): brand top-left, face in the middle, the text block anchored at the bottom, all centred, as in the approved design (PM line 71).
// Layout B: brand top-left, face at the top centred, name centred, groups left-aligned, and "Link in the caption below" at the foot.
// Shrinks the face, then the type, until everything fits; a subject is never cut off. Returns the final type scale and face size (for the test page).
export function composeAndDraw(
  canvas: HTMLCanvasElement,
  opts: { name: string; photo: CardPhoto | null; makeRows: (s: number) => Row[]; faceD: number; mode?: 'A' | 'B' },
): { scale: number; faceD: number; fits: boolean } {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const avail = CARD_H - PAD_TOP - PAD_BOTTOM;
  const brandH = Math.round(BRAND_SIZE * 1.2);
  const isB = opts.mode === 'B';
  const nameRow: Row = { text: opts.name, size: 120, weight: 500, color: INK, mt: 0, lh: 1.15 };
  const FOOT = 'Link in the caption below';
  const footSize = 39;
  const footH = isB ? Math.round(footSize * 1.2) : 0;
  const B_FACE_TOP = 42;

  let faceD = opts.faceD;
  let scale = 1;
  const build = () => {
    if (!isB) return measure(ctx, opts.makeRows(scale));
    const m = measure(ctx, opts.makeRows(scale));
    const n = measure(ctx, [nameRow]);
    return { items: m.items, height: m.height, nameH: n.height };
  };
  let m = build() as ReturnType<typeof measure> & { nameH?: number };
  const need = () => (isB ? brandH + B_FACE_TOP + faceD + 36 + (m.nameH ?? 0) + 42 + m.height + 36 + footH : brandH + faceD + m.height + MIN_GAP * 2);
  const fits = () => need() <= avail;
  const smaller = () => {
    scale = Math.round((scale - 0.02) * 100) / 100;
    m = build() as typeof m;
  };
  while (!fits() && faceD > 300) faceD -= 30;
  while (!fits() && scale > 0.62) smaller();
  while (!fits() && faceD > 200) faceD -= 20;
  while (!fits() && scale > 0.45) smaller();

  drawBrand(ctx);
  const initial = (opts.name[0] ?? 'T').toLocaleUpperCase('en-ZA');
  if (isB) {
    const faceTop = PAD_TOP + brandH + B_FACE_TOP;
    drawFace(ctx, CARD_W / 2, faceTop + faceD / 2, faceD, opts.photo, initial);
    const nameTop = faceTop + faceD + 36;
    paintRows(ctx, measure(ctx, [nameRow]).items, nameTop);
    paintRows(ctx, m.items, nameTop + (m.nameH ?? 0) + 42);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = INK;
    ctx.font = `400 ${footSize}px ${FONT}`;
    ctx.fillText(FOOT, CARD_W / 2, CARD_H - PAD_BOTTOM - footH);
    ctx.globalAlpha = 1;
  } else {
    // face in the middle of the space between the brand and the text block, the text anchored at the bottom
    const textTop = CARD_H - PAD_BOTTOM - 42 - m.height;
    const faceTop = PAD_TOP + brandH + (textTop - (PAD_TOP + brandH) - faceD) / 2;
    drawFace(ctx, CARD_W / 2, faceTop + faceD / 2, faceD, opts.photo, initial);
    paintRows(ctx, m.items, textTop);
  }
  return { scale, faceD, fits: fits() };
}

// Draws the share card (layout A or B by how many subjects) on a canvas of CARD_W x CARD_H. Nothing is sent anywhere.
export async function drawShareCard(canvas: HTMLCanvasElement, input: { firstName: string; subjects: PublicPageSubject[]; photo?: CardPhoto | null }): Promise<void> {
  const layout = cardLayout(input.subjects);
  const groups = groupByGradeRange(input.subjects, layout);
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('no canvas');
  const name = fitName(probe, input.firstName, layout === 'A' ? 96 : 120, layout === 'A' ? 600 : 500);
  composeAndDraw(canvas, { name, photo: input.photo ?? null, makeRows: (s) => subjectRows(name, groups, layout, s), faceD: 450, mode: layout });
}

// ---- The weekly card (JOB WEEKLY): her REAL numbers, counts only; same design and rules as the share card ----------------------------------------------------
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

// The CEO's weekly words; her link is on its own line (not on the picture).
export function weeklyCaption(post: WeeklyPost, link: string): string {
  if (post.lessons >= 1) {
    return `Week ${post.week}: I taught ${lessonsWord(post.lessons)}. Thank you to the families who trusted me. Know a parent looking for a tutor? Please reshare this post.\n${link}`;
  }
  return `Thank you to everyone who has supported me so far. I'm still looking for my first families. Please help me reach them by resharing this post, it would be greatly appreciated.\n${link}`;
}

export function weeklyRows(name: string, post: WeeklyPost): Row[] {
  const rows: Row[] = [
    { text: name, size: 114, weight: 500, color: INK, mt: 0, lh: 1.15 },
    { text: `Week ${post.week}`, size: 60, weight: 600, color: SOFT, mt: 18, lh: 1.2 },
  ];
  if (post.lessons >= 1) {
    rows.push({ text: String(post.lessons), size: 260, weight: 700, color: '#FFFFFF', mt: 30, lh: 1.05 });
    rows.push({ text: post.lessons === 1 ? 'lesson taught this week' : 'lessons taught this week', size: 54, weight: 500, color: INK, mt: 12, lh: 1.2 });
    rows.push({ text: 'Thank you to the families who trusted me', size: 45, weight: 400, color: INK, mt: 48, lh: 1.3 });
  } else {
    rows.push({ text: 'Thank you', size: 90, weight: 600, color: '#FFFFFF', mt: 36, lh: 1.15 });
    rows.push({ text: "to everyone who has supported me. I'm still looking for my first families. Please reshare this post.", size: 48, weight: 400, color: INK, mt: 24, lh: 1.3 });
  }
  return rows;
}

export async function drawWeeklyCard(canvas: HTMLCanvasElement, input: { firstName: string; post: WeeklyPost; photo?: CardPhoto | null }): Promise<void> {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('no canvas');
  const name = fitName(probe, input.firstName, 114, 500);
  composeAndDraw(canvas, { name, photo: input.photo ?? null, makeRows: () => weeklyRows(name, input.post), faceD: 450 });
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png');
  });
}

// ---- her photo: read, cropped to a square (the circle is drawn on the card) and kept in memory only ------------------------------------------------------------
const PHOTO_SIZE = 720;

// Turns the picture she picked into a square canvas (centred across, a little above the middle so a face stays in), turned the right way up. Never uploaded.
export async function preparePhoto(file: File): Promise<CardPhoto> {
  if (!/^image\//.test(file.type)) throw new Error('not a picture');
  let bitmap: ImageBitmap | HTMLImageElement;
  let w: number;
  let h: number;
  if (typeof createImageBitmap === 'function') {
    const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
    bitmap = b;
    w = b.width;
    h = b.height;
  } else {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((ok, bad) => {
        img.onload = () => ok();
        img.onerror = () => bad(new Error('bad picture'));
        img.src = url;
      });
      bitmap = img;
      w = img.naturalWidth;
      h = img.naturalHeight;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (!w || !h) throw new Error('empty picture');
  const side = Math.min(w, h);
  const sx = Math.round((w - side) / 2);
  const sy = Math.round((h - side) * 0.3);
  const c = document.createElement('canvas');
  c.width = PHOTO_SIZE;
  c.height = PHOTO_SIZE;
  const cx = c.getContext('2d');
  if (!cx) throw new Error('no canvas');
  cx.drawImage(bitmap, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  if ('close' in bitmap) (bitmap as ImageBitmap).close();
  return { source: c };
}
