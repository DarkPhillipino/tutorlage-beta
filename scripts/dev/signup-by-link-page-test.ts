// Checks on the PAGE's half of the one-step tutor sign-up (job T, 18 Nov 2026). Run: npx tsx scripts/dev/signup-by-link-page-test.ts
// Proves, with a fake fetch and by reading the source: the check sends only the token to the Worker's own route, and any doubt (no token, a failing or slow Worker, a 404 from a Worker
// without the route, an odd answer, "not available") is "no one-step", so the ordinary sign-up shows; the create sends only the token, the password and the two version words; a link the
// Worker will not use falls back to the ordinary form with a plain note; real refusals are shown in the Worker's own words; the one-step page shows the row's email with "Is this the right
// email?" and a way to change details, never pre-ticks the Terms, and signs the person in only after the Worker said ok; the ordinary form is untouched when the one-step is not shown.
// It does NOT prove the Worker (signup-by-link-test.ts), the database, or the page in a browser (tests/browser/signup-by-link.spec.ts).
import { readFileSync } from 'node:fs';
import { ONE_STEP_COPY, checkSignupLink, createAccountByLink, parseLinkCheck } from '../../src/lib/signupByLink';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const urlFor = (path: string): string => `https://api.example.invalid${path}`;
const TOK = '0123456789abcdef0123456789abcdef';
const GOOD = { available: true, firstName: 'Thandi', surname: 'Nkosi', email: 'thandi@example.invalid', phone: '0821234567', dateOfBirth: '1995-03-02' };

type Reply = { ok: boolean; status: number; json(): Promise<unknown> };
function fake(reply: { status?: number; body?: unknown } | 'throw' | 'badjson' | 'hang') {
  const calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const fetchFn = async (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }): Promise<Reply> => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (reply === 'throw') throw new TypeError('Failed to fetch');
    if (reply === 'hang') return new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const status = reply === 'badjson' ? 200 : reply.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => { if (reply === 'badjson') throw new Error('not json'); return reply.body; } };
  };
  return { fetchFn, calls };
}

async function main() {
  // ---- the check ----
  const g = fake({ body: GOOD });
  const d = await checkSignupLink(TOK, urlFor, g.fetchFn);
  check('check: one POST to our own Worker route with ONLY the token in the body and no credentials', g.calls.length === 1 && g.calls[0].url.endsWith('/api/signup/tutor-by-link/check') && g.calls[0].method === 'POST' && g.calls[0].body === JSON.stringify({ token: TOK }) && Object.keys(g.calls[0].headers).join() === 'Content-Type', JSON.stringify(g.calls));
  check('check: the details come back safe for the page', d?.firstName === 'Thandi' && d.surname === 'Nkosi' && d.email === 'thandi@example.invalid' && d.phone === '0821234567' && d.dateOfBirth === '1995-03-02');
  check('check: no token means no call at all', (await checkSignupLink(null, urlFor, g.fetchFn)) === null && g.calls.length === 1);
  for (const [name, r] of [['"not available"', { body: { available: false } }], ['a 404 from a Worker without the route', { status: 404, body: { error: 'x' } }], ['a 500', { status: 500, body: {} }], ['a 429', { status: 429, body: {} }], ['a network failure', 'throw'], ['an answer that is not JSON', 'badjson'], ['an empty answer', { body: null }], ['an answer without a date of birth', { body: { ...GOOD, dateOfBirth: '' } }], ['an answer without a surname', { body: { ...GOOD, surname: '' } }], ['a bad date of birth', { body: { ...GOOD, dateOfBirth: 'yesterday' } }], ['available as the text "true"', { body: { ...GOOD, available: 'true' } }]] as const) {
    check(`check: ${name} is "no one-step": null, never a throw`, (await checkSignupLink(TOK, urlFor, fake(r).fetchFn)) === null);
  }
  const t0 = Date.now();
  const slow = await checkSignupLink(TOK, urlFor, fake('hang').fetchFn);
  check('check: a Worker that never answers is given up on after a few seconds (null)', slow === null && Date.now() - t0 >= 3500 && Date.now() - t0 < 8000, String(Date.now() - t0));
  check('parseLinkCheck trims and cuts over-long text', parseLinkCheck({ ...GOOD, firstName: '  ' + 'a'.repeat(80) + ' ' })?.firstName.length === 50);

  // ---- the create ----
  const ok = fake({ body: { ok: true, email: GOOD.email } });
  const made = await createAccountByLink({ token: TOK, password: 'correct horse battery', termsVersion: '2026-11-17', privacyVersion: '2026-11-17' }, urlFor, ok.fetchFn);
  check('create: one POST with ONLY the token, the password and the two version words', made.ok === true && ok.calls.length === 1 && ok.calls[0].url.endsWith('/api/signup/tutor-by-link') && JSON.stringify(JSON.parse(ok.calls[0].body)) === JSON.stringify({ token: TOK, password: 'correct horse battery', acceptedTermsVersion: '2026-11-17', acceptedPrivacyVersion: '2026-11-17' }));
  const nov = fake({ body: { ok: true } });
  await createAccountByLink({ token: TOK, password: 'correct horse battery', termsVersion: null, privacyVersion: null }, urlFor, nov.fetchFn);
  check('create: versions the page could not load are simply not sent (no empty words)', !('acceptedTermsVersion' in JSON.parse(nov.calls[0].body)) && !('acceptedPrivacyVersion' in JSON.parse(nov.calls[0].body)));
  const args = { token: TOK, password: 'correct horse battery', termsVersion: '2026-11-17', privacyVersion: '2026-11-17' };
  for (const [name, r] of [['a 409 "unavailable"', { status: 409, body: { code: 'unavailable', error: 'x' } }], ['a Worker without the route (404)', { status: 404, body: {} }], ['a network failure', 'throw']] as const) {
    const out = await createAccountByLink(args, urlFor, fake(r).fetchFn);
    check(`create: ${name} falls back to the ordinary form with a plain note about the confirmation email`, out.ok === false && out.kind === 'fallback' && /confirmation email/.test(out.message), JSON.stringify(out));
  }
  const weak = await createAccountByLink(args, urlFor, fake({ status: 422, body: { code: 'weak_password', error: 'That password is too easy to guess.' } }).fetchFn);
  const exists = await createAccountByLink(args, urlFor, fake({ status: 409, body: { code: 'exists', error: 'An account already exists for this email. Sign in, or reset your password.' } }).fetchFn);
  const vers = await createAccountByLink(args, urlFor, fake({ status: 409, body: { code: 'versions_changed', error: 'The Terms or the Privacy Policy changed while this page was open. Reload the page and accept them again.' } }).fetchFn);
  const failedAns = await createAccountByLink(args, urlFor, fake({ status: 500, body: { code: 'failed' } }).fetchFn);
  const limited = await createAccountByLink(args, urlFor, fake({ status: 429, body: { error: 'Too many requests — please slow down and try again shortly.' } }).fetchFn);
  check('create: real refusals are shown in the Worker\'s own words and keep the one-step page (kind error)', weak.ok === false && weak.kind === 'error' && weak.message === 'That password is too easy to guess.' && exists.ok === false && exists.kind === 'error' && /already exists/.test(exists.message) && vers.ok === false && vers.kind === 'error' && /Reload/.test(vers.message));
  check('create: an answer with no sentence gets a plain "try again" sentence, and a rate limit gets its own plain sentence', failedAns.ok === false && failedAns.kind === 'error' && /try again/i.test(failedAns.message) && limited.ok === false && limited.kind === 'error' && /wait a minute/.test(limited.message));
  const odd = await createAccountByLink(args, urlFor, fake({ status: 200, body: { ok: 'yes' } }).fetchFn);
  check('create: a 200 that does not say ok: true is not a success', odd.ok === false);

  // ---- the page, by reading the source ----
  const page = code('src/pages/CreateAccount.tsx');
  const form = code('src/components/LinkSignupForm.tsx');
  const lib = code('src/lib/signupByLink.ts');
  check('the page asks the Worker only for a TUTOR link (the token is read only for the tutor role) and shows the one-step form only when the Worker said yes and the person has not chosen the full form',
    /const prefillToken = role === 'tutor' \?/.test(page) && /checkSignupLink\(prefillToken, apiUrl\)/.test(page) && /const showOneStep = role === 'tutor' && !!prefillToken && !!oneStep && !useFullForm;/.test(page));
  check('the ordinary form, its error box, its notes and the Google button are drawn exactly when the one-step is not shown (nothing else about them changed)',
    /\{!showOneStep && \(\s*<form onSubmit=\{handleSubmit\}/.test(page) && /\{!showOneStep && error && \(/.test(page) && /\{!showOneStep && FEATURES\.googleSignIn && \(/.test(page) && /\{!showOneStep && prefilled && \(/.test(page));
  check('the ordinary submit still calls the browser sign-up (supabase.auth.signUp) and the page never creates an account any other way itself', /supabase\.auth\.signUp\(/.test(page) && !/tutor-by-link|createAccountByLink/.test(page));
  check('"No, change my details" and any fallback hand over to the ordinary form with the row\'s details filled in (a typed box is kept) and say why', /onUseFullForm=\{\(message\) =>/.test(page) && /setFirstName\(\(v\) => v \|\| oneStep\.firstName\)/.test(page) && /setEmail\(\(v\) => v \|\| oneStep\.email\)/.test(page) && /setDateOfBirth\(\(v\) => v \|\| oneStep\.dateOfBirth\)/.test(page) && /data-switch-note/.test(page));
  check('the one-step form shows the email from the row with "Is this the right email?" and a way to change it, and the details it will use', form.includes('ONE_STEP_COPY.emailQuestion') && form.includes('ONE_STEP_COPY.changeDetails') && /data-link-email/.test(form) && /details\.firstName/.test(form) && /details\.dateOfBirth/.test(form));
  check('the Terms tick starts unticked and the account is not created without it or without a matching password (the same rule as the ordinary form)', /useState\(false\)/.test(form) && /const \[accepted, setAccepted\] = useState\(false\)/.test(form) && /validateNewPassword\(password, confirmPassword\)/.test(form) && /if \(!accepted\)/.test(form) && !/checked(=\{true\}| )/.test(form.replace(/checked=\{accepted\}/g, '')));
  check('the person is signed in only after the Worker said ok, with the ROW\'s email and the password just chosen; if that sign-in fails they are told the account is ready and sent to sign in', /made\.ok === false/.test(form) && form.indexOf('signInWithPassword') > form.indexOf('made.ok === false') && /signInWithPassword\(\{ email: details\.email, password \}\)/.test(form) && /setMadeButNotSignedIn\(true\)/.test(form) && ONE_STEP_COPY.readyBody.includes('could not sign you in'));
  check('nothing about the person is put in an address, and the token and password only travel in the body of a POST to our own Worker', !/navigate\([^)]*(token|password|email)/i.test(form) && !/location\.(href|search)\s*=/.test(form + lib) && /method: 'POST'/.test(lib) && !/\?token=|[?&]password=/.test(lib));
  check('the page never logs a token or a password', !/console\.(log|error|warn)\([^)]*(token|password)/i.test(form + lib + page));

  if (failed > 0) {
    console.log(`\n${failed} FAILED`);
    process.exit(1);
  }
  console.log('\nall ok');
}
void main();
