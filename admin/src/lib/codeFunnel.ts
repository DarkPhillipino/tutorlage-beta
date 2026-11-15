import { isMissingFunction, type PromoAdminClient } from './promoCodes';

// The CODES FUNNEL (R12) and the TUTOR ACTIVATION list (R13), 11 Nov 2026: what the Codes page shows under "Numbers" and "Tutors". Two read-only database functions
// (admin_code_funnel, admin_tutor_activation: supabase/migrations/20261111130000_code_funnel_and_tutor_activation.sql), finance admins only, counts and dates only (no
// family name, e-mail or phone number is ever in the answer). Every question is TOLERANT like the rest of the Codes page: a database without the migration gives
// "not available" and the page says so in one line; the admin app runs live from the working tree and can be ahead of the database.
// The client is passed in so a test can hand in a fake (scripts/dev/code-funnel-admin-test.ts). Money is whole rands.

export const FUNNEL_NOT_AVAILABLE = 'The code numbers are not on this database yet: the funnel migration has not been applied. This block starts working as soon as it is.';
export const ACTIVATION_NOT_AVAILABLE = 'The tutor list is not on this database yet: the funnel migration has not been applied. This block starts working as soon as it is.';
export const FUNNEL_MAX_DAYS = 366;

export type Kinds = Record<string, number>;

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const kinds = (v: unknown): Kinds => {
  const out: Kinds = {};
  for (const [k, n] of Object.entries(obj(v))) out[k] = num(n);
  return out;
};
// One count out of a code's (or the totals') figures: absent means none happened.
export const count = (k: Kinds, kind: string): number => k[kind] ?? 0;

// ---- the funnel ----------------------------------------------------------------------------------------------------------------------------------------
export interface FunnelCode {
  codeId: string;
  code: string;
  label: string;
  active: boolean;
  ownerTutorId: string | null;
  referringTutorId: string | null;
  createdAt: string;
  opensEver: number;       // link opens ever, whatever the range (for the "link not opened yet" mark)
  k: Kinds;                // the counts in the range, by kind (see KIND_WORDS)
}
export interface FunnelDay { day: string; codeId: string; code: string; k: Kinds }
export interface FunnelBaselineDay { day: string; withCode: number; withoutCode: number }
export interface FunnelData {
  from: string;
  to: string;
  opensCounter: 'live' | 'not_live';
  bonusOn: boolean;
  codes: FunnelCode[];
  totals: Kinds;
  days: FunnelDay[];
  baseline: { withCode: number; withoutCode: number };
  baselineDays: FunnelBaselineDay[];
}

export function parseFunnel(data: unknown): FunnelData | null {
  const d = obj(data);
  if (typeof d.from !== 'string' || typeof d.to !== 'string') return null;
  const codes: FunnelCode[] = [];
  for (const r of Array.isArray(d.codes) ? (d.codes as unknown[]) : []) {
    const c = obj(r);
    if (typeof c.code_id !== 'string' || typeof c.code !== 'string') continue;
    codes.push({
      codeId: c.code_id, code: c.code, label: str(c.label), active: c.active === true, ownerTutorId: strOrNull(c.owner_tutor_id), referringTutorId: strOrNull(c.referring_tutor_id),
      createdAt: str(c.created_at), opensEver: num(c.opens_ever), k: kinds(c.k),
    });
  }
  const days: FunnelDay[] = [];
  for (const r of Array.isArray(d.days) ? (d.days as unknown[]) : []) {
    const x = obj(r);
    if (typeof x.day !== 'string' || typeof x.code_id !== 'string') continue;
    days.push({ day: x.day, codeId: x.code_id, code: str(x.code), k: kinds(x.k) });
  }
  const baselineDays: FunnelBaselineDay[] = [];
  for (const r of Array.isArray(d.baseline_days) ? (d.baseline_days as unknown[]) : []) {
    const x = obj(r);
    if (typeof x.day !== 'string') continue;
    baselineDays.push({ day: x.day, withCode: num(x.with_code), withoutCode: num(x.without_code) });
  }
  const b = obj(d.baseline);
  return {
    from: d.from, to: d.to, opensCounter: d.opens_counter === 'live' ? 'live' : 'not_live', bonusOn: d.bonus_on === true, codes, totals: kinds(d.totals), days,
    baseline: { withCode: num(b.with_code), withoutCode: num(b.without_code) }, baselineDays,
  };
}

export type FunnelResult =
  | { status: 'ready'; data: FunnelData }
  | { status: 'not_available' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

const classify = (error: { code?: string; message?: string }): Exclude<FunnelResult, { status: 'ready' }> => {
  if (isMissingFunction(error)) return { status: 'not_available' };
  if (error.code === '42501' || /finance admins only/i.test(error.message ?? '')) return { status: 'forbidden' };
  return { status: 'error', message: error.message ?? 'The numbers could not be loaded.' };
};

export async function fetchCodeFunnel(db: PromoAdminClient, from: string | null, to: string | null): Promise<FunnelResult> {
  try {
    const { data, error } = await db.rpc('admin_code_funnel', { p_from: from, p_to: to });
    if (error) return classify(error);
    const parsed = parseFunnel(data);
    return parsed ? { status: 'ready', data: parsed } : { status: 'error', message: 'The numbers came back in a shape the page does not know.' };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'The numbers could not be loaded.' };
  }
}

// ---- the range: South African days ---------------------------------------------------------------------------------------------------------------------
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
export const sastToday = (now: Date = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const addDays = (day: string, n: number): string => {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (from: string, to: string): number => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);

export type RangePreset = 'today' | '7' | '30' | '90';
export const PRESET_WORDS: Record<RangePreset, string> = { today: 'Today', '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days' };
export function presetRange(p: RangePreset, today: string): { from: string; to: string } {
  const back = p === 'today' ? 0 : Number(p) - 1;
  return { from: addDays(today, -back), to: today };
}
// The page checks the range before asking; the database checks it again.
export function rangeProblem(from: string, to: string): string | null {
  if (!isDay(from) || !isDay(to)) return 'Pick a start day and an end day.';
  if (from > to) return 'The start day is after the end day.';
  if (daysBetween(from, to) + 1 > FUNNEL_MAX_DAYS) return 'Pick a range of one year or less.';
  return null;
}

// ---- words ----------------------------------------------------------------------------------------------------------------------------------------------
// What each kind in a code's figures is, in the words the page uses (one place, so the legend and the columns agree).
export const KIND_WORDS: Record<string, string> = {
  open: 'Link opens',
  visitor: 'People who opened the link (each counted once, for the first code they opened)',
  signup: 'Signed up with the code (or had it attached by an admin on that day)',
  signup_admin: 'Of those, attached by an admin afterwards',
  funded: 'Put money in the wallet (their first top-up that was received)',
  book_1: 'Booked their 1st lesson with the code',
  book_2: 'Booked their 2nd lesson with the code',
  book_3: 'Booked their 3rd lesson with the code',
  book_4: 'Booked a 4th lesson (after the discount ends, while a code covers 3)',
  first_done: 'Had their first lesson completed',
  discounted: 'Lessons that got the discount (not given back)',
  rand_booked: 'Discount on lessons booked',
  rand_given: 'Discount on lessons completed (what the code really cost)',
  returned: 'Discounts given back (cancelled, declined or expired lessons)',
  bonus_paid: 'Tutor bonus paid, net of anything taken back',
  bonus_held: 'Tutor bonus held back by the R15 floor or the self-referral guard',
  expired: 'Requests that expired with no tutor',
};

// The limits printed under the numbers (the answers are daily events, not a cohort).
export const FUNNEL_LIMITS: string[] = [
  'Days are South African days. Every number counts something on the day it happened, so a family that signs up on Monday and books on Friday appears in each step on its own day: these are daily events, not a follow-the-family cohort.',
  'A returned lesson (cancelled, declined or expired) is not a booking: it shows once under "given back" on the day it was returned.',
  'The 4th booking is the family\'s 4th lesson that was not cancelled, on the day it was booked. While a code covers 3 lessons, that is the family staying after the discount ends.',
  'Rand given is the discount on lessons that were completed, by the day they were completed; rand booked is the discount on lessons booked, by the day they were booked. Both are net of what was given back.',
  'A person who opens code A and later code B counts as a visitor of A only. Opens are counted from the link; a code typed in by hand is a sign-up but not an open.',
  'The baseline counts parents and learners who signed up themselves in the same days (not a learner a parent added). A mistyped code counts as no code.',
];

export const rangeLabel = (from: string, to: string): string => (from === to ? from : `${from} to ${to}`);

export type LinkState = 'not_counted' | 'not_opened' | 'ok';
// "Not shared" is only said when the counter is live, the code is active and nobody has ever opened its link; before the counter is live the page says "not counted yet".
export function linkState(c: Pick<FunnelCode, 'opensEver' | 'active'>, counter: 'live' | 'not_live'): LinkState {
  if (counter !== 'live') return 'not_counted';
  return c.opensEver === 0 && c.active ? 'not_opened' : 'ok';
}

// Does a code row have anything in the range? (The table hides a paused code with nothing to show.)
export const hasActivity = (k: Kinds): boolean => Object.keys(k).some((key) => (k[key] ?? 0) !== 0);

// The days of the range, added across the codes (or for one code), newest first, for the "day by day" table.
export interface DayTotals { day: string; k: Kinds; withCode: number; withoutCode: number }
export function dayByDay(data: FunnelData, codeId: string | null): DayTotals[] {
  const byDay = new Map<string, Kinds>();
  for (const d of data.days) {
    if (codeId && d.codeId !== codeId) continue;
    const k = byDay.get(d.day) ?? {};
    for (const [kind, n] of Object.entries(d.k)) k[kind] = (k[kind] ?? 0) + n;
    byDay.set(d.day, k);
  }
  const base = new Map(data.baselineDays.map((b) => [b.day, b]));
  const days = new Set<string>([...byDay.keys(), ...(codeId ? [] : [...base.keys()])]);
  return [...days].sort().reverse().map((day) => ({ day, k: byDay.get(day) ?? {}, withCode: base.get(day)?.withCode ?? 0, withoutCode: base.get(day)?.withoutCode ?? 0 }));
}

export const percentOf = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

// ---- the tutor activation list (R13) -------------------------------------------------------------------------------------------------------------------
export type NextStep = 'subjects' | 'hours' | 'request_seen' | 'accept' | 'complete';
export const NEXT_STEP_WORDS: Record<NextStep, string> = {
  subjects: 'Has not added a subject yet',
  hours: 'Has not saved any hours yet',
  request_seen: 'Has not seen a request yet',
  accept: 'Has seen a request but not accepted one',
  complete: 'Accepted a lesson, none completed yet',
};
export const DONE_WORDS = 'Has taught a lesson';

export interface ActivationTutor {
  tutorId: string;
  name: string | null;
  level: string | null;
  approvedAt: string | null;
  approvalKnown: boolean;
  code: string | null;
  codeActive: boolean;
  opens: number;
  visitors: number;
  signups: number;
  familyLessons: number;
  hasSubjects: boolean;
  hasHours: boolean;
  hoursSavedAt: string | null;
  firstRequestSeenAt: string | null;
  onboardingCompletedAt: string | null;
  accepted: number;
  firstAcceptedAt: string | null;
  completed: number;
  bonusRand: number;
  nextStep: NextStep | null;
  quiet: boolean;
}
export interface ActivationData {
  quietDays: number;
  opensCounter: 'live' | 'not_live';
  totals: { verified: number; quiet: number; withSubjects: number; withHours: number; sawARequest: number; acceptedOne: number; completedOne: number; approvalUnknown: number };
  tutors: ActivationTutor[];
}

const STEPS: readonly string[] = ['subjects', 'hours', 'request_seen', 'accept', 'complete'];

export function parseActivation(data: unknown): ActivationData | null {
  const d = obj(data);
  if (!Array.isArray(d.tutors)) return null;
  const t = obj(d.totals);
  const tutors: ActivationTutor[] = [];
  for (const r of d.tutors as unknown[]) {
    const x = obj(r);
    if (typeof x.tutor_id !== 'string') continue;
    tutors.push({
      tutorId: x.tutor_id, name: strOrNull(x.name), level: strOrNull(x.level), approvedAt: strOrNull(x.approved_at), approvalKnown: x.approval_known === true,
      code: strOrNull(x.code), codeActive: x.code_active === true, opens: num(x.opens), visitors: num(x.visitors), signups: num(x.signups), familyLessons: num(x.family_lessons),
      hasSubjects: x.has_subjects === true, hasHours: x.has_hours === true, hoursSavedAt: strOrNull(x.hours_saved_at), firstRequestSeenAt: strOrNull(x.first_request_seen_at),
      onboardingCompletedAt: strOrNull(x.onboarding_completed_at), accepted: num(x.accepted), firstAcceptedAt: strOrNull(x.first_accepted_at), completed: num(x.completed),
      bonusRand: num(x.bonus_rand), nextStep: typeof x.next_step === 'string' && STEPS.includes(x.next_step) ? (x.next_step as NextStep) : null, quiet: x.quiet === true,
    });
  }
  return {
    quietDays: num(d.quiet_days) || 7,
    opensCounter: d.opens_counter === 'live' ? 'live' : 'not_live',
    totals: {
      verified: num(t.verified), quiet: num(t.quiet), withSubjects: num(t.with_subjects), withHours: num(t.with_hours), sawARequest: num(t.saw_a_request),
      acceptedOne: num(t.accepted_one), completedOne: num(t.completed_one), approvalUnknown: num(t.approval_unknown),
    },
    tutors,
  };
}

export type ActivationResult =
  | { status: 'ready'; data: ActivationData }
  | { status: 'not_available' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

export async function fetchTutorActivation(db: PromoAdminClient, quietDays = 7): Promise<ActivationResult> {
  try {
    const { data, error } = await db.rpc('admin_tutor_activation', { p_quiet_days: quietDays });
    if (error) return classify(error);
    const parsed = parseActivation(data);
    return parsed ? { status: 'ready', data: parsed } : { status: 'error', message: 'The tutor list came back in a shape the page does not know.' };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'The tutor list could not be loaded.' };
  }
}

// "Approved 20 days ago" / "Approval date not recorded": the date is never guessed.
export function approvalWords(t: Pick<ActivationTutor, 'approvedAt' | 'approvalKnown'>, now: Date = new Date()): string {
  if (!t.approvalKnown || !t.approvedAt) return 'Approval date not recorded';
  const days = Math.floor((now.getTime() - new Date(t.approvedAt).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return 'Approval date not recorded';
  if (days <= 0) return 'Approved today';
  return days === 1 ? 'Approved yesterday' : `Approved ${days} days ago`;
}

// Where a tutor is, in one line: the next thing missing, or that they have taught.
export const stageWords = (t: Pick<ActivationTutor, 'nextStep'>): string => (t.nextStep ? NEXT_STEP_WORDS[t.nextStep] : DONE_WORDS);
