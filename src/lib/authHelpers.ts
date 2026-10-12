// Pure helpers for the account-email screens: "send the link again" (master 7cl), "Forgot your password?"
// and "set a new password" (master 7cm). No React, no Supabase client, no import.meta here on purpose, so
// scripts/dev/auth-helpers-test.ts can run every rule under tsx without a browser or any keys.
//
// What supabase-js really returns (checked in node_modules/@supabase/auth-js 2.112.4, lib/fetch.js + errors.js):
//   - a failed call gives `error` with `.name`, `.status` (HTTP status) and `.code` (the server's error_code);
//   - a wrong password is 400 `invalid_credentials` ("Invalid login credentials");
//   - a right password on an unconfirmed address is 400 `email_not_confirmed` ("Email not confirmed");
//   - asking for an email too soon is 429 `over_email_send_rate_limit`;
//   - the same new password is 422 `same_password`; a dead session on updateUser is 401 / AuthSessionMissingError;
//   - no network at all is an `AuthRetryableFetchError` with status 0, and server faults 500, 502-504, 520-530 are
//     also `AuthRetryableFetchError`s, carrying the server's own message.
import { LEARNER_LOGIN_DOMAIN } from './accountRules';

// Sign-up and "set a new password" use the same rule, so they cannot drift apart. The database/Supabase may
// ask for more; if it does, its own message is shown.
export const MIN_PASSWORD_LENGTH = 8;

// How long the "send it again" buttons stay switched off after an email was sent. Supabase itself refuses a
// second email to the same person inside 60 seconds, so the button waits as long as the server does.
export const EMAIL_LINK_COOLDOWN_SECONDS = 60;

export const AUTH_COPY = {
  // Under every "we sent you a link" message.
  emailArrivalHint: 'It can take a few minutes to arrive. Check your spam or junk folder too.',
  // Shown after every "forgot password" request, whether or not an account exists, so the page cannot be
  // used to find out who has an account.
  resetNeutral: 'If an account exists for that address, we have sent a link.',
  // Neutral on purpose: Supabase answers "ok" for an address that is waiting to be confirmed, for one that is already
  // confirmed and for one it has never seen, and sends nothing in the last two. So this must not promise that mail left.
  resendSent: 'If this address is waiting to be confirmed, we have sent the link again.',
  resendTooSoon: 'We have only just sent one. Please wait a minute, then try again.',
  // The server's other "too many emails" answer: a cap on all emails the site sends in an hour, not on this person.
  resendBusy: 'Too many emails have been sent just now. Please wait a few minutes, then try again.',
  unreachable: 'We could not reach Tutorlage. Check your internet connection and try again.',
  // The "set a new password" page could not tell whether the reset link is good (no answer from Supabase), which is
  // not the same as the link being used up.
  linkNotCheckedTitle: 'We could not check your link',
  linkNotCheckedBody:
    'Your phone or computer could not reach Tutorlage just now. Check your internet connection, then reload this page. The link may still work.',
  // Learners a guardian added have a sign-in name, not a real email address: nothing can be mailed to them.
  learnerCannotGetEmail:
    'Sign-in names do not have an email address, so we cannot send a link. Ask your parent or guardian.',
  signInNotConfirmed: 'Your email address is not confirmed yet. Open the link we emailed you, or send it again.',
  // A learner's sign-in name has no inbox, so "open the link we emailed you" would make no sense to them.
  learnerNotConfirmed: 'This sign-in name is not ready to use yet. Ask your parent or guardian.',
  passwordsDiffer: 'Passwords do not match.',
  passwordTooShort: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  samePassword: 'Your new password must be different from your old one.',
  rateLimited: 'Too many tries. Please wait a minute and try again.',
} as const;

// ---------------------------------------------------------------------------------------------------------
// Reading an error without trusting its shape.

function field(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[key] : undefined;
}

export function authErrorCode(error: unknown): string | null {
  const code = field(error, 'code');
  return typeof code === 'string' ? code : null;
}

export function authErrorMessage(error: unknown): string {
  const message = field(error, 'message');
  return typeof message === 'string' ? message : '';
}

function authErrorStatus(error: unknown): number | null {
  const status = field(error, 'status');
  return typeof status === 'number' ? status : null;
}

// A right password on an address nobody has confirmed yet.
export function isEmailNotConfirmed(error: unknown): boolean {
  return authErrorCode(error) === 'email_not_confirmed' || /email not confirmed/i.test(authErrorMessage(error));
}

export function isInvalidCredentials(error: unknown): boolean {
  return authErrorCode(error) === 'invalid_credentials' || /invalid login credentials/i.test(authErrorMessage(error));
}

// Supabase answers a second email request inside its 60-second window, or too many requests, with 429.
export function isRateLimited(error: unknown): boolean {
  const code = authErrorCode(error);
  return (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    authErrorStatus(error) === 429 ||
    /rate limit|only request this|for security purposes/i.test(authErrorMessage(error))
  );
}

// No answer at all (offline, blocked, timed out) or the service itself is down. 500 is deliberately not
// here: when Supabase can't send an email it says 500 "Error sending ... email", and that only happens for an
// address that has an account.
export function isServiceUnreachable(error: unknown): boolean {
  if (field(error, 'name') !== 'AuthRetryableFetchError') return false;
  const status = authErrorStatus(error);
  return status === null || status === 0 || status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530);
}

// Supabase gave no verdict at all, so nothing is known about the link: no answer (offline, timed out) or a server fault
// (500 and the other 5xx supabase-js retries). Wider than isServiceUnreachable on purpose: that one leaves 500 out
// because of the email-sending case, which does not apply to checking a link.
export function isLinkCheckInconclusive(error: unknown): boolean {
  return field(error, 'name') === 'AuthRetryableFetchError';
}

// The link is dead: the session behind it is gone, expired or never existed.
export function isSessionGone(error: unknown): boolean {
  const code = authErrorCode(error);
  return (
    field(error, 'name') === 'AuthSessionMissingError' ||
    code === 'session_not_found' ||
    code === 'session_expired' ||
    code === 'bad_jwt' ||
    code === 'no_authorization' ||
    code === 'refresh_token_not_found' ||
    code === 'refresh_token_already_used' ||
    authErrorStatus(error) === 401
  );
}

// ---------------------------------------------------------------------------------------------------------
// Addresses.

// True for the stored address of a learner a guardian added with a sign-in name (see accountRules.ts).
export function isLearnerSignInAddress(address: string): boolean {
  return address.trim().toLowerCase().endsWith(`@${LEARNER_LOGIN_DOMAIN}`);
}

// What was typed in a "sign-in name or email" box cannot receive mail: no "@", or a learner address.
export function cannotReceiveEmail(typed: string): boolean {
  const value = typed.trim();
  return !value.includes('@') || isLearnerSignInAddress(value);
}

// ---------------------------------------------------------------------------------------------------------
// The cool-down on "send it again".

// Whole seconds left of a cool-down that began at `startedAt` (ms). Never more than the full length, so a
// clock that jumps backwards cannot lock the button for hours.
export function cooldownSecondsLeft(
  startedAt: number | null,
  now: number,
  totalSeconds: number = EMAIL_LINK_COOLDOWN_SECONDS,
): number {
  if (startedAt === null) return 0;
  const left = Math.ceil((startedAt + totalSeconds * 1000 - now) / 1000);
  return Math.min(totalSeconds, Math.max(0, left));
}

export function resendButtonLabel(sending: boolean, secondsLeft: number, idleLabel = 'Send the link again'): string {
  if (sending) return 'Sending…';
  if (secondsLeft > 0) return `Send it again in ${secondsLeft}s`;
  return idleLabel;
}

// The wait is remembered per address for as long as the page is open, so leaving a screen and coming back inside the
// minute (for example sign in again, fail again, and see the button again) does not give a fresh, enabled button.
const sendStartedAt = new Map<string, number>();

// The key the sign-up "send the link again" wait is remembered under. Sign-up uses it too (it has just sent the first
// email), so the button on the "Check your email" screen starts off for the minute the server will refuse anyway.
export function signupResendKey(address: string): string {
  return `signup-resend:${address.trim().toLowerCase()}`;
}

// The start time to remember so that exactly `waitSeconds` are left now (the server said how long it still wants
// us to wait). With no figure, or one that makes no sense, the whole wait.
export function cooldownStartTime(
  now: number,
  waitSeconds: number | null | undefined,
  totalSeconds: number = EMAIL_LINK_COOLDOWN_SECONDS,
): number {
  const left =
    typeof waitSeconds === 'number' && Number.isFinite(waitSeconds) && waitSeconds > 0
      ? Math.min(totalSeconds, Math.ceil(waitSeconds))
      : totalSeconds;
  return now - (totalSeconds - left) * 1000;
}

export function lastSendStartedAt(key: string): number | null {
  return sendStartedAt.get(key) ?? null;
}

export function noteSendStarted(key: string, at: number): void {
  sendStartedAt.set(key, at);
}

// ---------------------------------------------------------------------------------------------------------
// Plain wording for each failure.

// Supabase uses the one code, over_email_send_rate_limit, for two different limits (its docs: a 60-second window per
// person for sign-up and reset emails, and a cap on all emails per hour for the whole project). The first says
// "For security purposes, you can only request this ..." in its message, the second "email rate limit exceeded", so only
// the first is told to wait a minute. The first has been worded two ways, both matched here: "... once every 60
// seconds" (older servers) and "... after 41 seconds." (newer ones, counting down what is left). The newer wording
// was reported from upstream's source; it was not seen from a live call to dev, so both are matched.
function isOneMinuteWindow(error: unknown): boolean {
  return /only request this|once every|60 seconds/i.test(authErrorMessage(error));
}

// How many seconds the server says are left in its per-person window ("... after 41 seconds."), when it says so.
// Never more than the usual wait. Null for the whole-site cap and when no figure is given; the old wording's
// "every 60 seconds" reads as 60.
export function rateLimitWaitSeconds(error: unknown): number | null {
  if (!isRateLimited(error) || !isOneMinuteWindow(error)) return null;
  const match = /(\d+)\s*seconds?/i.exec(authErrorMessage(error));
  if (!match) return null;
  const seconds = Number(match[1]);
  return seconds > 0 ? Math.min(EMAIL_LINK_COOLDOWN_SECONDS, seconds) : null;
}

export function describeResendError(error: unknown): string {
  if (isRateLimited(error)) return isOneMinuteWindow(error) ? AUTH_COPY.resendTooSoon : AUTH_COPY.resendBusy;
  if (isServiceUnreachable(error)) return AUTH_COPY.unreachable;
  const reason = authErrorMessage(error).trim();
  return reason
    ? `We could not send the link. Please try again in a minute. (${reason})`
    : 'We could not send the link. Please try again in a minute.';
}

export interface SignInProblem {
  text: string;
  // True when the password was right but the email address was never confirmed: offer "send the link again".
  needsConfirmation: boolean;
}

// `address` is what was sent to Supabase (already turned from a sign-in name into its stored address, if it was one).
export function describeSignInError(error: unknown, identifierLabel = 'email', address = ''): SignInProblem {
  if (isEmailNotConfirmed(error)) {
    if (address && cannotReceiveEmail(address)) return { text: AUTH_COPY.learnerNotConfirmed, needsConfirmation: false };
    return { text: AUTH_COPY.signInNotConfirmed, needsConfirmation: true };
  }
  if (isInvalidCredentials(error)) {
    return {
      text: `That ${identifierLabel} and password do not match. Check for typing mistakes, or use “Forgot your password?” below.`,
      needsConfirmation: false,
    };
  }
  if (isRateLimited(error)) return { text: AUTH_COPY.rateLimited, needsConfirmation: false };
  if (isServiceUnreachable(error)) return { text: AUTH_COPY.unreachable, needsConfirmation: false };
  return { text: authErrorMessage(error) || 'We could not sign you in. Please try again.', needsConfirmation: false };
}

export type ResetRequestOutcome = 'neutral' | 'unreachable';

// What the "forgot password" page does with Supabase's answer. Every answer gets the same neutral message,
// so a stranger cannot tell which addresses have accounts, with one exception that says nothing about any
// account: when the request never got through at all.
export function resetRequestOutcome(error: unknown): ResetRequestOutcome {
  return error && isServiceUnreachable(error) ? 'unreachable' : 'neutral';
}

export type UpdatePasswordProblem = { kind: 'link_expired' } | { kind: 'message'; text: string };

export function describeUpdatePasswordError(error: unknown): UpdatePasswordProblem {
  if (authErrorCode(error) === 'same_password') return { kind: 'message', text: AUTH_COPY.samePassword };
  if (isSessionGone(error)) return { kind: 'link_expired' };
  if (isRateLimited(error)) return { kind: 'message', text: AUTH_COPY.rateLimited };
  if (isServiceUnreachable(error)) return { kind: 'message', text: AUTH_COPY.unreachable };
  return {
    kind: 'message',
    text: authErrorMessage(error).trim() || 'We could not change your password. Please try again.',
  };
}

// The sign-up rule, shared with the "set a new password" page: the two boxes match, then the length.
export function validateNewPassword(password: string, confirmation: string): string | null {
  if (password !== confirmation) return AUTH_COPY.passwordsDiffer;
  if (password.length < MIN_PASSWORD_LENGTH) return AUTH_COPY.passwordTooShort;
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// The address a Supabase email link brings the person back to.

export interface AuthRedirectInfo {
  // The address SAYS it is a password-recovery link (`type=recovery` rides along with the session tokens in the
  // fragment). This is only a claim: anyone can type such an address. Nothing may be shown or allowed on the strength
  // of it; judgeRecoveryLink below turns it into a verdict using what supabase-js found out from the server.
  isRecovery: boolean;
  // The link came back with an error instead of a session (expired or already used).
  errorCode: string | null;
  errorDescription: string | null;
}

// Supabase puts the result in the address fragment (#access_token=...&type=recovery, or #error=...&error_code=...),
// and supabase-js removes it once it has read it, so this has to be read early.
export function parseAuthRedirect(hash: string, search = ''): AuthRedirectInfo {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  for (const [key, value] of fragment) params.set(key, value);
  return {
    // A real reset link carries its tokens in the fragment only, so the query string is not looked at here.
    isRecovery: fragment.get('type') === 'recovery' && fragment.has('access_token'),
    errorCode: params.get('error_code') ?? (params.has('error') ? params.get('error') : null),
    errorDescription: params.get('error_description'),
  };
}

export type RecoveryLinkVerdict = 'confirmed' | 'not-a-reset-link' | 'could-not-check';

// Is this page load a real password-reset in progress? Only something the server checked may say yes.
//   claimedByAddress    the address said it was a reset link (AuthRedirectInfo.isRecovery)
//   initializeError     the `error` of supabase.auth.initialize(): supabase-js's own result of reading the link, which
//                       is null only when it took the token to Supabase, the server accepted it, and the session is saved
//   flagSet             an earlier load of this tab already had its reset link confirmed (survives a reload, because
//                       supabase-js clears the fragment)
// A forged address (junk token, or a token the server refuses) leaves supabase-js with an error and the person's own
// session untouched, so it is never 'confirmed': a signed-in person cannot be made to see the form that way.
export function judgeRecoveryLink(
  claimedByAddress: boolean,
  initializeError: unknown,
  flagSet: boolean,
): RecoveryLinkVerdict {
  if (claimedByAddress) {
    if (!initializeError) return 'confirmed';
    return isLinkCheckInconclusive(initializeError) ? 'could-not-check' : 'not-a-reset-link';
  }
  return flagSet ? 'confirmed' : 'not-a-reset-link';
}
