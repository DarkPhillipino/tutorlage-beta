// The concurrent two-tutor claim race (see README.md). DEV DATABASE ONLY. Run from the repository root of a copy linked to dev:
//   node supabase/tests/claim_race/claim-race.mjs            (set it up, race, verify, print the verdict; leaves the fixture for inspection)
//   node supabase/tests/claim_race/claim-race.mjs --cleanup  (remove the fixture and restore the settings)
// Each claim is a separate `supabase db query` process, so it is its own database connection; every process sleeps INSIDE the database until
// one shared instant (the database clock, 80 s ahead; the processes are started 3 s apart because the pooler rate-limits temporary logins) and then calls claim_session_request as the server's role, exactly as the Worker does.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEV = 'wfpjoxetbprmllqqarwp';
const ROUNDS = 6;
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-race-'));
const sb = (file, workdir) => spawnSync('npx', ['supabase', 'db', 'query', '--linked', ...(workdir ? ['--workdir', workdir] : []), '-f', file], { encoding: 'utf8', shell: true });
const workdir = process.env.RACE_WORKDIR || undefined;

const ref = (() => { try { return fs.readFileSync(path.resolve(workdir || '.', 'supabase/.temp/project-ref'), 'utf8').trim(); } catch { return ''; } })();
if (ref !== DEV) { console.error(`Refusing: this copy is linked to "${ref}", not the dev database ${DEV}.`); process.exit(2); }

function query(sql) {
  const f = path.join(tmp, `q${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(f, sql);
  const r = sb(f, workdir);
  const out = r.stdout || '';
  const i = out.indexOf('{');
  if (r.status !== 0 || i < 0) throw new Error('query failed: ' + (r.stdout + r.stderr).replace(/\s+/g, ' ').slice(0, 600));
  return JSON.parse(out.slice(i)).rows ?? [];
}

if (process.argv.includes('--cleanup')) {
  console.log(JSON.stringify(query(fs.readFileSync(path.join(dir, 'cleanup.sql'), 'utf8'))));
  process.exit(0);
}

query(fs.readFileSync(path.join(dir, 'cleanup.sql'), 'utf8'));
query(fs.readFileSync(path.join(dir, 'setup.sql'), 'utf8'));
const [{ l, t1, t2 }] = query(`select (select id from auth.users where email like 'zzrace.l.%@example.invalid') l, (select id from auth.users where email like 'zzrace.t1.%@example.invalid') t1, (select id from auth.users where email like 'zzrace.t2.%@example.invalid') t2`);
const reqs = query(`select id from public.session_requests where paystack_reference like 'zzrace\\_%' order by requested_start`).map((x) => x.id);
const before = query(`select (select count(*) from public.sessions where student_id = '${l}') s, (select available_rand || '/' || held_rand from public.wallets where profile_id = '${l}') w`)[0];
console.log(`fixture: ${reqs.length} sent requests, tutors t1/t2, wallet before (available/held) ${before.w}, sessions before ${before.s}`);

// the shared instant, on the database's clock
const [{ at }] = query(`select to_char(clock_timestamp() + interval '80 seconds', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') at`);
const claimSql = (round, q, t) => `do $do$
declare j jsonb; t0 timestamptz; o text;
begin
  perform pg_sleep(greatest(0, extract(epoch from ('${at}'::timestamptz - clock_timestamp()))));
  t0 := clock_timestamp();
  set local role service_role;
  begin
    select public.claim_session_request('${q}', '${t}') into j;
    o := 'accepted:' || (j ->> 'mode');
  exception when others then
    o := 'refused:' || sqlerrm;
  end;
  reset role;
  insert into public.zzrace_results values (${round}, '${q}', '${t}', t0, clock_timestamp(), o);
end $do$;`;

const procs = [];
for (let i = 0; i < ROUNDS; i++) {
  for (const [n, t] of [['a', t1], ['b', t2]]) {
    const f = path.join(tmp, `claim-${i}${n}.sql`);
    fs.writeFileSync(f, claimSql(i, reqs[i], t));
    procs.push(new Promise((res) => { setTimeout(() => {
      const args = ['supabase', 'db', 'query', '--linked', ...(workdir ? ['--workdir', workdir] : []), '-f', f];
      const c = spawn('npx', args, { shell: true });
      let o = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (o += d));
      c.on('close', (code) => res({ round: i, who: n, code, out: o.replace(/\s+/g, ' ').slice(0, 300) }));
    }, procs.length * 3000); }));
  }
}
const done = await Promise.all(procs);
const bad = done.filter((d) => d.code !== 0 || /"_tag":"Error"/.test(d.out));
if (bad.length) console.log('PROCESS PROBLEMS:', JSON.stringify(bad));

const res = query(`select round, tutor_id, (tutor_id = '${t1}')::int as is_t1, outcome, to_char(started_at, 'HH24:MI:SS.MS') st, to_char(finished_at, 'HH24:MI:SS.MS') fin, extract(epoch from started_at)::float8 e from public.zzrace_results order by round, started_at`);
let fails = 0;
const lines = [];
const ck = (id, label, got, want) => { const ok = String(got) === String(want); if (!ok) fails++; lines.push(`${id} ${label}: ${got}${ok ? ' ok' : ` FAIL (want ${want})`}`); };
for (let i = 0; i < ROUNDS; i++) {
  const rr = res.filter((x) => x.round === i);
  const acc = rr.filter((x) => x.outcome.startsWith('accepted')).length;
  const ref2 = rr.filter((x) => x.outcome === 'refused:Another tutor already accepted this request, or it is no longer available.').length;
  const skew = rr.length === 2 ? Math.round(Math.abs(rr[0].e - rr[1].e) * 1000) : 'n/a';
  ck(`R${i + 1}a`, `both claims ran; exactly one accepted, the other refused with the plain "already accepted" words (starts ${skew} ms apart)`, `${rr.length} ran, ${acc} accepted, ${ref2} refused`, '2 ran, 1 accepted, 1 refused');
}
const win = query(`select q.id, q.status, q.payment_status, q.tutor_id, (select count(*) from public.sessions s where s.id = q.resulting_session_id) as sess,
    (select count(*) from public.sessions s where s.student_id = '${l}' and s.scheduled_start = q.requested_start) as same_slot,
    (select count(*) from public.wallet_ledger w where w.idempotency_key = 'charge:' || q.id) as charges,
    (select count(*) from public.wallet_ledger w where w.idempotency_key = 'hold:' || q.id) as holds,
    (select count(*) from public.wallet_ledger w where w.idempotency_key = 'release:' || q.id) as releases,
    (select count(*) from public.notifications n where n.profile_id = '${l}' and n.type = 'request_accepted' and n.related_session_id = q.resulting_session_id) as told
  from public.session_requests q where q.paystack_reference like 'zzrace\\_%' order by q.requested_start`);
win.forEach((w, i) => {
  const winner = res.find((x) => x.round === i && x.outcome.startsWith('accepted'));
  ck(`R${i + 1}b`, 'request accepted by the winner only; one session; one charge line, one hold line, no release; learner told once',
    `${w.status}/${w.payment_status} tutor_is_winner=${winner ? w.tutor_id === winner.tutor_id : 'none'} sessions=${w.sess} same_slot=${w.same_slot} charges=${w.charges} holds=${w.holds} releases=${w.releases} told=${w.told}`,
    'accepted/wallet_paid tutor_is_winner=true sessions=1 same_slot=1 charges=1 holds=1 releases=0 told=1');
});
const after = query(`select (select count(*) from public.sessions where student_id = '${l}') s, (select available_rand || '/' || held_rand from public.wallets where profile_id = '${l}') w,
   (select count(*) from public.sessions where student_id = '${l}' and tutor_id = '${t1}') s1, (select count(*) from public.sessions where student_id = '${l}' and tutor_id = '${t2}') s2`)[0];
ck('T1', `${ROUNDS} requests, ${ROUNDS} sessions in all (no double session)`, after.s - before.s, ROUNDS);
ck('T2', `wallet: R1000 less ${ROUNDS} x R100 charged exactly once (available/held)`, after.w, `${1000 - ROUNDS * 100}/0`);
lines.push(`info sessions won: tutor one ${after.s1}, tutor two ${after.s2}`);
console.log(lines.join('\n'));
console.log(`\nCLAIM RACE (dev ${DEV}): ${lines.length} lines, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
