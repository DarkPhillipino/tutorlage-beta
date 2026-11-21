// The EXTENDED concurrent claim race (see README.md). DEV DATABASE ONLY. Run from the repository root of a copy linked to dev:
//   node supabase/tests/claim_race/claim-race-extended.mjs            (set up, race, verify, print the verdict; leaves the fixture for inspection)
//   node supabase/tests/claim_race/claim-race-extended.mjs --cleanup  (remove the fixture and restore the settings)
// Two scenarios, each request claimed by THREE tutors at the same instant (3 separate `supabase db query` processes = 3 database connections per request):
//   W3  the wallet route (4 requests): exactly one wins and gets a session; the other two are refused with the plain "already accepted" words.
//   C3  the card route (4 requests, card check passed): exactly one wins and gets mode `charge` with a charge reference; the other two are refused. As far as the
//       database goes: the winner's request is `charging` with that reference, no session yet (the Worker books it only after Paystack confirms), nothing in the wallet ledger.
// Every process sleeps INSIDE the database until one shared instant (the database clock, 120 s ahead; the processes are started 3 s apart because the pooler rate-limits
// temporary logins) and then calls claim_session_request as the server's role, exactly as the Worker does. No Paystack call is made by the database or by this script.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEV = 'wfpjoxetbprmllqqarwp';
const ROUNDS = 4;
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-race-x-'));
const workdir = process.env.RACE_WORKDIR || undefined;
const sb = (file) => spawnSync('npx', ['supabase', 'db', 'query', '--linked', ...(workdir ? ['--workdir', workdir] : []), '-f', file], { encoding: 'utf8', shell: true });

const ref = (() => { try { return fs.readFileSync(path.resolve(workdir || '.', 'supabase/.temp/project-ref'), 'utf8').trim(); } catch { return ''; } })();
if (ref !== DEV) { console.error(`Refusing: this copy is linked to "${ref}", not the dev database ${DEV}.`); process.exit(2); }

function query(sql) {
  const f = path.join(tmp, `q${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(f, sql);
  const r = sb(f);
  const out = r.stdout || '';
  const i = out.indexOf('{');
  if (r.status !== 0 || i < 0) throw new Error('query failed: ' + (r.stdout + r.stderr).replace(/\s+/g, ' ').slice(0, 600));
  return JSON.parse(out.slice(i, out.lastIndexOf('}') + 1)).rows ?? [];
}

if (process.argv.includes('--cleanup')) {
  console.log(JSON.stringify(query(fs.readFileSync(path.join(dir, 'cleanup.sql'), 'utf8'))));
  process.exit(0);
}

query(fs.readFileSync(path.join(dir, 'cleanup.sql'), 'utf8'));
query(fs.readFileSync(path.join(dir, 'setup-extended.sql'), 'utf8'));
const [{ l, t1, t2, t3 }] = query(`select (select id from auth.users where email like 'zzrace.l.%@example.invalid') l, (select id from auth.users where email like 'zzrace.t1.%@example.invalid') t1, (select id from auth.users where email like 'zzrace.t2.%@example.invalid') t2, (select id from auth.users where email like 'zzrace.t3.%@example.invalid') t3`);
const tutors = [t1, t2, t3];
const wReqs = query(`select id from public.session_requests where paystack_reference like 'zzrace\\_w%' order by requested_start`).map((x) => x.id);
const cReqs = query(`select id from public.session_requests where paystack_reference like 'zzrace\\_c%' order by requested_start`).map((x) => x.id);
const before = query(`select (select count(*) from public.sessions where student_id = '${l}') s, (select available_rand || '/' || held_rand from public.wallets where profile_id = '${l}') w`)[0];
console.log(`fixture: ${wReqs.length} wallet requests, ${cReqs.length} card requests, 3 tutors, wallet before (available/held) ${before.w}, sessions before ${before.s}`);

const [{ at }] = query(`select to_char(clock_timestamp() + interval '120 seconds', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') at`);
const claimSql = (scenario, round, q, t) => `do $do$
declare j jsonb; t0 timestamptz; o text; d text;
begin
  perform pg_sleep(greatest(0, extract(epoch from ('${at}'::timestamptz - clock_timestamp()))));
  t0 := clock_timestamp();
  set local role service_role;
  begin
    select public.claim_session_request('${q}', '${t}') into j;
    o := 'accepted:' || (j ->> 'mode');
    d := j::text;
  exception when others then
    o := 'refused:' || sqlerrm;
  end;
  reset role;
  insert into public.zzrace_results values ('${scenario}', ${round}, '${q}', '${t}', t0, clock_timestamp(), o, d);
end $do$;`;

const procs = [];
const jobs = [['W3', wReqs], ['C3', cReqs]];
for (const [scenario, reqs] of jobs) {
  for (let i = 0; i < ROUNDS; i++) {
    for (const [n, t] of [['a', t1], ['b', t2], ['c', t3]]) {
      const f = path.join(tmp, `claim-${scenario}-${i}${n}.sql`);
      fs.writeFileSync(f, claimSql(scenario, i, reqs[i], t));
      const delay = procs.length * 3000;
      procs.push(new Promise((res) => { setTimeout(() => {
        const args = ['supabase', 'db', 'query', '--linked', ...(workdir ? ['--workdir', workdir] : []), '-f', f];
        const c = spawn('npx', args, { shell: true });
        let o = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (o += d));
        c.on('close', (code) => res({ scenario, round: i, who: n, code, out: o.replace(/\s+/g, ' ').slice(0, 300) }));
      }, delay); }));
    }
  }
}
console.log(`${procs.length} claim processes started 3 s apart; they all fire at the shared instant ${at}`);
const done = await Promise.all(procs);
const bad = done.filter((d) => d.code !== 0 || /"_tag":"Error"/.test(d.out));
if (bad.length) console.log('PROCESS PROBLEMS:', JSON.stringify(bad));

const res = query(`select scenario, round, tutor_id, outcome, detail, extract(epoch from started_at)::float8 e from public.zzrace_results order by scenario, round, started_at`);
let fails = 0;
const lines = [];
const ck = (id, label, got, want) => { const ok = String(got) === String(want); if (!ok) fails++; lines.push(`${id} ${label}: ${got}${ok ? ' ok' : ` FAIL (want ${want})`}`); };
const REFUSED = 'refused:Another tutor already accepted this request, or it is no longer available.';
const won = {};
for (const [scenario, reqs] of jobs) {
  for (let i = 0; i < ROUNDS; i++) {
    const rr = res.filter((x) => x.scenario === scenario && x.round === i);
    const acc = rr.filter((x) => x.outcome.startsWith('accepted'));
    const refused = rr.filter((x) => x.outcome === REFUSED).length;
    const skew = rr.length ? Math.round((Math.max(...rr.map((x) => x.e)) - Math.min(...rr.map((x) => x.e))) * 1000) : 'n/a';
    ck(`${scenario}.${i + 1}a`, `all three claims ran; exactly one accepted, two refused with the plain "already accepted" words (first to last start ${skew} ms apart)`, `${rr.length} ran, ${acc.length} accepted, ${refused} refused`, '3 ran, 1 accepted, 2 refused');
    won[`${scenario}${i}`] = acc[0];
  }
}
// W3 database state
const w = query(`select q.id, q.status, q.payment_status, q.tutor_id,
    (select count(*) from public.sessions s where s.id = q.resulting_session_id) as sess,
    (select count(*) from public.sessions s where s.student_id = '${l}' and s.scheduled_start = q.requested_start) as same_slot,
    (select count(*) from public.wallet_ledger x where x.idempotency_key = 'charge:' || q.id) as charges,
    (select count(*) from public.wallet_ledger x where x.idempotency_key = 'hold:' || q.id) as holds,
    (select count(*) from public.wallet_ledger x where x.idempotency_key = 'release:' || q.id) as releases,
    (select count(*) from public.notifications n where n.profile_id = '${l}' and n.type = 'request_accepted' and n.related_session_id = q.resulting_session_id) as told
  from public.session_requests q where q.paystack_reference like 'zzrace\\_w%' order by q.requested_start`);
w.forEach((r, i) => {
  const winner = won[`W3${i}`];
  ck(`W3.${i + 1}b`, 'request accepted by the winner only; one session; one charge line, one hold line, no release; learner told once',
    `${r.status}/${r.payment_status} tutor_is_winner=${winner ? r.tutor_id === winner.tutor_id : 'none'} sessions=${r.sess} same_slot=${r.same_slot} charges=${r.charges} holds=${r.holds} releases=${r.releases} told=${r.told}`,
    'accepted/wallet_paid tutor_is_winner=true sessions=1 same_slot=1 charges=1 holds=1 releases=0 told=1');
});
// C3 database state: the winner's request is `charging` with the very reference the winner was told; no session, no ledger line; the other tutors hold nothing
const c = query(`select q.id, q.status, q.payment_status, q.tutor_id, q.charge_reference, q.resulting_session_id is null as no_session,
    (select count(*) from public.sessions s where s.student_id = '${l}' and s.scheduled_start = q.requested_start) as same_slot,
    (select count(*) from public.wallet_ledger x where x.idempotency_key like '%' || q.id || '%') as ledger
  from public.session_requests q where q.paystack_reference like 'zzrace\\_c%' order by q.requested_start`);
c.forEach((r, i) => {
  const winner = won[`C3${i}`];
  let reply = {};
  try { reply = JSON.parse(winner?.detail ?? '{}'); } catch { /* checked below */ }
  ck(`C3.${i + 1}b`, 'the winner was told mode "charge" with a charge reference, R100 in cents; the request is `charging` for the winner only with that same reference; no session yet; nothing in the wallet ledger',
    `mode=${reply.mode} amount_cents=${reply.amount_cents} ref_matches=${!!reply.charge_reference && reply.charge_reference === r.charge_reference} ${r.status}/${r.payment_status} tutor_is_winner=${winner ? r.tutor_id === winner.tutor_id : 'none'} no_session=${r.no_session} same_slot=${r.same_slot} ledger=${r.ledger}`,
    'mode=charge amount_cents=10000 ref_matches=true pending/charging tutor_is_winner=true no_session=true same_slot=0 ledger=0');
});
const after = query(`select (select count(*) from public.sessions where student_id = '${l}') s, (select available_rand || '/' || held_rand from public.wallets where profile_id = '${l}') w`)[0];
ck('T1', `${ROUNDS} wallet requests, ${ROUNDS} sessions in all (no double session; the card requests make none)`, after.s - before.s, ROUNDS);
ck('T2', `wallet: R1000 less ${ROUNDS} x R100 charged exactly once (available/held)`, after.w, `${1000 - ROUNDS * 100}/0`);
const tally = (s) => tutors.map((t) => res.filter((x) => x.scenario === s && x.outcome.startsWith('accepted') && x.tutor_id === t).length).join('/');
lines.push(`info wins per tutor (t1/t2/t3): wallet ${tally('W3')}, card ${tally('C3')}`);
console.log(lines.join('\n'));
console.log(`\nCLAIM RACE EXTENDED (dev ${DEV}): ${lines.length} lines, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
