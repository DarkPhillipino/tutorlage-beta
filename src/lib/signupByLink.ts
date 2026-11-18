// THE PAGE'S HALF OF "A PERSONAL SIGN-UP LINK MAKES THE TUTOR ACCOUNT ALREADY CONFIRMED" (job T, 18 Nov 2026). The Worker half is server/signupByLink.ts (two routes, no sign-in: the token in the
// link is the credential); the database half is supabase/migrations/20261118210000_signup_link_confirms.sql. While the database setting signup_link_confirms is OFF (its default) the check
// answers "not available" and the sign-up page is exactly the ordinary one.
//
// EVERYTHING HERE IS TOLERANT: any doubt (no network, a Worker without the route, a slow answer, an odd answer) is "not available" and the person gets the ordinary sign-up, which still works.
// A check never shows an error. Nothing about the person is put in an address; the token and the password travel only in the body of a POST to our own Worker.
// No Supabase, auth or `import.meta` in this file (it runs under Node in the script test): the caller passes `urlFor` (apiUrl from src/lib/api.ts) which puts the Worker's address in front of a path.
export type UrlFor = (path: string) => string;

export interface LinkDetails {
  firstName: string;
  surname: string;
  email: string;
  phone: string;
  // YYYY-MM-DD
  dateOfBirth: string;
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// What the Worker's check answered, made safe. Null unless it says available AND gave the three things the account needs (a name, an email, a date of birth).
export function parseLinkCheck(data: unknown): LinkDetails | null {
  const d = data as Record<string, unknown> | null | undefined;
  if (!d || typeof d !== 'object' || d.available !== true) return null;
  const out: LinkDetails = {
    firstName: text(d.firstName, 50),
    surname: text(d.surname, 50),
    email: text(d.email, 254),
    phone: text(d.phone, 30),
    dateOfBirth: /^\d{4}-\d{2}-\d{2}$/.test(text(d.dateOfBirth, 10)) ? text(d.dateOfBirth, 10) : '',
  };
  return out.firstName && out.surname && out.email && out.dateOfBirth ? out : null;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

const CHECK_TIMEOUT_MS = 4000;

// Never throws. Null when the one-step sign-up is not available for this link, for any reason.
export async function checkSignupLink(token: string | null, urlFor: UrlFor, fetchFn: FetchLike = defaultFetch): Promise<LinkDetails | null> {
  if (!token) return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS) : null;
  try {
    const r = await fetchFn(urlFor('/api/signup/tutor-by-link/check'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: controller?.signal });
    if (!r.ok) return null;
    return parseLinkCheck(await r.json());
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// What a create can come to. 'fallback' means: this link cannot make the account in one step, use the ordinary sign-up (nothing was made).
export type CreateByLinkResult =
  | { ok: true }
  | { ok: false; kind: 'fallback'; message: string }
  | { ok: false; kind: 'error'; message: string };

const FALLBACK_NOTE = 'We could not make your account in one step this time. Please check your details below and sign up here: we will send you a confirmation email.';
const TRY_AGAIN = 'We could not create your account just now. Please try again in a few minutes.';

export interface CreateByLinkArgs {
  token: string;
  password: string;
  termsVersion: string | null;
  privacyVersion: string | null;
}

// Never throws. The Worker answers the plain sentence for every refusal; it is shown as it is. A link the Worker will not use (unavailable, a missing route, no network) is 'fallback'.
export async function createAccountByLink(args: CreateByLinkArgs, urlFor: UrlFor, fetchFn: FetchLike = defaultFetch): Promise<CreateByLinkResult> {
  const body: Record<string, string> = { token: args.token, password: args.password };
  if (args.termsVersion && args.privacyVersion) {
    body.acceptedTermsVersion = args.termsVersion;
    body.acceptedPrivacyVersion = args.privacyVersion;
  }
  let status = 0;
  let answer: { code?: unknown; error?: unknown } | null = null;
  try {
    const r = await fetchFn(urlFor('/api/signup/tutor-by-link'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    status = r.status;
    try {
      answer = (await r.json()) as typeof answer;
    } catch {
      answer = null;
    }
    if (r.ok && (answer as { ok?: unknown } | null)?.ok === true) return { ok: true };
  } catch {
    return { ok: false, kind: 'fallback', message: FALLBACK_NOTE };
  }
  const code = typeof answer?.code === 'string' ? answer.code : '';
  const sentence = typeof answer?.error === 'string' && answer.error ? answer.error : TRY_AGAIN;
  // A Worker that has no such route (404), a switch that went off, or a link that was used/lapsed: the ordinary sign-up.
  if (status === 404 || status === 405 || code === 'unavailable') return { ok: false, kind: 'fallback', message: FALLBACK_NOTE };
  if (status === 429) return { ok: false, kind: 'error', message: 'Too many tries. Please wait a minute and try again.' };
  return { ok: false, kind: 'error', message: sentence };
}

// The words on the one-step page.
export const ONE_STEP_COPY = {
  notice: 'Your place is open. We have your details from the list, so you only need to choose a password.',
  emailQuestion: 'Is this the right email?',
  emailWhy: 'We use it to sign you in and to reach you. You do not need to confirm it by email.',
  changeDetails: 'No, change my details',
  changeDetailsNote: 'You will check and change your details in the full form, and we will send a confirmation email to the address you give.',
  ready: 'Your account is ready',
  readyBody: 'Your account was made, but we could not sign you in just now. Sign in with the email and the password you chose.',
} as const;
