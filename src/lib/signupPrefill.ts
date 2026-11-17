// THE PRE-FILLED TUTOR SIGN-UP (CEO's order of 17 Nov 2026: "the waiting list is the first stage of sign-up"). The second message to a person on the founding tutors list carries a
// personal link, tutorlage.com/signup/tutor?k=<token>. This file is the sign-up page's half: read the token from the address, ask the database for what the person gave the list,
// and hand it to the form. The database half is supabase/migrations/20261117090000_founding_signup_prefill.sql (founding_signup_prefill): it takes ONLY the token and answers
// ONLY first name, surname, email, phone and date of birth, or null; it answers null for an unknown token, a token whose person already has an account, and when it is asked too
// often. The link carries no name, age or email: only the token, which is 122 random bits.
//
// EVERYTHING HERE IS TOLERANT: any doubt (no token, a bad token, a database without the function, no network, an odd answer) is "no pre-fill", and the sign-up page is then
// exactly the empty form it has always been. A pre-fill never blocks, never shows an error, and never ticks a box: the Terms acceptance stays the person's own act.
import { isPlausibleDateOfBirth } from './accountRules';

export const SIGNUP_TOKEN_PARAM = 'k';
const TOKEN_RE = /^[0-9a-f]{32}$/;

// "?k=<32 hex characters>" in an address's query string (upper-case letters are lowered); anything else is no token.
export function signupTokenFromSearch(search: string): string | null {
  try {
    const raw = (new URLSearchParams(search).get(SIGNUP_TOKEN_PARAM) ?? '').trim().toLowerCase();
    return TOKEN_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export interface SignupPrefill {
  firstName: string;
  surname: string;
  email: string;
  phone: string;
  // YYYY-MM-DD, or '' (people who joined before the list asked for it)
  dateOfBirth: string;
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// What the database answered, made safe for the form's boxes. Null when there is nothing to fill in at all (a null answer, a non-object, an object with no usable field).
export function parseSignupPrefill(data: unknown): SignupPrefill | null {
  const d = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!d || typeof d !== 'object') return null;
  const dob = text(d.date_of_birth, 10);
  const out: SignupPrefill = {
    firstName: text(d.first_name, 50),
    surname: text(d.surname, 50),
    email: text(d.email, 254),
    phone: text(d.phone, 30),
    dateOfBirth: /^\d{4}-\d{2}-\d{2}$/.test(dob) && isPlausibleDateOfBirth(dob) ? dob : '',
  };
  return out.firstName || out.surname || out.email || out.phone || out.dateOfBirth ? out : null;
}

interface DbResult { data: unknown; error: unknown }
export interface PrefillClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}

// Never throws. Null for no token, an error, no answer or nothing to fill in.
export async function fetchSignupPrefill(db: PrefillClient, token: string | null): Promise<SignupPrefill | null> {
  if (!token) return null;
  try {
    const { data, error } = await db.rpc('founding_signup_prefill', { p_token: token });
    if (error) return null;
    return parseSignupPrefill(data);
  } catch {
    return null;
  }
}

// What the sign-up form keeps in its boxes and what a pre-fill may put there. A box the person has already typed in is never overwritten: the pre-fill only fills empty boxes
// (the answer can arrive after they started typing).
export interface SignupBoxes {
  firstName: string;
  surname: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string;
}
export function fillEmptyBoxes(current: SignupBoxes, prefill: SignupPrefill): SignupBoxes {
  return {
    firstName: current.firstName || prefill.firstName,
    surname: current.surname || prefill.surname,
    email: current.email || prefill.email,
    phoneNumber: current.phoneNumber || prefill.phone,
    dateOfBirth: current.dateOfBirth || prefill.dateOfBirth,
  };
}

// The words shown above the form when a pre-fill happened. The two ticks and the password are still the person's.
export const PREFILL_NOTICE = 'We filled in the details you gave when you joined the list. Check them, choose a password and accept the Terms and Privacy Policy.';
export const PREFILL_EMAIL_HINT = 'This is the email you gave the list. Use the same one, so we can find your place.';
