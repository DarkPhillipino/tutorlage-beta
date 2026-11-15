// Checks on the ADMIN FOUNDING WAVES PAGE (Marketing's measurement document section 9.2; the PM's queue of 11 Nov 2026: R5, R6, R8, R9, R10, R11, R4).
// Run: npx tsx scripts/dev/admin-founding-waves-test.ts
// Proves, with a fake database client, rendered markup and by reading the source and the migration text: the page reads through the admin functions only and opens cleanly BEFORE
// the migration is applied; every answer is mapped from the shapes the migration returns; the funnel CSV holds counts only; "Release" passes the wave number only when one is
// given; the argument names match the migration's; every stage the database can return has a label; the public page sends only the NAME of the last field touched, for fields
// the database accepts; the menu and the route exist; typed names are printed as plain text; nothing on the new screens sends a message or says "free".
// It does NOT prove the database behaviour (supabase/tests/founding_waves.sql, rolled back) or the page in a real browser.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { releaseEntries, FOUNDING_NOT_ON_YET, FOUNDING_NO_ACCESS, type FoundingAdminClient } from '../../admin/src/lib/founding';
import {
  ALL_TIME, DECLINE_LABELS, FIELD_LABELS, NO_STEP_FILTER, STAGE_LABELS, WAVES_CSV_HEADER, fetchAbandons, fetchAnswers, fetchWaves, filterSteps, mapAbandons, mapAnswers, mapPipeline, mapSteps,
  mapSuggestion, mapTriggers, mapWaves, markContacted, setStopRule, setSuggestSkip, setWave, setWaveCap, wavesCsv, waveName, waveOptions, shortDate, lastNDays,
  type WavesResult,
} from '../../admin/src/lib/foundingWaves';
import { FoundingWavesBody, type FoundingWavesBodyProps } from '../../admin/src/components/FoundingWavesBody';
import { EMPTY_FOUNDING_FORM, FOUNDING_FIELD_FOR_KEY, logFoundingField } from '../../src/lib/foundingList';

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
const MIGRATION = read('supabase/migrations/20261111120000_founding_waves.sql');
const params = (name: string) => new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`).exec(MIGRATION)?.[1].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).join();

type Err = { code?: string; message?: string } | null;
function fake(answers: Record<string, { data?: unknown; error?: Err }> = {}, opts: { throws?: boolean } = {}): { db: FoundingAdminClient; calls: { fn: string; args: Record<string, unknown> | undefined }[] } {
  const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const db: FoundingAdminClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (opts.throws) throw new Error('Failed to fetch');
      const a = answers[fn];
      return { data: a?.data ?? null, error: a?.error ?? null };
    },
  };
  return { db, calls };
}

// ---- the shapes the migration returns (the same shapes the rolled-back suite asserts on) ----------------------------------------------------------------------
const STEPS = [{
  id: 'p1', source: 'form', status: 'released', wave: 71, src: 'f1', is_test: false, full_name: '<b>Tia</b> One', code_name: 'Tia', stage: 'second_lesson',
  joined_at: '2026-11-01T08:00:00+00:00', released_at: '2026-11-03T08:00:00+00:00', released_messaged_at: '2026-11-03T09:00:00+00:00', lapsed_at: null, last_contacted_at: null,
  account_at: '2026-11-04T08:00:00+00:00', agreed_at: '2026-11-04T09:00:00+00:00', signup_finished_at: '2026-11-04T09:00:00+00:00', first_document_at: '2026-11-05T08:00:00+00:00',
  documents_complete_at: '2026-11-06T08:00:00+00:00', is_verified: true, approved_at: null, is_declined: false, declined_at: null, decline_reason: null, hours_saved_at: null, has_hours: true,
  first_request_seen_at: '2026-11-08T08:00:00+00:00', first_accepted_at: '2026-11-08T10:00:00+00:00', first_completed_at: '2026-11-09T10:00:00+00:00', second_completed_at: '2026-11-10T10:00:00+00:00',
}, {
  id: 'p2', source: 'form', status: 'released', wave: 72, src: null, is_test: false, full_name: 'Pat Two', code_name: 'Pat', stage: 'declined', joined_at: '2026-11-02T08:00:00+00:00',
  released_at: '2026-11-03T08:00:00+00:00', is_declined: true, declined_at: '2026-11-07T08:00:00+00:00', decline_reason: 'clearance',
}, { id: 'p3', source: 'form', status: 'joined', wave: null, src: 'zz', is_test: false, full_name: 'Lee Three', code_name: 'Lee', stage: 'joined', joined_at: '2026-11-02T08:00:00+00:00' }];
const WAVES = [
  { wave: 71, released: 6, messaged: 6, lapsed: 1, declined: 1, steps: [{ key: 'account', label: 'Account made', n: 4, pct: 67, avg_days: 5.5, median_days: 6.0, oldest_days: 20.0 }, { key: 'approved', label: 'Approved', n: 1, pct: 17, avg_days: null, median_days: null, oldest_days: null }] },
  { wave: 0, released: 6, messaged: 6, lapsed: 1, declined: 1, steps: [{ key: 'account', label: 'Account made', n: 4, pct: 67, avg_days: 5.5, median_days: 6.0, oldest_days: 20.0 }] },
];
const TRIGGERS = {
  current_wave: 71,
  b1: { state: 'met', demand_rows: 1, rows: [{ subject: 'Mathematics', phase: 'Senior (7-9)', requests: 2, unserved_requests: 1, ready_tutors: 0 }] },
  b2: { state: 'met', approved: 1, working: 1, line_pct: 60, share_pct: 100 },
  b3: { state: 'not_met', waiting: 1, oldest_days: 8.0, not_uploaded: 2 },
  b4: { state: 'default', rate: 0.36, measured: false, waves: [] },
  b5: { state: 'not_met', open: 1 },
  all_clear: false,
  stop_rules: [{ rule: 3, kind: 'manual', open: false, note: null, since: null, label: 'The page, the form or the counters are broken' }, { rule: 4, kind: 'auto', open: true, note: '1 complete document set(s) waiting more than 7 days', since: null, label: 'Verification overdue' }],
};
const PIPELINE = { waiting: 1, oldest_days: 8.0, over_5_days: 1, over_7_days: 1, avg_days_to_approval: 4.0, longest_decided_days: 4.0, declines_by_reason: { clearance: 1 },
  by_week: [{ week_start: '2026-11-09', completed: 1, approved: 0, declined: 1, avg_days: null, longest_days: null, declines_by_reason: { clearance: 1 } }] };
const SUGGESTION = { cap: 15, rate: 0.36, rate_measured: false, rate_waves: [], gap: 3, suggested_n: 8, next_wave: 72,
  demand: [{ subject: 'Mathematics', phase: 'Senior (7-9)', shortfall: 3, requests: 2, unserved: 1, ready_tutors: 0, people_waiting: 2 }],
  people: [{ id: 'q1', full_name: 'Qa One', code_name: 'Qa', joined_at: '2026-11-02T08:00:00+00:00', skipped: false, lapsed: false, covers_n: 1, covers: [{ subject: 'Mathematics', phase: 'Senior (7-9)' }], suggested: true },
           { id: 'q2', full_name: 'Qb Two', code_name: 'Qb', joined_at: '2026-11-03T08:00:00+00:00', skipped: true, lapsed: true, covers_n: 0, covers: [], suggested: false }] };
const ANSWERS = { total: 3, police: { have: 1, applied: 1, not_yet: 1 }, practicum: { two: 1 }, parent_reach: { up_to_10: 1 }, willing: { yes: 2, no: 1 }, availability: { evenings: 2, weekends: 1 },
  bands: { 'Intermediate (4-6)': 2 }, top_subjects: [{ subject: 'Mathematics', n: 2 }], heard: { message: { n: 1, with_registered_tag: 0 }, '(not said)': { n: 2, with_registered_tag: 0 } },
  consent_news: { yes: 1, no: 2 }, have: { device: 2, connection: 1, bank: 0 }, by_week: [{ week_start: '2026-11-09', joins: 3 }] };
const ABANDONS = { started: 3, joined: 1, abandoned: 2, by_field: [{ field: '(not recorded)', n: 1 }, { field: 'police_clearance', n: 1 }], by_src: [{ src: 'zzab', field: 'police_clearance', n: 1 }] };

const ALL_OK = {
  admin_founding_steps: { data: STEPS }, admin_founding_waves: { data: WAVES }, admin_founding_triggers: { data: TRIGGERS }, admin_founding_pipeline: { data: PIPELINE }, admin_founding_suggestion: { data: SUGGESTION },
};

async function main(): Promise<void> {
  // ---- reading --------------------------------------------------------------------------------------------------------------------------------------------------------------
  const ok = fake(ALL_OK);
  const r = await fetchWaves(ok.db);
  check('the page reads through five admin functions only', ok.calls.map((c) => c.fn).sort().join() === 'admin_founding_pipeline,admin_founding_steps,admin_founding_suggestion,admin_founding_triggers,admin_founding_waves');
  check('every name it calls exists in the migration', ok.calls.every((c) => new RegExp(`create or replace function public\\.${c.fn}\\(`).test(MIGRATION)));
  check('a good answer is an ok result with all five parts', r.state === 'ok' && r.data.steps.length === 3 && r.data.waves.length === 2 && !!r.data.triggers && !!r.data.pipeline && !!r.data.suggestion);
  const missing = await fetchWaves(fake({ admin_founding_steps: { error: { code: 'PGRST202', message: 'Could not find the function public.admin_founding_steps' } }, admin_founding_waves: { error: { code: 'PGRST202' } } }).db);
  check('BEFORE the migration is applied the page opens with a plain "not switched on yet"', missing.state === 'not_set_up');
  check('a signed-in person without the role is told so', (await fetchWaves(fake({ admin_founding_steps: { error: { code: '42501', message: 'Only a verification officer' } } }).db)).state === 'no_access');
  check('a network failure is a plain failure, never a thrown error', (await fetchWaves(fake({}, { throws: true }).db)).state === 'failed');
  const partial = await fetchWaves(fake({ ...ALL_OK, admin_founding_triggers: { error: { message: 'boom' } }, admin_founding_pipeline: { error: { code: 'PGRST202' } } }).db);
  check('if one side panel fails the rest still draws', partial.state === 'ok' && partial.data.triggers === null && partial.data.pipeline === null && partial.data.waves.length === 2);

  // ---- mapping --------------------------------------------------------------------------------------------------------------------------------------------------------------
  const steps = mapSteps(STEPS);
  check('R5: a person is mapped with every dated step', steps[0].fullName === '<b>Tia</b> One' && steps[0].wave === 71 && steps[0].secondCompletedAt === '2026-11-10T10:00:00+00:00' && steps[0].isVerified && steps[0].approvedAt === null && steps[0].hasHours && steps[0].hoursSavedAt === null);
  check('R5: a person with nothing yet maps to blanks, not errors', steps[2].accountAt === null && steps[2].wave === null && steps[2].releasedAt === null && steps[2].stage === 'joined');
  check('R5: filter by wave, by furthest step and by name', filterSteps(steps, { ...NO_STEP_FILTER, wave: '71' }).length === 1 && filterSteps(steps, { ...NO_STEP_FILTER, wave: 'none' }).length === 1
    && filterSteps(steps, { ...NO_STEP_FILTER, stage: 'declined' })[0].id === 'p2' && filterSteps(steps, { ...NO_STEP_FILTER, search: 'LEE' }).length === 1 && waveOptions(steps).join() === '71,72');
  const waves = mapWaves(WAVES);
  check('R6: a wave block maps its counts and its steps (days kept as numbers, blanks as null)', waves[0].released === 6 && waves[0].steps[0].medianDays === 6 && waves[0].steps[1].avgDays === null && waveName(0) === 'All waves together' && waveName(1).includes('warm'));
  const csv = wavesCsv(waves);
  const lines = csv.trim().split('\r\n');
  check('R14: the waves CSV is one row per wave per step with the header, counts and days only', lines[0] === WAVES_CSV_HEADER && lines.length === 1 + 2 + 1 && lines[1] === '71,6,6,1,1,account,4,67,5.5,6,20' && lines[2].endsWith(',approved,1,17,,,') && lines[3].startsWith('all,'));
  check('R14: the CSV holds no name, email or number', !/[@+]|[A-Za-z]{4,}\s[A-Za-z]{3,}/.test(lines.slice(1).join('\n')) && !/\d{9,}/.test(csv));
  const trig = mapTriggers(TRIGGERS);
  check('R9: the lights map (met, not met, default) with their numbers', trig.currentWave === 71 && trig.b1.state === 'met' && trig.b1.rows[0].unserved === 1 && trig.b2.sharePct === 100 && trig.b3.state === 'not_met' && trig.b3.oldestDays === 8
    && trig.b4.state === 'default' && trig.b4.rate === 0.36 && trig.b5.open === 1 && !trig.allClear);
  check('R9: the stop rules keep their kind (worked out or by hand) and whether they are open', trig.stopRules.length === 2 && trig.stopRules[0].kind === 'manual' && trig.stopRules[1].kind === 'auto' && trig.stopRules[1].open);
  check('R9: an unknown light state reads "not enough to say", never a crash', mapTriggers({ b1: { state: 'purple' } }).b1.state === 'unknown');
  const pipe = mapPipeline(PIPELINE);
  check('R10: the pipeline maps waiting, oldest, over 7 days, the averages, the weeks and the reasons', pipe.waiting === 1 && pipe.oldestDays === 8 && pipe.over7 === 1 && pipe.avgDaysToApproval === 4 && pipe.byWeek[0].declines.clearance === 1 && pipe.declinesByReason.clearance === 1);
  const sug = mapSuggestion(SUGGESTION);
  check('R8: the suggestion maps the cap, the rate, the gap, the size, the next wave, the demand and each person (skipped, lapsed, covers)', sug.cap === 15 && sug.gap === 3 && sug.suggestedN === 8 && sug.nextWave === 72
    && sug.demand[0].peopleWaiting === 2 && sug.people[0].suggested && sug.people[1].skipped && sug.people[1].lapsed && sug.people[0].covers[0].phase === 'Senior (7-9)');
  const ans = mapAnswers(ANSWERS);
  check('R11: the answers map as counts', ans.total === 3 && ans.police.have === 1 && ans.willing.yes === 2 && ans.topSubjects[0].n === 2 && ans.heard.message.n === 1 && ans.consentNews.no === 2 && ans.have.device === 2);
  const ab = mapAbandons(ABANDONS);
  check('R4: the abandons map by field and by tag', ab.started === 3 && ab.abandoned === 2 && ab.byField[1].field === 'police_clearance' && ab.bySrc[0].src === 'zzab');
  const a1 = fake({ admin_founding_answers: { data: ANSWERS }, admin_founding_abandons: { data: ABANDONS } });
  await fetchAnswers(a1.db, { from: '2026-11-01', to: '2026-11-07', src: ' F1 ' });
  await fetchAbandons(a1.db, ALL_TIME);
  check('R11 and R4 pass the range and the tag with the migration\'s argument names', JSON.stringify(a1.calls[0].args) === JSON.stringify({ p_from: '2026-11-01', p_to: '2026-11-07', p_src: 'F1' }) && JSON.stringify(a1.calls[1].args) === JSON.stringify({ p_from: null, p_to: null, p_src: null }));

  // ---- the writes -------------------------------------------------------------------------------------------------------------------------------------------------------------
  const w = fake({ admin_release_founding: { data: { released: 2, skipped: 1, wave: 72 } } });
  const rel = await releaseEntries(w.db, ['a', 'b', 'c']);
  const rel2 = await releaseEntries(w.db, ['a'], 75);
  check('Release leaves the wave number out when none is given (the database then picks it) and passes it when one is', JSON.stringify(w.calls[0].args) === '{"p_ids":["a","b","c"]}' && JSON.stringify(w.calls[1].args) === '{"p_ids":["a"],"p_wave":75}');
  check('Release reports how many were released, skipped and into which wave', rel.released === 2 && rel.skipped === 1 && rel.wave === 72 && rel2.error === null);
  const wr = fake();
  await setSuggestSkip(wr.db, 'x', true); await setWaveCap(wr.db, 12); await setStopRule(wr.db, 3, true, ' broke '); await setWave(wr.db, ['x'], 5); await markContacted(wr.db, 'x');
  check('the writes use the migration\'s function and argument names',
    wr.calls.map((c) => c.fn).join() === 'admin_set_founding_suggest_skip,admin_set_founding_wave_cap,admin_set_founding_stop_rule,admin_set_founding_wave,admin_mark_founding_contacted'
    && wr.calls.every((c) => params(c.fn) === Object.keys(c.args ?? {}).join()) && (wr.calls[2].args as { p_note: string }).p_note === 'broke');
  check('a write before the migration is applied says "not switched on yet"', (await setWaveCap(fake({ admin_set_founding_wave_cap: { error: { code: 'PGRST202' } } }).db, 5)) === FOUNDING_NOT_ON_YET);

  // ---- the migration's shapes agree with the screen's words ---------------------------------------------------------------------------------------------------------
  const stagesInSql = Array.from(/'stage', case([\s\S]*?)else 'joined' end/.exec(MIGRATION)?.[1].matchAll(/then '([a-z_]+)'/g) ?? []).map((m) => m[1]).concat('joined');
  check('every stage the database can return has a label', stagesInSql.length >= 13 && stagesInSql.every((s) => !!STAGE_LABELS[s]), stagesInSql.filter((s) => !STAGE_LABELS[s]).join());
  const reasonsInSql = Array.from(MIGRATION.matchAll(/then '(clearance|document_missing)'|else '(other)'/g)).flatMap((m) => [m[1], m[2]]).filter(Boolean);
  check('every decline reason the database can return has a label', reasonsInSql.length === 3 && reasonsInSql.every((x) => !!DECLINE_LABELS[x]));
  const allowed = Array.from(/last_field in \(([^)]*)\)/.exec(MIGRATION)?.[1].matchAll(/'([a-z_]+)'/g) ?? []).map((m) => m[1]);
  check('every field the database accepts has a label', allowed.length === 17 && allowed.every((f) => !!FIELD_LABELS[f]));
  check('the form key map only names fields the database accepts, and covers every key of the form', Object.keys(EMPTY_FOUNDING_FORM).every((k) => k in FOUNDING_FIELD_FOR_KEY) && Object.values(FOUNDING_FIELD_FOR_KEY).every((v) => allowed.includes(v)));
  check('the migration does not use the learner waiting-list names', !/tutor_waitlist|join_tutor_waitlist|leave_tutor_waitlist/.test(MIGRATION));

  // ---- the public page: only the NAME of the last field ------------------------------------------------------------------------------------------------------------
  const sent: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  await logFoundingField({ rpc: async (fn: string, args?: Record<string, unknown>) => { sent.push({ fn, args }); return { data: null, error: null }; } } as never, '11111111-1111-4111-8111-111111111111', 'email', 'f1');
  await logFoundingField({ rpc: async () => { throw new Error('offline'); } } as never, 'v', 'email');
  await logFoundingField({ rpc: async (fn: string, args?: Record<string, unknown>) => { sent.push({ fn, args }); return { data: null, error: null }; } } as never, null, 'email');
  await logFoundingField({ rpc: async (fn: string, args?: Record<string, unknown>) => { sent.push({ fn, args }); return { data: null, error: null }; } } as never, 'v', undefined);
  check('the page sends the visitor id, the field NAME and the first tag, nothing else; a failure or a missing id sends nothing and never throws',
    sent.length === 1 && sent[0].fn === 'log_founding_field' && Object.keys(sent[0].args ?? {}).join() === 'p_visitor,p_field,p_first' && sent[0].args?.p_field === 'email');
  const page = code('src/pages/FoundingTutors.tsx');
  check('the page records a field when a value is set, once per change, and never in a browser that is not counted', /touch\(FOUNDING_FIELD_FOR_KEY\[key as string\]\)/.test(page) && /touch\('subjects'\)/.test(page)
    && /if \(skipCount \|\| !field \|\| lastField\.current === field\) return;/.test(page) && !/logFoundingField\([^)]*(form\.|value)/.test(page));

  // ---- the screen -------------------------------------------------------------------------------------------------------------------------------------------------------------
  const okResult: WavesResult = { state: 'ok', data: { steps, waves, triggers: trig, pipeline: pipe, suggestion: sug } };
  const noop = () => undefined;
  const props = (result: WavesResult | null, over: Partial<FoundingWavesBodyProps> = {}): FoundingWavesBodyProps => ({
    result, error: null, notice: null, busy: false, filter: NO_STEP_FILTER, onFilter: noop, answers: { state: 'ok', data: ans }, abandons: { state: 'ok', data: ab }, range: ALL_TIME, onRange: noop,
    onCsv: noop, onSkip: noop, onCap: noop, onRelease: noop, onStopRule: noop, onRetry: noop, ...over,
  });
  const html = render(React.createElement(FoundingWavesBody, props(okResult)));
  for (const h of ['Is it time to release the next wave?', 'Who to release next', 'Funnel by wave', 'Verification pipeline', 'What the list looks like', 'Where people leave the form', 'Every person, step by step']) {
    check(`the screen draws the section "${h}"`, html.includes(h));
  }
  check('the lights say what they found', html.includes('1 of 1 approved tutors') && html.includes('1 complete set(s) still wait') && html.includes('Not measured yet') && html.includes('Rule 4: Verification overdue'));
  check('the suggestion names its size, its wave and its Release button', html.includes('Release the 1 suggested as wave 72') && html.includes('Take off') && html.includes('Put back'));
  check('typed names are printed as plain text, never as markup', !html.includes('<b>Tia</b>') && html.includes('&lt;b&gt;Tia&lt;/b&gt; One'));
  check('a date is shown in South African time, a blank step stays blank', shortDate('2026-11-03T23:30:00+00:00') === '4 Nov' && shortDate(null) === '' && lastNDays(7, new Date('2026-11-10T10:00:00Z')).from === '2026-11-04');
  const notSet = render(React.createElement(FoundingWavesBody, props({ state: 'not_set_up' })));
  check('before the database change the screen says so in plain words', notSet.includes(FOUNDING_NOT_ON_YET) && !notSet.includes('Funnel by wave'));
  check('without the role the screen says so', render(React.createElement(FoundingWavesBody, props({ state: 'no_access' }))).includes(FOUNDING_NO_ACCESS));
  check('a failure offers "Try again"', render(React.createElement(FoundingWavesBody, props({ state: 'failed', message: 'It broke' }))).includes('Try again'));
  check('an error and a notice are shown', render(React.createElement(FoundingWavesBody, props(okResult, { error: 'Bad thing', notice: 'Good thing' }))).includes('Bad thing') && html !== '');

  // ---- source rules -------------------------------------------------------------------------------------------------------------------------------------------------------------
  const newCode = ['admin/src/lib/foundingWaves.ts', 'admin/src/components/FoundingWavesBody.tsx', 'admin/src/pages/FoundingWaves.tsx'].map(code).join('\n');
  check('nothing on the new screens sends a message or opens WhatsApp', !/wa\.me|window\.open|mailto:|fetch\(/.test(newCode));
  check('no new text says "free" lessons or sessions', !/free (lesson|session)/i.test(newCode) && !/free (lesson|session)/i.test(MIGRATION));
  check('the new screens do not read the people table directly', !/\.from\(['"]founding_/.test(newCode));
  check('the menu and the route exist for officers and super admins', /founding-waves/.test(code('admin/src/App.tsx')) && /to: '\/founding-waves'.*verification_officer.*super_admin/.test(code('admin/src/components/AdminLayout.tsx')));
  check('the migration closes its views and table to every API role and pins every search path', /revoke all on public\.founding_person_steps from public, anon, authenticated, service_role/.test(MIGRATION)
    && /revoke all on public\.founding_tutor_facts from public, anon, authenticated, service_role/.test(MIGRATION) && /revoke all on public\.founding_form_fields from public, anon, authenticated, service_role/.test(MIGRATION)
    && (MIGRATION.match(/create or replace function/g) ?? []).length === (MIGRATION.match(/set search_path = public/g) ?? []).length);

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
