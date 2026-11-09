// PROMO CODES (CEO, 5 Nov 2026): 10 percent off a parent's first 3 lessons, by code (plan Drake/project-manager/tutor-recruitment-plan-2026-11-04.md 8.2).
// A code is typed at sign-up, or arrives pre-filled from a link (tutorlage.com/?code=XYZ); the database attaches it to the account, takes one "use" when a
// request is sent from the wallet and puts the discounted price on hold. This file holds the words, the checks and the questions, and takes the database
// client as an argument so a test can hand in a fake (promo-code-test.ts); promoHooks.ts binds them to the app's own client.
// Everything here is TOLERANT: a database without the promo migration, or any error, answers "no discount" and nothing about sign-up or booking changes.
// A code that is wrong NEVER blocks a sign-up: the person is told in one plain line and carries on.
// Money is whole rands (integers). The word "free" is not used anywhere in these words: the CEO retired it for lessons (5 Nov 2026).
import { rand0 } from './wallet';

// The few things of the Supabase client used here, so a test can hand in a fake.
interface DbError { code?: string; message?: string }
interface DbResult { data: unknown; error: DbError | null }
export interface PromoClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}
// The few things of window.localStorage used here (a test hands in a plain object).
export interface PromoStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// The one shape of a code, the same as the database's promo_normalise: 3 to 32 letters, digits, - or _, in capitals.
export const PROMO_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
export const PROMO_STORAGE_KEY = 'tutorlage.promo_code';
// A code that arrived by link is remembered for 30 days: long enough for a parent who signs up a day or two later.
export const PROMO_REMEMBER_DAYS = 30;
// What the sign-up form sends along (the database keeps at most this many letters of whatever was typed).
export const PROMO_TYPED_MAX = 40;

export function normalisePromoCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase();
  return PROMO_CODE_PATTERN.test(t) ? t : null;
}

// ?code=XYZ in an address's query string (case does not matter, spaces round it do not matter).
export function promoCodeFromSearch(search: string): string | null {
  try {
    return normalisePromoCode(new URLSearchParams(search).get('code'));
  } catch {
    return null;
  }
}

// ---- remembering a code that arrived by link (browser storage can be blocked or empty: every use is wrapped) --------------------------------------
function browserStore(): PromoStore | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function rememberPromoCode(code: string, now: number = Date.now(), store: PromoStore | null = browserStore()): void {
  const normal = normalisePromoCode(code);
  if (!normal || !store) return;
  try {
    store.setItem(PROMO_STORAGE_KEY, JSON.stringify({ code: normal, at: now }));
  } catch {
    // storage full or blocked: the person can still type the code
  }
}

export function recallPromoCode(now: number = Date.now(), store: PromoStore | null = browserStore()): string | null {
  if (!store) return null;
  try {
    const raw = store.getItem(PROMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown };
    const code = normalisePromoCode(parsed.code);
    const at = typeof parsed.at === 'number' ? parsed.at : 0;
    if (!code || now - at > PROMO_REMEMBER_DAYS * 86_400_000) {
      store.removeItem(PROMO_STORAGE_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function forgetPromoCode(store: PromoStore | null = browserStore()): void {
  try {
    store?.removeItem(PROMO_STORAGE_KEY);
  } catch {
    // nothing to do
  }
}

// Called once when the app starts, before any page or redirect can drop the address's query string: a link tutorlage.com/?code=XYZ lands on the start
// page, which sends a signed-out visitor to the sign-in page, so the code has to be taken from the address first.
export function rememberPromoCodeFromUrl(search: string = typeof window !== 'undefined' ? window.location.search : '', now: number = Date.now(), store: PromoStore | null = browserStore()): string | null {
  const code = promoCodeFromSearch(search);
  if (code) rememberPromoCode(code, now, store);
  return code;
}

// ---- the sign-up box ---------------------------------------------------------------------------------------------------------------------------------
export type PromoCheck =
  | { state: 'empty' }
  | { state: 'badShape' }
  | { state: 'valid'; percent: number; lessons: number }
  | { state: 'invalid' }
  | { state: 'limited' }
  | { state: 'unavailable' };   // the question could not be asked (no network, a database without the promo migration): say nothing

const asNumber = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

export async function checkPromoCode(db: PromoClient, raw: string): Promise<PromoCheck> {
  const typed = raw.trim();
  if (typed === '') return { state: 'empty' };
  const code = normalisePromoCode(typed);
  if (!code) return { state: 'badShape' };
  try {
    const { data, error } = await db.rpc('check_promo_code', { p_code: code });
    if (error || !data || typeof data !== 'object') return { state: 'unavailable' };
    const d = data as Record<string, unknown>;
    if (d.valid === true) {
      const percent = asNumber(d.percent);
      const lessons = asNumber(d.lessons);
      return Number.isFinite(percent) && Number.isFinite(lessons) ? { state: 'valid', percent, lessons } : { state: 'unavailable' };
    }
    return d.limited === true ? { state: 'limited' } : { state: 'invalid' };
  } catch {
    return { state: 'unavailable' };
  }
}

export function lessonsWord(n: number): string {
  return n === 1 ? 'lesson' : 'lessons';
}

// The line under the box. A wrong code gets a plain sentence and never blocks the sign-up (the CEO's rule); the code is still sent with the sign-up, so
// an admin can see what was typed and attach the right one.
export function promoCheckMessage(check: PromoCheck): { tone: 'good' | 'note'; text: string } | null {
  switch (check.state) {
    case 'valid':
      return { tone: 'good', text: `Code accepted: ${check.percent}% off your first ${check.lessons === 1 ? '' : `${check.lessons} `}${lessonsWord(check.lessons)}.` };
    case 'invalid':
      return { tone: 'note', text: "We don't recognise that code, so no discount will be added. You can still create your account." };
    case 'badShape':
      return { tone: 'note', text: 'That does not look like a code (letters, numbers, - and _ only). You can still create your account.' };
    case 'limited':
      return { tone: 'note', text: 'Too many tries just now. You can still create your account; tell us the code afterwards and we will add it.' };
    default:
      return null;
  }
}

// What goes into the sign-up's metadata: whatever was typed (trimmed, at most PROMO_TYPED_MAX letters), valid or not. The database decides.
export function promoSignupMetadata(typed: string): { signup_code?: string } {
  const t = typed.trim().slice(0, PROMO_TYPED_MAX);
  return t === '' ? {} : { signup_code: t };
}

// After a Google sign-up there is no form to carry the code, so the code the link brought is claimed right after (accounts made in the last 24 hours with
// no code yet; the database refuses anything else). Tried once; the remembered code is dropped either way.
export async function claimRememberedPromoCode(db: PromoClient, now: number = Date.now(), store: PromoStore | null = browserStore()): Promise<'attached' | 'refused' | 'none'> {
  const code = recallPromoCode(now, store);
  if (!code) return 'none';
  forgetPromoCode(store);
  try {
    const { data, error } = await db.rpc('attach_my_promo_code', { p_code: code });
    if (error || !data || typeof data !== 'object') return 'refused';
    return (data as Record<string, unknown>).attached === true ? 'attached' : 'refused';
  } catch {
    return 'refused';
  }
}

// ---- the booking screen ------------------------------------------------------------------------------------------------------------------------------
export interface PromoQuote {
  percent: number;
  listRand: number;
  discountRand: number;
  payRand: number;
  lessonNumber: number;
  lessons: number;
}

// What the signed-in person would pay for a price (whole rands) before the request is sent: the same arithmetic the database uses when it puts the money on
// hold. null = no discount applies (no code, a paused code, all lessons used) or the question could not be asked.
export async function fetchPromoQuote(db: PromoClient, listRand: number): Promise<PromoQuote | null> {
  if (!Number.isFinite(listRand) || listRand < 1) return null;
  try {
    const { data, error } = await db.rpc('my_promo_quote', { p_list_rand: Math.round(listRand) });
    if (error || !data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (d.applies !== true) return null;
    const q: PromoQuote = {
      percent: asNumber(d.percent),
      listRand: asNumber(d.list_rand),
      discountRand: asNumber(d.discount_rand),
      payRand: asNumber(d.pay_rand),
      lessonNumber: asNumber(d.lesson_number),
      lessons: asNumber(d.lessons),
    };
    return Object.values(q).every(Number.isFinite) && q.discountRand >= 1 && q.payRand >= 1 ? q : null;
  } catch {
    return null;
  }
}

// The line the booking screen shows before sending: "10% code applied: R252 (lesson 1 of 3)".
export function promoQuoteLine(q: PromoQuote): string {
  return `${q.percent}% code applied: ${rand0(q.payRand)} (lesson ${q.lessonNumber} of ${q.lessons})`;
}
