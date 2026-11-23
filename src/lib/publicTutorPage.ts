// A TUTOR'S OWN PUBLIC PAGE, /t/CODE (CEO, 24 Nov 2026; job P slice 1; migration 20261124120000). The tutor chooses whether it is public (default off, an explicit consent). A visitor sees the first name only, the
// verified subjects and grades, the level and its price, the "checked" lines, the weekly hours in words and whether she takes requests. NO photo, NO intro, NO surname, NO contact details, NO ratings and no
// learner data: the database answers with a fixed shape (public_tutor_page) and this file only puts it into words. The checked lines are decided by the database, live, in the agreed wording (never "vetted",
// "certified" or "background-checked"). The database client is passed in so scripts/dev/public-tutor-page-test.ts can hand in a fake. Everything is TOLERANT: any error answers "no page".
import { tutorCodeLink } from './tutorCode';

interface DbError { code?: string; message?: string }
interface DbResult { data: unknown; error: DbError | null }
export interface PublicPageClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}

export interface PublicPageSubject { subject: string; minGrade: string; maxGrade: string }
export interface PublicTutorPage {
  code: string;
  firstName: string;
  levelId: string;
  levelName: string;
  price: number;
  currency: string;
  subjects: PublicPageSubject[];
  checked: string[];
  hours: string | null;
  takingRequests: boolean;
}

export const PUBLIC_PAGE_COPY = {
  notFound: 'This page is not available.',
  notFoundMore: 'The link may be wrong, or the tutor has not made her page public.',
  book: 'Book a lesson',
  bookNote: 'You sign up (or sign in) with her code, so your first 3 lessons cost 10% less. Then you send your request.',
  notTaking: 'She has not set her working hours yet. You can still sign up with her code and send your request to any tutor who fits.',
  otherTutorNote: 'If she cannot take a request, another tutor who fits will.',
  hoursHeading: 'When she teaches',
  subjectsHeading: 'What she teaches',
  checkedHeading: 'What we have checked',
  checkedNote: 'Tutorlage checks these documents by hand before a tutor can teach.',
  levelHeading: 'Level and price',
  // On the tutor's own Teach screen
  cardTitle: 'Your public page',
  cardOff: 'Switched off. Nobody can open your page.',
  cardOn: 'Switched on. Anyone with your link can open it.',
  consent:
    'If you switch this on, anyone with your link will see your first name, your subjects and grades, your level and price, the checks we have done and your weekly hours. No photo, no surname, no contact details. You can switch it off at any time and the page disappears at once.',
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
    firstName,
    levelId: str(d.level_id),
    levelName: str(d.level_name),
    price: whole(d.price),
    currency: str(d.currency) || 'ZAR',
    subjects,
    checked: Array.isArray(d.checked) ? (d.checked as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    hours: typeof d.hours === 'string' && d.hours !== '' ? d.hours : null,
    takingRequests: d.taking_requests === true,
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

// Where "Book a lesson" goes: the same sign-up link her own code link has always been (src/main.tsx reads ?code= before anything else).
export const bookLink = (code: string): string => tutorCodeLink(code, '');

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
