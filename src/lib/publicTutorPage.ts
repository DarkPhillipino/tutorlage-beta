// A TUTOR'S OWN PUBLIC PAGE, /t/CODE (CEO, 24 and 25 Nov 2026; migrations 20261124120000 and 20261125150000). A visitor sees the first name only, the approved photo, the verified subjects and grades, one
// level card (price, level, tier name and what THAT tutor's level rests on), the weekly hours in words and the Book button. NO intro, NO surname, NO contact details, NO ratings and no learner data: the
// database answers with a fixed shape (public_tutor_page) and this file only puts it into words. The basis is decided by the database: the tutor's own record where it meets the level's minimums, else the
// tutor's own recorded credential, never the list of what could reach the level (never "vetted", "certified" or "background-checked"). The database client is passed in so
// scripts/dev/public-tutor-page-test.ts can hand in a fake. Everything is TOLERANT: any error answers "no page".
import { requirementLines, type LadderRow } from './ladderCopy';

interface DbError { code?: string; message?: string }
interface DbResult { data: unknown; error: DbError | null }
export interface PublicPageClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}

export interface PublicPageSubject { subject: string; minGrade: string; maxGrade: string }
// What the level rests on: the tutor's own record (the lines to show) or the label of the tutor's own credential.
export type LevelBasis = { kind: 'credential'; label: string } | { kind: 'record'; lines: string[] };
export interface PublicTutorPage {
  code: string;
  firstName: string;
  levelId: string;
  levelName: string;
  price: number;
  currency: string;
  subjects: PublicPageSubject[];
  // The tier's one-line description, only where the database says it is true for this tutor.
  tierLine: string | null;
  basis: LevelBasis | null;
  // What a new parent or learner account made from the page gets (the code's own numbers), or null.
  discount: { percent: number; lessons: number } | null;
  hours: string | null;
  takingRequests: boolean;
  // Her approved photo as a small JPEG data address, or null (no photo, or not yet approved: the database answers it only for an approved photo on a page that is on).
  photo: string | null;
}

export const PUBLIC_PAGE_COPY = {
  notFound: 'This page is not available.',
  notFoundMore: 'The link may be wrong, or the tutor has not made her page public.',
  book: 'Book a lesson',
  bookNote: (name: string) => `Sign in or create an account, choose a subject and a time, and send your request to ${name}.`,
  discountNote: (percent: number, lessons: number) =>
    `A new parent or learner account created from this page pays ${percent}% less on its first ${lessons === 1 ? 'lesson' : `${lessons} lessons`}.`,
  notTaking: (name: string) => `${name} has not set working hours yet, so a lesson cannot be requested at the moment.`,
  hoursNote: (name: string) => `South African time. You ask for a time inside these hours, and the lesson is booked only when ${name} accepts.`,
  hoursHeading: 'When she teaches',
  subjectsHeading: 'What she teaches',
  subjectsPending: 'Her subjects are being approved.',
  credentialHeading: 'Credential on record',
  recordHeading: (name: string) => `${name} reached this level with:`,
  // On the tutor's own Teach screen
  cardTitle: 'Your public page',
  cardOff: 'Switched off. Nobody can open your page.',
  cardOn: 'Your profile is live. Anyone with your link can open it. You can switch it off at any time.',
  consent:
    'If you switch this on, anyone with your link will see your first name, your subjects and grades, your level and price, the qualification, study or other basis your level rests on, your weekly hours, and your photo once the company has approved it. No surname and no contact details. You can switch it off at any time and the page disappears at once.',
  consentLabel: 'I understand and I want my page to be public',
  switchOn: 'Switch on my page',
  switchOff: 'Switch off my page',
  copy: 'Copy my profile link',
  copied: 'Link copied',
  cantYet: 'Your page can be switched on once you are approved and have your code.',
} as const;

const whole = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// "Grade 8" -> "8"; "Grade R" -> "R"; anything else stays as written
const gradeBit = (g: string): string => (/^Grade\s+(\S+)$/i.exec(g.trim()) ? g.trim().replace(/^Grade\s+/i, '') : g.trim());
const isGrade = (g: string): boolean => /^Grade\s+\S+$/i.test(g.trim());

// "Grades 8 to 12", "Grade 5" (one grade), or the plain words when an end is not a school grade ("Grade R to Adult / Professional Development")
export function gradesInWords(min: string, max: string): string {
  const a = min.trim();
  const b = max.trim();
  if (a.toLowerCase() === b.toLowerCase()) return isGrade(a) ? `Grade ${gradeBit(a)}` : a;
  if (isGrade(a) && isGrade(b)) return `Grades ${gradeBit(a)} to ${gradeBit(b)}`;
  return `${a} to ${b}`;
}

// "thandi" -> "Thandi", "mary-ann" -> "Mary-Ann": the first letter of each part is a capital, the rest is left as she typed it.
export function capitaliseName(name: string): string {
  return name.trim().replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase('en-ZA'));
}

// Only a small JPEG data address is accepted as a photo: anything else is dropped, so a stray value can never reach an image tag.
export function safePhoto(v: unknown): string | null {
  return typeof v === 'string' && v.length <= 250000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(v) ? v : null;
}

export function parseBasis(v: unknown): LevelBasis | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (d.kind === 'credential') return str(d.label) ? { kind: 'credential', label: str(d.label) } : null;
  if (d.kind !== 'record') return null;
  // The same words the price ladder uses for a level's minimums; hours counted from outside Tutorlage are not called "taught on Tutorlage".
  const row = {
    minHours: Number(d.min_hours) || 0, minRating: Number(d.min_rating) || 0, minRepeatRatePct: Number(d.min_repeat_rate_pct) || 0,
    minReviews: Number(d.min_reviews) || 0, minUpliftStudents: Number(d.min_uplift_students) || 0, requiredUpliftPct: Number(d.required_uplift_pct) || 0,
  } as LadderRow;
  const lines = requirementLines(row).map((l) => (d.outside_hours === true ? l.replace('hours taught on Tutorlage', 'hours of teaching') : l));
  return lines.length > 0 ? { kind: 'record', lines } : null;
}

function parseDiscount(v: unknown): { percent: number; lessons: number } | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const percent = whole(d.percent);
  const lessons = whole(d.lessons);
  return percent > 0 && lessons > 0 ? { percent, lessons } : null;
}

// What the database answered, or null when there is no page (or the answer is odd).
export function parsePublicPage(data: unknown): PublicTutorPage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const code = str(d.code);
  const firstName = str(d.first_name);
  if (!code || !firstName) return null;
  const subjects = Array.isArray(d.subjects)
    ? (d.subjects as unknown[])
        .map((s): PublicPageSubject | null => {
          if (!s || typeof s !== 'object') return null;
          const o = s as Record<string, unknown>;
          return str(o.subject) ? { subject: str(o.subject), minGrade: str(o.min_grade), maxGrade: str(o.max_grade) } : null;
        })
        .filter((s): s is PublicPageSubject => s !== null)
    : [];
  return {
    code,
    firstName: capitaliseName(firstName),
    levelId: str(d.level_id),
    levelName: str(d.level_name),
    price: whole(d.price),
    currency: str(d.currency) || 'ZAR',
    subjects,
    tierLine: str(d.tier_line) || null,
    basis: parseBasis(d.basis),
    discount: parseDiscount(d.discount),
    hours: typeof d.hours === 'string' && d.hours !== '' ? d.hours : null,
    takingRequests: d.taking_requests === true,
    photo: safePhoto(d.photo),
  };
}

export async function fetchPublicPage(client: PublicPageClient, code: string): Promise<PublicTutorPage | null> {
  try {
    const { data, error } = await client.rpc('public_tutor_page', { p_code: code });
    if (error) return null;
    return parsePublicPage(data);
  } catch {
    return null;
  }
}

// "R250 an hour"
export function priceLine(page: Pick<PublicTutorPage, 'price' | 'currency'>): string {
  const sym = page.currency === 'ZAR' ? 'R' : `${page.currency} `;
  return `${sym}${Math.round(page.price).toLocaleString('en-ZA').replace(/ /g, ' ')} an hour`;
}

// The address of her page, the link she shares.
export const profileLink = (code: string, origin = 'https://tutorlage.com'): string => `${origin}/t/${encodeURIComponent(code)}`;

// The addresses of the booking path of one tutor (inside the app: the router adds the site's base path).
export const bookPath = (code: string): string => `/t/${encodeURIComponent(code)}/book`;
export const signUpPath = (code: string): string => `/t/${encodeURIComponent(code)}/signup`;
export const pagePath = (code: string): string => `/t/${encodeURIComponent(code)}`;

// The tutor's own switch
export interface MyPublicProfile { isTutor: boolean; code: string | null; canBePublic: boolean; isPublic: boolean }

export async function fetchMyPublicProfile(client: PublicPageClient): Promise<MyPublicProfile | null> {
  try {
    const { data, error } = await client.rpc('my_public_profile');
    if (error || !data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    return {
      isTutor: d.is_tutor === true,
      code: typeof d.code === 'string' && d.code !== '' ? d.code : null,
      canBePublic: d.can_be_public === true,
      isPublic: d.is_public === true,
    };
  } catch {
    return null;
  }
}

// Returns null when it worked, or the plain-words problem.
export async function setMyPublicProfile(client: PublicPageClient, on: boolean): Promise<string | null> {
  try {
    const { error } = await client.rpc('set_my_public_profile', { p_public: on });
    if (!error) return null;
    return error.message && /switched on once/.test(error.message) ? PUBLIC_PAGE_COPY.cantYet : 'Could not change your page. Try again.';
  } catch {
    return 'Could not change your page. Try again.';
  }
}

// A number goes up by one for her page (JOB COUNTERS, 24 Nov 2026): the open of her page, and the tap on Book. Only the code and the word are sent: no visitor id, no cookie, nothing is stored about
// the person. Never an error to the visitor: any failure is ignored.
export async function countPageEvent(client: PublicPageClient, code: string, kind: 'page_open' | 'book_tap'): Promise<void> {
  try {
    await client.rpc('count_tutor_page_event', { p_code: code, p_kind: kind });
  } catch {
    /* a missed count is better than a held-up visitor */
  }
}
