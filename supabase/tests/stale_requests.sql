-- Rolled-back test of migration 20261118100000_stale_requests.sql (road to P5 items 31 and 3; 18 Nov 2026).
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/stale_requests.sql supabase/migrations/20261118100000_stale_requests.sql
-- After the apply, paste this file alone. Fixtures are made-up people (example.invalid); every real request is left alone and counted only. The block ends with `raise exception`, so nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  adult text := (v_today - interval '30 years')::date::text;
  v_l uuid := gen_random_uuid();
  v_sa uuid := gen_random_uuid();
  qa uuid; qb uuid; qc uuid; qd uuid; qe uuid; qf uuid;
  real_open int; real_stale int; real_init int;
  t text; n int; n2 int; nfail int; nlines int;
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
    execute $mk$
      create function pg_temp.mkq(p_stu uuid, p_status text, p_pay text, p_age interval, p_addr boolean default false) returns uuid language plpgsql as $f$
      declare v uuid;
      begin
        insert into public.session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, created_at)
        values (p_stu, p_stu, now() + interval '5 days', 1, p_status, p_pay, 'sr_' || gen_random_uuid(), '1A', 1, 50, now() - p_age)
        returning id into v;
        return v;
      end $f$ $mk$;

    -- what is really there (read only; none of it is touched by name)
    select count(*) filter (where status = 'pending' and payment_status = 'initiated' and created_at < now() - interval '60 minutes'),
           count(*) filter (where status = 'pending' and payment_status = 'card_verified' and created_at <= now() - interval '24 hours'),
           count(*) filter (where status = 'pending' and payment_status = 'initiated')
      into real_stale, real_open, real_init from public.session_requests;
    r := r || format('S0 real rows now (info): initiated and older than 60 min=%s, funded and waiting 24 h or more=%s, initiated in all=%s', real_stale, real_open, real_init) || E'\n';

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_l, z, 'authenticated', 'authenticated', 'sr.l.' || uid || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}'),
      (v_sa, z, 'authenticated', 'authenticated', 'sr.a.' || uid || '@example.invalid', '{}'::jsonb, '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active)
      values (v_sa, 'Sue', 'Support', 'sr.a.' || uid || '@example.invalid', '', 'support_agent', true);

    qa := pg_temp.mkq(v_l, 'pending', 'initiated', interval '2 hours');       -- abandoned draft: to be cancelled
    qb := pg_temp.mkq(v_l, 'pending', 'initiated', interval '10 minutes');    -- a payment may be in progress: untouched
    qc := pg_temp.mkq(v_l, 'pending', 'card_verified', interval '3 days', true);   -- funded, open to any tutor, waiting 72 h: in the watch, not expired by the job
    qd := pg_temp.mkq(v_l, 'accepted', 'paid', interval '3 days');            -- done: untouched
    qe := pg_temp.mkq(v_l, 'pending', 'card_verified', interval '1 hour');    -- funded, waiting 1 h: not in the 24 h watch
    qf := pg_temp.mkq(v_l, 'pending', 'initiated', interval '5 days');        -- very old draft: to be cancelled
    r := r || 'S1 setup: a learner, a support agent and six requests (made up)' || E'\n';

    -- ITEM 31 -------------------------------------------------------------------------------------------------------------------------------
    n := public.expire_stale_initiated_requests();
    r := r || pg_temp.chk('X1', 'the job cancelled the abandoned drafts: this run (made-up + real stale ones)', (n - real_stale)::text, '2');
    select string_agg(x.id::text, ',') into t from (select id from public.session_requests where id in (qa, qf) and status = 'cancelled' and responded_at is not null) x;
    r := r || pg_temp.chk('X2', 'both made-up drafts are cancelled with a response time', (select count(*)::text from public.session_requests where id in (qa, qf) and status = 'cancelled' and responded_at is not null), '2');
    r := r || pg_temp.chk('X3', 'the 10-minute-old draft is untouched', (select status || '/' || payment_status from public.session_requests where id = qb), 'pending/initiated');
    r := r || pg_temp.chk('X4', 'the funded waiting request, the accepted one and the 1-hour one are untouched', (select string_agg(status || '/' || payment_status, ' ' order by id = qc desc, id = qd desc) from public.session_requests where id in (qc, qd, qe)), 'pending/card_verified accepted/paid pending/card_verified');
    n2 := public.expire_stale_initiated_requests();
    r := r || pg_temp.chk('X5', 'a second run straight after cancels nothing', n2::text, '0');
    r := r || pg_temp.chk('X6', 'no real stale draft is left, and the real fresh ones were not touched', (select count(*)::text from public.session_requests where status = 'pending' and payment_status = 'initiated' and created_at < now() - interval '60 minutes'), '0');
    select count(*)::text into t from cron.job where jobname = 'expire-stale-initiated-requests' and schedule = '*/5 * * * *' and active and command = 'select public.expire_stale_initiated_requests();';
    r := r || pg_temp.chk('X7', 'scheduled every 5 minutes, active', t, '1');
    r := r || pg_temp.chk('X8', 'no API role may run the job',
      has_function_privilege('anon', 'public.expire_stale_initiated_requests()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.expire_stale_initiated_requests()', 'execute')::text || '/' || has_function_privilege('service_role', 'public.expire_stale_initiated_requests()', 'execute')::text,
      'false/false/false');
    r := r || pg_temp.chk('X9', 'the learner cannot run it either', pg_temp.run_as(v_l, 'select public.expire_stale_initiated_requests()::text'), 'ERR: permission denied for function expire_stale_initiated_requests');

    -- ITEM 3 --------------------------------------------------------------------------------------------------------------------------------
    t := pg_temp.run_as(v_sa, format('select count(*)::text from public.admin_stale_requests() w where w.request_id in (%L, %L, %L, %L, %L, %L)', qa, qb, qc, qd, qe, qf));
    r := r || pg_temp.chk('W1', 'the watch (24 h) lists only the funded request that has waited 3 days (of the six made up)', t, '1');
    t := pg_temp.run_as(v_sa, format('select w.request_id::text || ''/'' || w.hours_waiting::text || ''/'' || w.addressed_to_one_tutor::text || ''/'' || w.funding from public.admin_stale_requests() w where w.request_id = %L', qc));
    r := r || pg_temp.chk('W2', 'that row: id, hours waiting, open to any tutor (false), funding', replace(t, qc::text, 'ID'), 'ID/72.0/false/card');
    t := pg_temp.run_as(v_sa, format('select count(*)::text from public.admin_stale_requests(0) w where w.request_id in (%L, %L, %L, %L, %L, %L)', qa, qb, qc, qd, qe, qf));
    r := r || pg_temp.chk('W3', 'with 0 hours the two funded pending requests show (still not the drafts or the accepted one)', t, '2');
    r := r || pg_temp.chk('W4', 'a learner is refused', pg_temp.run_as(v_l, 'select count(*)::text from public.admin_stale_requests()'), 'ERR: Admins only');
    r := r || pg_temp.chk('W5', 'a signed-out caller is refused', pg_temp.run_as(null, 'select count(*)::text from public.admin_stale_requests()'), 'ERR: permission denied for function admin_stale_requests');
    r := r || pg_temp.chk('W6', 'a silly number of hours is refused', pg_temp.run_as(v_sa, 'select count(*)::text from public.admin_stale_requests(-1)'), 'ERR: Hours must be between 0 and 8760');
    select string_agg(a.attname, ',' order by a.attnum) into t from pg_proc p, unnest(p.proargnames) with ordinality as a(attname, attnum), unnest(p.proargmodes) with ordinality as m(mode, mnum)
      where p.oid = 'public.admin_stale_requests(integer)'::regprocedure and a.attnum = m.mnum and m.mode = 't';
    r := r || pg_temp.chk('W7', 'what it returns has no name, email, phone or tutor id', t, 'request_id,created_at,hours_waiting,requested_start,duration_hours,addressed_to_one_tutor,funding');
    select provolatile::text into t from pg_proc where oid = 'public.admin_stale_requests(integer)'::regprocedure;
    r := r || pg_temp.chk('W8', 'declared read-only (stable)', t, 's');
    r := r || pg_temp.chk('W9', 'anon may not run it, signed-in callers may (the admin test is inside)',
      has_function_privilege('anon', 'public.admin_stale_requests(integer)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.admin_stale_requests(integer)', 'execute')::text, 'false/true');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
