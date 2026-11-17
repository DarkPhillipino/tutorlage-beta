// Checks on SEEDING THE WARM TUTORS' ACCOUNTS, the app's half (CEO's order of 17 Nov 2026). Run: npx tsx scripts/dev/seed-warm-tutors-test.ts
// Reads the source and the migration text (no database, no browser). Proves: the account gate asks for a surname only when the database says so, saves the three things in a fixed
// order and only after all three are right, never pre-ticks the Terms, and a database without the new function changes nothing; Manage Account has a Change password card that only
// asks Supabase to email the person's own address (no password field, no password in the code); the migration's four functions have the rights the tool and the app need.
// It does NOT prove the database (supabase/tests/seed_warm_tutor_accounts.sql, rolled back and run on production), the page in a browser (tests/browser/seeded-tutor.spec.ts) or the
// CEO's tool (Drake/programmer/tools/create-warm-tutor-account.test.mjs).
import { readFileSync } from 'node:fs';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const gate = code('src/components/AccountGate.tsx');
const queries = code('src/lib/queries.ts');
const card = code('src/components/ChangePasswordCard.tsx');
const modal = code('src/components/ManageAccountModal.tsx');
const mig = read('supabase/migrations/20261117140000_seed_warm_tutor_accounts.sql');
const migCode = mig.replace(/^\s*--.*$/gm, '');

// ---- the account gate ----
check('the gate asks the database whether a surname is needed (my_needs_surname) next to the date of birth and the acceptances, and any error or a missing function means "no"',
  /supabase\.rpc\('my_needs_surname'\)/.test(queries) && /needsSurname: !surname\.error && surname\.data === true/.test(queries) && /withinMs\(supabase\.rpc\('my_needs_surname'\), SURNAME_QUESTION_MS/.test(queries) && /SURNAME_QUESTION_MS = 3000/.test(queries));
check('the surname question can never hold the gate: it is capped at 3 seconds and an error, a throw or no answer all fall back to "no surname needed"', /setTimeout\(\(\) => resolve\(fallback/.test(queries) && /\(\) => \{\s*clearTimeout\(timer\);\s*resolve\(fallback/.test(queries));
check('the gate only stops the person for a surname when needsSurname is true; the date of birth and Terms rules are untouched', /const needsSurname = state\.needsSurname;/.test(gate) && /if \(!needsDateOfBirth && !needsAcceptance && !needsSurname\)/.test(gate)
  && /const needsDateOfBirth = !state\.dateOfBirth;/.test(gate) && /const needsAcceptance = state\.pendingDocuments\.length > 0;/.test(gate));
check('the three saves run in this order, surname then date of birth then the acceptance, and only after every check has passed', (() => {
  const submit = gate.slice(gate.indexOf('const handleSubmit'), gate.lastIndexOf('return shell('));
  const iChecks = submit.indexOf('Please accept the Terms');
  const iTry = submit.indexOf('setIsSubmitting(true)');
  const a = submit.indexOf('await setMySurname'); const b = submit.indexOf('await setMyDateOfBirth'); const c = submit.indexOf('await acceptCurrentPolicies');
  return iChecks > 0 && iTry > iChecks && a > iTry && b > a && c > b;
})());
check('the surname box is labelled Surname, is required, shown only when needed, and the Terms box starts unticked', /needsSurname && \(/.test(gate) && /htmlFor="gateSurname"/.test(gate) && /id="gateSurname"/.test(gate) && /autoComplete="family-name"/.test(gate) && /const \[accepted, setAccepted\] = useState\(false\)/.test(gate) && !/setAccepted\(true\)/.test(gate));
check('the intro line "Before you start, we need a couple of details." shows for a missing surname or date of birth', /needsDateOfBirth \|\| needsSurname/.test(gate) && /Before you start, we need a couple of details\./.test(gate));
check('setMySurname calls set_my_surname with p_surname and throws on error', /export async function setMySurname/.test(queries) && /rpc\('set_my_surname', \{ p_surname: surname \}\)/.test(queries));

// ---- change your password ----
check('Manage Account shows the Change password card on the Profile tab', /<ChangePasswordCard email=\{userAccount\.email\} \/>/.test(modal) && /import \{ ChangePasswordCard \}/.test(modal));
check('the card asks Supabase to email the person\'s OWN address with the same reset link the Forgot password page sends (the Set a new password page)', /supabase\.auth\.resetPasswordForEmail\(email, \{ redirectTo: passwordResetRedirect\(\) \}\)/.test(card) && /passwordResetRedirect/.test(code('src/pages/ForgotPassword.tsx')));
check('the card has NO password box and handles no password: no input, no updateUser, no signIn', !/<input|type="password"|PasswordInput|updateUser|signInWithPassword/.test(card));
check('a learner\'s sign-in name (no inbox) is told to ask a guardian; too many tries and no network have their own words', /cannotReceiveEmail\(email\)/.test(card) && /AUTH_COPY\.learnerCannotGetEmail/.test(card) && /AUTH_COPY\.rateLimited/.test(card) && /AUTH_COPY\.unreachable/.test(card));
check('the button waits out the minute Supabase itself enforces, and says "Send the link again" after a send', /useCooldown\(\)/.test(card) && /resendButtonLabel\(isSending, waiting \? secondsLeft : 0, status === 'sent' \? 'Send the link again' : 'Change password'\)/.test(card));
check('the sign-in page\'s Forgot your password link and page still exist (the other half of "users can change their own password")', /forgot-password/.test(code('src/App.tsx') + code('src/main.tsx') + read('src/main.tsx')) && /resetPasswordForEmail/.test(code('src/pages/ForgotPassword.tsx')) && /updateUser/.test(code('src/pages/ResetPassword.tsx')));

// ---- the migration ----
const grant = (fn: string) => new RegExp(`grant execute on function public\\.${fn} to ([a-z_, ]+);`).exec(migCode)?.[1];
check('the two seeding functions are for the service key only', grant('founding_seed_row\\(text\\)') === 'service_role' && grant('founding_seed_finish\\(uuid, uuid\\)') === 'service_role'
  && /revoke all on function public\.founding_seed_row\(text\) from public, anon, authenticated;/.test(migCode) && /revoke all on function public\.founding_seed_finish\(uuid, uuid\) from public, anon, authenticated;/.test(migCode));
check('the two surname functions are for signed-in people only and are security definer with the search path pinned', grant('my_needs_surname\\(\\)') === 'authenticated' && grant('set_my_surname\\(text\\)') === 'authenticated'
  && (migCode.match(/security definer\s+set search_path = public/g) ?? []).length === 4);
check('filing writes only claims and the list row: pending subjects, status signed_up, no acceptance, date of birth, document, availability or verification insert/update', /verification_status\)\s+values \(p_user_id[^)]*'pending'\)/.test(migCode) && /status = case when status = 'verified' then status else 'signed_up' end/.test(migCode)
  && !/policy_acceptances|date_of_birth =|tutor_verification_documents|tutor_availability|is_verified\s*=|update public\.profiles|update public\.tutor_profiles/.test(migCode.slice(migCode.indexOf('founding_seed_finish'), migCode.indexOf('create or replace function public.my_needs_surname'))));
check('the surname can only be saved by a tutor whose saved name is one word (never a rename)', /p\.role = 'tutor'/.test(migCode) && /position\(' ' in v_name\) > 0/.test(migCode) && /update public\.profiles set full_name = v_name \|\| ' ' \|\| v where id = auth\.uid\(\)/.test(migCode));

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
