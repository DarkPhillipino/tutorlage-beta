// Checks on the TUTOR CODES and the TUTOR BONUS screens and words (CEO, 10 Nov 2026). Run: npx tsx scripts/dev/tutor-code-test.ts
// Proves, with a fake database client and by reading the source: the tutor's earnings page asks one tolerant question (my_tutor_code) and shows nothing when the tutor has no
// code or the database does not have the migration yet; the bonus is mentioned to the tutor ONLY when the CEO's switch is on, and "up to" keeps the words true under the
// platform floor; the bonus shows on the earnings history as its own line and a take-back reads plainly; the admin Codes page reads the new fields tolerantly and its two new
// buttons go through the audited functions; the migration ships the bonus OFF, reuses the existing audit actions and patches two wallet functions only with markers.
// It does NOT prove the database behaviour (supabase/tests/tutor_codes_and_bonus.sql, rolled back) or the screens in a real browser.
import { readFileSync } from 'node:fs';
import {
  TUTOR_CODE_COPY, bonusLine, bonusPaidLine, familiesLine, fetchMyTutorCode, parseTutorCode, savingLine, shareText, tutorCodeLink, whatsappShareLink, type TutorCodeClient,
} from '../../src/lib/tutorCode';
import { ledgerLineText } from '../../src/lib/wallet';
import {
  PROMO_NOT_AVAILABLE, createTutorCode, makeMissingTutorCodes, parsePromoCodes, totalsOf, tutorCodeNotice, type PromoAdminClient,
} from '../../admin/src/lib/promoCodes';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type Answer = { data: unknown; error: { code?: string; message?: string } | null };
function fake(answer: (fn: string, args?: Record<string, unknown>) => Answer): { db: TutorCodeClient & PromoAdminClient; calls: { fn: string; args?: Record<string, unknown> }[] } {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  return { calls, db: { rpc: async (fn, args) => { calls.push({ fn, args }); return answer(fn, args); } } };
}

async function main() {
  // ---- the tutor's own question -------------------------------------------------------------------------------------------------------------------------
  const has = { has_code: true, code: 'THABO', active: true, percent: 10, lessons: 3, bonus_on: false, bonus_percent: 5, bonus_months: 12, families: 4, bonus_lessons: 0, bonus_rand: 0 };
  const on = { ...has, bonus_on: true, bonus_lessons: 3, bonus_rand: 54 };
  const ok = fake(() => ({ data: has, error: null }));
  const mine = await fetchMyTutorCode(ok.db);
  check('one question, my_tutor_code, answers the code, the saving, the families and the switch', ok.calls.length === 1 && ok.calls[0].fn === 'my_tutor_code' && mine?.code === 'THABO' && mine.percent === 10 && mine.lessons === 3 && mine.families === 4 && mine.bonusOn === false);
  check('a tutor with no code, an odd answer, an error, a missing function or a thrown error all give "no code" and never a crash',
    (await fetchMyTutorCode(fake(() => ({ data: { has_code: false }, error: null })).db)) === null
    && parseTutorCode(null) === null && parseTutorCode('x') === null && parseTutorCode({ has_code: true, code: '' }) === null
    && (await fetchMyTutorCode(fake(() => ({ data: null, error: { code: '42883', message: 'function my_tutor_code does not exist' } })).db)) === null
    && (await fetchMyTutorCode({ rpc: async () => { throw new Error('offline'); } })) === null);
  check('the figures come back as whole numbers, with the plan\'s defaults (15 percent, 3 lessons, 5 percent, 12 months) when the answer leaves them out',
    (() => { const d = parseTutorCode({ has_code: true, code: 'A1B', families: '2', bonus_rand: 14.4 }); return d?.percent === 15 &&d.lessons === 3 && d.bonusPercent === 5 && d.bonusMonths === 12 && d.families === 2 && d.bonusRand === 14 && d.active === true; })());

  // ---- the words ---------------------------------------------------------------------------------------------------------------------------------------------
  const m = parseTutorCode(has)!;
  const mOn = parseTutorCode(on)!;
  check('the link is tutorlage.com/?code=CODE (the sign-up reads it)', tutorCodeLink('THABO') === 'https://tutorlage.com/?code=THABO');
  check('the saving and the families in plain words', savingLine(m) === 'Families who sign up with it pay 10% less on their first 3 lessons.'
    && familiesLine(0) === 'No family has signed up with it yet.' && familiesLine(1) === '1 family has signed up with it.' && familiesLine(4) === '4 families have signed up with it.');
  check('the bonus is described with "up to" (the platform floor can trim it at the top levels) and says it changes nothing for the family or the tutor\'s own pay',
    /up to 5%/.test(bonusLine(mOn)) && /12 months/.test(bonusLine(mOn)) && /changes nothing for the family/.test(bonusLine(mOn)));
  check('what the bonus has paid so far is said only once it has paid', bonusPaidLine(parseTutorCode(has)!) === null && bonusPaidLine(mOn) === 'So far R54 from 3 lessons.');
  check('the message a tutor can send names the code, the saving and the link, and a WhatsApp link only carries it (nothing is sent by the app)',
    shareText(m) === 'Join Tutorlage with my code THABO and pay 10% less on your first 3 lessons: https://tutorlage.com/?code=THABO'
    && whatsappShareLink(shareText(m)).startsWith('https://wa.me/?text=') && !/\bfetch\(|sendMessage|\.rpc\(/.test(code('src/components/TutorCodeCard.tsx').replace(/fetchMyTutorCode/g, '')));
  const card = code('src/components/TutorCodeCard.tsx');
  check('the card says nothing about the bonus unless the switch is on, and shows nothing at all without a code', /code\.bonusOn &&/.test(card) && /if \(!code\) return null/.test(card));
  const panel = code('src/components/TutorWalletPanel.tsx');
  check('the card sits on the tutor\'s earnings page', /import \{ TutorCodeCard \} from '\.\/TutorCodeCard'/.test(panel) && /<TutorCodeCard \/>/.test(panel));
  const words = [read('src/lib/tutorCode.ts'), read('src/components/TutorCodeCard.tsx')].join('\n').replace(/^\s*\/\/.*$/gm, '');
  check('no new text offers "free" lessons or sessions, and none names a school, a campus or a faculty', !/\bfree\b/i.test(words) && !/campus|faculty|emeris|waterfall|university/i.test(words), (words.match(/.{20}\b(free|campus|faculty)\b.{20}/i) ?? [''])[0]);

  // ---- the earnings history -------------------------------------------------------------------------------------------------------------------------------
  check('the bonus is its own line on the tutor\'s history, the session credit is unchanged, and a take-back reads plainly',
    ledgerLineText({ kind: 'session_credit', note: 'Referral bonus: a family who joined with your code had a lesson' }, null, true) === 'Bonus: a family who joined with your code had a lesson'
    && ledgerLineText({ kind: 'session_credit', note: 'Session completed' }, 'Maths', true) === 'Earned from a Maths session'
    && ledgerLineText({ kind: 'refund_reversal', note: 'The family was refunded for the lesson this referral bonus was paid on' }, null, true) === 'Bonus taken back: a family was refunded for a lesson'
    && ledgerLineText({ kind: 'refund_reversal', note: 'The learner was refunded for this session' }, null, true) === 'Taken back: the learner was refunded for a session');

  // ---- the admin Codes page -----------------------------------------------------------------------------------------------------------------------------------
  const before = { id: '1', code: 'ODI2026', percent_off: 10, uses_per_account: 3, active: true, signups: 2, lessons_booked: 1, lessons_completed: 1, lessons_returned: 0, rand_booked: 28, rand_given: 28 };
  const after = { ...before, id: '2', code: 'THABO', owner_tutor_id: 't1', owner_tutor_name: 'Thabo M', bonus_lessons: 3, bonus_rand_paid: 54, bonus_rand_held_back: 39 };
  const rows = parsePromoCodes([before, after]);
  check('the list reads the new fields, and a database without them (the old list) still reads as before', rows[0].ownerTutorId === null && rows[0].bonusLessons === 0 && rows[1].ownerTutorId === 't1' && rows[1].ownerTutorName === 'Thabo M'
    && rows[1].bonusLessons === 3 && rows[1].bonusRandPaid === 54 && rows[1].bonusRandHeldBack === 39);
  check('the totals add up the bonus paid', totalsOf(rows).bonusRandPaid === 54 && totalsOf(rows).codes === 2);
  const act = fake((fn) => (fn === 'admin_create_tutor_code' ? { data: { created: true, id: 'x', code: 'THABO' }, error: null } : { data: { made: 3, failed: 1 }, error: null }));
  const made = await createTutorCode(act.db, '22222222-2222-2222-2222-222222222222', '  Thabo  ');
  const catchUp = await makeMissingTutorCodes(act.db);
  check('the button: through admin_create_tutor_code with the tutor and the chosen name (empty sends null); the catch-up through admin_make_missing_tutor_codes',
    act.calls[0].fn === 'admin_create_tutor_code' && act.calls[0].args?.p_tutor === '22222222-2222-2222-2222-222222222222' && act.calls[0].args?.p_chosen_name === 'Thabo' && made.created && made.code === 'THABO'
    && act.calls[1].fn === 'admin_make_missing_tutor_codes' && catchUp.made === 3 && catchUp.failed === 1);
  const noName = fake(() => ({ data: { created: false, code: 'THABO' }, error: null }));
  await createTutorCode(noName.db, '22222222-2222-2222-2222-222222222222', '   ');
  check('no chosen name sends null (the database uses the first name)', noName.calls[0].args?.p_chosen_name === null);
  check('the notice gives the code and its link, and says when the tutor already had one', /THABO is ready.*tutorlage\.com\/\?code=THABO/.test(tutorCodeNotice({ created: true, code: 'THABO' })) && /already has the code THABO/.test(tutorCodeNotice({ created: false, code: 'THABO' })));
  let message = '';
  try { await createTutorCode(fake(() => ({ data: null, error: { code: '42883', message: 'function admin_create_tutor_code does not exist' } })).db, 'x', ''); } catch (e) { message = e instanceof Error ? e.message : ''; }
  check('before the migration is applied the button says so in one plain line', message === PROMO_NOT_AVAILABLE);
  let refused = '';
  try { await createTutorCode(fake(() => ({ data: null, error: { code: '23505', message: 'The code ZZOLO is taken. Pick another name.' } })).db, 'x', 'zzolo'); } catch (e) { refused = e instanceof Error ? e.message : ''; }
  check('a name that is taken comes back in the database\'s own words', /is taken/.test(refused));
  const body = code('admin/src/components/PromoCodesBody.tsx');
  const lib = code('admin/src/lib/promoCodes.ts');
  check('the page has the tutor-code box, the owner line and the bonus numbers per code', /data-codes-tutor>/.test(read('admin/src/components/PromoCodesBody.tsx')) && /data-code-owner/.test(body) && /data-code-bonus/.test(body)
    && ['Bonus lessons paid', 'Bonus paid to the tutor', 'Bonus held back'].every((w) => body.includes(`label="${w}"`)));
  check('no direct table read or write from the page: only the audited database functions', !/\.from\(/.test(body + lib) && !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(body + lib));
  const adminWords = read('admin/src/components/PromoCodesBody.tsx');
  check('the page names no school, campus or faculty in anything new and offers no "free" lessons',
    !/\bfree\b/i.test(adminWords.replace(/^\s*\/\/.*$/gm, '').replace(/Free a|free of/g, '')) && !/campus|emeris|waterfall/i.test(adminWords.replace(/Faculty of Education/g, '')));

  // ---- the migration (read, not run) -------------------------------------------------------------------------------------------------------------------------------
  const mig = read('supabase/migrations/20261110120000_tutor_codes_and_bonus.sql');
  const migCode = mig.replace(/^\s*--.*$/gm, '');
  check('the bonus ships OFF with the plan\'s numbers: 5 percent, 12 months, R15 floor', /'tutor_bonus_enabled', 'false'::jsonb/.test(mig) && /'tutor_bonus_percent', '5'::jsonb/.test(mig) && /'tutor_bonus_months', '12'::jsonb/.test(mig)
    && /'tutor_bonus_platform_floor_rand', '15'::jsonb/.test(mig) && /'tutor_bonus_only_when_they_teach', 'false'::jsonb/.test(mig));
  check('it adds no new audit-action values and drops nothing', !/alter type/i.test(migCode) && !/\bdrop (table|function|column|trigger if exists (?!trg_tutor_personal_code_on_approved))/i.test(migCode));
  check('the two wallet patches are marked and anchored once (wallet_credit_tutor, admin_refund_to_wallet)', /TUTOR BONUS credit \(CEO, 10 Nov 2026\)/.test(mig) && /TUTOR BONUS refund \(CEO, 10 Nov 2026\)/.test(mig)
    && (mig.match(/select pg_temp\.bonus_patch\(/g) ?? []).length === 2 && /strpos\(d, p_marker\) > 0/.test(mig) && /n <> p_expect/.test(mig));
  check('the bonus is paid in a block of its own after the tutor\'s credit, and a failed take-back never blocks a refund', /perform public\.tutor_bonus_pay\(new\.id\);\s*exception when others then/.test(mig) && /perform public\.tutor_bonus_take_back\([^;]*\);\s*exception when others then/.test(mig));
  check('the floor is the rule: the bonus is the smaller of the percent and what Tutorlage keeps above the floor, never below zero', /greatest\(0, least\(x\.w, p_platform_keeps - p_floor\)\)/.test(mig));
  check('the first offer is untouched: a personal code uses owner_tutor_id, never referring_tutor_id', /owner_tutor_id uuid references public\.tutor_profiles/.test(mig) && !/insert into public\.promo_codes \([^)]*referring_tutor_id/.test(mig));
  check('the migration holds no key-shaped string, and no "free" wording for lessons', !/\b(sk|pk)_(live|test)_[A-Za-z0-9]/.test(mig) && !/\bfree (lesson|session)/i.test(mig));

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
