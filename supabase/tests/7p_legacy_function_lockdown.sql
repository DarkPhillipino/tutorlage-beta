-- Rolled-back test of the legacy-function lockdown (migration 20260930230000). See README.md.
-- Also confirm afterwards that the pg_cron jobs still succeed:
--   select j.jobname, d.status, d.start_time from cron.job_run_details d
--   join cron.job j on j.jobid = d.jobid order by d.start_time desc limit 4;
do $$
declare
  r text := E'\n';
  v1 uuid := gen_random_uuid();
  v_cnt int;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v1, z,'authenticated','authenticated','t.l.'||v1||'@example.invalid', jsonb_build_object('role','tutor','date_of_birth','1990-01-01'), '{}');
  select count(*) into v_cnt from tutor_profiles where id = v1;
  r := r || format('L1 signup trigger still fires: tutor rows=%s (want 1)', v_cnt) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  set local role anon;
  begin
    perform public.fn_expire_stale_session_requests(0);
    r := r || 'L2 FAIL anon expired requests' || E'\n';
  exception when others then r := r || 'L2 ok anon refused: ' || sqlerrm || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v1, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.expire_stale_paid_requests();
    r := r || 'L3 FAIL user ran the refund job' || E'\n';
  exception when others then r := r || 'L3 ok signed-in user refused: ' || sqlerrm || E'\n'; end;
  reset role;
  raise exception 'LOCKDOWN TEST (rolled back): %', r;
end $$;
