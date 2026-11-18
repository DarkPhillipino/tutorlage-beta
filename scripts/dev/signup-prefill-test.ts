// Checks on the PRE-FILLED TUTOR SIGN-UP, the page's half (CEO's order of 17 Nov 2026: "the waiting list is the first stage of sign-up"). Run: npx tsx scripts/dev/signup-prefill-test.ts
// Proves, with a fake database client and by reading the source: the token is read only from ?k= and only when it is 32 hex characters; the one database call takes only the token;
// the answer is made safe for the boxes (no usable field = no pre-fill; a bad date of birth is dropped); a box the person already typed in is never overwritten; any failure (no token,
// an error, a throw, a null answer) is "no pre-fill"; the sign-up page uses it for the TUTOR form only, never ticks anything, shows no error, and puts nothing about the person in an
// address. It does NOT prove the database (supabase/tests/founding_signup_prefill.sql, rolled back and run on production) or the page in a browser (tests/browser/signup-prefill.spec.ts).
import { readFileSync } from 'node:fs';
import { fetchSignupPrefill, fillEmptyBoxes, parseSignupPrefill, signupTokenFromSearch, PREFILL_EMAIL_HINT, PREFILL_NOTICE, type PrefillClient, type SignupBoxes } from '../../src/lib/signupPrefill';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TOK = '0123456789abcdef0123456789abcdef';
const GOOD = { first_name: 'Thandi', surname: 'Nkosi', email: 'thandi@example.invalid', phone: '0821234567', date_of_birth: '1995-03-02' };

function fake(answer: { data?: unknown; error?: unknown } | 'throw') {
  const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const db: PrefillClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (answer === 'throw') throw new Error('Failed to fetch');
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  };
  return { db, calls };
}

async function main() {
  // ---- the token in the address ----
  check('?k=<32 hex> is the token; capitals are lowered; the other words in the address are ignored', signupTokenFromSearch(`?k=${TOK}`) === TOK && signupTokenFromSearch(`?src=f1&k=${TOK.toUpperCase()}`) === TOK && signupTokenFromSearch(`?k=${TOK}&src=f1-n1`) === TOK);
  check('nothing, a short or long token, non-hex letters, an email, a name and a SQL try are no token', ['', '?k=', `?k=${TOK.slice(1)}`, `?k=${TOK}0`, `?k=${'z'.repeat(32)}`, '?k=thandi%40example.invalid', '?k=Thandi', "?k=' or true --", '?kk=' + TOK, `?K=${TOK}`].every((s) => signupTokenFromSearch(s) === null));
  check('a broken search string never throws', signupTokenFromSearch('%E0%A4%A') === null);

  // ---- the one call ----
  const ok = fake({ data: GOOD });
  const got = await fetchSignupPrefill(ok.db, TOK);
  check('with a token it makes exactly one call, founding_signup_prefill, with exactly one argument (p_token) and nothing else', ok.calls.length === 1 && ok.calls[0].fn === 'founding_signup_prefill' && Object.keys(ok.calls[0].args ?? {}).join() === 'p_token' && ok.calls[0].args?.p_token === TOK);
  check('the answer becomes the five boxes\' values', JSON.stringify(got) === JSON.stringify({ firstName: 'Thandi', surname: 'Nkosi', email: 'thandi@example.invalid', phone: '0821234567', dateOfBirth: '1995-03-02' }));
  const none = fake({ data: GOOD });
  check('with no token it makes NO call at all (the plain sign-up page asks the database nothing)', (await fetchSignupPrefill(none.db, null)) === null && none.calls.length === 0);

  // ---- every doubt is "no pre-fill", never an error ----
  check('a null answer (a bad, used or unknown token, or too many tries) is no pre-fill', (await fetchSignupPrefill(fake({ data: null }).db, TOK)) === null);
  check('a database error is no pre-fill and does not throw', (await fetchSignupPrefill(fake({ error: { code: 'PGRST202', message: 'Could not find the function' } }).db, TOK)) === null);
  check('a thrown network error is no pre-fill and does not throw', (await fetchSignupPrefill(fake('throw').db, TOK)) === null);
  check('an answer with nothing usable (empty object, numbers, a string) is no pre-fill', [{}, { first_name: 5, email: null }, 'text', 12, [], [null], { first_name: '  ', surname: '' }].every((d) => parseSignupPrefill(d) === null));

  // ---- an older row: blank surname and date of birth, the rest filled ----
  const old = parseSignupPrefill({ first_name: 'Odi', surname: null, email: 'odi@example.invalid', phone: '0829876543', date_of_birth: null });
  check('AN OLDER ROW (joined before surname and date of birth were asked): those two stay empty, first name, email and phone are filled', old?.firstName === 'Odi' && old.surname === '' && old.dateOfBirth === '' && old.email === 'odi@example.invalid' && old.phone === '0829876543');
  check('a date of birth that is not a plausible date is dropped, the rest kept', parseSignupPrefill({ ...GOOD, date_of_birth: 'soon' })?.dateOfBirth === '' && parseSignupPrefill({ ...GOOD, date_of_birth: '1700-01-01' })?.dateOfBirth === '' && parseSignupPrefill({ ...GOOD, date_of_birth: '1995-03-02' })?.dateOfBirth === '1995-03-02');
  check('values are trimmed and cut to the boxes\' sizes; an array answer uses its first row', parseSignupPrefill({ ...GOOD, first_name: ` ${'x'.repeat(80)} ` })?.firstName === 'x'.repeat(50) && parseSignupPrefill([GOOD])?.firstName === 'Thandi');

  // ---- what the form does with it ----
  const empty: SignupBoxes = { firstName: '', surname: '', email: '', phoneNumber: '', dateOfBirth: '' };
  const filled = fillEmptyBoxes(empty, got!);
  check('empty boxes are filled from the list', filled.firstName === 'Thandi' && filled.surname === 'Nkosi' && filled.email === 'thandi@example.invalid' && filled.phoneNumber === '0821234567' && filled.dateOfBirth === '1995-03-02');
  const typed = fillEmptyBoxes({ ...empty, firstName: 'Thandiwe', email: 'mine@example.invalid' }, got!);
  check('a box the person has already typed in is NEVER overwritten (the answer can arrive late)', typed.firstName === 'Thandiwe' && typed.email === 'mine@example.invalid' && typed.surname === 'Nkosi');
  const page = code('src/pages/CreateAccount.tsx');
  check('the sign-up page pre-fills the TUTOR form only (no token is read for learners or parents), by the functional setters that only fill an empty box', /role === 'tutor' \? signupTokenFromSearch\(search\) : null/.test(page)
    && /setFirstName\(\(v\) => v \|\| p\.firstName\)/.test(page) && /setSurname\(\(v\) => v \|\| p\.surname\)/.test(page) && /setEmail\(\(v\) => v \|\| p\.email\)/.test(page) && /setPhoneNumber\(\(v\) => v \|\| p\.phone\)/.test(page) && /setDateOfBirth\(\(v\) => v \|\| p\.dateOfBirth\)/.test(page));
  const rawPage = read('src/pages/CreateAccount.tsx');
  const block = rawPage.slice(rawPage.indexOf('THE WAITING LIST IS THE FIRST STAGE'), rawPage.indexOf('// The versions the checkbox accepts'));
  check('NOTHING IS TICKED FOR THEM: the Terms box still starts unticked, and the pre-fill block never sets it or the password boxes', block.length > 400 && /const \[accepted, setAccepted\] = useState\(false\)/.test(page) && !/setAccepted|setPassword|setConfirmPassword|setPromoCode|setError/.test(block) && !/setAccepted\(true\)|checked=\{true\}/.test(page));
  check('a failed or empty pre-fill shows nothing: the only message is drawn when a pre-fill happened, and it is not an error', /\{!showOneStep && prefilled && \(/.test(page) && !/setError\([^)]*[Pp]refill/.test(page) && /data-prefilled="true"/.test(page));
  check('the words: the notice says to check the details, choose a password and accept the Terms; the email hint says to use the same one; neither says "free"', /Check them, choose a password and accept the Terms and Privacy Policy/.test(PREFILL_NOTICE) && /same one/.test(PREFILL_EMAIL_HINT) && !/\bfree\b/i.test(PREFILL_NOTICE + PREFILL_EMAIL_HINT));
  const lib = code('src/lib/signupPrefill.ts');
  check('the pre-fill never puts anything about the person in an address, a log or storage: no history, storage, console or error-log call in its file or the page\'s pre-fill block', !/history\.|localStorage|sessionStorage|console\.|logClientError|document\.cookie/.test(lib)
    && !/history\.|localStorage|sessionStorage|console\.|logClientError/.test(block));
  check('the sign-up page without a link is unchanged: the pre-fill block is skipped when there is no token (the effect returns first)', /if \(!prefillToken\) return undefined;/.test(page));
  const NEW = read('supabase/migrations/20261117090000_founding_signup_prefill.sql');
  const fn = NEW.slice(NEW.indexOf('create or replace function public.founding_signup_prefill'), NEW.indexOf('revoke all on function public.founding_signup_prefill'));
  check('the database call answers only the five fields the form uses (first_name, surname, email, phone, date_of_birth) and the page reads exactly those', ['first_name', 'surname', 'email', 'phone', 'date_of_birth'].every((k) => fn.includes(`'${k}'`) && read('src/lib/signupPrefill.ts').includes(`d.${k}`))
    && !/'status'|'admin_note'|'subjects'|'src'|'user_id'|'id'/.test(fn.slice(fn.indexOf('return jsonb_build_object'))));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
