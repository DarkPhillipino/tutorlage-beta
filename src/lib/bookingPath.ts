// THE BOOKING PATH OF ONE TUTOR (PM line 79 C, 25 Nov 2026): a person who taps Book on /t/CODE ends on /t/CODE/book, whatever way they sign in. Two things have to survive a round trip:
//  - an e-mail sign-up: the code travels in the new account's own sign-up data (user_metadata.book_tutor_code), so it also works when the confirmation e-mail is opened on another phone;
//  - Google: the browser leaves for Google and comes back to /auth/callback on the same device, so the code waits in this browser's storage for half an hour.
// Both are used once. Everything is tolerant: blocked storage or an odd value simply means "no booking to return to".
import { normalisePromoCode, type PromoStore } from './promoCode';

export const BOOKING_META_KEY = 'book_tutor_code';
export const GOOGLE_BOOKING_KEY = 'tutorlage.book_after_google';
export const GOOGLE_BOOKING_MINUTES = 30;
const DONE_KEY = 'tutorlage.booking_landed';

function browserStore(kind: 'localStorage' | 'sessionStorage'): PromoStore | null {
  try {
    return typeof window !== 'undefined' && window[kind] ? window[kind] : null;
  } catch {
    return null;
  }
}

// The code a new account was created to book with, or null. `done` is this tab's memory that the booking page has already been shown.
export function pendingBookingCode(user: { user_metadata?: Record<string, unknown> | null } | null | undefined, done: PromoStore | null = browserStore('sessionStorage')): string | null {
  const code = normalisePromoCode(user?.user_metadata?.[BOOKING_META_KEY]);
  if (!code) return null;
  try {
    return done?.getItem(DONE_KEY) === code ? null : code;
  } catch {
    return code;
  }
}

export function noteBookingLanded(code: string, done: PromoStore | null = browserStore('sessionStorage')): void {
  try {
    done?.setItem(DONE_KEY, code);
  } catch {
    // the account's own copy is cleared as well
  }
}

export function rememberGoogleBooking(code: string, now: number = Date.now(), store: PromoStore | null = browserStore('localStorage')): void {
  const c = normalisePromoCode(code);
  if (!c) return;
  try {
    store?.setItem(GOOGLE_BOOKING_KEY, JSON.stringify({ code: c, at: now }));
  } catch {
    // blocked storage: the person lands on the home page, as before
  }
}

export function forgetGoogleBooking(store: PromoStore | null = browserStore('localStorage')): void {
  try {
    store?.removeItem(GOOGLE_BOOKING_KEY);
  } catch {
    // nothing to do
  }
}

// Read once and forgotten.
export function takeGoogleBooking(now: number = Date.now(), store: PromoStore | null = browserStore('localStorage')): string | null {
  try {
    const raw = store?.getItem(GOOGLE_BOOKING_KEY);
    if (!raw) return null;
    store?.removeItem(GOOGLE_BOOKING_KEY);
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown };
    const at = typeof parsed.at === 'number' ? parsed.at : 0;
    return now - at > GOOGLE_BOOKING_MINUTES * 60_000 ? null : normalisePromoCode(parsed.code);
  } catch {
    return null;
  }
}

// A Google account counts as new for this long after it was made: only a new one takes the "Parent or guardian" choice made before Google.
export function isNewAccount(createdAt: string | undefined, now: number = Date.now()): boolean {
  const at = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(at) && now - at < 15 * 60_000;
}
