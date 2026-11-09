-- Rolled-back test of migration 20261104210100_admins_read_only_sessions.sql (4 Nov 2026).
-- Run the migration together with this file in one rolled-back statement (migration first):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/admins_read_only_sessions.sql supabase/migrations/20261104210100_admins_read_only_sessions.sql
-- or, once the migration is applied, paste this file alone. Fixtures are made-up people (example.invalid), one session, one request and one
-- dispute, all inserted as the owner. Every line ends "ok" or "FAIL (want ...)"; the block raises an error at the end on purpose so
-- nothing is kept.
-- A line that FAILs in group P (the list of write-capable policies) or X (functions that write these tables) names what it found: that is
-- information for the programmer, not a reason to apply anything by hand.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_sa uuid := gen_random_uuid();    -- super_admin
  v_fm uuid := gen_random_uuid();    -- finance_manager
  v_su uuid := gen_random_uuid();    -- support_agent
  v_of uuid := gen_random_uuid();    -- a support agent whose access is switched off
  v_l  uuid := gen_random_uuid();    -- an adult learner
  v_t  uuid := gen_random_uuid();    -- a tutor
  v_o  uuid := gen_random_uuid();    -- a stranger
  e uuid; s uuid; q uuid; d uuid;
  s_before text; q_before text;
  t text; nfail int; nlines int;
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
  -- the server's key: the service_role runs as itself and is not held to row policies
  execute $mk$
    create function pg_temp.as_service(p_sql text) returns text language plpgsql as $f$
    declare v text;
    begin
      set local role service_role;
      begin
        execute p_sql into v;
        reset role;
        return coalesce(v, 'null');
      exception when others then
        reset role;
        return 'ERR: ' || sqlerrm;
      end;
    end $f$ $mk$;
  -- "changed nothing": the statement touched 0 rows or was refused
  execute $mk$
    create function pg_temp.nowrite(p_u uuid, p_sql text) returns text language sql as $f$
      select (a.res = '0' or a.res like 'ERR:%')::text from (select pg_temp.run_as(p_u, p_sql) as res) a $f$ $mk$;
  -- everything a signed-in admin could do to the two tables: eight answers in one line
  --   read the session, read the request, update the session's money columns (rows changed), delete the session (0 rows or refused: the
  --   authenticated role has no DELETE right on sessions at all, which is stronger than a 0-row delete: true), insert a session (refused?),
  --   update the request's money columns (rows), delete the request (rows), insert a request (refused?)
  execute $mk$
    create function pg_temp.attack(p_u uuid, p_s uuid, p_q uuid, p_stu uuid, p_tut uuid, p_enr uuid) returns text language plpgsql as $f$
    begin
      return array_to_string(array[
        pg_temp.run_as(p_u, format('select count(*)::text from public.sessions where id = %L', p_s)),
        pg_temp.run_as(p_u, format('select count(*)::text from public.session_requests where id = %L', p_q)),
        pg_temp.run_as(p_u, format('with u as (update public.sessions set gross_amount = 1, tutor_payout_amount = 1, platform_commission_pct = 0 where id = %L returning 1) select count(*)::text from u', p_s)),
        pg_temp.nowrite(p_u, format('with d as (delete from public.sessions where id = %L returning 1) select count(*)::text from d', p_s)),
        (pg_temp.run_as(p_u, format('insert into public.sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount) values (%L, %L, %L, now() + interval ''2 days'', 1, 0, 1, 1)', p_stu, p_tut, p_stu)) like 'ERR:%')::text,
        pg_temp.run_as(p_u, format('with u as (update public.session_requests set charged_amount = 1, payment_status = ''paid'' where id = %L returning 1) select count(*)::text from u', p_q)),
        pg_temp.run_as(p_u, format('with d as (delete from public.session_requests where id = %L returning 1) select count(*)::text from d', p_q)),
        (pg_temp.run_as(p_u, format('insert into public.session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, tier_id) values (%L, %L, %L, now() + interval ''3 days'', 1, ''adm_probe'', ''1A'', 1)', p_stu, p_enr, p_stu)) like 'ERR:%')::text
      ], ' ');
    end $f$ $mk$;

  -- ---- people, one session, one request, one dispute (all inserted as the owner) -------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_sa, z, 'authenticated', 'authenticated', 'ro.sa.' || v_sa || '@example.invalid', jsonb_build_object('first_name', 'Sue', 'surname', 'Super', 'date_of_birth', adult), '{}'),
    (v_fm, z, 'authenticated', 'authenticated', 'ro.fm.' || v_fm || '@example.invalid', jsonb_build_object('first_name', 'Fin', 'surname', 'Manager', 'date_of_birth', adult), '{}'),
    (v_su, z, 'authenticated', 'authenticated', 'ro.su.' || v_su || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
    (v_of, z, 'authenticated', 'authenticated', 'ro.of.' || v_of || '@example.invalid', jsonb_build_object('first_name', 'Olly', 'surname', 'Off', 'date_of_birth', adult), '{}'),
    (v_l,  z, 'authenticated', 'authenticated', 'ro.l.'  || v_l  || '@example.invalid', jsonb_build_object('first_name', 'Lee', 'surname', 'Learner', 'date_of_birth', adult), '{}'),
    (v_t,  z, 'authenticated', 'authenticated', 'ro.t.'  || v_t  || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'surname', 'Tutor', 'date_of_birth', adult), '{}'),
    (v_o,  z, 'authenticated', 'authenticated', 'ro.o.'  || v_o  || '@example.invalid', jsonb_build_object('first_name', 'Otto', 'surname', 'Other', 'date_of_birth', adult), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (v_sa, 'Sue', 'Super', 'ro.sa.' || v_sa || '@example.invalid', '', 'super_admin', true),
    (v_fm, 'Fin', 'Manager', 'ro.fm.' || v_fm || '@example.invalid', '', 'finance_manager', true),
    (v_su, 'Sam', 'Support', 'ro.su.' || v_su || '@example.invalid', '', 'support_agent', true),
    (v_of, 'Olly', 'Off', 'ro.of.' || v_of || '@example.invalid', '', 'support_agent', false);
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_l, 'Zorology', 'Grade 10') returning id into e;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
    values (v_l, v_t, v_l, now() + interval '1 day', 100, 20, 100, 80) returning id into s;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference,
                                min_sub_tier_id, tier_id, charged_amount, currency_code)
    values (v_l, e, v_l, now() + interval '5 days', 1, 'pending', 'initiated', 'ro_' || gen_random_uuid(), '1A', 1, 100, 'ZAR') returning id into q;
  insert into platform_disputes (session_id, raised_by_id, reason, description) values (s, v_l, 'other', 'fixture dispute for the admin read-only test') returning id into d;
  select to_jsonb(x)::text into s_before from sessions x where x.id = s;
  select to_jsonb(x)::text into q_before from session_requests x where x.id = q;
  r := r || 'S0 setup: a super admin, a finance manager, a support agent, a switched-off support agent, a learner, a tutor, a stranger; one session, one request, one dispute' || E'\n';

  -- ---- admins: read yes; update, delete, insert no (every role, even the super admin) -------------------------------------------------------
  r := r || pg_temp.chk('A1', 'a SUPPORT AGENT: reads both rows; updating money columns changes 0 rows; delete 0; insert of a session refused; same for the request',
    pg_temp.attack(v_su, s, q, v_l, v_t, e), '1 1 0 true true 0 0 true');
  r := r || pg_temp.chk('A2', 'a FINANCE MANAGER: the same (money moves through the audited admin functions, not through these tables)',
    pg_temp.attack(v_fm, s, q, v_l, v_t, e), '1 1 0 true true 0 0 true');
  r := r || pg_temp.chk('A3', 'a SUPER ADMIN: the same (read yes, direct writes no)',
    pg_temp.attack(v_sa, s, q, v_l, v_t, e), '1 1 0 true true 0 0 true');
  select to_jsonb(x)::text into t from sessions x where x.id = s;
  r := r || pg_temp.chk('A4', 'the session row is byte for byte what it was (every column)', (t = s_before)::text, 'true');
  select to_jsonb(x)::text into t from session_requests x where x.id = q;
  r := r || pg_temp.chk('A5', 'the request row is byte for byte what it was (every column)', (t = q_before)::text, 'true');
  select count(*)::text into t from session_requests where paystack_reference = 'adm_probe';
  r := r || pg_temp.chk('A6', 'no request was added by an admin', t, '0');

  -- ---- everyone else is as before --------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('B1', 'a switched-off admin sees neither table row',
    pg_temp.run_as(v_of, format('select count(*)::text from public.sessions where id = %L', s)) || ' ' || pg_temp.run_as(v_of, format('select count(*)::text from public.session_requests where id = %L', q)), '0 0');
  r := r || pg_temp.chk('B2', 'the learner still reads their own session and request',
    pg_temp.run_as(v_l, format('select count(*)::text from public.sessions where id = %L', s)) || ' ' || pg_temp.run_as(v_l, format('select count(*)::text from public.session_requests where id = %L', q)), '1 1');
  r := r || pg_temp.chk('B3', 'the session''s tutor still reads their session',
    pg_temp.run_as(v_t, format('select count(*)::text from public.sessions where id = %L', s)), '1');
  r := r || pg_temp.chk('B4', 'a stranger reads neither',
    pg_temp.run_as(v_o, format('select count(*)::text from public.sessions where id = %L', s)) || ' ' || pg_temp.run_as(v_o, format('select count(*)::text from public.session_requests where id = %L', q)), '0 0');
  r := r || pg_temp.chk('B5', 'the learner cannot write the session or the request either (0 rows, or refused)',
    pg_temp.nowrite(v_l, format('with u as (update public.sessions set gross_amount = 1 where id = %L returning 1) select count(*)::text from u', s)) || ' ' ||
    pg_temp.nowrite(v_l, format('with u as (update public.session_requests set charged_amount = 1 where id = %L returning 1) select count(*)::text from u', q)),
    'true true');
  select count(*)::text into t from sessions x where x.id = s and x.gross_amount = 1;
  r := r || pg_temp.chk('B6', 'and nothing changed (no session with a gross amount of 1)', t, '0');

  -- ---- the Disputes page: it writes platform_disputes only, and that still works for a support agent -------------------------------------------
  t := pg_temp.run_as(v_su, format($q$with u as (update public.platform_disputes set status = 'dismissed', resolution_notes = 'test', refund_amount = null, resolved_at = now(), assigned_admin_id = %L where id = %L returning 1) select count(*)::text from u$q$, v_su, d));
  select t || ' / ' || status::text into t from platform_disputes where id = d;
  r := r || pg_temp.chk('D1', 'the Disputes page''s own update (platform_disputes) still works for a support agent: 1 row, status stored', t, '1 / dismissed');

  -- ---- the admin functions and the server do not need the admin's table rights ----------------------------------------------------------------
  execute $mk$
    create function public.zz_session_write_probe(p_s uuid, p_q uuid) returns text language plpgsql security definer set search_path = public as $f$
    declare a int; b int;
    begin
      update public.sessions set tutor_payout_amount = 81 where id = p_s;
      get diagnostics a = row_count;
      update public.session_requests set charged_amount = 101 where id = p_q;
      get diagnostics b = row_count;
      return a::text || ' ' || b::text;
    end $f$ $mk$;
  grant execute on function public.zz_session_write_probe(uuid, uuid) to authenticated;
  r := r || pg_temp.chk('F1', 'a SECURITY DEFINER function run by a support agent can still write both tables (this is how the audited admin_* functions work)',
    pg_temp.run_as(v_su, format('select public.zz_session_write_probe(%L, %L)', s, q)), '1 1');
  select tutor_payout_amount::text || ' ' || charged_amount::text into t from sessions x join session_requests y on y.id = q where x.id = s;
  r := r || pg_temp.chk('F2', 'and the values really changed (a session payout of 81, a request charge of 101)', regexp_replace(t, '\.00', '', 'g'), '81 101');
  r := r || pg_temp.chk('F3', 'the server''s key (service_role) can still update a request',
    pg_temp.as_service(format('with u as (update public.session_requests set card_check_refund_status = ''queued'' where id = %L returning 1) select count(*)::text from u', q)), '1');

  -- ---- what is installed -------------------------------------------------------------------------------------------------------------------------
  select string_agg(tablename || ':' || policyname || ':' || cmd, ' | ' order by tablename, policyname) into t from pg_policies
    where schemaname = 'public' and tablename in ('sessions', 'session_requests')
      and policyname in ('Admins manage session requests', 'Admins manage sessions', 'Admins read session requests', 'Admins read sessions');
  r := r || pg_temp.chk('P1', 'the four policy names this migration touches: the two read-only ones exist (SELECT), the two old FOR ALL ones are gone', t,
    'session_requests:Admins read session requests:SELECT | sessions:Admins read sessions:SELECT');
  select coalesce(string_agg(tablename || ':' || policyname || ':' || cmd, ' | ' order by tablename, policyname), '(none)') into t from pg_policies
    where schemaname = 'public' and tablename in ('sessions', 'session_requests') and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  r := r || pg_temp.chk('P2', 'every policy that can write either table (only the learner / guardian insert of a request is wanted)', t,
    'session_requests:Learners or their guardians create session requests:INSERT');
  select coalesce(string_agg(tablename || ':' || policyname || ':' || cmd, ' | ' order by tablename, policyname), '(none)') into t from pg_policies
    where schemaname = 'public' and tablename in ('sessions', 'session_requests') and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and (coalesce(qual, '') ilike '%is_active_admin%' or coalesce(with_check, '') ilike '%is_active_admin%' or coalesce(qual, '') ilike '%admin_profiles%' or coalesce(with_check, '') ilike '%admin_profiles%');
  r := r || pg_temp.chk('P3', 'every WRITE policy on the two tables that gives an admin a right (none)', t, '(none)');
  select coalesce(string_agg(p.proname, ',' order by p.proname), '(none)') into t from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and not p.prosecdef
      and p.proname not in ('zz_session_write_probe')
      and (p.prosrc ~* 'update\s+(public\.)?(sessions|session_requests)\y' or p.prosrc ~* 'delete\s+from\s+(public\.)?(sessions|session_requests)\y'
           or p.prosrc ~* 'insert\s+into\s+(public\.)?(sessions|session_requests)\y');
  r := r || pg_temp.chk('X1', 'functions that write either table and are NOT security definer (they would have relied on the admin''s row rights)', t, '(none)');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'ADMINS READ-ONLY SESSIONS TEST (rolled back): % lines, % FAIL\n%', nlines, nfail, r;
end $$;
