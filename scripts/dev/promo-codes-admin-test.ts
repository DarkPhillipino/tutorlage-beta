// Checks on the ADMIN CODES PAGE (PROMO CODES, CEO's decision of 5 Nov 2026). Run: npx tsx scripts/dev/promo-codes-admin-test.ts
// Proves, with a fake database client and by reading the source: only the finance manager and the super admin may use the page; the page still loads
// BEFORE the migration is applied (a missing function is "not available": an empty page and one plain line, never a crash); the list is read in one call
// and every figure is a whole number; a code's status is told in words (active, paused, ended, full); the form checks percent, lessons, dates (South
// African days, the last day included) and the cap before anything is sent; every change goes through the audited database functions (no direct table
// write); the admin can attach a code to an account by e-mail with a written reason; a referring tutor is chosen from a search of tutors only.
// It does NOT prove the database behaviour (supabase/tests/promo_codes_1_*.sql to promo_codes_3_*.sql (three chunks), rolled back) or the screen in a real browser (the preview does that).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  EMPTY_CODE_FORM, PROMO_NOT_AVAILABLE, STATUS_WORDS, attachPromoCode, canUsePromoCodes, codeStatus, createPromoCode, exampleLine, fetchPromoCodes, findTutors,
  formFromRow, isMissingFunction, parseCodeForm, parsePromoCodes, promoLink, ruleLine, setPromoCodeActive, totalsOf, updatePromoCode, type PromoAdminClient, type PromoCodeRow,
} from '../../admin/src/lib/promoCodes';
import { PromoCodesBody } from '../../admin/src/components/PromoCodesBody';

const adminRequire = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = adminRequire('react') as typeof import('react');
const render = (adminRequire('react-dom/server') as typeof import('react-dom/server')).renderToStaticMarkup;

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type Answer = { data: unknown; error: { code?: string; message?: string } | null };
function fake(answer: (fn: string, args?: Record<string, unknown>) => Answer): { db: PromoAdminClient; calls: { fn: string; args?: Record<string, unknown> }[] } {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  return { calls, db: { rpc: async (fn, args) => { calls.push({ fn, args }); return answer(fn, args); } } };
}

const rowJson = {
  id: '11111111-1111-1111-1111-111111111111', code: 'ODI2026', label: 'Odi', percent_off: 10, uses_per_account: 3, valid_from: '2026-11-06T00:00:00+00:00', valid_until: null,
  max_families: 100, active: true, referring_tutor_id: '22222222-2222-2222-2222-222222222222', referring_tutor_name: 'Odi Mokoena', created_at: '2026-11-05T10:00:00+00:00',
  signups: 12, lessons_booked: 9, lessons_completed: 6, lessons_returned: 2, rand_booked: 135, rand_given: 90,
};

async function main() {
  // ---- who ----
  check('only the finance manager and the super admin may use the page', canUsePromoCodes('finance_manager') && canUsePromoCodes('super_admin') && !canUsePromoCodes('support_agent') && !canUsePromoCodes('verification_officer') && !canUsePromoCodes(null) && !canUsePromoCodes(undefined));

  // ---- loading, and loading BEFORE the migration ----
  const ok = fake(() => ({ data: [rowJson], error: null }));
  const listed = await fetchPromoCodes(ok.db);
  check('the list is read in one call to the audited list function', ok.calls.length === 1 && ok.calls[0].fn === 'admin_list_promo_codes' && listed.status === 'ready');
  const row = listed.status === 'ready' ? listed.codes[0] : null;
  check('every figure arrives as a whole number, names and dates as text, no cap as null', row?.signups === 12 && row?.lessonsBooked === 9 && row?.lessonsCompleted === 6 && row?.lessonsReturned === 2 && row?.randBooked === 135 && row?.randGiven === 90 && row?.maxFamilies === 100 && row?.validUntil === null && row?.referringTutorName === 'Odi Mokoena');
  check('a missing function (the migration is not applied yet) is "not available", never an error: PostgREST code, Postgres code or the words',
    (await Promise.all([
      fetchPromoCodes(fake(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_list_promo_codes without parameters in the schema cache' } })).db),
      fetchPromoCodes(fake(() => ({ data: null, error: { code: '42883', message: 'function admin_list_promo_codes() does not exist' } })).db),
      fetchPromoCodes(fake(() => ({ data: null, error: { message: 'Could not find the function public.admin_list_promo_codes' } })).db),
    ])).every((r) => r.status === 'not_available') && isMissingFunction({ code: 'PGRST202' }) && !isMissingFunction({ code: '42501' }) && !isMissingFunction(null));
  check('a support agent (or anyone the database refuses) is told so, not shown an error', (await fetchPromoCodes(fake(() => ({ data: null, error: { code: '42501', message: 'Finance admins only' } })).db)).status === 'forbidden');
  check('any other failure is an error with its words, and a thrown error does not crash', (await fetchPromoCodes(fake(() => ({ data: null, error: { code: 'XX000', message: 'boom' } })).db)).status === 'error'
    && (await fetchPromoCodes({ rpc: async () => { throw new Error('offline'); } })).status === 'error');
  check('an odd answer gives an empty list, and odd rows are skipped', parsePromoCodes(null).length === 0 && parsePromoCodes('x').length === 0 && parsePromoCodes([null, 5, { id: 1 }, rowJson]).length === 1);
  check('the not-available line says the page works as soon as the migration is applied', /not been applied/.test(PROMO_NOT_AVAILABLE) && /as soon as it is/.test(PROMO_NOT_AVAILABLE));

  // ---- status, totals, words ----
  const base = { active: true, validFrom: '2026-11-01T00:00:00Z', validUntil: null as string | null, maxFamilies: null as number | null, signups: 0 };
  const now = new Date('2026-11-10T12:00:00Z');
  check('status: active', codeStatus(base, now) === 'active');
  check('status: paused wins over everything', codeStatus({ ...base, active: false, validUntil: '2026-11-02T00:00:00Z' }, now) === 'paused');
  check('status: ended after its last day; families already in keep their lessons (said in words)', codeStatus({ ...base, validUntil: '2026-11-10T00:00:00Z' }, now) === 'ended' && /keep their lessons/.test(STATUS_WORDS.ended));
  check('status: not started, and full when the cap is reached', codeStatus({ ...base, validFrom: '2026-11-20T00:00:00Z' }, now) === 'not_started' && codeStatus({ ...base, maxFamilies: 5, signups: 5 }, now) === 'full' && codeStatus({ ...base, maxFamilies: 5, signups: 4 }, now) === 'active');
  check('paused is explained: nobody signs up and no new lesson gets the discount', /nobody can sign up/.test(STATUS_WORDS.paused) && /no new lesson gets the discount/.test(STATUS_WORDS.paused));
  const two: PromoCodeRow[] = [row!, { ...row!, id: 'x', signups: 3, lessonsBooked: 2, lessonsCompleted: 1, randBooked: 30, randGiven: 15 }];
  const t = totalsOf(two);
  check('totals add up: codes, families, lessons, rand given and committed', t.codes === 2 && t.signups === 15 && t.lessonsBooked === 11 && t.lessonsCompleted === 7 && t.randBooked === 165 && t.randGiven === 105);
  check('the rule in words and a worked example at the live 2C price', ruleLine(row!) === '10% off the first 3 lessons' && ruleLine({ percentOff: 15, usesPerAccount: 1 }) === '15% off the first lesson' && exampleLine(10, 280) === "R280 lesson: the parent pays R252, Tutorlage's share is R28 less");
  check('the link a tutor or the CEO sends is tutorlage.com/?code=CODE', promoLink('ODI2026') === 'https://tutorlage.com/?code=ODI2026');

  // ---- the form ----
  const good = { ...EMPTY_CODE_FORM, code: ' odi2026 ', label: ' Odi ', validFrom: '2026-11-06', validUntil: '2026-12-31', maxFamilies: '100', tutorId: '22222222-2222-2222-2222-222222222222' };
  const p = parseCodeForm(good);
  check('a good form: the code in capitals, whole numbers, the first day starts at midnight and the LAST day is included (SAST)',
    p.ok && p.args.code === 'ODI2026' && p.args.percent === 10 && p.args.uses === 3 && p.args.validFrom === '2026-11-05T22:00:00.000Z' && p.args.validUntil === '2026-12-31T22:00:00.000Z' && p.args.maxFamilies === 100 && p.args.label === 'Odi');
  const empties = parseCodeForm({ ...EMPTY_CODE_FORM, code: 'ABC123' });
  check('the defaults are 10 percent off the first 3 lessons, no dates, no cap, no tutor', empties.ok && empties.args.percent === 10 && empties.args.uses === 3 && empties.args.validFrom === null && empties.args.validUntil === null && empties.args.maxFamilies === null && empties.args.tutorId === null);
  const bad = (patch: Partial<typeof good>): string => { const r = parseCodeForm({ ...good, ...patch }); return 'message' in r ? r.message : 'ok'; };
  check('refused before anything is sent: a bad code, 31 percent, 0 lessons, a half lesson, a bad date, an end before the start, a zero cap, a made-up tutor',
    /3 to 32 letters/.test(bad({ code: 'a b' })) && /1 to 30/.test(bad({ percent: '31' })) && /1 to 30/.test(bad({ percent: '0' })) && /1 to 20/.test(bad({ uses: '0' })) && /1 to 20/.test(bad({ uses: '2.5' }))
    && /start date/.test(bad({ validFrom: '6 Nov' })) && /after the start/.test(bad({ validFrom: '2026-12-31', validUntil: '2026-11-06' })) && /at least 1/.test(bad({ maxFamilies: '0' })) && /from the list/.test(bad({ tutorId: 'Odi' })));
  check('editing does not ask for the code again', parseCodeForm({ ...good, code: '' }, { codeRequired: false }).ok);
  check('a row goes back into the form as South African days, the last day as typed', (() => { const f = formFromRow({ ...row!, validFrom: '2026-11-05T22:00:00.000Z', validUntil: '2026-12-31T22:00:00.000Z' }); return f.validFrom === '2026-11-06' && f.validUntil === '2026-12-31' && f.percent === '10' && f.maxFamilies === '100' && f.tutorId === row!.referringTutorId; })());

  // ---- the actions ----
  const act = fake((fn) => ({ data: fn === 'admin_attach_promo_code' ? { attached: true, already: false } : null, error: null }));
  if (p.ok) await createPromoCode(act.db, p.args);
  check('make a code: through admin_create_promo_code with every field', act.calls[0].fn === 'admin_create_promo_code' && act.calls[0].args?.p_code === 'ODI2026' && act.calls[0].args?.p_percent === 10 && act.calls[0].args?.p_uses === 3 && act.calls[0].args?.p_max_families === 100 && act.calls[0].args?.p_tutor === '22222222-2222-2222-2222-222222222222');
  if (p.ok) await updatePromoCode(act.db, 'id1', p.args, true);
  check('edit a code: through admin_update_promo_code (the code itself is not sent)', act.calls[1].fn === 'admin_update_promo_code' && act.calls[1].args?.p_id === 'id1' && act.calls[1].args?.p_active === true && !('p_code' in (act.calls[1].args ?? {})));
  await setPromoCodeActive(act.db, 'id1', false);
  check('pause: through admin_set_promo_code_active', act.calls[2].fn === 'admin_set_promo_code_active' && act.calls[2].args?.p_active === false);
  const attached = await attachPromoCode(act.db, ' parent@example.com ', ' odi2026 ', ' Forgot to type it ');
  check('attach: by e-mail, with a written reason, through admin_attach_promo_code', act.calls[3].fn === 'admin_attach_promo_code' && act.calls[3].args?.p_email === 'parent@example.com' && act.calls[3].args?.p_code === 'odi2026' && act.calls[3].args?.p_reason === 'Forgot to type it' && attached.already === false);
  let message = '';
  try { await createPromoCode(fake(() => ({ data: null, error: { code: '23505', message: 'That code already exists.' } })).db, (p as { ok: true; args: never }).args); } catch (e) { message = (e as Error).message; }
  check('a refusal comes back in the database\'s own words', /already exists/.test(message));
  let notThere = '';
  try { await setPromoCodeActive(fake(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })).db, 'x', true); } catch (e) { notThere = (e as Error).message; }
  check('an action before the migration says the codes are not on this database yet', notThere === PROMO_NOT_AVAILABLE);

  // ---- referring tutor search ----
  const people = fake(() => ({ data: [{ id: 'a', role: 'tutor', full_name: 'Odi M', email: 'odi@example.com' }, { id: 'b', role: 'parent', full_name: 'Pat', email: 'pat@example.com' }], error: null }));
  const tutors = await findTutors(people.db, 'od');
  check('the tutor search lists tutors only, through the admin search', tutors.length === 1 && tutors[0].id === 'a' && people.calls[0].fn === 'admin_search_profiles');
  check('a search needs two letters, and a failing search is an empty list', (await findTutors(people.db, 'o')).length === 0 && people.calls.length === 1 && (await findTutors(fake(() => ({ data: null, error: { message: 'x' } })).db, 'od')).length === 0);

  // ---- the screen and its source ----
  const html = render(React.createElement(PromoCodesBody, { client: ok.db, role: 'finance_manager' }));
  check('the screen renders its heading and starts by loading', /Codes<\/h1>/.test(html) && /Loading codes/.test(html));
  const denied = render(React.createElement(PromoCodesBody, { client: ok.db, role: 'support_agent' }));
  check('a support agent who reaches the page is told it is not theirs, with no forms', /finance manager and the super admin/.test(denied) && !/data-codes-create/.test(denied));
  const body = code('admin/src/components/PromoCodesBody.tsx');
  const lib = code('admin/src/lib/promoCodes.ts');
  check('no direct table read or write from the page: only the audited database functions', !/\.from\(/.test(body + lib) && !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(body + lib));
  check('the page shows the not-available line, the totals, the per-code numbers, the make form and the attach box', /data-codes-not-available/.test(body) && /data-codes-totals/.test(body) && /data-code-numbers/.test(body) && /data-codes-create/.test(body) && /data-codes-attach/.test(body));
  check('per code: signed up, lessons booked, lessons done, given back and rand given away', ['Signed up', 'Lessons booked', 'Lessons done', 'Given back', 'Rand given away'].every((w) => body.includes(`label="${w}"`)));
  check('pause and resume, edit and copy-link are on every code', /Pause/.test(body) && /Resume/.test(body) && /Edit/.test(body) && /Copy link/.test(body));
  check('the page file only hands over the admin client and the role', /PromoCodesBody client=\{client\} role=\{adminProfile\?\.adminRole\}/.test(code('admin/src/pages/PromoCodes.tsx')));
  const words = [read('admin/src/lib/promoCodes.ts'), read('admin/src/components/PromoCodesBody.tsx')].join('\n');
  check('no new text offers "free" lessons or sessions', !/\bfree\b/i.test(words.replace(/Free a|free of/g, '')), (words.match(/.{20}\bfree\b.{20}/i) ?? [''])[0]);

  console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
