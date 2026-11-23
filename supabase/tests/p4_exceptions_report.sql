-- Rolled-back test of migration 20261123200000_p4_exceptions_report.sql (P4-5, 23 Nov 2026). Run it TOGETHER with the migration (one statement; the last line raises so everything is undone; needs the drift
-- migration 20261123120000 and slice A already applied) or alone after the apply. Made-up people only; nothing is kept. Real exceptions exist too, so every count is read as "before and after".
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_off uuid := gen_random_uuid(); v_sup uuid := gen_random_uuid(); t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  b jsonb; a jsonb; t text; txt text;
  nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null') || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$ $mk$;
    execute $mk$
      create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        if p_u is null then perform set_config('request.jwt.claims', '', true); set local role anon;
        else perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true); set local role authenticated; end if;
        begin execute p_sql into v; reset role; return coalesce(v, 'null');
        exception when others then reset role; return 'ERR: ' || sqlerrm; end;
      end $f$ $mk$;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_off, z, 'authenticated', 'authenticated', 'ex.off.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
      (v_sup, z, 'authenticated', 'authenticated', 'ex.sup.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
      (t1, z, 'authenticated', 'authenticated', 'ex.t1.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Exc', 'surname', 'Tutor', 'date_of_birth', adult), '{}'),
      (t2, z, 'authenticated', 'authenticated', 'ex.t2.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Other', 'surname', 'Person', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_off, 'Vic', 'Officer', 'ex.off.' || uid || '@example.invalid', '', 'verification_officer', true),
      (v_sup, 'Sam', 'Support', 'ex.sup.' || uid || '@example.invalid', '', 'support_agent', true);

    b := (pg_temp.run_as(v_off, 'select public.admin_exceptions_report()::text'))::jsonb;
    r := r || pg_temp.chk('A1', 'the answer has counts and rows', (b ? 'counts')::text || (b ? 'rows')::text, 'truetrue');
    r := r || pg_temp.chk('A2', 'the five counts', (select string_agg(k, ',' order by k) from jsonb_object_keys(b -> 'counts') k), 'direct_level,grandfathered,module7,not_ready,prior_hours');

    -- one of each exception, made the way the app makes them
    perform pg_temp.run_as(v_off, format($q$select public.admin_assign_tier(%L, '2C', 'a reason that is long enough')::text$q$, t1));
    perform pg_temp.run_as(v_off, format($q$select public.admin_add_prior_hours(%L, 40, 'taught at a school for a year', 'letter 2024-17')::text$q$, t1));
    perform pg_temp.run_as(v_off, format($q$select public.admin_grant_module7_exemption(%L, null, 30, 'wave one, set up in progress')::text$q$, t1));
    update public.tutor_profiles set is_verified = true, onboarding_status = 'verified' where id = t2;   -- verified with no documents: the nightly check will flag it
    perform public.tutor_drift_scan();
    a := (pg_temp.run_as(v_off, 'select public.admin_exceptions_report()::text'))::jsonb;
    r := r || pg_temp.chk('B1', 'a direct level is counted', ((a -> 'counts' ->> 'direct_level')::int - (b -> 'counts' ->> 'direct_level')::int)::text, '1');
    r := r || pg_temp.chk('B2', 'hours taught elsewhere are counted', ((a -> 'counts' ->> 'prior_hours')::int - (b -> 'counts' ->> 'prior_hours')::int)::text, '1');
    r := r || pg_temp.chk('B3', 'a Module 7 exemption is counted', ((a -> 'counts' ->> 'module7')::int - (b -> 'counts' ->> 'module7')::int)::text, '1');
    r := r || pg_temp.chk('B4', 'an approved tutor who is no longer ready is counted', ((a -> 'counts' ->> 'not_ready')::int - (b -> 'counts' ->> 'not_ready')::int)::text, '1');
    r := r || pg_temp.chk('B5', 'each of the four appears as a row, with the name and the typed reason', (select string_agg(x ->> 'kind', ',' order by x ->> 'kind') from jsonb_array_elements(a -> 'rows') x where x ->> 'tutor_id' in (t1::text, t2::text)), 'direct_level,module7,not_ready,prior_hours');
    r := r || pg_temp.chk('B6', 'the direct-level row carries the reason that was typed and the level', (select (x ->> 'reason') || '|' || (x ->> 'detail') from jsonb_array_elements(a -> 'rows') x where x ->> 'tutor_id' = t1::text and x ->> 'kind' = 'direct_level'), 'a reason that is long enough|level 2C');
    r := r || pg_temp.chk('B7', 'the Module 7 row has an end date', (select (x ->> 'ends_at' is not null)::text from jsonb_array_elements(a -> 'rows') x where x ->> 'tutor_id' = t1::text and x ->> 'kind' = 'module7'), 'true');
    r := r || pg_temp.chk('B8', 'the not-ready row names the reason codes', (select x ->> 'detail' from jsonb_array_elements(a -> 'rows') x where x ->> 'tutor_id' = t2::text and x ->> 'kind' = 'not_ready'), 'not_ready: no_track, identity_missing, police_missing');
    txt := a::text;
    r := r || pg_temp.chk('B9', 'no email address anywhere in the answer', (position('@' in txt) = 0)::text, 'true');
    r := r || pg_temp.chk('B10', 'at most 100 rows', (jsonb_array_length(a -> 'rows') <= 100)::text, 'true');

    -- who may read
    r := r || pg_temp.chk('C1', 'a support agent is refused', pg_temp.run_as(v_sup, 'select public.admin_exceptions_report()::text'), 'ERR: Only a verification officer or a super admin can see this');
    r := r || pg_temp.chk('C2', 'a tutor is refused', pg_temp.run_as(t1, 'select public.admin_exceptions_report()::text'), 'ERR: Admins only');
    r := r || pg_temp.chk('C3', 'a signed-out caller is refused', pg_temp.run_as(null, 'select public.admin_exceptions_report()::text'), 'ERR: permission denied for function admin_exceptions_report');
    r := r || pg_temp.chk('C4', 'rights anon/signed-in/server key, and it only reads (STABLE)', (select has_function_privilege('anon', p.oid, 'execute')::int::text || has_function_privilege('authenticated', p.oid, 'execute')::int::text || has_function_privilege('service_role', p.oid, 'execute')::int::text || '/' || p.provolatile::text from pg_proc p where p.proname = 'admin_exceptions_report' and p.pronamespace = 'public'::regnamespace), '010/s');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
