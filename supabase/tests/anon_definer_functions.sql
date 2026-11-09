-- Rolled-back test of the PROPOSED migration 20261104210200_close_anon_on_signed_in_only_functions.sql (4 Nov 2026).
-- Run the migration together with this file in one rolled-back statement (migration first):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/anon_definer_functions.sql supabase/migrations/20261104210200_close_anon_on_signed_in_only_functions.sql
-- or, once the migration is applied, paste this file alone. One made-up learner (example.invalid). Every line ends "ok" or "FAIL (want ...)";
-- the block raises an error at the end on purpose so nothing is kept.
-- Line R6 is the safety net: it lists every SECURITY DEFINER function in schema public that a signed-out caller can still run, apart from the
-- four kept on purpose. If it names anything, that function reached the anon role through the default execute right and needs a decision.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_l uuid := gen_random_uuid();
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
  -- "worked": the call was allowed (any answer that is not an error)
  execute $mk$ create function pg_temp.worked(p_u uuid, p_sql text) returns text language sql as $f$
      select (pg_temp.run_as(p_u, p_sql) not like 'ERR:%')::text $f$ $mk$;
  -- "closed": refused for lack of the execute right, and for no other reason
  execute $mk$ create function pg_temp.closed(p_u uuid, p_sql text) returns text language sql as $f$
      select (pg_temp.run_as(p_u, p_sql) like 'ERR: permission denied for function%')::text $f$ $mk$;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l, z, 'authenticated', 'authenticated', 'af.l.' || v_l || '@example.invalid', jsonb_build_object('first_name', 'Lee', 'surname', 'Learner', 'date_of_birth', adult), '{}');
  r := r || 'S0 setup: one learner' || E'\n';

  -- ---- who may execute the seven (the advisor's list) ----------------------------------------------------------------------------------------
  select string_agg(x.n || '=' || has_function_privilege('anon', x.o, 'EXECUTE')::text, ' ' order by x.n) into t from (values
    ('available_price_levels', 'public.available_price_levels(text, text, uuid, timestamptz, numeric, uuid)'::regprocedure),
    ('current_policy_versions', 'public.current_policy_versions()'::regprocedure),
    ('free_sessions_open', 'public.free_sessions_open()'::regprocedure),
    ('log_client_error', 'public.log_client_error(text, text, text, text, text)'::regprocedure),
    ('public_tutor_reviews', 'public.public_tutor_reviews(uuid)'::regprocedure),
    ('school_curricula', 'public.school_curricula(uuid)'::regprocedure),
    ('wallet_open', 'public.wallet_open()'::regprocedure)) x(n, o);
  r := r || pg_temp.chk('R1', 'a signed-out caller may run (true) or not (false)', t,
    'available_price_levels=false current_policy_versions=true free_sessions_open=true log_client_error=true public_tutor_reviews=true school_curricula=false wallet_open=false');
  select string_agg(x.n || '=' || has_function_privilege('authenticated', x.o, 'EXECUTE')::text, ' ' order by x.n) into t from (values
    ('available_price_levels', 'public.available_price_levels(text, text, uuid, timestamptz, numeric, uuid)'::regprocedure),
    ('current_policy_versions', 'public.current_policy_versions()'::regprocedure),
    ('free_sessions_open', 'public.free_sessions_open()'::regprocedure),
    ('log_client_error', 'public.log_client_error(text, text, text, text, text)'::regprocedure),
    ('public_tutor_reviews', 'public.public_tutor_reviews(uuid)'::regprocedure),
    ('school_curricula', 'public.school_curricula(uuid)'::regprocedure),
    ('wallet_open', 'public.wallet_open()'::regprocedure)) x(n, o);
  r := r || pg_temp.chk('R2', 'a signed-in caller may run all seven', t,
    'available_price_levels=true current_policy_versions=true free_sessions_open=true log_client_error=true public_tutor_reviews=true school_curricula=true wallet_open=true');

  -- ---- real calls ------------------------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('R3', 'signed out, the four kept functions still answer (policy versions, free mode, reviews of an unknown tutor, an error report)',
    pg_temp.worked(null, 'select count(*)::text from public.current_policy_versions()') || ' ' ||
    pg_temp.worked(null, 'select public.free_sessions_open()::text') || ' ' ||
    pg_temp.worked(null, format('select count(*)::text from public.public_tutor_reviews(%L)', gen_random_uuid())) || ' ' ||
    pg_temp.worked(null, $q$select public.log_client_error('logged', 'anon function test', '/zz-test')::text$q$),
    'true true true true');
  r := r || pg_temp.chk('R4', 'signed out, the three closed functions are refused for lack of the execute right (not for another reason)',
    pg_temp.closed(null, $q$select count(*)::text from public.available_price_levels('Zorology', 'Grade 10', null::uuid)$q$) || ' ' ||
    pg_temp.closed(null, 'select count(*)::text from public.school_curricula(null::uuid)') || ' ' ||
    pg_temp.closed(null, 'select public.wallet_open()::text'),
    'true true true');
  r := r || pg_temp.chk('R5', 'a signed-in learner can still run the three (the booking screens)',
    pg_temp.worked(v_l, $q$select count(*)::text from public.available_price_levels('Zorology', 'Grade 10', null::uuid)$q$) || ' ' ||
    pg_temp.worked(v_l, 'select count(*)::text from public.school_curricula(null::uuid)') || ' ' ||
    pg_temp.worked(v_l, 'select public.wallet_open()::text'),
    'true true true');

  -- ---- the safety net ------------------------------------------------------------------------------------------------------------------------------
  select coalesce(string_agg(distinct p.proname, ',' order by p.proname), '(none)') into t from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
      and p.proname not in ('current_policy_versions', 'log_client_error', 'public_tutor_reviews', 'free_sessions_open');
  r := r || pg_temp.chk('R6', 'every other SECURITY DEFINER function in schema public that a signed-out caller can still run', t, '(none)');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'ANON DEFINER FUNCTIONS TEST (rolled back): % lines, % FAIL\n%', nlines, nfail, r;
end $$;
