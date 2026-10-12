// Test of src/lib/authHelpers.ts (master backlog 7cl "send the link again", 7cm "forgot password"): the rules for the
// cool-down, the wording of each failure, the password rule and the reading of an email link's address, first on their
// own and then against supabase-js talking to a pretend Auth server (scripts/dev/fake-auth.ts), so the error objects
// are the ones supabase-js really builds. No network beyond localhost, no keys, no real email.
// Run: npx tsx scripts/dev/auth-helpers-test.ts   (exits 1 if any check fails)
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthWeakPasswordError,
  createClient,
} from '@supabase/supabase-js';
import { toSignInEmail } from '../../src/lib/accountRules';
import {
  AUTH_COPY,
  EMAIL_LINK_COOLDOWN_SECONDS,
  MIN_PASSWORD_LENGTH,
  cannotReceiveEmail,
  cooldownSecondsLeft,
  cooldownStartTime,
  describeResendError,
  describeSignInError,
  describeUpdatePasswordError,
  isEmailNotConfirmed,
  isInvalidCredentials,
  isLearnerSignInAddress,
  isLinkCheckInconclusive,
  isRateLimited,
  isServiceUnreachable,
  judgeRecoveryLink,
  lastSendStartedAt,
  noteSendStarted,
  parseAuthRedirect,
  rateLimitWaitSeconds,
  resendButtonLabel,
  resetRequestOutcome,
  signupResendKey,
  validateNewPassword,
} from '../../src/lib/authHelpers';
import { fakeAccessToken, startFakeAuth } from './fake-auth';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

async function main() {
  // ---- The password rule: the same words sign-up always used --------------------------------------------------
  check('minimum length is 8', MIN_PASSWORD_LENGTH === 8);
  check('mismatch is checked first (as sign-up did)', validateNewPassword('abc', 'abd') === 'Passwords do not match.');
  check('too short', validateNewPassword('abcdefg', 'abcdefg') === 'Password must be at least 8 characters.');
  check('eight is enough', validateNewPassword('abcdefgh', 'abcdefgh') === null);
  check('empty boxes that match are too short', validateNewPassword('', '') === 'Password must be at least 8 characters.');

  // ---- The cool-down ---------------------------------------------------------------------------------------------
  const T0 = 1_800_000_000_000;
  check('cool-down length is 60 seconds', EMAIL_LINK_COOLDOWN_SECONDS === 60);
  check('never started: no wait', cooldownSecondsLeft(null, T0) === 0);
  check('just started: 60', cooldownSecondsLeft(T0, T0) === 60);
  check('1 ms later still rounds up to 60', cooldownSecondsLeft(T0, T0 + 1) === 60);
  check('after 30 s: 30', cooldownSecondsLeft(T0, T0 + 30_000) === 30);
  check('after 59.2 s: 1', cooldownSecondsLeft(T0, T0 + 59_200) === 1);
  check('after exactly 60 s: 0', cooldownSecondsLeft(T0, T0 + 60_000) === 0);
  check('long after: 0', cooldownSecondsLeft(T0, T0 + 10 * 60_000) === 0);
  check('clock set back an hour cannot lock the button past 60', cooldownSecondsLeft(T0, T0 - 3_600_000) === 60);
  check('button says Sending… while sending', resendButtonLabel(true, 0) === 'Sending…');
  check('sending wins over the wait', resendButtonLabel(true, 40) === 'Sending…');
  check('button shows the seconds', resendButtonLabel(false, 42) === 'Send it again in 42s');
  check('idle label', resendButtonLabel(false, 0) === 'Send the link again');
  check('idle label can be changed', resendButtonLabel(false, 0, 'Send reset link') === 'Send reset link');
  check('no send remembered for an address that never had one', lastSendStartedAt('signup-resend:nobody@example.com') === null);
  noteSendStarted('signup-resend:pat@gmail.com', T0);
  check('a send is remembered per address, so the wait survives closing the screen', lastSendStartedAt('signup-resend:pat@gmail.com') === T0 && cooldownSecondsLeft(lastSendStartedAt('signup-resend:pat@gmail.com'), T0 + 20_000) === 40);
  check('... and another address is not held back by it', lastSendStartedAt('signup-resend:someone.else@gmail.com') === null);
  // Sign-up starts this wait under the same key the button reads (review finding: the button was live straight after sign-up).
  check('sign-up and the button share one wait key, whatever the case or spaces', signupResendKey(' Pat@Gmail.com ') === 'signup-resend:pat@gmail.com' && signupResendKey('pat@gmail.com') === signupResendKey('PAT@gmail.com'));
  noteSendStarted(signupResendKey('NewPerson@Example.com '), T0);
  check('a sign-up that has just sent leaves the button off for the minute', cooldownSecondsLeft(lastSendStartedAt(signupResendKey('newperson@example.com')), T0 + 1_000) === 59);
  check('the server says 41 seconds are left: 41 shown', cooldownSecondsLeft(cooldownStartTime(T0, 41), T0) === 41);
  check('... and it counts down from there', cooldownSecondsLeft(cooldownStartTime(T0, 41), T0 + 40_000) === 1 && cooldownSecondsLeft(cooldownStartTime(T0, 41), T0 + 41_000) === 0);
  check('no figure from the server: the whole minute', cooldownSecondsLeft(cooldownStartTime(T0, null), T0) === 60 && cooldownSecondsLeft(cooldownStartTime(T0, undefined), T0) === 60);
  check('a figure above the minute is capped at the minute', cooldownSecondsLeft(cooldownStartTime(T0, 600), T0) === 60);
  check('a zero, negative or broken figure means the whole minute', cooldownSecondsLeft(cooldownStartTime(T0, 0), T0) === 60 && cooldownSecondsLeft(cooldownStartTime(T0, -5), T0) === 60 && cooldownSecondsLeft(cooldownStartTime(T0, Number.NaN), T0) === 60);

  // ---- Learners' sign-in names have no inbox ----------------------------------------------------------------------
  check('a sign-in name becomes a learner address', isLearnerSignInAddress(toSignInEmail('thando-7k2m9q')));
  check('learner address in capitals', isLearnerSignInAddress('Thando-7k2m9q@Learners.Tutorlage.INVALID'));
  check('a real address is not a learner address', !isLearnerSignInAddress('pat@gmail.com'));
  check('a name with no @ cannot receive email', cannotReceiveEmail('thando-7k2m9q'));
  check('a learner address cannot receive email', cannotReceiveEmail('thando-7k2m9q@learners.tutorlage.invalid'));
  check('a real address can', !cannotReceiveEmail('  pat@gmail.com '));
  check('an @tutorlage.com tester address can', !cannotReceiveEmail('tutor.tester1@tutorlage.com'));
  check('empty cannot', cannotReceiveEmail('   '));

  // ---- Classifying errors, using supabase-js's own error classes ------------------------------------------------
  const notConfirmed = new AuthApiError('Email not confirmed', 400, 'email_not_confirmed');
  const badLogin = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials');
  const tooSoon = new AuthApiError('For security purposes, you can only request this once every 60 seconds', 429, 'over_email_send_rate_limit');
  const offline = new AuthRetryableFetchError('Failed to fetch', 0);
  const down = new AuthRetryableFetchError('Service Unavailable', 503);
  const smtp500 = new AuthRetryableFetchError('Error sending recovery email', 500);

  check('email_not_confirmed by code', isEmailNotConfirmed(notConfirmed));
  check('email_not_confirmed by message alone (older server)', isEmailNotConfirmed(new Error('Email not confirmed')));
  check('a wrong password is not "not confirmed"', !isEmailNotConfirmed(badLogin));
  check('invalid credentials by code', isInvalidCredentials(badLogin));
  check('rate limit by code', isRateLimited(tooSoon));
  check('rate limit by 429 alone', isRateLimited(new AuthApiError('slow down', 429, undefined)));
  check('a 400 is not a rate limit', !isRateLimited(notConfirmed));
  check('offline is unreachable', isServiceUnreachable(offline));
  check('503 is unreachable', isServiceUnreachable(down));
  check('500 "Error sending email" is NOT unreachable (it only happens for real accounts)', !isServiceUnreachable(smtp500));
  check('an API error is not unreachable', !isServiceUnreachable(badLogin));

  const notConfirmedProblem = describeSignInError(notConfirmed);
  check('sign-in: not confirmed offers the resend', notConfirmedProblem.needsConfirmation && notConfirmedProblem.text === AUTH_COPY.signInNotConfirmed);
  const badLoginProblem = describeSignInError(badLogin);
  check('sign-in: wrong password is plain and offers no resend', !badLoginProblem.needsConfirmation && /do not match/.test(badLoginProblem.text) && /Forgot your password/.test(badLoginProblem.text));
  check('sign-in: wrong password does not say whether the account exists', !/no account|not found|does not exist|unknown/i.test(badLoginProblem.text));
  check('sign-in: student box wording', /email or sign-in name and password/.test(describeSignInError(badLogin, 'email or sign-in name').text));
  check('sign-in: other errors keep their own words', describeSignInError(new AuthApiError('User is banned', 400, 'user_banned')).text === 'User is banned');
  check('sign-in: offline', describeSignInError(offline).text === AUTH_COPY.unreachable);

  // A learner's sign-in name has no inbox: no "send the link again" for them, whichever way the address arrives.
  const learnerProblem = describeSignInError(notConfirmed, 'email or sign-in name', toSignInEmail('thando-7k2m9q'));
  check('sign-in: unconfirmed learner sign-in name is told to ask a parent, with no resend', !learnerProblem.needsConfirmation && learnerProblem.text === AUTH_COPY.learnerNotConfirmed && /parent or guardian/.test(learnerProblem.text));
  check('sign-in: unconfirmed real address still offers the resend', describeSignInError(notConfirmed, 'email', 'tutor.tester1@tutorlage.com').needsConfirmation);

  check('resend: too soon', describeResendError(tooSoon) === AUTH_COPY.resendTooSoon);
  // Supabase's one rate-limit code covers two limits; only the per-person one may say "wait a minute".
  const hourlyCap = new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit');
  check('resend: the whole-site hourly cap is not described as "wait a minute"', describeResendError(hourlyCap) === AUTH_COPY.resendBusy && describeResendError(hourlyCap) !== AUTH_COPY.resendTooSoon && !/wait a minute/.test(describeResendError(hourlyCap)));
  check('resend: a 429 with no message at all is the careful wording', describeResendError(new AuthApiError('', 429, undefined)) === AUTH_COPY.resendBusy);
  // The per-person window is worded two ways (older: "once every 60 seconds"; newer, counting down: "after 41 seconds.").
  // Review finding: only the older one was recognised, so the newer one was shown as "wait a few minutes".
  const tooSoonNew = new AuthApiError('For security purposes, you can only request this after 41 seconds.', 429, 'over_email_send_rate_limit');
  check('resend: the newer per-person wording is the wait-a-minute line, not the busy one', describeResendError(tooSoonNew) === AUTH_COPY.resendTooSoon && isRateLimited(tooSoonNew));
  check('resend: ... and the 41 seconds are read from it', rateLimitWaitSeconds(tooSoonNew) === 41);
  check('resend: the older wording reads as 60', rateLimitWaitSeconds(tooSoon) === 60);
  check('resend: the whole-site cap carries no figure', rateLimitWaitSeconds(hourlyCap) === null);
  check('resend: a 429 with no message carries no figure', rateLimitWaitSeconds(new AuthApiError('', 429, undefined)) === null);
  check('resend: a figure above a minute is capped at a minute', rateLimitWaitSeconds(new AuthApiError('For security purposes, you can only request this after 600 seconds.', 429, 'over_email_send_rate_limit')) === 60);
  check('resend: an error that is not a rate limit carries no figure', rateLimitWaitSeconds(offline) === null && rateLimitWaitSeconds(new Error('after 41 seconds')) === null);
  check('resend: offline', describeResendError(offline) === AUTH_COPY.unreachable);
  check('resend: sending failed keeps the reason', /Error sending confirmation email/.test(describeResendError(new AuthRetryableFetchError('Error sending confirmation email', 500))));

  // The forgot-password page: every answer but "could not reach the service" gets the one neutral message.
  const neutralFor: Array<[string, unknown]> = [
    ['success', null],
    ['429 too soon', tooSoon],
    ['429 too soon, newer wording', tooSoonNew],
    // Deliberately neutral. Upstream returns "email rate limit exceeded" from the function that sends the mail, which (as
    // far as I could read; not confirmed on dev) a reset for an address with no account never reaches. A different line
    // here could then tell a stranger which addresses have accounts, so the page keeps one answer.
    ['429 whole-site cap', hourlyCap],
    ['500 sending failed', smtp500],
    ['400 invalid address', new AuthApiError('Unable to validate email address: invalid format', 400, 'email_address_invalid')],
    ['an unknown error', new Error('boom')],
  ];
  for (const [name, error] of neutralFor) {
    check(`forgot password: ${name} gets the neutral message`, resetRequestOutcome(error) === 'neutral');
  }
  check('forgot password: offline is the only different answer', resetRequestOutcome(offline) === 'unreachable' && resetRequestOutcome(down) === 'unreachable');
  check('the neutral message is the agreed words', AUTH_COPY.resetNeutral === 'If an account exists for that address, we have sent a link.');
  // Supabase answers "ok" to a resend for an address that is confirmed or unknown too, and then sends nothing.
  check('the "sent again" line does not promise that mail left', /^If this address is waiting to be confirmed/.test(AUTH_COPY.resendSent));

  const same = describeUpdatePasswordError(new AuthApiError('New password should be different from the old password.', 422, 'same_password'));
  check('new password: same as old', same.kind === 'message' && same.text === AUTH_COPY.samePassword);
  check('new password: session missing means the link is dead', describeUpdatePasswordError(new AuthSessionMissingError()).kind === 'link_expired');
  check('new password: 401 means the link is dead', describeUpdatePasswordError(new AuthApiError('invalid JWT', 401, 'bad_jwt')).kind === 'link_expired');
  const weak = describeUpdatePasswordError(new AuthWeakPasswordError('Password should be at least 10 characters.', 422, ['length']));
  check('new password: a stricter server rule is shown in its own words', weak.kind === 'message' && weak.text === 'Password should be at least 10 characters.');
  check('new password: offline', JSON.stringify(describeUpdatePasswordError(offline)) === JSON.stringify({ kind: 'message', text: AUTH_COPY.unreachable }));

  // ---- Reading the address an email link brings the person back to -----------------------------------------------
  const recovery = parseAuthRedirect('#access_token=abc&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery');
  check('recovery link is recognised', recovery.isRecovery && recovery.errorCode === null);
  const signup = parseAuthRedirect('#access_token=abc&expires_in=3600&refresh_token=r&token_type=bearer&type=signup');
  check('a sign-up confirmation link is not a recovery link', !signup.isRecovery);
  const expired = parseAuthRedirect('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  check('an expired link is recognised', !expired.isRecovery && expired.errorCode === 'otp_expired' && /expired/.test(expired.errorDescription ?? ''));
  check('an error with no code still counts as an error', parseAuthRedirect('#error=access_denied').errorCode === 'access_denied');
  check('a plain address is nothing', !parseAuthRedirect('', '').isRecovery && parseAuthRedirect('', '').errorCode === null);
  check('type=recovery with no token is not trusted', !parseAuthRedirect('#type=recovery').isRecovery);
  check('a router-style fragment is harmless', !parseAuthRedirect('#/login').isRecovery);
  check('error in the query string is read too', parseAuthRedirect('', '?error_code=otp_expired').errorCode === 'otp_expired');
  // Review finding: the address alone must never be enough. Real links carry their tokens in the fragment only.
  check('a recovery claim in the query string is not even a claim', !parseAuthRedirect('', '?type=recovery&access_token=x').isRecovery);
  check('a recovery claim in the fragment is only a claim: parsing cannot tell it from a real link', parseAuthRedirect('#type=recovery&access_token=x', '').isRecovery);

  // ---- The verdict on a reset link: what the address says is a claim, what the server accepted is the proof --------------
  const refused = new AuthApiError('invalid JWT: unable to parse or verify signature', 401, 'bad_jwt');
  check('verdict: a claim that supabase-js got the server to accept is confirmed', judgeRecoveryLink(true, null, false) === 'confirmed');
  check('verdict: a claim the server refused is not a reset link', judgeRecoveryLink(true, refused, false) === 'not-a-reset-link');
  check('verdict: ... even with a stale flag in the tab', judgeRecoveryLink(true, refused, true) === 'not-a-reset-link');
  check('verdict: no answer from Supabase is "could not check", not "expired"', judgeRecoveryLink(true, offline, false) === 'could-not-check' && judgeRecoveryLink(true, down, false) === 'could-not-check' && judgeRecoveryLink(true, smtp500, false) === 'could-not-check');
  check('verdict: no claim and no flag is not a reset link', judgeRecoveryLink(false, null, false) === 'not-a-reset-link');
  check('verdict: no claim, but this tab already had its link confirmed (a reload): confirmed', judgeRecoveryLink(false, null, true) === 'confirmed');
  check('"could not check" covers no answer and server faults, not API refusals', isLinkCheckInconclusive(offline) && isLinkCheckInconclusive(down) && isLinkCheckInconclusive(smtp500) && !isLinkCheckInconclusive(refused) && !isLinkCheckInconclusive(null));

  // ---- supabase-js against the pretend Auth server ----------------------------------------------------------------
  const fake = await startFakeAuth();
  const newClient = (url = fake.url) =>
    createClient(url, 'fake-publishable-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const client = newClient();

  // sign-in
  const unconfirmed = await client.auth.signInWithPassword({ email: 'unconfirmed.tester@tutorlage.com', password: 'goodpassword1' });
  check('real client: unconfirmed address gives code email_not_confirmed', unconfirmed.error?.code === 'email_not_confirmed', `code=${unconfirmed.error?.code} status=${unconfirmed.error?.status} message=${unconfirmed.error?.message}`);
  check('real client: ... and the page offers the resend', describeSignInError(unconfirmed.error).needsConfirmation);
  const wrong = await client.auth.signInWithPassword({ email: 'pat@gmail.com', password: 'nope' });
  check('real client: wrong password gives code invalid_credentials', wrong.error?.code === 'invalid_credentials' && isInvalidCredentials(wrong.error));
  check('real client: ... and no resend is offered', !describeSignInError(wrong.error).needsConfirmation);

  // send the link again: the same redirect the sign-up used, and the right type
  const redirect = 'https://darkphillipino.github.io/tutorlage-beta/login';
  const resent = await client.auth.resend({ type: 'signup', email: 'pat@gmail.com', options: { emailRedirectTo: redirect } });
  const resendCall = fake.calls.filter((c) => c.path === '/auth/v1/resend').at(-1);
  check('real client: resend succeeds', resent.error === null);
  check('resend asks for type "signup" for that address', resendCall?.body.type === 'signup' && resendCall?.body.email === 'pat@gmail.com');
  check('resend carries the same return address as sign-up (GitHub Pages base path kept)', resendCall?.query.redirect_to === redirect, `redirect_to=${resendCall?.query.redirect_to}`);
  const resentSoon = await client.auth.resend({ type: 'signup', email: 'toosoon@gmail.com' });
  check('real client: a second send inside a minute is a rate limit', isRateLimited(resentSoon.error) && resentSoon.error?.code === 'over_email_send_rate_limit' && resentSoon.error?.status === 429);
  check('... with the plain wait message', describeResendError(resentSoon.error) === AUTH_COPY.resendTooSoon);
  const resentWindow = await client.auth.resend({ type: 'signup', email: 'window41@gmail.com' });
  check('real client: the newer per-person wording is the wait line, with 41 seconds', describeResendError(resentWindow.error) === AUTH_COPY.resendTooSoon && rateLimitWaitSeconds(resentWindow.error) === 41, `message=${resentWindow.error?.message}`);
  const resentCap = await client.auth.resend({ type: 'signup', email: 'sitecap@gmail.com' });
  check('real client: the whole-site cap is the busy line, with no figure', describeResendError(resentCap.error) === AUTH_COPY.resendBusy && rateLimitWaitSeconds(resentCap.error) === null, `message=${resentCap.error?.message}`);
  const resentFail = await client.auth.resend({ type: 'signup', email: 'smtpfail@gmail.com' });
  check('real client: a failed send keeps the server\'s reason', /Error sending confirmation email/.test(describeResendError(resentFail.error)), `status=${resentFail.error?.status}`);
  const resentDown = await client.auth.resend({ type: 'signup', email: 'down503@gmail.com' });
  check('real client: service down reads as unreachable', describeResendError(resentDown.error) === AUTH_COPY.unreachable);

  // forgot password
  const resetUrl = 'https://darkphillipino.github.io/tutorlage-beta/reset-password';
  const asked = await client.auth.resetPasswordForEmail('pat@gmail.com', { redirectTo: resetUrl });
  const recoverCall = fake.calls.filter((c) => c.path === '/auth/v1/recover').at(-1);
  check('real client: reset request succeeds', asked.error === null && resetRequestOutcome(asked.error) === 'neutral');
  check('reset request carries the /reset-password return address', recoverCall?.query.redirect_to === resetUrl && recoverCall?.body.email === 'pat@gmail.com', `redirect_to=${recoverCall?.query.redirect_to}`);
  const askedSoon = await client.auth.resetPasswordForEmail('toosoon@gmail.com');
  check('real client: a 429 on reset still shows the neutral message', askedSoon.error?.status === 429 && resetRequestOutcome(askedSoon.error) === 'neutral');
  const askedFail = await client.auth.resetPasswordForEmail('smtpfail@gmail.com');
  check('real client: a 500 on reset (account exists, mail failed) still shows the neutral message', askedFail.error?.status === 500 && resetRequestOutcome(askedFail.error) === 'neutral');
  const askedDown = await client.auth.resetPasswordForEmail('down503@gmail.com');
  check('real client: service down on reset is reported as unreachable', resetRequestOutcome(askedDown.error) === 'unreachable');

  // no server at all
  const dead = deadUrl();
  const offlineClient = newClient(dead);
  const askedOffline = await offlineClient.auth.resetPasswordForEmail('pat@gmail.com');
  check('real client: nothing listening gives an unreachable error', resetRequestOutcome(askedOffline.error) === 'unreachable' && isServiceUnreachable(askedOffline.error), `name=${askedOffline.error?.name} status=${askedOffline.error?.status}`);
  const resentOffline = await offlineClient.auth.resend({ type: 'signup', email: 'pat@gmail.com' });
  check('real client: nothing listening on resend says so', describeResendError(resentOffline.error) === AUTH_COPY.unreachable);

  // set a new password, from a reset session
  const session = await client.auth.setSession({ access_token: fakeAccessToken(), refresh_token: 'fake-refresh' });
  check('real client: a reset session can be set', session.error === null && session.data.session !== null, session.error?.message ?? '');
  const sameResult = await client.auth.updateUser({ password: 'samepassword1' });
  check('real client: same password gives same_password', sameResult.error?.code === 'same_password' && JSON.stringify(describeUpdatePasswordError(sameResult.error)) === JSON.stringify({ kind: 'message', text: AUTH_COPY.samePassword }));
  const weakResult = await client.auth.updateUser({ password: 'short' });
  check('real client: a server-side weak password shows its own words', weakResult.error?.code === 'weak_password' && describeUpdatePasswordError(weakResult.error).kind === 'message', `code=${weakResult.error?.code}`);
  const goodResult = await client.auth.updateUser({ password: 'a-new-password-1' });
  const putCall = fake.calls.filter((c) => c.method === 'PUT' && c.path === '/auth/v1/user').at(-1);
  check('real client: a good new password is accepted', goodResult.error === null && putCall?.body.password === 'a-new-password-1');
  fake.revokeSessions = true;
  const goneResult = await client.auth.updateUser({ password: 'a-new-password-2' });
  check('real client: a dead reset session reads as an expired link', describeUpdatePasswordError(goneResult.error).kind === 'link_expired', `name=${goneResult.error?.name} code=${goneResult.error?.code} status=${goneResult.error?.status}`);

  // ---- A reset address read by real supabase-js the way a browser would read it ---------------------------------------
  // Review finding: a signed-in person could be shown "Set a new password" by an address like
  // /reset-password#type=recovery&access_token=junk, because the address alone was trusted. Here supabase-js reads such an
  // address (a pretend `window`, nothing else) and the verdict is judged on what it reports.
  type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
  const memoryStore = (): Store => {
    const map = new Map<string, string>();
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
  };
  let opened = 0;
  const signedInStore = (key: string): Store => {
    const store = memoryStore();
    store.setItem(
      key,
      JSON.stringify({
        access_token: fakeAccessToken('signedin@example.com'),
        refresh_token: 'own-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'user-1', aud: 'authenticated', email: 'signedin@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-10-10T08:00:00Z' },
      }),
    );
    return store;
  };
  // `signedIn`: the browser already holds a session of its own (kept under its own key, so no two clients share one).
  const openAt = async (hash: string, serverUrl: string, signedIn: boolean) => {
    const storageKey = `test-auth-${(opened += 1)}`;
    const storage = signedIn ? signedInStore(storageKey) : memoryStore();
    const g = globalThis as Record<string, unknown>;
    g.window = { location: { href: `http://localhost:3000/reset-password${hash}`, hash, search: '' }, addEventListener() {}, removeEventListener() {}, history: { replaceState() {} } };
    g.document = { visibilityState: 'hidden' };
    try {
      const browserClient = createClient(serverUrl, 'fake-publishable-key', {
        auth: { storage, storageKey, persistSession: true, autoRefreshToken: false },
      });
      const { error } = await browserClient.auth.initialize();
      const { data } = await browserClient.auth.getSession();
      const claimed = parseAuthRedirect(hash, '').isRecovery;
      return { error, session: data.session, claimed, verdict: judgeRecoveryLink(claimed, error, false) };
    } finally {
      delete g.window;
      delete g.document;
    }
  };
  const ownToken = fakeAccessToken('signedin@example.com');
  const tail = '&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery';

  const forged = await openAt(`#access_token=junk${tail}`, fake.url, true);
  check('forged address (junk token) while signed in: the address claims a reset', forged.claimed);
  check('... supabase-js reports an error and keeps the person\'s own session', forged.error !== null && forged.session?.access_token === ownToken, `error=${forged.error?.name}/${forged.error?.code}/${forged.error?.status}`);
  check('... so the verdict is "not a reset link" (the page says expired, never the form)', forged.verdict === 'not-a-reset-link');
  const forgedBare = await openAt('#type=recovery&access_token=x', fake.url, true);
  check('forged address with only type and a token, while signed in: not a reset link, still signed in', forgedBare.claimed && forgedBare.verdict === 'not-a-reset-link' && forgedBare.session?.access_token === ownToken, `error=${forgedBare.error?.name}`);

  const goodToken = fakeAccessToken('real.owner@example.com');
  const good = await openAt(`#access_token=${goodToken}${tail}`, fake.url, false);
  check('a real link (token the server accepts), signed out: confirmed, with the link\'s session saved', good.error === null && good.verdict === 'confirmed' && good.session?.access_token === goodToken, `error=${good.error?.name}`);
  const goodWhileSignedIn = await openAt(`#access_token=${goodToken}${tail}`, fake.url, true);
  check('a real link opened by someone already signed in: confirmed, and the link\'s session replaces theirs', goodWhileSignedIn.verdict === 'confirmed' && goodWhileSignedIn.session?.access_token === goodToken);

  const noNetwork = await openAt(`#access_token=${goodToken}${tail}`, deadUrl(), false);
  check('a real link while Supabase cannot be reached: "could not check", not "expired"', noNetwork.error !== null && noNetwork.verdict === 'could-not-check', `error=${noNetwork.error?.name}/${noNetwork.error?.status}`);
  check('... and the person\'s link is not used up (supabase-js left no session behind either)', noNetwork.session === null);
  const noNetworkSignedIn = await openAt(`#access_token=${goodToken}${tail}`, deadUrl(), true);
  check('... also for someone already signed in: "could not check", own session kept', noNetworkSignedIn.verdict === 'could-not-check' && noNetworkSignedIn.session?.access_token === ownToken);

  await fake.close();

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

// An address on this machine with nothing listening on it.
function deadUrl(): string {
  return 'http://127.0.0.1:9';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
