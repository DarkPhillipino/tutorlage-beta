// Checks on the WORKER half of "a personal sign-up link makes the tutor account already confirmed" (job T, 18 Nov 2026). Run: npx tsx scripts/dev/signup-by-link-test.ts
// Proves, with a fake database, a fake Auth and a fake mailer (no network, no key): the two routes take only the token, password and version words from the request; every detail of the account comes
// from the list row; Auth is asked for an already-confirmed account with the same metadata the sign-up form sends; "not available" for every doubt (switch off, used, lapsed, unknown); a stale
// page cannot record an old acceptance; weak and over-long passwords; an account that already exists; a refusal by the sign-up rules; the notice mail goes to the ROW's address and its failure never
// undoes the account; nothing secret is logged; and server/index.ts wires the two routes with their own limits. It does NOT prove the database (supabase/tests/founding_signup_resolve.sql) or
// Supabase Auth itself (the real run on production with a made-up row is a separate step).
import { readFileSync } from 'node:fs';
import { MSG, TOKEN_SHAPE, classifyCreateUserError, createSignupByLink, noticeMail, type CreateUserOutcome, type LinkRow, type SignupByLinkDeps } from '../../server/signupByLink';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}

const TOK = '0123456789abcdef0123456789abcdef';
const ROW: LinkRow = { rowId: 'row-1', firstName: 'Thandi', surname: 'Nkosi', email: 'thandi@example.invalid', phone: '0821234567', dateOfBirth: '1995-03-02' };
const PASSWORD = 'correct horse battery';

function harness(over: Partial<{ row: LinkRow | null; resolveThrows: boolean; versions: { terms: string; privacy: string } | null; create: CreateUserOutcome; createThrows: boolean; mail: { ok: boolean; waiting?: boolean; detail?: string } | 'throw' }> = {}) {
  const calls = { resolve: [] as { token: string; caller: string }[], create: [] as { email: string; password: string; metadata: Record<string, string> }[], mail: [] as { to: string; subject: string; text: string }[], logs: [] as string[], versions: 0 };
  const deps: SignupByLinkDeps = {
    resolve: async (token, caller) => {
      calls.resolve.push({ token, caller });
      if (over.resolveThrows) throw new Error('database down');
      return over.row === undefined ? ROW : over.row;
    },
    currentVersions: async () => {
      calls.versions += 1;
      return over.versions === undefined ? { terms: '2026-11-17', privacy: '2026-11-17' } : over.versions;
    },
    createUser: async (args) => {
      calls.create.push(args);
      if (over.createThrows) throw new Error('auth down');
      return over.create ?? { ok: true, userId: 'user-1' };
    },
    sendMail: async (m) => {
      calls.mail.push(m);
      if (over.mail === 'throw') throw new Error('mail down');
      return over.mail ?? { ok: true };
    },
    log: (l) => calls.logs.push(l),
  };
  return { s: createSignupByLink(deps), calls };
}
const GOOD_BODY = { token: TOK, password: PASSWORD, acceptedTermsVersion: '2026-11-17', acceptedPrivacyVersion: '2026-11-17' };

async function main() {
  // ---- check: what the page may learn ----
  {
    const h = harness();
    const r = await h.s.check({ token: TOK.toUpperCase() + ' ' }, 'ip:1.2.3.4');
    check('check: a good link answers the details from the row and the caller key goes to the database', r.status === 200 && r.body.available === true && r.body.email === ROW.email && r.body.firstName === 'Thandi' && r.body.surname === 'Nkosi' && r.body.phone === '0821234567' && r.body.dateOfBirth === '1995-03-02' && h.calls.resolve[0].token === TOK && h.calls.resolve[0].caller === 'ip:1.2.3.4', JSON.stringify(r));
    check('check: it answers only those five facts plus the flag (no row id, no token)', Object.keys(r.body).sort().join(',') === 'available,dateOfBirth,email,firstName,phone,surname');
    check('check: nothing is created and no mail is sent', h.calls.create.length === 0 && h.calls.mail.length === 0);
  }
  for (const [name, body] of [['no body', undefined], ['no token', {}], ['a short token', { token: TOK.slice(1) }], ['a non-hex token', { token: 'z'.repeat(32) }], ['an email as token', { token: 'a@b.co' }], ['a number', { token: 12345 }]] as const) {
    const h = harness();
    const r = await h.s.check(body, 'ip:x');
    check(`check: ${name} is "not available" and the database is not even asked`, r.status === 200 && r.body.available === false && h.calls.resolve.length === 0);
  }
  {
    const r1 = await harness({ row: null }).s.check({ token: TOK }, 'ip:x');
    const r2 = await harness({ resolveThrows: true }).s.check({ token: TOK }, 'ip:x');
    check('check: the database saying null (switch off, used, lapsed, unknown, incomplete) is "not available", never an error', r1.status === 200 && r1.body.available === false);
    check('check: the database failing is "not available" too, so the ordinary sign-up is used', r2.status === 200 && r2.body.available === false);
  }

  // ---- create: the happy path ----
  {
    const h = harness();
    const r = await h.s.create(GOOD_BODY, 'ip:1.2.3.4');
    check('create: a good request makes the account and answers ok with the ROW\'s email', r.status === 200 && r.body.ok === true && r.body.email === ROW.email, JSON.stringify(r));
    const c = h.calls.create[0];
    check('create: Auth gets the row\'s email, the typed password and the sign-up form\'s metadata, nothing else', c.email === ROW.email && c.password === PASSWORD
      && JSON.stringify(c.metadata) === JSON.stringify({ first_name: 'Thandi', surname: 'Nkosi', phone_number: '0821234567', role: 'tutor', date_of_birth: '1995-03-02', accepted_terms_version: '2026-11-17', accepted_privacy_version: '2026-11-17' }), JSON.stringify(c));
    check('create: the notice mail goes to the row\'s address, says what happened and what to do if it was not them, and holds no password and no token', h.calls.mail.length === 1 && h.calls.mail[0].to === ROW.email
      && /account was made/i.test(h.calls.mail[0].subject) && /support@tutorlage\.com/.test(h.calls.mail[0].text) && /Forgot your password/.test(h.calls.mail[0].text) && !h.calls.mail[0].text.includes(PASSWORD) && !h.calls.mail[0].text.includes(TOK));
    check('create: the log says an account was made and holds no token, password or email address', h.calls.logs.length >= 1 && h.calls.logs.every((l) => !l.includes(PASSWORD) && !l.includes(TOK) && !l.includes(ROW.email)), h.calls.logs.join(' | '));
  }
  // every detail from the row, none from the request
  {
    const h = harness();
    await h.s.create({ ...GOOD_BODY, email: 'someone.else@example.invalid', firstName: 'Mallory', first_name: 'Mallory', surname: 'X', phone: '0', dateOfBirth: '1900-01-01', date_of_birth: '1900-01-01', role: 'admin', email_confirm: false, user_metadata: { role: 'admin' } }, 'ip:x');
    const c = h.calls.create[0];
    check('create: an email, name, phone, date of birth, role or metadata in the request is ignored: they come from the row', c.email === ROW.email && c.metadata.first_name === 'Thandi' && c.metadata.surname === 'Nkosi' && c.metadata.phone_number === '0821234567' && c.metadata.date_of_birth === '1995-03-02' && c.metadata.role === 'tutor' && Object.keys(c.metadata).length === 7);
  }
  // no phone on the row; no versions sent
  {
    const h = harness({ row: { ...ROW, phone: null } });
    const r = await h.s.create({ token: TOK, password: PASSWORD }, 'ip:x');
    check('create: a row without a phone sends an empty phone; a page that could not load the versions sends none and the account gate asks again (no version in the metadata, the versions are not even read)', r.status === 200 && h.calls.create[0].metadata.phone_number === '' && !('accepted_terms_version' in h.calls.create[0].metadata) && h.calls.versions === 0);
  }

  // ---- create: the refusals ----
  for (const [name, body] of [['no token', { password: PASSWORD }], ['a bad token', { token: 'nope', password: PASSWORD }], ['no password', { token: TOK }], ['a numeric password', { token: TOK, password: 12345678 }], ['only one version word', { ...GOOD_BODY, acceptedPrivacyVersion: undefined }], ['a version word with a space and a quote', { ...GOOD_BODY, acceptedTermsVersion: "x' or 1=1" }], ['a body that is not an object', 'hello']] as const) {
    const h = harness();
    const r = await h.s.create(body, 'ip:x');
    check(`create: ${name} is 400 and nothing is looked up or made`, r.status === 400 && r.body.code === 'bad_request' && h.calls.resolve.length === 0 && h.calls.create.length === 0, JSON.stringify(r));
  }
  {
    const h = harness();
    const r = await h.s.create({ ...GOOD_BODY, password: '1234567' }, 'ip:x');
    const long = await harness().s.create({ ...GOOD_BODY, password: 'x'.repeat(73) }, 'ip:x');
    const edge = await harness().s.create({ ...GOOD_BODY, password: 'x'.repeat(72) }, 'ip:x');
    check('create: 7 characters is refused in plain words before anything is looked up; 73 is refused; 72 passes', r.status === 422 && r.body.error === MSG.passwordShort && h.calls.resolve.length === 0 && long.status === 422 && long.body.error === MSG.passwordLong && edge.status === 200);
  }
  {
    const h = harness({ row: null });
    const r = await h.s.create(GOOD_BODY, 'ip:x');
    check('create: a link the database does not accept (switch off, used, lapsed, unknown) is 409 "unavailable": the page then uses the ordinary sign-up; nothing is made, no mail', r.status === 409 && r.body.code === 'unavailable' && h.calls.create.length === 0 && h.calls.mail.length === 0);
    const t = await harness({ resolveThrows: true }).s.create(GOOD_BODY, 'ip:x');
    check('create: the database failing is the same "unavailable" answer, never a half-made account', t.status === 409 && t.body.code === 'unavailable');
  }
  {
    const h = harness({ versions: { terms: '2026-12-01', privacy: '2026-11-17' } });
    const r = await h.s.create(GOOD_BODY, 'ip:x');
    check('create: a stale page (the Terms changed since it loaded) cannot record the old acceptance: 409, nothing made', r.status === 409 && r.body.code === 'versions_changed' && h.calls.create.length === 0 && h.calls.resolve.length === 0);
    const n = await harness({ versions: null }).s.create(GOOD_BODY, 'ip:x');
    check('create: today\'s versions unreadable while the page sent some: 503, nothing made (the ordinary sign-up is the way)', n.status === 503 && n.body.code === 'failed');
  }
  for (const [label, outcome, status, code] of [['exists', { ok: false, kind: 'exists' }, 409, 'exists'], ['weak', { ok: false, kind: 'weak_password' }, 422, 'weak_password'], ['refused by the sign-up rules', { ok: false, kind: 'refused' }, 409, 'unavailable'], ['any other failure', { ok: false, kind: 'failed' }, 500, 'failed']] as const) {
    const h = harness({ create: outcome });
    const r = await h.s.create(GOOD_BODY, 'ip:x');
    check(`create: Auth answering "${label}" is ${status} ${code}, no notice mail`, r.status === status && r.body.code === code && h.calls.mail.length === 0, JSON.stringify(r));
  }
  {
    const r = await harness({ createThrows: true }).s.create(GOOD_BODY, 'ip:x');
    check('create: Auth throwing is a plain 500 sentence', r.status === 500 && r.body.error === MSG.failed);
  }
  {
    const w = harness({ mail: { ok: false, waiting: true } });
    const rw = await w.s.create(GOOD_BODY, 'ip:x');
    const t = harness({ mail: 'throw' });
    const rt = await t.s.create(GOOD_BODY, 'ip:x');
    check('create: no mail path set up, or the mailer throwing, never undoes the account (still ok), and it is logged without the address', rw.status === 200 && rt.status === 200 && w.calls.logs.some((l) => /notice mail was not sent/.test(l)) && t.calls.logs.some((l) => /notice mail was not sent/.test(l)) && [...w.calls.logs, ...t.calls.logs].every((l) => !l.includes(ROW.email)));
  }
  {
    const first = harness();
    const second = harness({ row: null });
    const a = await first.s.create(GOOD_BODY, 'ip:x');
    const b = await second.s.create(GOOD_BODY, 'ip:x');
    check('create: a second use of the same link (the database now answers null) makes nothing', a.status === 200 && b.status === 409 && second.calls.create.length === 0);
  }

  // ---- the Auth error mapping, with real-shaped errors ----
  check('Auth errors: email_exists / "already registered" is exists; weak_password is weak; "Database error creating new user" is refused; nothing is no outcome; anything else is failed',
    (classifyCreateUserError({ code: 'email_exists', status: 422, message: 'A user with this email address has already been registered' }) as { kind: string }).kind === 'exists'
    && (classifyCreateUserError({ message: 'A user with this email address has already been registered' }) as { kind: string }).kind === 'exists'
    && (classifyCreateUserError({ code: 'weak_password', status: 422, message: 'Password should be at least 8 characters' }) as { kind: string }).kind === 'weak_password'
    && (classifyCreateUserError({ status: 500, message: 'Database error creating new user' }) as { kind: string }).kind === 'refused'
    && classifyCreateUserError(null) === null
    && (classifyCreateUserError({ status: 500, message: 'Something else' }) as { kind: string }).kind === 'failed');
  check('the token shape is exactly 32 lower-case hex characters', TOKEN_SHAPE.test(TOK) && !TOKEN_SHAPE.test(TOK.toUpperCase()) && !TOKEN_SHAPE.test(TOK + '0'));
  check('the notice mail cleans a name with line breaks or angle brackets and falls back to "there"', !/\n.*<|<script>/.test(noticeMail('Th\nan<script>di', 'a@b.co').text.split('\n')[0]) && noticeMail('  ', 'a@b.co').text.startsWith('Hi there,'));

  // ---- the wiring in server/index.ts ----
  const code = readFileSync('server/index.ts', 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('index.ts mounts exactly the two routes, each with its own rate limit, after the JSON reader and the CORS check (so the browser page may call them)',
    /app\.post\('\/api\/signup\/tutor-by-link\/check', rateLimit\(30, 60_000\)/.test(code) && /app\.post\('\/api\/signup\/tutor-by-link', rateLimit\(8, 60_000\)/.test(code)
    && code.indexOf('/api/signup/tutor-by-link') > code.indexOf('Access-Control-Allow-Origin') && code.indexOf('/api/signup/tutor-by-link') > code.indexOf('const MAX_BODY_BYTES'));
  check('index.ts creates the account with email_confirm: true through the admin API and takes the visitor address from the Cloudflare header the other limits use, never from the body',
    /auth\.admin\.createUser\(\{ email, password, email_confirm: true, user_metadata: metadata \}\)/.test(code) && /callerAddress\(req, RATE_LIMIT_IP_HEADER\)/.test(code) && /ipHeader \? req\.headers\[ipHeader\]/.test(readFileSync('server/rateLimit.ts', 'utf8')) && !/function callerKey\(req: Request\): string \{[^}]*req\.body/.test(code));
  check('index.ts answers with no caching', (code.match(/Cache-Control', 'no-store'\)\.status\(reply\.status\)/g) ?? []).length === 2);

  if (failed > 0) {
    console.log(`\n${failed} FAILED`);
    process.exit(1);
  }
  console.log('\nall ok');
}
void main();
