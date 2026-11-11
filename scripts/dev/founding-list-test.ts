// Checks on the FOUNDING TUTORS LIST, public side (CEO's order of 10 Nov 2026; plan Drake/project-manager/tutor-waitlist-page-action-plan-2026-11-10.md P-1, P-3, P-4).
// Run: npx tsx scripts/dev/founding-list-test.ts
// Proves, with a fake database client, drawn markup and by reading the source and the migration text: the words are the drafts' and never say "free" or name where tutors
// come from; the +27 number tidy; the form's checks; the payload's keys are exactly the ones the migration's join function reads (and its allowed answers are the form's
// options); every answer of the database becomes a plain sentence; the counters are fire-and-forget and need a visitor id; the anonymous visitor id; the Teach gate reads
// "open" on any doubt, parses the four states, and the three screens it guards use it; the page is not indexed and not linked from anywhere public.
// It does NOT prove the database behaviour (supabase/tests/founding_tutors_list.sql, rolled back) or the page in a real browser (checked separately in the Browser pane).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  EMPTY_FOUNDING_FORM, FOUNDING_CONSENT_VERSION, FOUNDING_COPY, FOUNDING_GATE_STATES, FOUNDING_MAX_SUBJECTS, FOUNDING_MIN_FILL_MS, FOUNDING_VISITOR_KEY, GATE_OPEN, SHOW_PERSONAL_LINK_LINE,
  allFoundingWords, buildJoinPayload, cleanSrc, describeJoinError, fetchMyFoundingGate, gateBlocksTutorSide, gateMessage, getVisitorId, isUuid, joinFoundingList, logFoundingEvent,
  noticeBody, parseFoundingGate, randomId, srcFromSearch, tidyZaMobile, validateFoundingForm, countingSwitchedOff, getFirstTag, logCodeOpen, looksLikeBot,
  type FoundingClient, type FoundingForm, type FoundingLists,
} from '../../src/lib/foundingList';
import { FoundingGateInline, FoundingGateNotice } from '../../src/components/FoundingGateNotice';
import { PAGE_META } from '../../src/lib/pageMeta';
import { fetchFoundingGatePublic } from '../../src/lib/foundingGatePublic';
import { requirementsFor } from '../../src/lib/tutorOnboarding';

const rootRequire = createRequire(new URL('../../package.json', import.meta.url));
const React = rootRequire('react') as typeof import('react');
const render = (rootRequire('react-dom/server') as typeof import('react-dom/server')).renderToStaticMarkup;

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MIGRATION = read('supabase/migrations/20261110200000_founding_tutors_list.sql');

type Err = { code?: string; message?: string } | null;
function fake(opts: { data?: unknown; error?: Err; throws?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const db: FoundingClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (opts.throws) throw new Error('Failed to fetch');
      return { data: 'data' in opts ? opts.data : { ok: true }, error: opts.error ?? null };
    },
  };
  return { db, calls };
}

const lists: FoundingLists = {
  subjects: ['Mathematics', 'Physical Sciences', 'English Home Language'],
  grades: ['Grade R', 'Grade 1', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12', 'Honours'],
};
const goodForm = (over: Partial<FoundingForm> = {}): FoundingForm => ({
  ...EMPTY_FOUNDING_FORM, fullName: 'Thandi Test', codeName: 'Thandi', whatsapp: '082 123 4567', email: 'thandi@example.invalid', isAdult: true,
  subjects: [{ subject: 'Mathematics', minGrade: 'Grade 8', maxGrade: 'Grade 12' }], availability: ['evenings'], practicum: 'two', policeClearance: 'applied', parentReach: '10_to_30',
  parentReachWilling: 'yes', consentContact: true, ...over,
});

async function main() {
  // ---- the words ----
  const words = allFoundingWords();
  check('the page is called "Founding tutors list" and the first sentence is the drafts\'', FOUNDING_COPY.pageTitle === 'Founding tutors list'
    && FOUNDING_COPY.intro === 'Paid, freelance tutoring on your own hours. Join the list and we will message you when your place opens.');
  check('the two top buttons are "Join the list" and "See more"', FOUNDING_COPY.join === 'Join the list' && FOUNDING_COPY.seeMore === 'See more');
  check('the pay paragraph is the CEO\'s of 10 Nov night: from R35 up to R590 (4B, the highest level families can book today); R1,044 (4D) is NOT used', /Rates start from R35 an hour and go up to R590 an hour at our highest level\./.test(FOUNDING_COPY.more.earn) && !/1,044|1044/.test(words));
  check('the documents to prepare are the four in the drafts, with the WhatsApp warning', FOUNDING_COPY.more.docs.length === 4 && FOUNDING_COPY.more.docsWarning === 'Never send documents on WhatsApp. You upload them in the app.');
  check('the personal-link line is held (the code system is not live): the switch is off and the page only draws it behind that switch', SHOW_PERSONAL_LINK_LINE === false && /SHOW_PERSONAL_LINK_LINE && \(/.test(code('src/pages/FoundingTutors.tsx')));
  check('the confirmation line is the drafts\'', FOUNDING_COPY.done === 'You are on the list. We will message you on WhatsApp when your place opens. Start getting your documents ready.');
  check('the three Teach-button messages are the drafts\' (not on the list, waiting)', FOUNDING_COPY.gateNotListed === 'Tutoring places open in groups. Join the founding tutors list and we will message you when your place opens.'
    && FOUNDING_COPY.gateWaiting === 'Your place has not opened yet. We will message you on WhatsApp when it does. Until then this page is not available. You can get your documents ready now.');
  check('the two consent boxes: the first is marked Required and the second Optional, in the drafts\' words, and neither is pre-ticked', FOUNDING_COPY.consentContact.startsWith('Required: I agree that Tutorlage may use the details I give here to contact me')
    && FOUNDING_COPY.consentMarketing.startsWith('Optional: I also agree that Tutorlage may send me news, offers and invitations') && !EMPTY_FOUNDING_FORM.consentContact && !EMPTY_FOUNDING_FORM.consentMarketing);
  check('the notice carries the retention promise (30 days after the place opens, 6 months after joining), STOP, and the privacy contact', /30 days after your place opens, or 6 months after you join/.test(noticeBody('x@y.z')) && /reply STOP/.test(noticeBody('x@y.z')) && noticeBody('support@tutorlage.com').includes('support@tutorlage.com') && !noticeBody('a@b.c').includes('{email}'));
  check('NO "free" lessons or sessions anywhere in the words ("freelance" is the drafts\' own word and is allowed)', !/\bfree\b/i.test(words));
  check('NEVER names or describes the school, campus, faculty or where tutors come from', !/campus|facult|universit|lecturer|class group|waterfall|education student|student teacher|\bdean\b|head of/i.test(words));
  check('the visible "how did you hear" choices are plain (a message or group chat, a friend, other)', FOUNDING_COPY.heardOptions.map((o) => o.label).join() === 'A message or group chat,A friend,Other');

  // ---- the number tidy ----
  check('six ways of writing one number give +27821234567', ['082 123 4567', '0821234567', '+27 82 123 4567', '27821234567', '0027 82 123 4567', '082-123-4567'].every((n) => tidyZaMobile(n) === '+27821234567'));
  check('"+27 (0) 82 123 4567" and "821234567" are tidied', tidyZaMobile('+27 (0) 82 123 4567') === '+27821234567' && tidyZaMobile('821234567') === '+27821234567');
  check('a landline, a short number, letters, a foreign number and nothing are refused', [tidyZaMobile('011 123 4567'), tidyZaMobile('12345'), tidyZaMobile('call me'), tidyZaMobile('+44 7911 123456'), tidyZaMobile('')].every((v) => v === null));
  check('the tidy is the same rule as the database\'s (the same six patterns are in the migration)', /d like '0027%'/.test(MIGRATION) && /d like '270%' and length\(d\) = 12/.test(MIGRATION) && /d like '0%' and length\(d\) = 10/.test(MIGRATION) && /\^27\[6-8\]\[0-9\]\{8\}\$/.test(MIGRATION));

  // ---- the ?src= tag ----
  check('?src=f1 is "f1"; capitals and spaces are cleaned; nothing, a bad word or 33 letters is no tag', srcFromSearch('?src=f1') === 'f1' && srcFromSearch('?src=%20F1-N2%20') === 'f1-n2' && srcFromSearch('') === null && srcFromSearch('?src=a%20b') === null
    && cleanSrc('a'.repeat(32)) === 'a'.repeat(32) && cleanSrc('a'.repeat(33)) === null && cleanSrc('<b>') === null && cleanSrc(null) === null);
  check('the visitor-id line is in the consent notice (drafts section 4)', noticeBody('x@y.z').includes('To count visitors, this page keeps a random number in your browser; it holds no personal details.'));
  const fstore = new Map<string, string>();
  const fs = { getItem: (k: string) => fstore.get(k) ?? null, setItem: (k: string, v: string) => void fstore.set(k, v), removeItem: (k: string) => void fstore.delete(k) };
  check('FIRST TAG: the first tag ever seen stays; a later tag does not overwrite it', getFirstTag(fs, 'f1') === 'f1' && getFirstTag(fs, 'f1-n2') === 'f1' && getFirstTag(fs, null) === 'f1');
  const fstore2 = new Map<string, string>();
  const fs2 = { getItem: (k: string) => fstore2.get(k) ?? null, setItem: (k: string, v: string) => void fstore2.set(k, v) };
  check('a first visit with no tag is remembered as "none": a later tagged visit is still filed under none', getFirstTag(fs2, null) === null && getFirstTag(fs2, 'f1') === null);
  check('a blocked store gives this load\'s tag and never throws', getFirstTag({ getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } }, 'ceo') === 'ceo' && getFirstTag(null, 'ceo') === 'ceo');
  const sk = new Map<string, string>();
  const sks = { getItem: (k: string) => sk.get(k) ?? null, setItem: (k: string, v: string) => void sk.set(k, v), removeItem: (k: string) => void sk.delete(k) };
  check('DO NOT COUNT THIS BROWSER: ?nocount=1 switches counting off here and it stays off; ?nocount=0 puts it back; no switch means counting', !countingSwitchedOff('', sks) && countingSwitchedOff('?nocount=1', sks) && countingSwitchedOff('', sks) && !countingSwitchedOff('?nocount=0', sks) && !countingSwitchedOff('', sks) && !countingSwitchedOff('?x=1', null));
  check('robots, scripted browsers and link-preview fetchers are not counted; an ordinary phone is', looksLikeBot({ webdriver: true, userAgent: 'x' }) && looksLikeBot({ userAgent: 'WhatsApp/2.23 A' }) && looksLikeBot({ userAgent: 'Mozilla/5.0 HeadlessChrome' }) && looksLikeBot({ userAgent: 'facebookexternalhit/1.1' })
    && !looksLikeBot({ userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' }) && !looksLikeBot(null));

  // ---- the form's checks ----
  const empty = validateFoundingForm(EMPTY_FOUNDING_FORM, lists);
  check('an empty form flags every needed field (name, link name, number, email, 18+, subjects, practicum, police, reach, willing, consent a)', ['fullName', 'codeName', 'whatsapp', 'email', 'isAdult', 'subjects', 'practicum', 'policeClearance', 'parentReach', 'parentReachWilling', 'consentContact'].every((k) => k in empty) && Object.keys(empty).length === 11);
  check('a complete form passes with no error', Object.keys(validateFoundingForm(goodForm(), lists)).length === 0);
  check('consent b, availability, weeks away, tutoring history and "heard about it" are optional', Object.keys(validateFoundingForm(goodForm({ availability: [], unavailableWeeks: '', priorTutoring: '', heardFrom: '', consentMarketing: false }), lists)).length === 0);
  check('the three "I have" ticks are not forced (someone without a bank account can still join)', Object.keys(validateFoundingForm(goodForm({ hasDevice: false, hasConnection: false, hasBank: false }), lists)).length === 0);
  check('a subject that is not in the app\'s list, or grades the wrong way round, are refused', 'subjects' in validateFoundingForm(goodForm({ subjects: [{ subject: 'Basket Weaving', minGrade: 'Grade 8', maxGrade: 'Grade 9' }] }), lists)
    && 'subjects' in validateFoundingForm(goodForm({ subjects: [{ subject: 'Mathematics', minGrade: 'Grade 12', maxGrade: 'Grade 8' }] }), lists)
    && !('subjects' in validateFoundingForm(goodForm({ subjects: [{ subject: 'mathematics', minGrade: 'grade 8', maxGrade: 'GRADE 12' }] }), lists)));
  check('up to 12 subjects, not 13', FOUNDING_MAX_SUBJECTS === 12 && !('subjects' in validateFoundingForm(goodForm({ subjects: Array.from({ length: 12 }, () => ({ subject: 'Mathematics', minGrade: 'Grade 8', maxGrade: 'Grade 9' })) }), lists))
    && 'subjects' in validateFoundingForm(goodForm({ subjects: Array.from({ length: 13 }, () => ({ subject: 'Mathematics', minGrade: 'Grade 8', maxGrade: 'Grade 9' })) }), lists));
  check('under 18 (not ticked), a landline, a bad email, a 301-character history and angle brackets are refused in words', 'isAdult' in validateFoundingForm(goodForm({ isAdult: false }), lists) && 'whatsapp' in validateFoundingForm(goodForm({ whatsapp: '011 123 4567' }), lists)
    && 'email' in validateFoundingForm(goodForm({ email: 'nope' }), lists) && 'priorTutoring' in validateFoundingForm(goodForm({ priorTutoring: 'x'.repeat(301) }), lists) && 'fullName' in validateFoundingForm(goodForm({ fullName: '<b>x</b>' }), lists));

  // ---- the payload (its keys are exactly the ones the database reads) ----
  const payload = buildJoinPayload(goodForm({ parentReachWilling: 'no', consentMarketing: true, subjects: [{ subject: 'Mathematics', minGrade: 'Grade 8', maxGrade: 'Grade 12' }, { subject: '', minGrade: '', maxGrade: '' }] }),
    { elapsedMs: 12345.6, website: '', src: 'fac', visitor: '11111111-1111-4111-8111-111111111111' });
  const fnText = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.join_founding_list'), MIGRATION.indexOf('revoke all on function public.join_founding_list'));
  const readKeys = new Set([...fnText.matchAll(/p ->>? '([a-z_]+)'/g)].map((m) => m[1]));
  check('the payload sends exactly the keys the migration\'s join function reads', [...readKeys].sort().join() === Object.keys(payload).sort().join(), `${[...readKeys].sort().join()} | ${Object.keys(payload).sort().join()}`);
  check('empty subject rows are dropped; the others use min_grade / max_grade as the database reads them', (payload.subjects as unknown[]).length === 1 && JSON.stringify(payload.subjects) === JSON.stringify([{ subject: 'Mathematics', min_grade: 'Grade 8', max_grade: 'Grade 12' }]) && /el ->> 'min_grade'|v_el ->> 'min_grade'/.test(fnText) && /v_el ->> 'max_grade'/.test(fnText));
  check('the time the form was open is a whole number of ms, the willing answer is a boolean, consent b is kept, the wording version is sent', payload.elapsed_ms === 12346 && payload.parent_reach_willing === false && payload.consent_marketing === true && payload.consent_version === FOUNDING_CONSENT_VERSION);
  check('the 4-second bot trap is the same number on both sides', FOUNDING_MIN_FILL_MS === 4000 && /< 4000/.test(fnText));
  const opt = (arr: ReadonlyArray<{ value: string }>) => arr.map((o) => o.value).join();
  check('the answers the form offers are exactly the ones the migration allows (practicum, police, parents, heard from, availability)',
    /in \('none', 'one', 'two', 'three_plus'\)/.test(fnText) && opt(FOUNDING_COPY.practicumOptions) === 'none,one,two,three_plus'
    && /in \('have', 'applied', 'not_yet'\)/.test(fnText) && opt(FOUNDING_COPY.policeOptions) === 'have,applied,not_yet'
    && /in \('none', 'up_to_10', '10_to_30', 'over_30'\)/.test(fnText) && opt(FOUNDING_COPY.reachOptions) === 'none,up_to_10,10_to_30,over_30'
    && /in \('message', 'friend', 'other'\)/.test(fnText) && opt(FOUNDING_COPY.heardOptions) === 'message,friend,other'
    && /a in \('evenings', 'weekends', 'holidays'\)/.test(fnText) && opt(FOUNDING_COPY.availabilityOptions) === 'evenings,weekends,holidays');
  check('the subject limit is 12 on both sides', /not between 1 and 12/.test(fnText));

  // ---- joining ----
  const ok = fake({ data: { ok: true } });
  const done = await joinFoundingList(ok.db, payload);
  check('joining calls join_founding_list with one argument called p and nothing else', done.ok === true && ok.calls.length === 1 && ok.calls[0].fn === 'join_founding_list' && Object.keys(ok.calls[0].args ?? {}).join() === 'p' && /create or replace function public\.join_founding_list\(p jsonb\)/.test(MIGRATION));
  const refused = await joinFoundingList(fake({ error: { code: '22023', message: 'Please enter a South African WhatsApp number, for example 082 123 4567.' } }).db, payload);
  check('the database\'s own plain sentence about a field is shown as it is', !refused.ok && 'message' in refused && refused.message === 'Please enter a South African WhatsApp number, for example 082 123 4567.');
  check('the busy-hour sentence is shown as it is', describeJoinError({ code: '54000', message: 'Many people are joining right now. Please try again in a few minutes.' }) === 'Many people are joining right now. Please try again in a few minutes.');
  check('a database without the migration says "not open yet" (by code, and by words)', describeJoinError({ code: 'PGRST202' }) === FOUNDING_COPY.notOpen && describeJoinError({ message: 'Could not find the function public.join_founding_list(p) in the schema cache' }) === FOUNDING_COPY.notOpen);
  check('any other error, and a thrown one, say what to do and that the typing is safe', describeJoinError({ code: '500', message: 'boom' }) === FOUNDING_COPY.failed && FOUNDING_COPY.failed.includes('still here')
    && (await joinFoundingList(fake({ throws: true }).db, payload)).ok === false && (await joinFoundingList(fake({ data: null }).db, payload)).ok === false);

  // ---- the counters ----
  const counter = fake();
  await logFoundingEvent(counter.db, '11111111-1111-4111-8111-111111111111', 'see_more', 'fac');
  check('a count calls log_founding_event with the visitor, the event, the link\'s tag and the visitor\'s first tag', counter.calls.length === 1 && counter.calls[0].fn === 'log_founding_event' && JSON.stringify(counter.calls[0].args) === JSON.stringify({ p_visitor: '11111111-1111-4111-8111-111111111111', p_event: 'see_more', p_src: 'fac', p_first: null })
    && /function public\.log_founding_event\(p_visitor text, p_event text, p_src text default null, p_first text default null\)/.test(MIGRATION));
  const codeCall = fake();
  await logCodeOpen(codeCall.db, '11111111-1111-4111-8111-111111111111', 'ODI-2026');
  await logCodeOpen(codeCall.db, '11111111-1111-4111-8111-111111111111', '<bad>');
  check('CODE OPENS (the Codes page counts them with this same counter): one code_open event, the code lower-cased in src; a bad code sends nothing', codeCall.calls.length === 1 && JSON.stringify(codeCall.calls[0].args) === JSON.stringify({ p_visitor: '11111111-1111-4111-8111-111111111111', p_event: 'code_open', p_src: 'odi-2026', p_first: null })
    && /'code_open'/.test(MIGRATION) && /event in \('open', 'see_more', 'form_start', 'join', 'code_open'\)/.test(MIGRATION));
  const counter2 = code('src/lib/foundingCount.ts');
  check('the address\'s ?code= is counted once from main.tsx, loading the database client and the counter only on demand; a switched-off browser and robots are skipped', /countCodeOpenFromUrl\(\);/.test(code('src/main.tsx')) && /import\('\.\/supabaseClient'\)/.test(counter2) && /import\('\.\/foundingList'\)/.test(counter2)
    && /countingSwitchedOff/.test(counter2) && /looksLikeBot/.test(counter2) && /if \(sent \|\| /.test(counter2) && !/from '\.\/foundingList'/.test(counter2.replace(/import type \{ FoundingClient \} from '\.\/foundingList';/, '')));
  const none = fake();
  await logFoundingEvent(none.db, null, 'open', null);
  check('with no visitor id nothing is sent', none.calls.length === 0);
  let threw = false;
  try { await logFoundingEvent(fake({ throws: true }).db, '11111111-1111-4111-8111-111111111111', 'open', null); } catch { threw = true; }
  check('a failed count is swallowed: counting never disturbs the page', !threw);
  check('the three counts the page sends are open, see_more, form_start (a join is counted by the database itself)', /p_event not in \('open', 'see_more', 'form_start', 'code_open'\)/.test(MIGRATION) && /\['open'\]|'open'/.test(code('src/pages/FoundingTutors.tsx')) && /count\('see_more'\)/.test(code('src/pages/FoundingTutors.tsx')) && /count\('form_start'\)/.test(code('src/pages/FoundingTutors.tsx')) && !/count\('join'\)/.test(code('src/pages/FoundingTutors.tsx')));

  // ---- the anonymous visitor id ----
  const memory = new Map<string, string>();
  const store = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
  const first = getVisitorId(store);
  check('a new visitor gets a random uuid, kept under one key; the same visitor gets the same id', isUuid(first) && memory.get(FOUNDING_VISITOR_KEY) === first && getVisitorId(store) === first);
  memory.set(FOUNDING_VISITOR_KEY, 'not-a-uuid');
  check('a damaged stored value is replaced with a fresh uuid', isUuid(getVisitorId(store)) && isUuid(memory.get(FOUNDING_VISITOR_KEY) ?? ''));
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  check('storage that is blocked still gives an id (for this page load) and never throws', isUuid(getVisitorId(blocked)) && isUuid(getVisitorId(null)));
  check('random ids are version-4 uuids and differ', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(randomId()) && randomId() !== randomId());
  check('the visitor id holds no personal data: the page keeps nothing else in the browser', (code('src/pages/FoundingTutors.tsx').match(/localStorage|sessionStorage|document\.cookie/g) ?? []).length === 1 && /return window\.localStorage/.test(code('src/pages/FoundingTutors.tsx')));

  // ---- the Teach gate ----
  check('the five states are the database\'s', FOUNDING_GATE_STATES.join() === 'open,not_listed,waiting,released,verified' && ['not_listed', 'waiting', 'released', 'verified', 'open'].every((s) => MIGRATION.includes(`'${s}'`)));
  check('the answer is parsed (state and switch); a list of one is read; nonsense is "open"', JSON.stringify(parseFoundingGate({ gate_on: true, state: 'waiting' })) === JSON.stringify({ gateOn: true, state: 'waiting' })
    && parseFoundingGate([{ gate_on: true, state: 'released' }]).state === 'released' && JSON.stringify(parseFoundingGate({ state: 'banana' })) === JSON.stringify(GATE_OPEN) && JSON.stringify(parseFoundingGate(null)) === JSON.stringify(GATE_OPEN));
  const gateCall = fake({ data: { gate_on: true, state: 'not_listed' } });
  check('the app asks my_founding_gate with no arguments and gets the state', (await fetchMyFoundingGate(gateCall.db)).state === 'not_listed' && gateCall.calls[0].fn === 'my_founding_gate' && gateCall.calls[0].args === undefined && /function public\.my_founding_gate\(\)/.test(MIGRATION));
  check('before the migration, on any error, and on a throw the answer is "open": the screens are as they were', (await fetchMyFoundingGate(fake({ error: { code: 'PGRST202' } }).db)).state === 'open' && (await fetchMyFoundingGate(fake({ error: { code: '42501' } }).db)).state === 'open' && (await fetchMyFoundingGate(fake({ throws: true }).db)).state === 'open');
  check('only "not on the list" and "waiting" are kept off the tutor side', gateBlocksTutorSide('not_listed') && gateBlocksTutorSide('waiting') && !gateBlocksTutorSide('open') && !gateBlocksTutorSide('released') && !gateBlocksTutorSide('verified'));
  check('a message exists for the two blocked states only', gateMessage('not_listed') === FOUNDING_COPY.gateNotListed && gateMessage('waiting') === FOUNDING_COPY.gateWaiting && gateMessage('open') === null && gateMessage('released') === null && gateMessage('verified') === null);

  // ---- the Teach screens, drawn ----
  const { MemoryRouter } = (await import('react-router-dom')) as typeof import('react-router-dom');
  const notListed = render(React.createElement(MemoryRouter, null, React.createElement(FoundingGateNotice, { state: 'not_listed' })));
  const waiting = render(React.createElement(MemoryRouter, null, React.createElement(FoundingGateNotice, { state: 'waiting' })));
  check('NOT ON THE LIST: the "join the list" message and a Join the list button that goes to /teach', notListed.includes('Tutoring places open in groups.') && /href="\/teach"[^>]*>Join the list</.test(notListed) && /data-founding-gate="not_listed"/.test(notListed));
  check('WAITING: the "place has not opened" message, mentions documents, and has no button to anywhere', waiting.includes('Your place has not opened yet.') && waiting.includes('get your documents ready now') && !/<a /.test(waiting) && /data-founding-gate="waiting"/.test(waiting));
  check('the small version (Teaching tab) says the same sentence', render(React.createElement(FoundingGateInline, { state: 'waiting' })).includes('Your place has not opened yet.'));

  // ---- where the gate and the page are wired ----
  const app = code('src/App.tsx');
  check('the Teach view in the app is wrapped in the gate (children: the same TeachGoScreen as before)', /<FoundingTeachGate>\s*<TeachGoScreen/.test(app) && /import \{ FoundingTeachGate \} from '\.\/components\/FoundingGate';/.test(app));
  const gateFile = code('src/components/TutorOnboardingGate.tsx');
  check('the tutor sign-up pages are not shown to a place that has not opened (decided once the gate state is known)', /useFoundingGate\(\)/.test(gateFile) && /!gateBlocksTutorSide\(gate\.state\) && stage !== 'not-needed'/.test(gateFile) && /state && !gateLoading && showFlow === null/.test(gateFile));
  check('the documents page sends a place that has not opened back to the app', /gateBlocksTutorSide\(gate\.state\)\) return <Navigate to="\/" replace \/>/.test(code('src/pages/TutorDocuments.tsx')));
  const panelFile = code('src/components/VerificationDocumentsPanel.tsx');
  check('the Teaching tab\'s document upload is behind the same gate (the panel\'s own export wraps its body; the Teaching tab line is unchanged)', /export const VerificationDocumentsPanel: React\.FC<\{ tutorId: string \}> = \(\{ tutorId \}\) => \(\s*<FoundingDocumentsGate>\s*<DocumentsPanelBody tutorId=\{tutorId\} \/>/.test(panelFile)
    && /FEATURES\.verificationDocuments && <VerificationDocumentsPanel tutorId=\{tutor\.id\} \/>/.test(code('src/components/TeachingProfilePanel.tsx')) && !/FoundingGate/.test(code('src/components/TeachingProfilePanel.tsx')));
  check('the gate shows its children while loading is over and the gate is off; it shows a plain "Loading…" meanwhile (no flash of the tutor side)', /if \(loading\) \{[\s\S]*gateLoading/.test(code('src/components/FoundingGate.tsx')) && /return <>\{children\}<\/>;/.test(code('src/components/FoundingGate.tsx')));
  check('the hook has no answer for a signed-out person (no call) and shares one answer for 30 seconds', /if \(!userId\) return \{ gate: GATE_OPEN, loading: false \}/.test(code('src/lib/foundingGateHooks.ts')) && /ANSWER_LIFETIME_MS = 30_000/.test(code('src/lib/foundingGateHooks.ts')));

  const main = code('src/main.tsx');
  check('/teach is a public route (no sign-in needed) loaded on demand', /const FoundingTutors = lazyRoute\(\(\) => import\('\.\/pages\/FoundingTutors\.tsx'\)\);/.test(main) && /<Route path="\/teach" element=\{<FoundingTutors \/>\} \/>/.test(main));
  const meta = PAGE_META.find((m) => m.path === '/teach');
  check('/teach is NOT indexed (not in the sitemap, disallowed in robots, noindex in its page) and its tab title and description are plain', !!meta && meta.index === false && meta.title === 'Founding tutors list | Tutorlage' && !/\bfree\b|campus|facult|universit/i.test(`${meta.title} ${meta.description}`));
  check('the page also puts a noindex line on itself while it is open, and puts the old one back', /setAttribute\('content', 'noindex'\)/.test(code('src/pages/FoundingTutors.tsx')) && /tag\.setAttribute\('content', before\)/.test(code('src/pages/FoundingTutors.tsx')));
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
  const linkers = walk('src').filter((p) => /['"`]\/teach['"`]|to="\/teach"|href="\/teach"/.test(read(p))).map((p) => p.replace(/\\/g, '/')).sort();
  check('NOT LINKED while the gate is off: the only places that name /teach are the route, the page table, the signed-in Teach message, and the two tutor sign-up links that point there ONLY while the gate is on (the PM, 11 Nov)', linkers.join() === 'src/components/FoundingGateNotice.tsx,src/lib/pageMeta.ts,src/main.tsx,src/pages/Landing.tsx,src/pages/SignIn.tsx', linkers.join());
  const landingSrc = code('src/pages/Landing.tsx'); const signinSrc = code('src/pages/SignIn.tsx'); const publicGate = code('src/lib/foundingGatePublic.ts');
  check('BECOME A TUTOR follows the gate: with it ON the start page links (three places) and the tutor sign-in page\'s create-account link go to /teach (Join the founding tutors list); with it OFF they are the tutor sign-up exactly as before', /gateOn \? \(\s*<Link to="\/teach"[^>]*>\s*Join the founding tutors list\s*<\/Link>\s*\) : \(\s*<Link to="\/signup\/tutor"[^>]*>\s*Become a tutor\s*<\/Link>/.test(landingSrc) && (landingSrc.match(/<BecomeTutor /g) ?? []).length === 3 && !/<Link to="\/signup\/tutor"[^>]*>\s*Become a tutor\s*<\/Link>[\s\S]*<Link to="\/signup\/tutor"[^>]*>\s*Become a tutor\s*<\/Link>/.test(landingSrc)
    && /role === 'tutor' && gateOn \? \(\s*<Link to="\/teach"/.test(signinSrc) && /Create a \{roleLabel\} account/.test(signinSrc) && read('src/pages/Login.tsx').includes("goToSignIn('tutor')"));
  const pubDb = (answer: { data?: unknown; error?: unknown }, throws = false) => ({ rpc: async () => { if (throws) throw new Error('x'); return { data: answer.data ?? null, error: answer.error ?? null }; } });
  check('the public gate reader (signed-out allowed): true only for a plain true; no migration, an error, a throw or nonsense is false, so the links stay as they were; it lives in its own small file (the start page does not download the page\'s words)', await fetchFoundingGatePublic(pubDb({ data: true })) === true && await fetchFoundingGatePublic(pubDb({ data: false })) === false && await fetchFoundingGatePublic(pubDb({ data: 'true' })) === false && await fetchFoundingGatePublic(pubDb({ error: { code: 'PGRST202' } })) === false && await fetchFoundingGatePublic(pubDb({}, true)) === false
    && !/foundingList/.test(publicGate.replace(/^.*\/\/.*$/gm, '')) && /rpc\('founding_gate_public'\)/.test(publicGate) && /create or replace function public\.founding_gate_public\(\)/.test(MIGRATION) && /grant execute on function public\.founding_gate_public\(\) to anon, authenticated/.test(MIGRATION));

  // ---- the page itself ----
  const page = code('src/pages/FoundingTutors.tsx');
  check('the bot trap: a hidden field called website that a person cannot reach (off-screen, not in the tab order, no autofill) and is sent with the form', /name="website"/.test(page) && /tabIndex=\{-1\}/.test(page) && /left: '-10000px'/.test(page) && /autoComplete="off"/.test(page) && /website, src: firstTag, visitor/.test(page));
  check('the See more control is a button that says whether it is open (aria-expanded) and what it controls', /aria-expanded=\{moreOpen\}/.test(page) && /aria-controls="founding-more"/.test(page));
  check('Join the list sends once at a time (the button waits while sending) and says what happened (alert for problems, status for success)', /disabled=\{sending\}/.test(page) && /if \(sending\) return;/.test(page) && /role="alert"/.test(page) && /role="status"/.test(page));
  check('phone-friendly: inputs are 16 px (no zoom on tap), have the right keyboard and autofill types, and the layout is one column', /text-base/.test(page) && /type="tel" inputMode="tel" autoComplete="tel"/.test(page) && /type="email" inputMode="email" autoComplete="email"/.test(page) && /autoComplete="name"/.test(page) && /max-w-xl/.test(page));
  check('the subject and grade lists are the app\'s own tables (subjects, grade_levels), read once after the page has drawn', /from\('subjects'\)/.test(page) && /from\('grade_levels'\)\.select\('name'\)\.order\('sort_order'\)/.test(page) && /window\.setTimeout\(\(\) => void loadLists\(\), 250\)/.test(page));
  check('the page loads no image, font or script of its own (light on data) and never renders typed text as HTML', !/<img|dangerouslySetInnerHTML|innerHTML/.test(page));
  check('what is typed stays on a failed send (the form is only replaced on success)', /\{done \? \(/.test(page) && /setProblem\(result\.message\)/.test(page));

  // ---- the PM's additions of 11 Nov (after Programmer C's report) ----
  const m13 = MIGRATION.slice(MIGRATION.indexOf('-- 13. 11 Nov additions'));
  check('THREE PATHS: one BEFORE INSERT trigger on tutor_profiles refuses a profile to a person who is not on the list or only waiting, covering the sign-up trigger, convert_new_account_role and the "Tutors insert own profile" policy; the switch off passes at once',
    /create trigger founding_gate_profile_guard before insert on public\.tutor_profiles/.test(m13) && /state_raw\(new\.id\) in \('not_listed', 'waiting'\)/.test(m13) && /if not public\.founding_gate_on\(\) then return new; end if;/.test(m13)
    && /on_auth_user_created|sign-up trigger/.test(m13) && /convert_new_account_role/.test(m13) && /Tutors insert own profile/.test(m13) && /errcode = '42501'/.test(m13));
  check('the owner running SQL is exempt but every API call and the sign-up service are held; the test hook can only make the rule stricter', /session_user in \('postgres', 'supabase_admin'\) and coalesce\(current_setting\('founding\.test_enforce', true\), ''\) <> 'on'/.test(m13));
  check('a refused tutor sign-up says the real reason (join the list first) as well as the age rule; other roles keep the old sentence', /Tutoring places open in groups: if you have not joined the founding tutors list yet, join it first \(tutorlage\.com\/teach\)/.test(read('src/pages/CreateAccount.tsx')) && /role === 'tutor'\s*\n?\s*\/\/ Founding tutors list/.test(read('src/pages/CreateAccount.tsx')) && /Check your date of birth — tutors and parents must be 18 or older\./.test(read('src/pages/CreateAccount.tsx')));
  check('VIDEO ROOMS: a trigger on video_rooms lets only a verified tutor open a room while the switch is on; /room is behind FoundingRoomGate for tutor accounts only (a learner or parent joining by code is never held)',
    /create trigger founding_gate_room_guard before insert on public\.video_rooms|create trigger founding_gate_room_guard before insert on public\.video_rooms for each row/.test(m13) && /state_raw\(new\.host_id\) <> 'verified'/.test(m13)
    && /<FoundingRoomGate>\s*<RoomPage \/>\s*<\/FoundingRoomGate>/.test(code('src/pages/guarded.tsx')) && /if \(profile\?\.role !== 'tutor'\) return <>\{children\}<\/>;/.test(code('src/components/FoundingGate.tsx')));
  check('the room message for a released tutor is plain, and a waiting or not-listed tutor gets their own message on /room', FOUNDING_COPY.gateRoom === 'You can open video rooms once you are verified.' && /gateBlocksTutorSide\(gate\.state\)\) return <FoundingGateNotice/.test(code('src/components/FoundingGate.tsx')) && /FOUNDING_COPY\.gateRoom/.test(code('src/components/FoundingGate.tsx')));
  check('the Teaching tab is behind the gate for a place that has not opened (a released tutor still reaches it: subjects, hours and documents are how they become ready)', /<FoundingTeachingGate><TeachingProfilePanel tutorId=\{tutorId\} \/><\/FoundingTeachingGate>/.test(code('src/components/ManageAccountModal.tsx')) && /export const FoundingTeachingGate = FoundingDocumentsGate;/.test(code('src/components/FoundingGate.tsx')));
  const req = (track: 'beginner' | 'experienced') => requirementsFor(track).filter((r) => r.required).map((r) => r.documentType).sort().join();
  const finishedFn = m13.slice(m13.indexOf('create or replace function public.tutor_onboarding_finished'), m13.indexOf('create or replace function public.tutor_onboarding_stamp_completed'));
  check('COMPLETED_AT: the migration\'s "finished" rule names the same required documents as the screens (identity, police clearance, and results for a beginner or proof of experience for an experienced tutor) and the 6-month police rule',
    req('beginner') === 'identity_doc,police_clearance,subject_results' && req('experienced') === 'identity_doc,police_clearance,proof_of_experience' && /'identity_doc'/.test(finishedFn) && /'police_clearance'/.test(finishedFn) && /'subject_results' else 'proof_of_experience'/.test(finishedFn.replace(/\s+/g, ' '))
    && /interval '6 months'/.test(finishedFn) && /o\.consented_at is not null/.test(finishedFn) && /is distinct from 'rejected'/.test(finishedFn));
  check('COMPLETED_AT is stamped the first time only, by triggers that can never stop an upload or a consent, and existing tutors who meet the rule are stamped',
    /alter table public\.tutor_onboarding add column if not exists completed_at timestamptz/.test(m13) && /where tutor_id = new\.tutor_id and completed_at is null/.test(m13) && /exception when others then\s*null;/.test(m13)
    && /after insert or update on public\.tutor_verification_documents/.test(m13) && /after insert or update of track, consented_at on public\.tutor_onboarding/.test(m13) && /update public\.tutor_onboarding o\s*set completed_at = greatest/.test(m13));
  check('FIRST_REQUEST_SEEN_AT is set once by the tutor\'s own call and cannot be written directly; no clash with the learner waiting-list names',
    /add column if not exists first_request_seen_at timestamptz/.test(m13) && /where id = auth\.uid\(\) and first_request_seen_at is null/.test(m13) && /new\.first_request_seen_at := old\.first_request_seen_at/.test(m13) && /before update of first_request_seen_at on public\.tutor_profiles/.test(m13)
    && !/tutor_waitlist|join_tutor_waitlist|leave_tutor_waitlist/.test(MIGRATION.replace(/--[^\n]*/g, '')));
  const funnelCode = code('src/lib/tutorFunnel.ts');
  check('the Teach screen tells the database ONCE, when its request list first returns a row, and ignores any failure (the call before the migration does nothing)', /supabase\.rpc\('note_first_request_seen'\)/.test(funnelCode) && /if \(noted\) return;/.test(funnelCode)
    && /if \(rows\.length > 0\) noteFirstRequestSeen\(\);/.test(code('src/components/AvailableRequestsQueue.tsx')) && /\(\) => undefined,\s*\(\) => undefined/.test(funnelCode));
  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
