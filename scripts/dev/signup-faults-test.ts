// Checks on describeSignUpFault (src/lib/authHelpers.ts, burst-readiness 4 Nov 2026). Run:  npx tsx scripts/dev/signup-faults-test.ts
// Proves: the 1 Nov fault ("Error sending confirmation email", status 500) and the project's hourly email cap become plain sentences AND are marked for the
// error log; the 60-second window and an offline visitor are plain but NOT logged; a person's own mistake (weak password, the age-rule database error, an
// existing account) is left alone; the sign-up page uses it and writes a logged fault through logClientError (which scrubs any email address).
import fs from 'node:fs';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { AUTH_COPY, describeSignUpFault } from '../../src/lib/authHelpers';
import { buildReport } from '../../src/lib/errorLog';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

// The 1 Nov 2026 fault: the SMTP login was refused, so Supabase answered 500 "Error sending confirmation email".
const mailFault = describeSignUpFault(new AuthApiError('Error sending confirmation email', 500, 'unexpected_failure'));
check('"Error sending confirmation email" (500) is a plain sentence and is logged', mailFault?.text === AUTH_COPY.signUpEmailFailed && mailFault.log === true, JSON.stringify(mailFault));

const hourlyCap = describeSignUpFault(new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'));
check('the project hourly email cap says people are signing up and is logged', hourlyCap?.text === AUTH_COPY.signUpBusy && hourlyCap.log === true, JSON.stringify(hourlyCap));

const oneMinute = describeSignUpFault(new AuthApiError('For security purposes, you can only request this after 41 seconds.', 429, 'over_email_send_rate_limit'));
check('the 60-second window for one address is plain and NOT logged (one person pressing twice)', oneMinute?.text === AUTH_COPY.resendTooSoon && oneMinute.log === false, JSON.stringify(oneMinute));

const offline = describeSignUpFault(new AuthRetryableFetchError('Failed to fetch', 0));
check('an offline visitor gets the connection sentence and is NOT logged', offline?.text === AUTH_COPY.unreachable && offline.log === false, JSON.stringify(offline));

const gateway = describeSignUpFault(new AuthRetryableFetchError('Bad gateway', 502));
check('a gateway error (502) is our side: plain sentence and logged', gateway?.log === true && gateway.text === AUTH_COPY.signUpEmailFailed, JSON.stringify(gateway));

check('a server fault with other words (500) is logged too', describeSignUpFault(new AuthApiError('Something went wrong', 500, 'unexpected_failure'))?.log === true);
check('the age-rule database error is left to the sign-up page (null)', describeSignUpFault(new AuthApiError('Database error saving new user', 500, 'unexpected_failure')) === null);
check('a weak password (422) is left alone (null)', describeSignUpFault(new AuthApiError('Password should be at least 6 characters.', 422, 'weak_password')) === null);
check('an already-registered address (422) is left alone (null)', describeSignUpFault(new AuthApiError('User already registered', 422, 'user_already_exists')) === null);
check('something that is not an error object never throws', describeSignUpFault(null) === null && describeSignUpFault('x') === null && describeSignUpFault(undefined) === null);

// What reaches the log: the words, the sign-up address and no personal data.
const report = buildReport(new AuthApiError('Error sending confirmation email to thandiwe@example.com', 500, 'unexpected_failure'), 'logged', {}, { pathname: '/signup/tutor', userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' });
check('the logged report names the sign-up screen and has no email address', report.screen === '/signup/tutor' && /AuthApiError: Error sending confirmation email to \[email\]/.test(report.message) && !report.message.includes('thandiwe'), report.message);

// The page uses it.
const page = fs.readFileSync(new URL('../../src/pages/CreateAccount.tsx', import.meta.url), 'utf8');
check('the sign-up page asks describeSignUpFault and logs only when it says to', /describeSignUpFault\(signUpError\)/.test(page) && /if \(fault\?\.log\) logClientError\(signUpError, 'logged'\)/.test(page));
check('the sign-up page still words the age-rule database error itself', /database error/.test(page) && /must be 18 or older/.test(page));
check('the raw server message is only the last fallback', /fault\?\.text \?\? signUpError\.message/.test(page));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
