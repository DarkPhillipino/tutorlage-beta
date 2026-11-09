import { rand0, walletErrorMessage } from './walletAdmin';
import type { AdminRole } from '../types';

// The ADMIN side of the PROMO CODES (CEO's decision of 5 Nov 2026: 10 percent off a parent's first 3 lessons, by code; plan
// Drake/project-manager/tutor-recruitment-plan-2026-11-04.md 8.2). The Codes page: make, edit, pause and list codes, and for each code the sign-ups, the
// lessons booked and the rand given away; and attach a code to an existing account ("I forgot to enter it").
// Only finance_manager and super_admin see or use any of it (the money is Tutorlage's own); the database refuses everyone else too, and nobody writes the
// tables directly: every change goes through an audited database function. Every question is TOLERANT: a database without the codes migration gives
// "not available" (an empty list) and never a crash, because the admin app runs live from the working tree and can be ahead of the database.
// The client is passed in so a test can hand in a fake (scripts/dev/promo-codes-admin-test.ts). Money is whole rands.

interface DbError { code?: string; message?: string; details?: string; hint?: string }
interface DbResult { data: unknown; error: DbError | null }
export interface PromoAdminClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}

export const PROMO_NOT_AVAILABLE = 'Codes are not on this database yet: the codes migration has not been applied. This page starts working as soon as it is.';
export const PROMO_PERCENT_MAX = 30;
export const PROMO_USES_MAX = 20;
export const SITE_ORIGIN = 'https://tutorlage.com';

export const canUsePromoCodes = (role: AdminRole | null | undefined): boolean => role === 'finance_manager' || role === 'super_admin';

// What the sign-up link for a code looks like (the CEO or a tutor sends it; the code is carried through sign-up and the confirmation e-mail).
export const promoLink = (code: string, origin: string = SITE_ORIGIN): string => `${origin}/?code=${encodeURIComponent(code)}`;

export interface PromoCodeRow {
  id: string;
  code: string;
  label: string;
  percentOff: number;
  usesPerAccount: number;
  validFrom: string;
  validUntil: string | null;
  maxFamilies: number | null;
  active: boolean;
  referringTutorId: string | null;
  referringTutorName: string | null;
  createdAt: string;
  signups: number;
  lessonsBooked: number;      // lessons that carry the discount and have not been given back (booked or done)
  lessonsCompleted: number;   // of those, the ones that have been delivered
  lessonsReturned: number;    // given back: cancelled, expired or declined before the lesson
  randBooked: number;         // the discount on lessons booked (committed)
  randGiven: number;          // the discount on lessons delivered: what the codes have really cost
}

const int = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const intOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

export function parsePromoCodes(data: unknown): PromoCodeRow[] {
  if (!Array.isArray(data)) return [];
  const out: PromoCodeRow[] = [];
  for (const r of data as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.code !== 'string') continue;
    out.push({
      id: r.id,
      code: r.code,
      label: str(r.label),
      percentOff: int(r.percent_off),
      usesPerAccount: int(r.uses_per_account),
      validFrom: str(r.valid_from),
      validUntil: strOrNull(r.valid_until),
      maxFamilies: intOrNull(r.max_families),
      active: r.active === true,
      referringTutorId: strOrNull(r.referring_tutor_id),
      referringTutorName: strOrNull(r.referring_tutor_name),
      createdAt: str(r.created_at),
      signups: int(r.signups),
      lessonsBooked: int(r.lessons_booked),
      lessonsCompleted: int(r.lessons_completed),
      lessonsReturned: int(r.lessons_returned),
      randBooked: int(r.rand_booked),
      randGiven: int(r.rand_given),
    });
  }
  return out;
}

export type PromoListResult =
  | { status: 'ready'; codes: PromoCodeRow[] }
  | { status: 'not_available' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

// A database without the function (the migration is not applied) is "not available", not an error.
export function isMissingFunction(e: DbError | null | undefined): boolean {
  if (!e) return false;
  return e.code === '42883' || e.code === 'PGRST202' || /could not find the function|function .* does not exist/i.test(e.message ?? '');
}

export async function fetchPromoCodes(db: PromoAdminClient): Promise<PromoListResult> {
  try {
    const { data, error } = await db.rpc('admin_list_promo_codes');
    if (error) {
      if (isMissingFunction(error)) return { status: 'not_available' };
      if (error.code === '42501' || /finance admins only/i.test(error.message ?? '')) return { status: 'forbidden' };
      return { status: 'error', message: error.message ?? 'The list could not be loaded.' };
    }
    return { status: 'ready', codes: parsePromoCodes(data) };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'The list could not be loaded.' };
  }
}

// ---- words ---------------------------------------------------------------------------------------------------------------------------------------------
export type CodeStatus = 'active' | 'paused' | 'ended' | 'not_started' | 'full';
export function codeStatus(c: Pick<PromoCodeRow, 'active' | 'validFrom' | 'validUntil' | 'maxFamilies' | 'signups'>, now: Date = new Date()): CodeStatus {
  if (!c.active) return 'paused';
  if (c.validUntil && now.getTime() >= new Date(c.validUntil).getTime()) return 'ended';
  if (c.validFrom && now.getTime() < new Date(c.validFrom).getTime()) return 'not_started';
  if (c.maxFamilies !== null && c.signups >= c.maxFamilies) return 'full';
  return 'active';
}
export const STATUS_WORDS: Record<CodeStatus, string> = {
  active: 'Active',
  paused: 'Paused: nobody can sign up with it and no new lesson gets the discount',
  ended: 'Ended: nobody new can use it; families already signed up keep their lessons',
  not_started: 'Starts later',
  full: 'Full: the cap of families is reached; families already signed up keep their lessons',
};

export function totalsOf(codes: PromoCodeRow[]): { codes: number; signups: number; lessonsBooked: number; lessonsCompleted: number; randBooked: number; randGiven: number } {
  return codes.reduce((t, c) => ({
    codes: t.codes + 1,
    signups: t.signups + c.signups,
    lessonsBooked: t.lessonsBooked + c.lessonsBooked,
    lessonsCompleted: t.lessonsCompleted + c.lessonsCompleted,
    randBooked: t.randBooked + c.randBooked,
    randGiven: t.randGiven + c.randGiven,
  }), { codes: 0, signups: 0, lessonsBooked: 0, lessonsCompleted: 0, randBooked: 0, randGiven: 0 });
}

// One line a person can read: "10% off the first 3 lessons".
export const ruleLine = (c: Pick<PromoCodeRow, 'percentOff' | 'usesPerAccount'>): string =>
  `${c.percentOff}% off the first ${c.usesPerAccount === 1 ? 'lesson' : `${c.usesPerAccount} lessons`}`;

// The rand figure for a lesson price at a code's percent, as the database works it (nearest rand, halves up): the page shows it as an example.
export const exampleLine = (percent: number, price: number): string => {
  const pay = Math.round(price * (100 - percent) / 100);
  return `${rand0(price)} lesson: the parent pays ${rand0(pay)}, Tutorlage's share is ${rand0(price - pay)} less`;
};

// ---- the form ------------------------------------------------------------------------------------------------------------------------------------------
export interface CodeForm {
  code: string;
  label: string;
  percent: string;
  uses: string;
  validFrom: string;     // a date (yyyy-mm-dd) in South African time, or empty = from now
  validUntil: string;    // the LAST day it can be used, or empty = no end
  maxFamilies: string;   // empty = no cap
  tutorId: string;       // empty = none
}
export const EMPTY_CODE_FORM: CodeForm = { code: '', label: '', percent: '10', uses: '3', validFrom: '', validUntil: '', maxFamilies: '', tutorId: '' };

export interface CodeArgs {
  code: string;
  label: string;
  percent: number;
  uses: number;
  validFrom: string | null;
  validUntil: string | null;
  maxFamilies: number | null;
  tutorId: string | null;
}

// A South African calendar day as the moment it starts (and, for the last day, the moment it ends).
const sastStart = (day: string): string => new Date(`${day}T00:00:00+02:00`).toISOString();
const sastEnd = (day: string): string => new Date(new Date(`${day}T00:00:00+02:00`).getTime() + 86_400_000).toISOString();
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00+02:00`).getTime());

export function parseCodeForm(f: CodeForm, opts: { codeRequired?: boolean } = {}): { ok: true; args: CodeArgs } | { ok: false; message: string } {
  const code = f.code.trim().toUpperCase();
  if ((opts.codeRequired ?? true) && !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) return { ok: false, message: 'A code is 3 to 32 letters, digits, - or _ (no spaces).' };
  const percent = Number(f.percent);
  if (!Number.isInteger(percent) || percent < 1 || percent > PROMO_PERCENT_MAX) return { ok: false, message: `The percent off is a whole number from 1 to ${PROMO_PERCENT_MAX}.` };
  const uses = Number(f.uses);
  if (!Number.isInteger(uses) || uses < 1 || uses > PROMO_USES_MAX) return { ok: false, message: `The lessons per account is a whole number from 1 to ${PROMO_USES_MAX}.` };
  if (f.validFrom.trim() !== '' && !isDay(f.validFrom.trim())) return { ok: false, message: 'The start date is not a date.' };
  if (f.validUntil.trim() !== '' && !isDay(f.validUntil.trim())) return { ok: false, message: 'The end date is not a date.' };
  const validFrom = f.validFrom.trim() === '' ? null : sastStart(f.validFrom.trim());
  const validUntil = f.validUntil.trim() === '' ? null : sastEnd(f.validUntil.trim());
  if (validFrom && validUntil && validUntil <= validFrom) return { ok: false, message: 'The end date has to be after the start date.' };
  let maxFamilies: number | null = null;
  if (f.maxFamilies.trim() !== '') {
    maxFamilies = Number(f.maxFamilies);
    if (!Number.isInteger(maxFamilies) || maxFamilies < 1) return { ok: false, message: 'The cap of families is a whole number of at least 1, or empty for no cap.' };
  }
  const tutorId = f.tutorId.trim() === '' ? null : f.tutorId.trim();
  if (tutorId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tutorId)) return { ok: false, message: 'Choose the tutor from the list.' };
  if (f.label.trim().length > 80) return { ok: false, message: 'The channel name is at most 80 letters.' };
  return { ok: true, args: { code, label: f.label.trim(), percent, uses, validFrom, validUntil, maxFamilies, tutorId } };
}

export function formFromRow(c: PromoCodeRow): CodeForm {
  const day = (iso: string | null, minusDay = false): string => {
    if (!iso) return '';
    const t = new Date(iso).getTime() - (minusDay ? 86_400_000 : 0);
    return Number.isNaN(t) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  };
  return {
    code: c.code,
    label: c.label,
    percent: String(c.percentOff),
    uses: String(c.usesPerAccount),
    validFrom: day(c.validFrom),
    validUntil: day(c.validUntil, true),
    maxFamilies: c.maxFamilies === null ? '' : String(c.maxFamilies),
    tutorId: c.referringTutorId ?? '',
  };
}

// ---- the actions: each goes through an audited database function ------------------------------------------------------------------------------------
export async function createPromoCode(db: PromoAdminClient, a: CodeArgs): Promise<void> {
  const { error } = await db.rpc('admin_create_promo_code', {
    p_code: a.code, p_label: a.label, p_percent: a.percent, p_uses: a.uses, p_valid_from: a.validFrom, p_valid_until: a.validUntil, p_max_families: a.maxFamilies, p_tutor: a.tutorId,
  });
  if (error) throw new Error(promoErrorMessage(error));
}

export async function updatePromoCode(db: PromoAdminClient, id: string, a: CodeArgs, active: boolean): Promise<void> {
  const { error } = await db.rpc('admin_update_promo_code', {
    p_id: id, p_label: a.label, p_percent: a.percent, p_uses: a.uses,
    // an empty start stays "as it was" for the form's sake: the caller passes the stored start when the box is empty
    p_valid_from: a.validFrom ?? new Date().toISOString(), p_valid_until: a.validUntil, p_max_families: a.maxFamilies, p_tutor: a.tutorId, p_active: active,
  });
  if (error) throw new Error(promoErrorMessage(error));
}

export async function setPromoCodeActive(db: PromoAdminClient, id: string, active: boolean): Promise<void> {
  const { error } = await db.rpc('admin_set_promo_code_active', { p_id: id, p_active: active });
  if (error) throw new Error(promoErrorMessage(error));
}

export async function attachPromoCode(db: PromoAdminClient, email: string, code: string, reason: string): Promise<{ already: boolean }> {
  const { data, error } = await db.rpc('admin_attach_promo_code', { p_email: email.trim(), p_code: code.trim(), p_reason: reason.trim() });
  if (error) throw new Error(promoErrorMessage(error));
  return { already: (data as { already?: boolean } | null)?.already === true };
}

export function promoErrorMessage(e: DbError | unknown): string {
  if (e && typeof e === 'object' && isMissingFunction(e as DbError)) return PROMO_NOT_AVAILABLE;
  return walletErrorMessage(e, 'That did not work. Try again.');
}

// ---- finding a tutor for "referring tutor" ------------------------------------------------------------------------------------------------------------
export interface TutorChoice { id: string; name: string; email: string }
export async function findTutors(db: PromoAdminClient, term: string): Promise<TutorChoice[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  try {
    const { data, error } = await db.rpc('admin_search_profiles', { p_term: t });
    if (error || !Array.isArray(data)) return [];
    return (data as Record<string, unknown>[])
      .filter((r) => r.role === 'tutor' && typeof r.id === 'string')
      .slice(0, 8)
      .map((r) => ({ id: r.id as string, name: str(r.full_name), email: str(r.email) }));
  } catch {
    return [];
  }
}
