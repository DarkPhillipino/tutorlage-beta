// The admin side of SHOULD batch B (18 Nov 2026): the paying-customer line on the Codes page, the scheduled-job list on the Errors page, the read-only list of subjects tutors asked for, and the
// Levels tick-box for "proves subject competence". The database functions decide everything (supabase/tests/paying_customers.sql, cron_problems.sql, credential_proves_subject_switch.sql);
// this proves the screens read and word the answers correctly and only ever write through the one new function.
import { readFileSync } from 'node:fs';
import { parsePayingCustomers, payingAdvice, payingAlertIds, payingLine, fetchPayingCustomers } from '../../admin/src/lib/payingCustomers';
import { mapCronProblems, problemLine } from '../../admin/src/lib/cronProblems';
import { groupBySubject, mapCandidates } from '../../admin/src/lib/subjectCandidates';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

async function main() {
  // ---- paying customers ----
  const raw = { count: 9612, from_topups: 9000, from_requests: 700, excluded_accounts: 1, active_codes: 2, warn_at: 9500, end_at: 10000, state: 'warn' };
  const warn = parsePayingCustomers(raw)!;
  check('the answer is read', warn.count === 9612 && warn.fromTopups === 9000 && warn.fromRequests === 700 && warn.excludedAccounts === 1 && warn.activeCodes === 2 && warn.state === 'warn');
  check('the line says the count of the limit with spaces for thousands', payingLine(warn).replace(/\s/g, ' ') === 'Paying customers: 9 612 of 10 000', payingLine(warn));
  check('nothing to say far from the limit', payingAdvice(parsePayingCustomers({ ...raw, count: 120, state: 'ok' })!) === '');
  check('at 9,500 it says how many to go and that nothing switches off by itself', /388 to go/.test(payingAdvice(warn)) && /nothing switches off by itself/.test(payingAdvice(warn)), payingAdvice(warn));
  const end = parsePayingCustomers({ ...raw, count: 10003, state: 'end' })!;
  check('at 10,000 it says to pause the codes still on, by hand', /Switch the 2 codes that are still on off below \(Pause\)/.test(payingAdvice(end)) && /Nothing switches off by itself/.test(payingAdvice(end)));
  check('at 10,000 with every code already off it says so', /Every code is already off/.test(payingAdvice({ ...end, activeCodes: 0 })));
  check('a bad or missing answer is no line', parsePayingCustomers(null) === null && parsePayingCustomers({}) === null && parsePayingCustomers('x') === null);
  check('the alert ids are the state, once per step: none while ok', payingAlertIds({ ...warn, state: 'ok' }).length === 0 && payingAlertIds(warn)[0] === 'paying:warn' && payingAlertIds(end)[0] === 'paying:end' && payingAlertIds(null).length === 0);
  check('the line is hidden when the function is missing or refused', (await fetchPayingCustomers({ rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) })) === null);
  check('and read when it answers', (await fetchPayingCustomers({ rpc: async () => ({ data: raw, error: null }) }))?.count === 9612);
  const codes = read('admin/src/components/PromoCodesBody.tsx');
  const pcLib = code('admin/src/lib/payingCustomers.ts');
  check('the Codes page shows the line and the advice, and the code never switches anything off by itself', codes.includes('payingLine(paying)') && codes.includes('payingAdvice(paying)') && !/setPromoCodeActive|admin_update_promo_code/.test(pcLib) && /rpc\('admin_paying_customers'\)/.test(pcLib));

  // ---- scheduled jobs ----
  const jobs = mapCronProblems([
    { job_name: 'poll-queued-refunds', problem: 'failed', failures: '3', last_status: 'succeeded', last_run_at: '2026-11-18T10:00:00Z', message: 'ERROR: boom', ref: 'poll-queued-refunds:failed:77' },
    { job_name: 'purge-founding-list', problem: 'stalled', failures: 0, last_status: 'succeeded', last_run_at: '2026-11-14T03:20:00Z', message: 'Last ran ...', ref: 'purge-founding-list:stalled:202611140320' },
    { job_name: 'x' },
  ]);
  check('the list maps rows; a row without a ref is dropped', jobs.length === 2 && jobs[0].failures === 3 && jobs[1].problem === 'stalled');
  check('plain words: failed three times / stopped running / once', problemLine(jobs[0]) === 'poll-queued-refunds failed 3 times in the last 24 hours' && problemLine(jobs[1]) === 'purge-founding-list has stopped running' && problemLine({ ...jobs[0], failures: 1 }).endsWith('failed once in the last 24 hours'));
  const errs = read('admin/src/pages/ClientErrors.tsx');
  const cronLib = code('admin/src/lib/cronProblems.ts');
  check('the Errors page has the scheduled-jobs section, hidden when the function is missing or refused, with its own error line', errs.includes('Scheduled jobs that need a look') && errs.includes('fetchCronProblems') && cronLib.includes("'42501'") && cronLib.includes('return null'));
  check('it reads only the one function and writes nothing', /rpc\('admin_cron_problems'/.test(cronLib) && !/\.(insert|update|delete|upsert)\(/.test(cronLib));

  // ---- subjects tutors asked for ----
  const cands = mapCandidates([
    { id: '1', subject_name: 'Zorology', curriculum: 'CAPS', requested_by: 't1', status: 'pending', created_at: '2026-11-17T08:00:00Z' },
    { id: '2', subject_name: ' zorology ', curriculum: 'CAPS', requested_by: 't2', status: 'pending', created_at: '2026-11-18T08:00:00Z' },
    { id: '3', subject_name: 'Latin', curriculum: 'CAPS', requested_by: null, status: 'approved', created_at: '2026-11-16T08:00:00Z' },
    { id: null },
  ], new Map([['t1', 'Tia Tutor']]));
  check('rows map with the tutor name where known; a row without an id is dropped', cands.length === 3 && cands[0].requestedByName === 'Tia Tutor' && cands[1].requestedByName === null);
  const groups = groupBySubject(cands);
  check('the same subject asked twice is one line, most asked first, with how many still wait', groups.length === 2 && groups[0].subjectName === 'Zorology' && groups[0].count === 2 && groups[0].pending === 2 && groups[1].subjectName === 'Latin' && groups[1].pending === 0);
  const cl = code('admin/src/lib/subjectCandidates.ts');
  const card = read('admin/src/components/SubjectCandidatesCard.tsx');
  check('the list is read-only: a select of the table and no write, and the page shows it under the approvals', /from\('subject_candidates'\)\.select\(/.test(cl) && !/\.(insert|update|delete|upsert|rpc)\(/.test(cl) && read('admin/src/pages/SubjectApprovals.tsx').includes('<SubjectCandidatesCard />') && card.includes('Read only'));

  // ---- the Levels tick-box ----
  const levels = read('admin/src/components/LevelsBody.tsx');
  const q = code('admin/src/lib/levelQueries.ts');
  check('the tick-box shows only when the database has the column and the screen has the action, and saves at once through its own function', levels.includes("typeof credential.provesSubject === 'boolean' && !!actions.setCredentialProvesSubject") && levels.includes('Proves subject competence.') && /rpc\('admin_set_credential_proves_subject'/.test(q));
  check('before the database update the Levels page still loads (the column is read again without it)', q.includes("select('code, label, entry_sub_tier_id, recency_years, description')") && q.includes('proves_subject_competence'));
  check('the old save function is untouched (it still sends label, level, recency and description only)', /admin_save_credential_definition[\s\S]{0,200}p_description: c\.description/.test(q) && !/admin_save_credential_definition[\s\S]{0,300}proves/.test(q));
}

main().then(() => {
  if (failed > 0) {
    console.log(`\n${failed} FAILED`);
    process.exit(1);
  }
  console.log('\nall ok');
});
