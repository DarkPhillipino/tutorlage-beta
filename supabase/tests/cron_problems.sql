-- Rolled-back test of migration 20261118170000_cron_problems.sql (SHOULD batch A item 18, 18 Nov 2026): a job that failed, or has stopped running, is reported; healthy, idle, inactive and unreadable-schedule jobs are not;
-- only a super admin can read it. Made-up jobs only ('zz-...', scheduled and logged INSIDE this rolled-back statement: they never exist for the scheduler).
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/cron_problems.sql supabase/migrations/20261118170000_cron_problems.sql
-- After the apply, paste this file alone. The block ends with `raise exception` so nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_sa uuid := gen_random_uuid(); v_fin uuid := gen_random_uuid(); v_sup uuid := gen_random_uuid(); v_tut uuid := gen_random_uuid();
  j_fail bigint; j_stall bigint; j_ok bigint; j_dok bigint; j_dstall bigint; j_odd bigint; j_never bigint; j_off bigint;
  n_real int; t text; nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;
    execute $mk$
      create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        if p_u is null then
          perform set_config('request.jwt.claims', '', true);
          set local role anon;
        else
          perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
          set local role authenticated;
        end if;
        begin
          execute p_sql into v;
          reset role;
          return coalesce(v, 'null');
        exception when others then
          reset role;
          return 'ERR: ' || sqlerrm;
        end;
      end $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_sa, z, 'authenticated', 'authenticated', 'cr.sa.' || uid || '@example.invalid', '{}', '{}'),
      (v_fin, z, 'authenticated', 'authenticated', 'cr.fin.' || uid || '@example.invalid', '{}', '{}'),
      (v_sup, z, 'authenticated', 'authenticated', 'cr.sup.' || uid || '@example.invalid', '{}', '{}'),
      (v_tut, z, 'authenticated', 'authenticated', 'cr.t.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tia', 'surname', 'T', 'date_of_birth', ((now() at time zone 'Africa/Johannesburg')::date - interval '30 years')::date::text), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_sa, 'Sue', 'Super', 'cr.sa.' || uid || '@example.invalid', '', 'super_admin', true),
      (v_fin, 'Fin', 'Manager', 'cr.fin.' || uid || '@example.invalid', '', 'finance_manager', true),
      (v_sup, 'Sam', 'Support', 'cr.sup.' || uid || '@example.invalid', '', 'support_agent', true);

    -- the direct reads below are made as the super admin (the function checks the caller's JWT, not the database role)
    perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);
    select count(*) into n_real from public.admin_cron_problems(24);
    r := r || format('S0 real problems on production now (info; the made-up jobs below are counted by name): %s', n_real) || E'\n';

    -- the made-up jobs and runs, served by swapped copies of the two internal wrappers (inside this rolled-back statement only; the real scheduler tables are not written)
    j_fail := 9000001; j_stall := 9000002; j_ok := 9000003; j_dok := 9000004; j_dstall := 9000005; j_odd := 9000006; j_never := 9000007; j_off := 9000008;
    execute format($f$ create or replace function public.cron_problem_jobs() returns table (jobid bigint, jobname text, schedule text, active boolean) language sql stable as $b$
      select * from (values (%s::bigint, %L, '*/5 * * * *', true), (%s, %L, '*/5 * * * *', true), (%s, %L, '*/5 * * * *', true), (%s, %L, '30 2 * * *', true),
                            (%s, %L, '31 2 * * *', true), (%s, %L, '0 */6 * * *', true), (%s, %L, '*/5 * * * *', true), (%s, %L, '*/5 * * * *', false)) v(jobid, jobname, schedule, active) $b$ $f$,
      j_fail, 'zz-fail-' || uid, j_stall, 'zz-stall-' || uid, j_ok, 'zz-ok-' || uid, j_dok, 'zz-dok-' || uid, j_dstall, 'zz-dstall-' || uid, j_odd, 'zz-odd-' || uid, j_never, 'zz-never-' || uid, j_off, 'zz-off-' || uid);
    execute format($f$ create or replace function public.cron_problem_runs() returns table (jobid bigint, runid bigint, status text, return_message text, start_time timestamptz) language sql stable as $b$
      select * from (values
        (%s::bigint, 1::bigint, 'failed', 'older failure', now() - interval '3 hours'),
        (%s, 2, 'failed', 'ERROR: newest failure text', now() - interval '2 hours'),
        (%s, 3, 'failed', 'too old to count', now() - interval '2 days'),
        (%s, 4, 'succeeded', null, now() - interval '1 minute'),
        (%s, 5, 'succeeded', null, now() - interval '2 hours'),
        (%s, 6, 'succeeded', null, now() - interval '1 minute'), (%s, 7, 'succeeded', null, now() - interval '6 minutes'),
        (%s, 8, 'succeeded', null, now() - interval '20 hours'),
        (%s, 9, 'succeeded', null, now() - interval '4 days'),
        (%s, 10, 'succeeded', null, now() - interval '3 days'),
        (%s, 11, 'failed', 'inactive job failure', now() - interval '1 hour')) v(jobid, runid, status, return_message, start_time) $b$ $f$,
      j_fail, j_fail, j_fail, j_fail, j_stall, j_ok, j_ok, j_dok, j_dstall, j_odd, j_off);
    r := r || 'S1 setup: 8 made-up jobs (served by swapped wrappers) (failed, stalled, healthy, daily healthy, daily stalled, odd schedule, never ran, inactive) and 4 people' || E'\n';

    -- read as the super admin; the rows for the made-up jobs only
    r := r || pg_temp.chk('C1', 'the job that failed twice in 24 hours is reported once, with 2 failures, the NEWEST error text and a ref naming its newest failed run',
      (select p.problem || '/' || p.failures || '/' || p.message || '/' || (p.ref ~ ('^zz-fail-' || uid || ':failed:[0-9]+$'))::text from public.admin_cron_problems(24) p where p.job_name = 'zz-fail-' || uid and p.problem = 'failed'), 'failed/2/ERROR: newest failure text/true');
    r := r || pg_temp.chk('C2', 'its newest run (a success a minute ago) is shown as the last status', (select p.last_status from public.admin_cron_problems(24) p where p.job_name = 'zz-fail-' || uid), 'succeeded');
    r := r || pg_temp.chk('C3', 'the 2-day-old failure is outside the window (24 h) and the window is adjustable: 720 h sees 3',
      (select p.failures::text from public.admin_cron_problems(720) p where p.job_name = 'zz-fail-' || uid and p.problem = 'failed'), '3');
    r := r || pg_temp.chk('C4', 'a 1-hour window sees none of it', (select count(*)::text from public.admin_cron_problems(1) p where p.job_name = 'zz-fail-' || uid and p.problem = 'failed'), '0');
    r := r || pg_temp.chk('C5', 'a job that has not run for 2 hours although it runs every 5 minutes is reported stalled',
      (select p.problem || '/' || (p.message like 'Last ran %') || '/' || (p.ref ~ ('^zz-stall-' || uid || ':stalled:[0-9]{12}$'))::text from public.admin_cron_problems(24) p where p.job_name = 'zz-stall-' || uid), 'stalled/true/true');
    r := r || pg_temp.chk('C6', 'a healthy every-5-minutes job is not reported', (select count(*)::text from public.admin_cron_problems(24) p where p.job_name = 'zz-ok-' || uid), '0');
    r := r || pg_temp.chk('C7', 'a daily job that ran 20 hours ago is not reported', (select count(*)::text from public.admin_cron_problems(24) p where p.job_name = 'zz-dok-' || uid), '0');
    r := r || pg_temp.chk('C8', 'a daily job that last ran 4 days ago is reported stalled', (select p.problem from public.admin_cron_problems(24) p where p.job_name = 'zz-dstall-' || uid), 'stalled');
    r := r || pg_temp.chk('C9', 'a schedule the function cannot read is never judged stalled', (select count(*)::text from public.admin_cron_problems(24) p where p.job_name = 'zz-odd-' || uid), '0');
    r := r || pg_temp.chk('C10', 'a job that never ran is not reported', (select count(*)::text from public.admin_cron_problems(24) p where p.job_name = 'zz-never-' || uid), '0');
    r := r || pg_temp.chk('C11', 'an inactive job is not reported, whatever its history', (select count(*)::text from public.admin_cron_problems(24) p where p.job_name = 'zz-off-' || uid), '0');
    r := r || pg_temp.chk('C12', 'exactly three problems come from the made-up jobs (failed, stalled, daily stalled) and none anywhere else changed (real problems = the info count above)',
      ((select count(*) from public.admin_cron_problems(24)) - n_real)::text, '3');

    -- who may read it
    r := r || pg_temp.chk('C13', 'a super admin can call it', (pg_temp.run_as(v_sa, 'select count(*)::text from public.admin_cron_problems(24)')::int >= 3)::text, 'true');
    r := r || pg_temp.chk('C14', 'a finance manager cannot', pg_temp.run_as(v_fin, 'select count(*)::text from public.admin_cron_problems(24)'), 'ERR: Only a super admin can see this');
    r := r || pg_temp.chk('C15', 'a support agent cannot', pg_temp.run_as(v_sup, 'select count(*)::text from public.admin_cron_problems(24)'), 'ERR: Only a super admin can see this');
    r := r || pg_temp.chk('C16', 'a tutor cannot', pg_temp.run_as(v_tut, 'select count(*)::text from public.admin_cron_problems(24)'), 'ERR: Admins only');
    r := r || pg_temp.chk('C17', 'signed out cannot, and nor can the server key',
      has_function_privilege('anon', 'public.admin_cron_problems(integer)', 'execute')::text || '/' || has_function_privilege('service_role', 'public.admin_cron_problems(integer)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.admin_cron_problems(integer)', 'execute')::text, 'false/false/true');
    r := r || pg_temp.chk('C18', 'the window must be 1 to 720 hours', pg_temp.run_as(v_sa, 'select count(*)::text from public.admin_cron_problems(0)') || ' | ' || pg_temp.run_as(v_sa, 'select count(*)::text from public.admin_cron_problems(721)'),
      'ERR: Hours must be between 1 and 720 | ERR: Hours must be between 1 and 720');
    r := r || pg_temp.chk('C19', 'it reads only (stable) and writes nothing', (select provolatile::text from pg_proc where oid = 'public.admin_cron_problems(integer)'::regprocedure), 's');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
