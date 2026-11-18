// A PERSONAL SIGN-UP LINK MAKES THE TUTOR ACCOUNT ALREADY CONFIRMED (job T, 18 Nov 2026; CEO accepted Drake/programmer/signup-confirmed-from-token-proposal-2026-11-18.md).
// Database half: supabase/migrations/20261118210000_signup_link_confirms.sql (setting signup_link_confirms, OFF by default; founding_signup_resolve, service key only).
// Page half: src/lib/signupByLink.ts and src/pages/CreateAccount.tsx.
//
// TWO NARROW ROUTES (mounted in server/index.ts), no sign-in, the token IS the credential:
//   POST /api/signup/tutor-by-link/check   { token }   -> { available: false } or { available: true, firstName, surname, email, phone, dateOfBirth }
//        What the page shows before the person types anything: the details from the list row and "Is this the right email?". Nothing is written.
//   POST /api/signup/tutor-by-link          { token, password, acceptedTermsVersion?, acceptedPrivacyVersion? } -> { ok: true, email }
//        Makes the account through Supabase Auth's admin API with email_confirm: true (so Supabase sends NO confirmation mail) and the same metadata the sign-up form sends today, so the existing
//        on_auth_user_created trigger builds the profile and the list row links itself exactly as now. EVERY detail (email, name, phone, date of birth) comes from the list row through
//        founding_signup_resolve, NEVER from the request: the request supplies only the token, the password and the two version words. Then a short "your account was made" notice goes to the row's
//        email (the safety net: a link that was forwarded and used by somebody else is visible to the real owner).
// While the switch is off (or the link is used, lapsed, unknown, incomplete, or the place is not open), the database answers null: check says { available: false } and create says 409 "unavailable",
// and the page falls back to the ordinary sign-up. Nothing here ever logs a token, a password or an email address.
//
// Everything outside comes in through `deps`, so scripts/dev/signup-by-link-test.ts runs it with fakes: no network, no key.
export interface LinkRow {
  rowId: string;
  firstName: string;
  surname: string;
  email: string;
  phone: string | null;
  dateOfBirth: string; // YYYY-MM-DD
}

export type CreateUserOutcome = { ok: true; userId: string } | { ok: false; kind: 'exists' | 'weak_password' | 'refused' | 'failed' };

export interface SignupByLinkDeps {
  // founding_signup_resolve(p_token, p_caller): the row, or null for any reason at all.
  resolve(token: string, caller: string): Promise<LinkRow | null>;
  // current_policy_versions(): the Terms and Privacy versions a person may accept today, or null if they cannot be read.
  currentVersions(): Promise<{ terms: string; privacy: string } | null>;
  createUser(args: { email: string; password: string; metadata: Record<string, string> }): Promise<CreateUserOutcome>;
  sendMail(mail: { to: string; subject: string; text: string }): Promise<{ ok: boolean; waiting?: boolean; detail?: string }>;
  log?: (line: string) => void;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export const TOKEN_SHAPE = /^[0-9a-f]{32}$/;
export const MIN_PASSWORD_LENGTH = 8; // the same minimum as the page (src/lib/authHelpers.ts)
export const MAX_PASSWORD_LENGTH = 72; // bcrypt reads no more than 72 bytes; a longer one would be silently cut, so it is refused out loud
const VERSION_SHAPE = /^[A-Za-z0-9._-]{1,40}$/;

export const MSG = {
  badRequest: 'Something is missing from that request. Please reload the page and try again.',
  unavailable: 'This link cannot be used to create your account in one step. Use the sign-up form instead.',
  exists: 'An account already exists for this email. Sign in, or reset your password.',
  passwordShort: `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  passwordLong: `Your password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
  passwordWeak: 'That password is too easy to guess. Choose a longer one, or one with different kinds of characters.',
  versionsChanged: 'The Terms or the Privacy Policy changed while this page was open. Reload the page and accept them again.',
  failed: 'We could not create your account just now. Please try again in a few minutes.',
} as const;

const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body });
const fail = (status: number, code: string, error: string): Reply => ({ status, body: { code, error } });

const textField = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// What a link-holder is told by mail. Plain words, no link to click and nothing to confirm: it only makes a hijack visible.
export function noticeMail(firstName: string, email: string): { to: string; subject: string; text: string } {
  const name = firstName.replace(/[\r\n<>]/g, ' ').trim() || 'there';
  return {
    to: email,
    subject: 'Your Tutorlage account was made',
    text:
      `Hi ${name},\n\n` +
      'A Tutorlage tutor account was just made with this email address, using your personal link from the founding tutors list. You do not need to confirm anything: sign in at https://tutorlage.com/login with the password that was chosen.\n\n' +
      'If this was you, there is nothing more to do.\n\n' +
      'If this was NOT you, please tell us at once at support@tutorlage.com, and use "Forgot your password" on the sign-in page to choose your own password.\n\n' +
      'Tutorlage',
  };
}

export function createSignupByLink(deps: SignupByLinkDeps) {
  const log = deps.log ?? ((line: string) => console.error(line));

  async function resolveSafely(token: string, caller: string): Promise<LinkRow | null> {
    try {
      return await deps.resolve(token, caller);
    } catch (e) {
      log(`signup-by-link: the link lookup failed: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
      return null;
    }
  }

  // The page asks this before it shows the one-step version. Any doubt is "not available" (the ordinary sign-up).
  async function check(body: unknown, caller: string): Promise<Reply> {
    const token = textField((body as { token?: unknown } | null)?.token)?.trim().toLowerCase() ?? '';
    if (!TOKEN_SHAPE.test(token)) return ok({ available: false });
    const row = await resolveSafely(token, caller);
    if (!row) return ok({ available: false });
    return ok({ available: true, firstName: row.firstName, surname: row.surname, email: row.email, phone: row.phone ?? '', dateOfBirth: row.dateOfBirth });
  }

  async function create(body: unknown, caller: string): Promise<Reply> {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const token = textField(b.token)?.trim().toLowerCase() ?? '';
    const password = textField(b.password);
    if (!TOKEN_SHAPE.test(token) || password === null) return fail(400, 'bad_request', MSG.badRequest);
    if (password.length < MIN_PASSWORD_LENGTH) return fail(422, 'weak_password', MSG.passwordShort);
    if (password.length > MAX_PASSWORD_LENGTH) return fail(422, 'weak_password', MSG.passwordLong);

    // The two version words the person ticked. Both or neither (a page that could not load them sends none; the account gate then asks again, as for the ordinary sign-up).
    const terms = b.acceptedTermsVersion === undefined || b.acceptedTermsVersion === null ? null : textField(b.acceptedTermsVersion);
    const privacy = b.acceptedPrivacyVersion === undefined || b.acceptedPrivacyVersion === null ? null : textField(b.acceptedPrivacyVersion);
    if ((terms === null) !== (privacy === null)) return fail(400, 'bad_request', MSG.badRequest);
    if (terms !== null && privacy !== null) {
      if (!VERSION_SHAPE.test(terms) || !VERSION_SHAPE.test(privacy)) return fail(400, 'bad_request', MSG.badRequest);
      let current: { terms: string; privacy: string } | null = null;
      try {
        current = await deps.currentVersions();
      } catch {
        current = null;
      }
      // A stale page must not record an old acceptance. If today's versions cannot be read at all, the ordinary sign-up is the way (it records what the page says): refuse softly.
      if (!current) return fail(503, 'failed', MSG.failed);
      if (current.terms !== terms || current.privacy !== privacy) return fail(409, 'versions_changed', MSG.versionsChanged);
    }

    const row = await resolveSafely(token, caller);
    if (!row) return fail(409, 'unavailable', MSG.unavailable);

    const metadata: Record<string, string> = {
      first_name: row.firstName,
      surname: row.surname,
      phone_number: row.phone ?? '',
      role: 'tutor',
      date_of_birth: row.dateOfBirth,
      ...(terms !== null && privacy !== null ? { accepted_terms_version: terms, accepted_privacy_version: privacy } : {}),
    };
    let made: CreateUserOutcome;
    try {
      made = await deps.createUser({ email: row.email, password, metadata });
    } catch (e) {
      log(`signup-by-link: the account could not be made: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
      return fail(500, 'failed', MSG.failed);
    }
    if (made.ok === false) {
      if (made.kind === 'exists') return fail(409, 'exists', MSG.exists);
      if (made.kind === 'weak_password') return fail(422, 'weak_password', MSG.passwordWeak);
      // 'refused': the database said no (for example the founding gate or the age rule). The ordinary sign-up gives the person the plain reasons.
      if (made.kind === 'refused') return fail(409, 'unavailable', MSG.unavailable);
      return fail(500, 'failed', MSG.failed);
    }

    // The safety net. Best effort: a mail that cannot be sent never undoes the account.
    try {
      const sent = await deps.sendMail(noticeMail(row.firstName, row.email));
      if (!sent.ok) log(`signup-by-link: the notice mail was not sent (${sent.waiting ? 'no mail path set up' : String(sent.detail ?? 'failed').slice(0, 80)})`);
    } catch {
      log('signup-by-link: the notice mail was not sent (error)');
    }
    log('signup-by-link: an account was made through a personal link');
    return ok({ ok: true, email: row.email });
  }

  return { check, create };
}

export type SignupByLink = ReturnType<typeof createSignupByLink>;

// Maps what Supabase Auth's admin createUser answered to the three kinds the logic above understands. Written apart so the test can feed it real-shaped errors.
export function classifyCreateUserError(error: { message?: string; status?: number; code?: string } | null | undefined): CreateUserOutcome | null {
  if (!error) return null;
  const msg = String(error.message ?? '');
  if (error.code === 'email_exists' || error.code === 'user_already_exists' || /already (been )?registered|already exists/i.test(msg)) return { ok: false, kind: 'exists' };
  if (error.code === 'weak_password' || /password/i.test(msg)) return { ok: false, kind: 'weak_password' };
  // The sign-up trigger refuses with a generic "Database error creating new user" (the founding gate, the age rule).
  if (/database error/i.test(msg)) return { ok: false, kind: 'refused' };
  return { ok: false, kind: 'failed' };
}
