// Checks on the ADMIN FOUNDING TUTORS PAGE (CEO's order of 10 Nov 2026; plan Drake/project-manager/tutor-waitlist-page-action-plan-2026-11-10.md P-2, P-3, P-4).
// Run: npx tsx scripts/dev/admin-founding-test.ts
// Proves, with a fake database client, rendered markup and by reading the source and the migration text: the page reads through the four admin functions only and opens
// cleanly BEFORE the migration is applied; filters by subject, phase and status, with counts; the status shown is the true one; the two ready-made WhatsApp messages are the
// drafts' words, built as wa.me links with the text filled in, and the app sends nothing; "Release" and "Mark as messaged" are the migration's functions with the migration's
// argument names; the Teach gate card shows the read-back, only a super admin can switch it, and it cannot be switched on while a tutor has no entry; the page counts and
// the coverage view draw; typed text is printed as plain text; the menu and route exist; no new text says "free".
// It does NOT prove the database behaviour (supabase/tests/founding_tutors_list.sql, rolled back) or the page in a real browser.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  CSV_HEADER, FOUNDING_NOT_ON_YET, FOUNDING_NO_ACCESS, NO_FILTER, PHASES, SIGNUP_LINK, STATUS_LABELS, LAPSE_DAYS,
  addEntry, countsByStatus, dailyCsv, deleteEntry, describeAgo, fetchFounding, fetchFunnel, filterEntries, greetingName, isMissingFounding, lastDays, mapCoverage, mapEntry, mapFunnel, mapGateCheck, mapHourly, markMessaged, parseTags, rate,
  releaseEntries, releaseMessage, saveTags, linkEntry, waitingMessage, setEntryStatus, setGate, subjectOptions, verifiedMessage, verifiedMessageWithLink, waDigits, waLink,
  type FoundingAdminClient, type FoundingEntry, type FoundingResult,
} from '../../admin/src/lib/founding';
import { FoundingBody, type FoundingBodyProps } from '../../admin/src/components/FoundingBody';

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
const MIGRATION = read('supabase/migrations/20261110200000_founding_tutors_list.sql');
const fnParams = (name: string) => new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`).exec(MIGRATION)?.[1].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).join();

type Err = { code?: string; message?: string } | null;
interface Calls { rpcs: { fn: string; args: Record<string, unknown> | undefined }[] }
function fake(answers: Record<string, { data?: unknown; error?: Err }> = {}, opts: { throws?: boolean } = {}): { db: FoundingAdminClient; calls: Calls } {
  const calls: Calls = { rpcs: [] };
  const db: FoundingAdminClient = {
    rpc: async (fn, args) => {
      calls.rpcs.push({ fn, args });
      if (opts.throws) throw new Error('Failed to fetch');
      const a = answers[fn];
      return { data: a && 'data' in a ? a.data : null, error: a?.error ?? null };
    },
  };
  return { db, calls };
}

const rawEntry = (over: Record<string, unknown> = {}) => ({
  id: 'e1', created_at: '2026-11-10T10:00:00Z', source: 'form', full_name: 'Thandi Testfounder', code_name: 'Thandi', whatsapp: '+27821234567', email: 'thandi@example.invalid',
  subjects: [{ subject: 'Mathematics', min_grade: 'Grade 8', max_grade: 'Grade 12' }], phases: ['FET (10-12)', 'Senior (7-9)'], availability: ['evenings'], unavailable_weeks: 'March',
  practicum: 'two', police_clearance: 'applied', parent_reach: '10_to_30', parent_reach_willing: true, prior_tutoring: 'Two years of maths', heard_from: 'message',
  has_device: true, has_connection: true, has_bank: false, consent_contact_at: '2026-11-10T10:00:00Z', consent_marketing_at: null, consent_version: '2026-11-10', src: 'fac',
  status: 'joined', effective_status: 'joined', released_at: null, released_messaged_at: null, verified_messaged_at: null, delete_after: '2027-05-10T10:00:00Z', admin_note: null,
  has_account: false, tutor_verified: false, weekly_hours: 0, ...over,
});
const entry = (over: Partial<FoundingEntry> = {}): FoundingEntry => ({ ...mapEntry(rawEntry()), ...over });

const funnelRaw = {
  from: '2026-11-04', to: '2026-11-11',
  by_day: [{ day: '2026-11-11', src: 'f1', opens: 8, visitors: 6, see_more: 4, form_start: 3, joins: 2 }, { day: '2026-11-10', src: '(none)', opens: 2, visitors: 2, see_more: 0, form_start: 0, joins: 0 }],
  by_src: [{ src: 'f1', opens: 8, visitors: 6, see_more: 4, form_start: 3, joins: 2, registered: true }, { src: '(none)', opens: 2, visitors: 2, see_more: 0, form_start: 0, joins: 0, registered: true },
    { src: 'zz9', opens: 1, visitors: 1, see_more: 0, form_start: 0, joins: 0, registered: false }],
  totals: { opens: 10, visitors: 8, see_more: 4, form_start: 3, joins: 2 },
  unregistered: ['zz9'],
};
const hourlyRaw = { by_hour: [{ hour: '2026-11-11 09:00', src: 'f1', opens: 5, visitors: 4, see_more: 2, form_start: 1, joins: 1 }] };
const gateRaw = (over: Record<string, unknown> = {}) => ({ gate_on: false, tutor_accounts: 12, verified: 4, released: 6, waiting: 0, not_listed: 0, not_listed_accounts: [], ...over });
const coverageRaw = [
  { subject: 'Mathematics', phase: 'Senior (7-9)', on_list: 8, released: 1, verified: 2, ready_tutors: 2, weekly_hours: 14.5, requests: 9, accepted: 4, unserved_requests: 5, expired: 1, status: 'THIN', demand_no_supply: true },
  { subject: 'Afrikaans', phase: 'FET (10-12)', on_list: 2, released: 0, verified: 0, ready_tutors: 0, weekly_hours: 0, requests: 3, accepted: 0, unserved_requests: 3, expired: 0, status: 'EMPTY', demand_no_supply: true },
  { subject: 'Life Sciences', phase: 'FET (10-12)', on_list: 6, released: 3, verified: 4, ready_tutors: 4, weekly_hours: 30, requests: 0, accepted: 0, unserved_requests: 0, expired: 0, status: 'OPEN', demand_no_supply: false },
];
const allOk = () => fake({
  admin_founding_entries: { data: [rawEntry({ id: 'old', created_at: '2026-11-09T08:00:00Z', full_name: 'Older One' }), rawEntry({ id: 'new', created_at: '2026-11-10T10:00:00Z' })] },
  admin_founding_coverage: { data: coverageRaw }, admin_founding_funnel: { data: funnelRaw }, admin_founding_gate_check: { data: gateRaw() },
  admin_founding_hourly: { data: hourlyRaw }, admin_founding_tags: { data: ['f1', 'f1-n1', 'ref-*'] },
});

async function main() {
  // ---- reading ----
  const a = allOk();
  const res = await fetchFounding(a.db);
  const data = res.state === 'ok' ? res.data : null;
  check('the page reads through the admin functions only (list, coverage, counts by day, counts by hour, tags, gate check), with the day range for the counts', a.calls.rpcs.map((c) => c.fn).sort().join() === 'admin_founding_coverage,admin_founding_entries,admin_founding_funnel,admin_founding_gate_check,admin_founding_hourly,admin_founding_tags'
    && Object.keys(a.calls.rpcs.find((c) => c.fn === 'admin_founding_funnel')?.args ?? {}).join() === 'p_from,p_to');
  check('every function it calls is defined by the migration, and the argument names are the migration\'s', ['admin_founding_coverage', 'admin_founding_entries', 'admin_founding_funnel', 'admin_founding_gate_check', 'admin_founding_hourly', 'admin_founding_tags', 'admin_set_founding_tags', 'admin_delete_founding_entry'].every((f) => new RegExp(`create or replace function public\\.${f}\\(`).test(MIGRATION))
    && fnParams('admin_founding_funnel') === 'p_from,p_to' && fnParams('admin_founding_hourly') === 'p_from,p_to' && fnParams('admin_set_founding_tags') === 'p_tags' && fnParams('admin_delete_founding_entry') === 'p_id');
  check('entries come back newest first whatever order they arrived in', !!data && data.entries.map((e) => e.id).join() === 'new,old');
  check('the entry is mapped: name, number, subjects with grades, phases, answers, consents, dates, tag', !!data && data.entries[0].fullName === 'Thandi Testfounder' && data.entries[0].whatsapp === '+27821234567' && data.entries[0].subjects[0].minGrade === 'Grade 8'
    && data.entries[0].phases.join() === 'FET (10-12),Senior (7-9)' && data.entries[0].policeClearance === 'applied' && data.entries[0].consentMarketingAt === null && data.entries[0].src === 'fac' && data.entries[0].parentReachWilling === true);
  check('mapEntry survives a row of nonsense (no name, an odd status counts as "on the list")', mapEntry({}).fullName === '' && mapEntry({}).status === 'joined' && mapEntry({ status: 'banana', effective_status: 'banana' }).effectiveStatus === 'joined' && mapEntry({}).subjects.length === 0 && mapEntry({}).whatsapp === null);
  check('the coverage, the counts, the hours, the tags and the gate check are mapped', !!data && data.coverage.length === 3 && data.coverage[0].readyTutors === 2 && data.coverage[0].onList === 8 && data.coverage[0].status === 'THIN' && data.coverage[0].demandNoSupply && data.coverage[0].weeklyHours === 14.5
    && data.funnel?.totals.joins === 2 && data.funnel?.bySrc[0].seeMore === 4 && data.funnel?.unregistered.join() === 'zz9' && data.funnel?.bySrc[2].registered === false && data.hourly[0].hour === '2026-11-11 09:00' && data.tags.join() === 'f1,f1-n1,ref-*'
    && data.gate?.tutorAccounts === 12 && data.gate?.gateOn === false);
  check('mappers read numbers sent as text and ignore junk; the status is worked out from ready tutors when missing', mapCoverage({ ready_tutors: '3', weekly_hours: 'x' }).readyTutors === 3 && mapCoverage({ ready_tutors: 3 }).status === 'OPEN' && mapCoverage({ ready_tutors: 1 }).status === 'THIN' && mapCoverage({}).status === 'EMPTY' && mapCoverage({ weekly_hours: 'x' }).weeklyHours === 0
    && mapFunnel('nope') === null && mapGateCheck(null) === null && mapGateCheck({ not_listed_accounts: [{ id: 'a' }] })?.notListedAccounts[0].name === 'Unnamed tutor');

  // ---- before the migration is applied ----
  const missing = await fetchFounding(fake({ admin_founding_entries: { error: { code: 'PGRST202', message: 'Could not find the function public.admin_founding_entries in the schema cache' } } }).db);
  check('a database without the migration: "not set up", not an error', missing.state === 'not_set_up');
  check('a missing function is recognised by PostgREST\'s code, Postgres\'s code, and by words alone', isMissingFounding({ code: 'PGRST202' }) && isMissingFounding({ code: '42883' }) && isMissingFounding({ code: '42P01' })
    && isMissingFounding({ message: 'function public.admin_founding_entries() does not exist' }) && !isMissingFounding({ code: '42501', message: 'permission denied' }) && !isMissingFounding(null));
  check('a support agent (refused with 42501) gets the plain "only a verification officer or super admin" state, not a crash', (await fetchFounding(fake({ admin_founding_entries: { error: { code: '42501', message: 'Only a verification officer' } } }).db)).state === 'no_access');
  const bad = await fetchFounding(fake({ admin_founding_entries: { error: { code: '500', message: 'boom' } } }).db);
  check('any other error is "failed" with the reason, not mistaken for an empty list', bad.state === 'failed' && /boom/.test((bad as { message: string }).message));
  check('a thrown error (the network) is "failed"', (await fetchFounding(fake({}, { throws: true }).db)).state === 'failed');
  const partial = await fetchFounding(fake({ admin_founding_entries: { data: [rawEntry()] }, admin_founding_coverage: { error: { code: '500' } }, admin_founding_funnel: { error: { code: '500' } }, admin_founding_gate_check: { error: { code: '500' } } }).db);
  check('if only the extras fail the list still shows (coverage empty, counts and gate unknown)', partial.state === 'ok' && partial.data.entries.length === 1 && partial.data.coverage.length === 0 && partial.data.funnel === null && partial.data.gate === null);
  check('an empty list is an empty list', JSON.stringify((await fetchFounding(fake({ admin_founding_entries: { data: [] } }).db)).state) === '"ok"');
  const fz = fake({ admin_founding_funnel: { data: funnelRaw } });
  check('changing the period asks only for the counts, with that day range', (await fetchFunnel(fz.db, { from: '2026-11-05', to: '2026-11-11' }))?.to === '2026-11-11' && JSON.stringify(fz.calls.rpcs) === JSON.stringify([{ fn: 'admin_founding_funnel', args: { p_from: '2026-11-05', p_to: '2026-11-11' } }])
    && (await fetchFunnel(fake({ admin_founding_funnel: { error: { code: '500' } } }).db, { from: 'a', to: 'b' })) === null);
  check('"last N days" ends today and starts N-1 days back', JSON.stringify(lastDays(7, new Date(2026, 10, 11))) === JSON.stringify({ from: '2026-11-05', to: '2026-11-11' }) && lastDays(1, new Date(2026, 10, 11)).from === '2026-11-11');
  check('R14: the CSV is one row per day per tag, oldest first, the five counters, COUNTS ONLY', (() => {
    const csv = dailyCsv(mapFunnel(funnelRaw));
    return csv === `${CSV_HEADER}\n2026-11-10,(none),2,2,0,0,0\n2026-11-11,f1,8,6,4,3,2\n` && CSV_HEADER === 'day,tag,opens,new_visitors,first_see_more,first_form_starts,joins' && !/@|\+27|name/i.test(csv) && dailyCsv(null) === `${CSV_HEADER}\n`;
  })());
  check('the tag list is typed as words (comma, space or line), lower-cased and without repeats; saving calls admin_set_founding_tags with p_tags', JSON.stringify(parseTags('F1, f1-n1\n ref-*  f1')) === JSON.stringify(['f1', 'f1-n1', 'ref-*'])
    && await (async () => { const f = fake({ admin_set_founding_tags: { data: { ok: true } } }); return (await saveTags(f.db, ['f1'])) === null && JSON.stringify(f.calls.rpcs[0]) === JSON.stringify({ fn: 'admin_set_founding_tags', args: { p_tags: ['f1'] } }); })());
  check('REMOVE AND DELETE calls admin_delete_founding_entry with p_id and shows the database\'s plain refusal for an existing tutor\'s line', await (async () => { const f = fake({ admin_delete_founding_entry: { data: { ok: true } } }); return (await deleteEntry(f.db, 'x')) === null && JSON.stringify(f.calls.rpcs[0]) === JSON.stringify({ fn: 'admin_delete_founding_entry', args: { p_id: 'x' } }); })()
    && (await deleteEntry(fake({ admin_delete_founding_entry: { error: { code: '55000', message: 'This line is an existing tutor account' } } }).db, 'x')) === 'This line is an existing tutor account');

  // ---- status, filters, counts ----
  const people: FoundingEntry[] = [
    entry({ id: '1', effectiveStatus: 'joined', fullName: 'Ann Arts', codeName: 'Ann', subjects: [{ subject: 'English Home Language', minGrade: 'Grade 4', maxGrade: 'Grade 6' }], phases: ['Intermediate (4-6)'], email: 'ann@x.invalid' }),
    entry({ id: '2', effectiveStatus: 'joined', fullName: 'Ben Maths', codeName: 'Ben' }),
    entry({ id: '3', status: 'released', effectiveStatus: 'released', fullName: 'Cleo Maths', codeName: 'Cleo', releasedAt: '2026-11-10T12:00:00Z' }),
    entry({ id: '4', status: 'released', effectiveStatus: 'signed_up', fullName: 'Dee Maths', codeName: 'Dee', hasAccount: true }),
    entry({ id: '5', status: 'verified', effectiveStatus: 'verified', fullName: 'Eve Maths', codeName: 'Eve', tutorVerified: true, hasAccount: true, ready: true, missing: [] }),
  ];
  check('counts by the TRUE status (a released person with an account is signed up; a lapsed one is lapsed), and "all"', JSON.stringify(countsByStatus(people)) === JSON.stringify({ all: 5, joined: 2, lapsed: 0, released: 1, signed_up: 1, verified: 1 })
    && countsByStatus([...people, entry({ id: '6', effectiveStatus: 'lapsed' })]).lapsed === 1);
  check('filter by status uses the true status; "all" shows everyone', filterEntries(people, { ...NO_FILTER, status: 'signed_up' }).map((r) => r.id).join() === '4' && filterEntries(people, NO_FILTER).length === 5);
  check('filter by subject', filterEntries(people, { ...NO_FILTER, subject: 'English Home Language' }).map((r) => r.id).join() === '1' && filterEntries(people, { ...NO_FILTER, subject: 'Mathematics' }).length === 4);
  check('filter by phase (a person whose grades touch the phase is in it)', filterEntries(people, { ...NO_FILTER, phase: 'Intermediate (4-6)' }).map((r) => r.id).join() === '1' && filterEntries(people, { ...NO_FILTER, phase: 'FET (10-12)' }).length === 4 && filterEntries(people, { ...NO_FILTER, phase: 'Foundation (R-3)' }).length === 0);
  check('the filters combine; search finds a name, an email or a number, in any capitals', filterEntries(people, { status: 'joined', subject: 'Mathematics', phase: '', search: '' }).map((r) => r.id).join() === '2'
    && filterEntries(people, { ...NO_FILTER, search: 'ANN@x' }).map((r) => r.id).join() === '1' && filterEntries(people, { ...NO_FILTER, search: '82 123' }).length === 0 && filterEntries(people, { ...NO_FILTER, search: '+2782' }).length === 5);
  check('the subject choices are the subjects people picked, sorted; the five phases are the database\'s', subjectOptions(people).join() === 'English Home Language,Mathematics' && PHASES.join() === 'Foundation (R-3),Intermediate (4-6),Senior (7-9),FET (10-12),University and adult'
    && PHASES.every((p) => MIGRATION.includes(`'${p}'`)));
  check('the four stored statuses are the migration\'s four; "lapsed" is the fifth the screen shows (status joined with lapsed_at set), with plain labels', Object.keys(STATUS_LABELS).sort().join() === 'joined,lapsed,released,signed_up,verified' && /status in \('joined', 'released', 'signed_up', 'verified'\)/.test(MIGRATION)
    && STATUS_LABELS.joined === 'On the list' && /when f\.lapsed_at is not null then 'lapsed'/.test(MIGRATION) && LAPSE_DAYS === 14 && /'founding_release_lapse_days',\s*'14'::jsonb/.test(MIGRATION));

  // ---- the ready-made WhatsApp messages (the drafts, sections 5c and 5d) ----
  const person = entry({ codeName: 'Thandi', fullName: 'Thandi Testfounder', email: 'thandi@example.invalid', whatsapp: '+27821234567' });
  check('"place is open" is the drafts\' 5c, with the name, the sign-up link and the email they gave', releaseMessage(person) === [
    'Hi Thandi, your place on Tutorlage has opened and stays open for 14 days. If this is not a good time, reply LATER and we will move you to a later group.',
    '1. Create your account here: https://tutorlage.com/signup/tutor, using thandi@example.invalid.',
    '2. Upload your documents in the app: ID or passport, police clearance from the last 6 months, school results or proof of your teaching experience, and your bank details.',
    '3. We check them within up to a week and message you here when you are verified.',
    'Stuck? Reply here.',
  ].join('\n') && SIGNUP_LINK === 'https://tutorlage.com/signup/tutor');
  check('"verified" is the drafts\' 5d variant 1 (no personal link yet)', verifiedMessage(person) === 'Hi Thandi, good news: you are verified on Tutorlage and can now accept requests. Open your Tutor page and check that your subjects and hours are set. You will see requests that match your level and subjects. Questions? Reply here.' && !/code=/.test(verifiedMessage(person)));
  check('variant 2 exists for the day the code is live (not used by any button): the link, 10 percent off the first 3 lessons, 5 percent more for the tutor', /tutorlage\.com\/\?code=ABC/.test(verifiedMessageWithLink(person, 'ABC')) && /10% off their first 3 lessons/.test(verifiedMessageWithLink(person, 'ABC')) && /earn 5% more/.test(verifiedMessageWithLink(person, 'ABC'))
    && !/verifiedMessageWithLink/.test(code('admin/src/components/FoundingBody.tsx') + code('admin/src/pages/FoundingTutors.tsx')));
  check('the greeting uses the name they asked for, else their first name, else "there"', greetingName({ codeName: 'Tee', fullName: 'Thandi X' }) === 'Tee' && greetingName({ codeName: '', fullName: 'Thandi Xaba' }) === 'Thandi' && greetingName({ codeName: ' ', fullName: '' }) === 'there');
  const link = waLink('+27821234567', 'Hi there\nline 2 & more?') ?? '';
  check('the link is wa.me with the digits only and the text filled in and escaped; it round-trips', /^https:\/\/wa\.me\/27821234567\?text=/.test(link) && decodeURIComponent(link.split('?text=')[1]) === 'Hi there\nline 2 & more?' && waDigits('+27 82 123 4567') === '27821234567');
  check('a number that cannot be WhatsApp (landline, none, junk) gives no link', waLink('+27111234567', 'x') === null && waLink(null, 'x') === null && waLink('abc', 'x') === null && waDigits(undefined) === null);
  check('NOTHING IS SENT by the app: no WhatsApp or other send call exists in the new admin files (only wa.me links the CEO opens himself)', !/api\.whatsapp|graph\.facebook|twilio|fetch\(|XMLHttpRequest|sendBeacon/i.test(['admin/src/lib/founding.ts', 'admin/src/components/FoundingBody.tsx', 'admin/src/pages/FoundingTutors.tsx'].map(code).join('\n')));
  check('no message says "free" lessons or sessions', !/\bfree\b/i.test(releaseMessage(person) + verifiedMessage(person) + verifiedMessageWithLink(person, 'ABC')));

  // ---- the writes ----
  const w = fake({ admin_release_founding: { data: { released: 2, skipped: 1 } }, admin_mark_founding_messaged: { data: { ok: true } }, admin_set_founding_status: { data: { ok: true } }, admin_add_founding_entry: { data: { ok: true } }, admin_set_founding_gate: { data: { ok: true } } });
  const rel = await releaseEntries(w.db, ['a', 'b', 'c']);
  check('release calls admin_release_founding with p_ids and reports how many were released and skipped', rel.error === null && rel.released === 2 && rel.skipped === 1 && JSON.stringify(w.calls.rpcs[0]) === JSON.stringify({ fn: 'admin_release_founding', args: { p_ids: ['a', 'b', 'c'] } }) && fnParams('admin_release_founding') === 'p_ids');
  check('mark as messaged: admin_mark_founding_messaged with p_id and p_kind, released or verified', (await markMessaged(w.db, 'a', 'released')) === null && JSON.stringify(w.calls.rpcs[1].args) === JSON.stringify({ p_id: 'a', p_kind: 'released' }) && fnParams('admin_mark_founding_messaged') === 'p_id,p_kind');
  check('a status correction: admin_set_founding_status with p_id and p_status', (await setEntryStatus(w.db, 'a', 'joined')) === null && JSON.stringify(w.calls.rpcs[2].args) === JSON.stringify({ p_id: 'a', p_status: 'joined' }) && fnParams('admin_set_founding_status') === 'p_id,p_status');
  check('add a person: admin_add_founding_entry with the five arguments the migration defines', (await addEntry(w.db, { fullName: 'Warm Tutor', codeName: 'Warm', whatsapp: '082 555 0101', email: 'w@x.invalid', status: 'released' })) === null
    && Object.keys(w.calls.rpcs[3].args ?? {}).join() === 'p_full_name,p_code_name,p_whatsapp,p_email,p_status' && fnParams('admin_add_founding_entry') === 'p_full_name,p_code_name,p_whatsapp,p_email,p_status');
  check('the gate switch: admin_set_founding_gate with p_on', (await setGate(w.db, true)) === null && JSON.stringify(w.calls.rpcs[4]) === JSON.stringify({ fn: 'admin_set_founding_gate', args: { p_on: true } }) && fnParams('admin_set_founding_gate') === 'p_on');
  const refusedGate = await setGate(fake({ admin_set_founding_gate: { error: { code: '55000', message: '2 tutor account(s) are not on the list yet. Add or release them first, then switch the gate on.' } } }).db, true);
  check('the database\'s refusal to switch on is shown in its own plain words', refusedGate === '2 tutor account(s) are not on the list yet. Add or release them first, then switch the gate on.');
  check('before the migration every write says "not switched on yet"; a thrown error is a sentence', (await releaseEntries(fake({ admin_release_founding: { error: { code: 'PGRST202' } } }).db, ['a'])).error === FOUNDING_NOT_ON_YET && (await setGate(fake({}, { throws: true }).db, false)) === 'Failed to fetch');
  check('the page writes through the functions only: no update, insert, delete, upsert or select on a table from the admin app', !/\.(update|insert|delete|upsert)\(|\.from\(\s*['"`]/.test(['admin/src/lib/founding.ts', 'admin/src/pages/FoundingTutors.tsx', 'admin/src/components/FoundingBody.tsx'].map(code).join('\n')));

  // ---- the page, drawn ----
  const noop = () => undefined;
  const props = (result: FoundingResult | null, over: Partial<FoundingBodyProps> = {}): FoundingBodyProps => ({
    result, isSuperAdmin: true, filter: NO_FILTER, onFilter: noop, selected: [], onToggle: noop, onSelectMany: noop, busyId: null, busyGate: false, error: null, notice: null, range: { from: '2026-11-04', to: '2026-11-11' }, funnelLoading: false,
    onRange: noop, onCsv: noop, onSaveTags: async () => true, onDelete: noop, onLink: async () => true, waitingSubjects: '', onWaitingSubjects: noop, onRelease: noop, onMark: noop, onStatus: noop, onAdd: async () => true, onGate: noop, onRetry: noop, ...over,
  });
  const body = (result: FoundingResult | null, over: Partial<FoundingBodyProps> = {}) => render(React.createElement(FoundingBody, props(result, over)));
  const okResult = (rows: FoundingEntry[], extra: Partial<{ gate: ReturnType<typeof mapGateCheck>; funnel: ReturnType<typeof mapFunnel>; coverage: ReturnType<typeof mapCoverage>[] }> = {}): FoundingResult => ({
    state: 'ok', data: { entries: rows, coverage: extra.coverage ?? coverageRaw.map(mapCoverage), funnel: extra.funnel === undefined ? mapFunnel(funnelRaw) : extra.funnel, hourly: mapHourly(hourlyRaw), tags: ['f1', 'f1-n1', 'ref-*'], gate: extra.gate === undefined ? mapGateCheck(gateRaw()) : extra.gate },
  });
  check('loading', /Loading the founding tutors list/.test(body(null)));
  const notYet = body({ state: 'not_set_up' });
  check('before the migration: a calm "Nobody on the list yet" with the reason; no alert, no error', /data-founding-not-set-up/.test(notYet) && notYet.includes('Nobody on the list yet') && notYet.includes(FOUNDING_NOT_ON_YET) && !/role="alert"/.test(notYet));
  check('no access shows the plain sentence; a failed read shows the reason and Try again', body({ state: 'no_access' }).includes(FOUNDING_NO_ACCESS) && /role="alert"/.test(body({ state: 'failed', message: 'boom' })) && body({ state: 'failed', message: 'boom' }).includes('Try again'));
  const list = body(okResult(people));
  const flat = list.replace(/<!-- -->/g, '');
  check('the status tabs carry the true counts: All (5), On the list (2), Released (1), Signed up (1), Verified (1)', ['All (5)', 'On the list (2)', 'Released (1)', 'Signed up (1)', 'Verified (1)'].every((s) => flat.includes(s)) && /role="tablist"/.test(list));
  check('filters exist for status, subject, phase and a search box', /aria-label="Filter by subject"/.test(list) && /aria-label="Filter by phase"/.test(list) && /aria-label="Search the list"/.test(list) && flat.includes('English Home Language') && flat.includes('FET (10-12)'));
  check('each person shows name, number, email, subjects with grades, phases, status; and one row per person', ['Ann Arts', 'Ben Maths', 'Cleo Maths', 'Eve Maths', '+27821234567', 'ann@x.invalid', 'English Home Language (Grade 4 to Grade 6)', 'Mathematics (Grade 8 to Grade 12)', 'Intermediate (4-6)'].every((s) => flat.includes(s)) && (list.match(/data-entry=/g) ?? []).length === 5);
  check('"Release" is offered to people on the list only (2 of 5); a released or signed-up person gets the "place open" message link; a verified person gets "Verified: message ready"',
    (list.match(/>Release</g) ?? []).length === 2 && (list.match(/data-release-link/g) ?? []).length === 2 && (list.match(/data-verified-link/g) ?? []).length === 1 && flat.includes('Verified: message ready'));
  const rl = /data-release-link[^>]*>|<a href="([^"]+)"[^>]*data-release-link/.exec(list);
  const hrefs = [...list.matchAll(/<a href="(https:\/\/wa\.me\/[^"]+)"/g)].map((m) => m[1]);
  check('the message buttons are wa.me links that open in a new tab safely, with the text already filled', hrefs.length === 3 && hrefs.every((h) => /^https:\/\/wa\.me\/27821234567\?text=/.test(h)) && /target="_blank" rel="noopener noreferrer"/.test(list) && !!rl);
  check('READINESS: a verified person who is NOT ready (no hours, no police clearance) gets a disabled "message not ready" button that lists what is missing, and NO wa.me link; a ready one gets the link', (() => { const nr = body(okResult([entry({ status: 'verified', effectiveStatus: 'verified', tutorVerified: true, hasAccount: true, ready: false, missing: ['no working hours saved', 'no police clearance on file'] })])); const ok = body(okResult([entry({ status: 'verified', effectiveStatus: 'verified', tutorVerified: true, hasAccount: true, ready: true, missing: [] })])); return /data-not-ready/.test(nr) && /disabled=""[^>]*>Verified: message not ready/.test(nr) && nr.includes('Missing: no working hours saved, no police clearance on file') && !/wa\.me/.test(nr) && /data-verified-link/.test(ok) && !/data-not-ready/.test(ok); })());
  check('readiness comes from the database (ready and missing in admin_founding_entries: verified, an approved subject, hours saved, police_clearance_problem null) and is mapped', mapEntry({ ready: true, missing: [] }).ready === true && mapEntry({ ready: false, missing: ['not verified yet'] }).missing.join() === 'not verified yet' && mapEntry({}).ready === false && /'ready', rd\.missing = '\{\}'::text\[\], 'missing', rd\.missing/.test(MIGRATION) && /public\.police_clearance_problem\(tp\.id\)/.test(MIGRATION) && /c\.verification_status::text = 'verified'/.test(MIGRATION) && /from public\.tutor_availability a where a\.tutor_id = tp\.id/.test(MIGRATION));
  check('THE "STILL WAITING" UPDATE (drafts 5b) is built with the name and the subjects the CEO typed', waitingMessage(person, '  Mathematics and Physical Sciences ') === 'Hi Thandi, a quick update from Tutorlage. This week we opened places for Mathematics and Physical Sciences. Yours has not opened yet: we open places where families are asking. We will message you here when it does. Please keep your documents ready. Reply STOP to leave the list.' && !/\bfree\b/i.test(waitingMessage(person, 'x')));
  const waitingRows = [entry({ id: 'w1', effectiveStatus: 'joined' }), entry({ id: 'w2', effectiveStatus: 'lapsed', status: 'joined', lapsedAt: '2026-11-10T10:00:00Z' }), entry({ id: 'w3', status: 'released', effectiveStatus: 'released' }), entry({ id: 'w4', waitingMessagedAt: new Date(Date.now() - 3600_000).toISOString() })];
  const noSubjects = body(okResult(waitingRows));
  const withSubjects = body(okResult(waitingRows), { waitingSubjects: 'Mathematics' });
  check('STILL WAITING on the list: the subjects box is there; with none typed no link is built (the row says what to do); with subjects typed each person who is NOT released (on the list or lapsed) gets a wa.me link, a released one does not, and the app sends nothing',
    /data-waiting-subjects/.test(noSubjects) && (noSubjects.match(/data-waiting-needs-subjects/g) ?? []).length === 3 && !/data-waiting-link/.test(noSubjects)
    && (withSubjects.match(/data-waiting-link/g) ?? []).length === 3 && withSubjects.includes('Still waiting: message ready') && decodeURIComponent((/data-waiting-link/.exec(withSubjects), (withSubjects.match(/href="(https:\/\/wa\.me\/[^"]+)"[^>]*data-waiting-link/) ?? [])[1] ?? '').split('?text=')[1] ?? '').includes('This week we opened places for Mathematics.'));
  check('a person already sent the update says so (when) and offers no second "Mark as messaged"; the others offer it once the link exists', withSubjects.replace(/<!-- -->/g, '').includes('Still-waiting message sent 1 h ago') && (withSubjects.match(/>Mark as messaged</g) ?? []).length >= 2);
  const mk = fake({ admin_mark_founding_messaged: { data: { ok: true } } });
  check('marking the update sent calls admin_mark_founding_messaged with kind "waiting", which the migration allows and records', (await markMessaged(mk.db, 'w1', 'waiting')) === null && JSON.stringify(mk.calls.rpcs[0].args) === JSON.stringify({ p_id: 'w1', p_kind: 'waiting' }) && /p_kind not in \('released', 'verified', 'waiting'\)/.test(MIGRATION) && /waiting_messaged_at = case when p_kind = 'waiting' then now\(\) else waiting_messaged_at end/.test(MIGRATION) && /'waiting_messaged_at', f\.waiting_messaged_at/.test(MIGRATION) && mapEntry({ waiting_messaged_at: '2026-11-11T08:00:00Z' }).waitingMessagedAt === '2026-11-11T08:00:00Z');
  const lk = fake({ admin_link_founding_entry: { data: { ok: true } } });
  check('LINK THIS ACCOUNT: calls admin_link_founding_entry with p_id and p_email; the database\'s plain refusals are shown; before the migration it says so', (await linkEntry(lk.db, 'e9', 'new@x.invalid')) === null && JSON.stringify(lk.calls.rpcs[0]) === JSON.stringify({ fn: 'admin_link_founding_entry', args: { p_id: 'e9', p_email: 'new@x.invalid' } }) && fnParams('admin_link_founding_entry') === 'p_id,p_email'
    && (await linkEntry(fake({ admin_link_founding_entry: { error: { code: '55000', message: 'There is no account with that email yet' } } }).db, 'e9', 'a@b.c')) === 'There is no account with that email yet' && (await linkEntry(fake({ admin_link_founding_entry: { error: { code: 'PGRST202' } } }).db, 'e9', 'a@b.c')) === FOUNDING_NOT_ON_YET);
  check('the link form shows only for a person with no account who joined (not for an account that exists, not for an existing tutor\'s line)', (body(okResult([entry({ hasAccount: false })])).match(/data-link-account/g) ?? []).length === 1 && !/data-link-account/.test(body(okResult([entry({ hasAccount: true })]))) && !/data-link-account/.test(body(okResult([entry({ source: 'backfill', hasAccount: false })]))));
  check('a released person who has not been messaged offers "Mark as messaged"; once messaged it says when',
    flat.includes('Mark as messaged') && /Messaged \d+ (min|h|days)/.test(body(okResult([entry({ status: 'released', effectiveStatus: 'released', releasedMessagedAt: new Date(Date.now() - 3 * 3600_000).toISOString() })])).replace(/<!-- -->/g, '')));
  check('a person with no WhatsApp number (an existing tutor account) gets no link and no Release', (() => { const h = body(okResult([entry({ source: 'backfill', status: 'verified', effectiveStatus: 'verified', whatsapp: null, email: null, fullName: '', codeName: '' })])); return /no WhatsApp number/.test(h) && !/wa\.me/.test(h) && /existing tutor account/.test(h); })());
  check('the details fold open with the consents and their times, the delete date, the answers and the tutoring history', ['Consent to contact', 'Consent to news and offers', 'not given', 'Details deleted on', 'Police clearance: ', 'Applied', 'Two years of maths'].every((s) => flat.includes(s)));
  check('bulk release: select everyone shown who is waiting, then Release selected (N)', flat.includes('Select everyone shown who is waiting (2)') && flat.includes('Release selected (0)') && body(okResult(people), { selected: ['1', '2'] }).replace(/<!-- -->/g, '').includes('Release selected (2)') && /aria-label="Select Ann Arts"/.test(list));
  check('a save in progress shows on that row only (its buttons wait)', /disabled=""[^>]*>Release</.test(body(okResult(people), { busyId: '1' })) && !/disabled=""[^>]*>Release</.test(body(okResult(people), { busyId: 'zzz' })));
  check('the last action\'s refusal or notice shows above the list', /role="alert"[^>]*>Only a super admin/.test(body(okResult(people), { error: 'Only a super admin can switch the founding tutors gate' })) && /role="status"[^>]*>Released 2/.test(body(okResult(people), { notice: 'Released 2.' })));
  const ghost = body(okResult(people), { filter: { ...NO_FILTER, status: 'verified', subject: 'English Home Language' } });
  check('filters that match nobody say so; an empty list says where people come from', /Nobody matches those filters/.test(ghost) && /People who fill in the founding tutors page appear here/.test(body(okResult([]))));
  const hostile = body(okResult([entry({ fullName: '<script>alert(1)</script>', codeName: '<b>Eve</b>', priorTutoring: '<img src=x onerror=alert(2)>', unavailableWeeks: '<i>x</i>' })]));
  check('what people typed is printed as plain text: tags are escaped', !/<script>alert/.test(hostile) && !/<img src=x/.test(hostile) && !/<b>Eve/.test(hostile) && hostile.includes('&lt;script&gt;'));
  check('none of the new admin files uses dangerouslySetInnerHTML or innerHTML', !/dangerouslySetInnerHTML|innerHTML/.test(['admin/src/lib/founding.ts', 'admin/src/pages/FoundingTutors.tsx', 'admin/src/components/FoundingBody.tsx'].map(code).join('\n')));

  // ---- the gate card ----
  const offClean = body(okResult(people));
  check('GATE OFF and clean: shows OFF, the read-back numbers, and an enabled "Switch the gate ON"', /data-gate="off"/.test(offClean) && /data-gate-readback/.test(offClean) && />Switch the gate ON</.test(offClean) && !/disabled=""[^>]*>Switch the gate ON/.test(offClean) && !/data-gate-blocked/.test(offClean));
  const blockedGate = mapGateCheck(gateRaw({ not_listed: 3, not_listed_accounts: [{ id: 'x', name: 'Nia Notlisted' }, { id: 'y', name: 'Olu Other' }] }));
  const blockedView = body(okResult(people, { gate: blockedGate }));
  check('GATE with tutors not on the list: names them, tells the CEO to add or release them, and the ON switch is disabled', /data-gate-blocked/.test(blockedView) && blockedView.includes('Nia Notlisted, Olu Other') && blockedView.replace(/<!-- -->/g, '').includes('and 1 more') && /disabled=""[^>]*>Switch the gate ON/.test(blockedView));
  check('only a super admin can press the switch (the database also refuses anyone else)', /disabled=""[^>]*>Switch the gate ON/.test(body(okResult(people), { isSuperAdmin: false })) && body(okResult(people), { isSuperAdmin: false }).includes('Only a super admin can switch it.'));
  const onView = body(okResult(people, { gate: mapGateCheck(gateRaw({ gate_on: true })) }));
  check('GATE ON: shows ON, explains the four states, and offers "Switch the gate OFF" (Phase 4)', /data-gate="on"/.test(onView) && />Switch the gate OFF</.test(onView) && onView.includes('wait to be verified'));
  check('a gate check that could not be read says so without breaking the page', /data-gate-unknown/.test(body(okResult(people, { gate: null }))));

  // ---- page counts and coverage ----
  const fun = body(okResult(people)).replace(/<!-- -->/g, '');
  check('PAGE COUNTS (R1): opens, new visitors, see more (first), form started (first), joined, and joined per visitor (2 of 8 = 25%); the daily figures are new ones so the days add up', /data-funnel/.test(fun) && ['Opens', 'New visitors', 'See more (first)', 'Form started (first)', 'Joined', 'Joined per visitor', '25%', 'so the days add up'].every((s) => fun.includes(s)));
  check('PAGE COUNTS by tag (f1, none; zz9 flagged not in the registry, and listed under Tags not in the registry), by day (South African time, always shown, with Download CSV), by hour (last 72 hours), a date range and 7, 14 and 30 day buttons', /data-funnel-src/.test(fun) && fun.includes('>f1<') && fun.includes('>(none)<') && /data-unregistered/.test(fun) && fun.includes('Tags not in the registry: zz9') && fun.includes('not in registry') && /data-funnel-day/.test(fun) && /data-csv/.test(fun) && fun.includes('Download CSV (counts only)') && fun.includes('2026-11-11') && /data-funnel-hour/.test(fun) && fun.includes('2026-11-11 09:00') && ['7 days', '14 days', '30 days'].every((s) => fun.includes(s)) && /aria-label="From day"/.test(fun.replace(/"/g, '"')));
  check('with nobody yet, the counts say so; the percentage is a dash when there are no visitors', body(okResult(people, { funnel: mapFunnel({ days: 30, by_day: [], by_src: [], totals: { opens: 0, visitors: 0, see_more: 0, form_start: 0, joins: 0 } }) })).includes('Nobody has opened the page') && rate(0, 0) === '–' && rate(1, 3) === '33%');
  check('counts that could not be read say so', /data-funnel-unknown/.test(body(okResult(people, { funnel: null }))));
  const cov = body(okResult(people)).replace(/<!-- -->/g, '');
  check('COVERAGE (R7): subject, band, on the list, released, verified, ready tutors, weekly hours, requests, accepted, unserved, expired, status (Mathematics Senior: 8 on the list, 2 ready, 14.5 hours, 9 requests, 5 unserved, THIN, demand no supply)', /data-coverage/.test(cov) && ['On the list', 'Released', 'Verified', 'Ready tutors', 'Weekly hours', 'Requests', 'Accepted', 'Unserved', 'Expired', 'Status', 'Mathematics', 'Senior (7-9)', '14.5', 'Afrikaans', '>THIN<', '>EMPTY<', '>OPEN<', 'demand, no supply'].every((s) => cov.includes(s)));
  check('unserved demand with fewer than 3 ready tutors is marked (red) so the CEO sees where to release first; a covered subject is not', /text-rose-700 font-bold">5</.test(cov) && /text-rose-700 font-bold">3</.test(cov) && !/text-rose-700 font-bold">0</.test(cov));
  check('"Add a person" is on the page with the five fields, for a warm tutor', /data-add/.test(list) && ['Full name', 'Name for the link', 'WhatsApp number', 'Sign-up email', 'Add to the list'].every((s) => list.includes(s)));
  check('"ago" is a short plain phrase', describeAgo('2026-11-10T11:57:00Z', new Date('2026-11-10T12:00:00Z')) === '3 min ago');

  // ---- the menu and the route ----
  const layout = code('admin/src/components/AdminLayout.tsx');
  const router = code('admin/src/App.tsx');
  check('the menu has a Founding tutors item for verification officers and super admins (the same two the database allows)', /\{ to: '\/founding', label: 'Founding tutors', icon: ListChecks, roles: \['verification_officer', 'super_admin'\] \}/.test(layout) && /admin_role in \('verification_officer', 'super_admin'\)/.test(MIGRATION));
  check('the router has the /founding page', /import \{ FoundingTutors \} from '\.\/pages\/FoundingTutors';/.test(router) && /<Route path="founding" element=\{<FoundingTutors \/>\} \/>/.test(router));
  check('only a super admin sees the enabled gate switch on the page (read from the signed-in admin\'s role)', /isSuperAdmin=\{adminProfile\?\.adminRole === 'super_admin'\}/.test(code('admin/src/pages/FoundingTutors.tsx')) && /window\.confirm\(/.test(code('admin/src/pages/FoundingTutors.tsx')));
  check('a single release also opens that person\'s message (a blocked pop-up still leaves the button)', /window\.open\(link, '_blank', 'noopener,noreferrer'\)/.test(code('admin/src/pages/FoundingTutors.tsx')) && /r\.released > 0/.test(code('admin/src/pages/FoundingTutors.tsx')));
  check('no new admin text says "free" lessons or sessions', !/\bfree\b/i.test(['admin/src/lib/founding.ts', 'admin/src/pages/FoundingTutors.tsx', 'admin/src/components/FoundingBody.tsx'].map(code).join('\n')));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
