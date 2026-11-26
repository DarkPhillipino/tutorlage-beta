// A TUTOR'S OWN CODE (CEO, 10 Nov 2026; plan Drake/project-manager/tutor-waitlist-page-action-plan-2026-11-10.md D3, P-5 and P-6).
// Every approved tutor has a personal code (made when they are approved). A family that signs up with it pays 10 percent less on its first 3 lessons, and, once the CEO
// switches the tutor bonus on, the tutor earns a share of that family's lessons for 12 months after the family's first lesson. This file holds the words, the sign-up link
// and the one question the tutor's earnings page asks (my_tutor_code). The database client is passed in so a test can hand in a fake (scripts/dev/tutor-code-test.ts).
// Everything is TOLERANT: a database without the tutor-codes migration, a tutor without a code, or any error answers "no code" and the page shows nothing extra.
// Nothing here names a family, a school, a campus or a faculty, and the word "free" is not used for lessons or sessions (the CEO retired it). Money is whole rands.
import { rand0 } from './wallet';

interface DbError { code?: string; message?: string }
interface DbResult { data: unknown; error: DbError | null }
export interface TutorCodeClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}

export const TUTOR_CODE_ORIGIN = 'https://tutorlage.com';

export interface TutorCode {
  code: string;
  active: boolean;
  percent: number;        // what a family saves on its first lessons
  lessons: number;        // how many lessons that covers
  families: number;       // families that signed up with the code
  bonusOn: boolean;       // the CEO's switch for the tutor bonus
  bonusPercent: number;
  bonusMonths: number;
  bonusLessons: number;   // lessons that have paid a bonus so far
  bonusRand: number;      // what the bonus has paid so far
}

const whole = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

// The sign-up link that pre-fills the code (src/main.tsx reads ?code= before anything else).
export const tutorCodeLink = (code: string, origin: string = TUTOR_CODE_ORIGIN): string => `${origin}/?code=${encodeURIComponent(code)}`;

// What the database answered, or null when the tutor has no code (or the answer is odd).
export function parseTutorCode(data: unknown): TutorCode | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.has_code !== true || typeof d.code !== 'string' || d.code === '') return null;
  return {
    code: d.code,
    active: d.active !== false,
    percent: whole(d.percent) || 15,
    lessons: whole(d.lessons) || 3,
    families: whole(d.families),
    bonusOn: d.bonus_on === true,
    bonusPercent: whole(d.bonus_percent) || 5,
    bonusMonths: whole(d.bonus_months) || 12,
    bonusLessons: whole(d.bonus_lessons),
    bonusRand: whole(d.bonus_rand),
  };
}

export async function fetchMyTutorCode(db: TutorCodeClient): Promise<TutorCode | null> {
  try {
    const { data, error } = await db.rpc('my_tutor_code');
    if (error) return null;
    return parseTutorCode(data);
  } catch {
    return null;
  }
}

// ---- the words ------------------------------------------------------------------------------------------------------------------------------------------
export const TUTOR_CODE_COPY = {
  title: 'Your tutor code',
  paused: 'Your code is paused. Get in touch with support if you did not expect this.',
  copyLink: 'Copy my link',
  copied: 'Copied',
  whatsapp: 'Share on WhatsApp',
} as const;

// "Families who sign up with it pay 10% less on their first 3 lessons."
export const savingLine = (c: Pick<TutorCode, 'percent' | 'lessons'>): string =>
  `Families who sign up with it pay ${c.percent}% less on their first ${c.lessons === 1 ? 'lesson' : `${c.lessons} lessons`}.`;

export const familiesLine = (n: number): string => (n === 0 ? 'No family has signed up with it yet.' : n === 1 ? '1 family has signed up with it.' : `${n} families have signed up with it.`);

// Said ONLY once the CEO has switched the bonus on. "Up to": at the top levels the platform floor can trim it, and the words must stay true.
export const bonusLine = (c: Pick<TutorCode, 'bonusPercent' | 'bonusMonths'>): string =>
  `You also earn up to ${c.bonusPercent}% of the lesson price on each of their lessons, for ${c.bonusMonths} months after their first lesson. It comes from Tutorlage's share, so it changes nothing for the family or in your own pay for a lesson.`;

export const bonusPaidLine = (c: Pick<TutorCode, 'bonusLessons' | 'bonusRand'>): string | null =>
  c.bonusLessons > 0 ? `So far ${rand0(c.bonusRand)} from ${c.bonusLessons} ${c.bonusLessons === 1 ? 'lesson' : 'lessons'}.` : null;

// What a tutor can send along (they send it themselves; the app never sends a message).
export const shareText = (c: Pick<TutorCode, 'code' | 'percent' | 'lessons'>, origin: string = TUTOR_CODE_ORIGIN): string =>
  `Join Tutorlage with my code ${c.code} and pay ${c.percent}% less on your first ${c.lessons === 1 ? 'lesson' : `${c.lessons} lessons`}: ${tutorCodeLink(c.code, origin)}`;
export const whatsappShareLink = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`;
