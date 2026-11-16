-- Rolled-back test of 20261116200400_tutor_profiles_subject_candidates_admin_update.sql (P2 security round 2, 16 Nov 2026): who may update tutor_profiles (and which columns) and subject_candidates
-- Run the migration together with this file in one rolled-back statement (migration first):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/tutor_profiles_subject_candidates_admin_update.sql supabase/migrations/20261116200400_tutor_profiles_subject_candidates_admin_update.sql
-- or, once the migration is applied, paste this file alone. Fixtures are made-up people (example.invalid) inserted as the owner; every line ends "ok" or
-- "FAIL (want ...)"; the block raises an error at the end on purpose so nothing is kept. Words used in the answers: S = refused "only a super admin",
-- V = refused "only a verification officer or a super admin", A = refused "Admins only", D = permission denied, H = held by a column guard, ran = it ran.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_sa uuid := gen_random_uuid();    -- super_admin
  v_fm uuid := gen_random_uuid();    -- finance_manager
  v_su uuid := gen_random_uuid();    -- support_agent
  v_vo uuid := gen_random_uuid();    -- verification_officer
  v_of uuid := gen_random_uuid();    -- a super_admin whose access is switched off
  v_l  uuid := gen_random_uuid();    -- an adult learner
  v_t  uuid := gen_random_uuid();    -- a tutor
  v_o  uuid := gen_random_uuid();    -- a stranger
  sc uuid;
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
  -- "refused": the statement raised a real error (true) or ran (false). A plain INSERT run through EXECUTE ... INTO always ends in the error
  -- "INTO used with a command that cannot return data", so a test that wants an INSERT to SUCCEED must write it as a data-modifying CTE with RETURNING.
  execute $mk$
    create function pg_temp.refused(p_u uuid, p_sql text) returns text language sql as $f$
      select (a.res like 'ERR:%' and a.res not like 'ERR: INTO used%')::text from (select pg_temp.run_as(p_u, p_sql) as res) a $f$ $mk$;
  -- "changed nothing": 0 rows or refused
  execute $mk$
    create function pg_temp.nowrite(p_u uuid, p_sql text) returns text language sql as $f$
      select (a.res = '0' or a.res like 'ERR:%')::text from (select pg_temp.run_as(p_u, p_sql) as res) a $f$ $mk$;
  -- one word per answer: S = "only a super admin", V = "only a verification officer or a super admin", A = "Admins only", D = permission denied,
  -- H = held by a column guard, ran = it ran, E[...] = anything else
  execute $mk$
    create function pg_temp.classify(v text) returns text language sql as $f$
      select case when v like 'ERR: Only a super admin%' then 'S'
                  when v like 'ERR: Only a verification officer%' then 'V'
                  when v like 'ERR: Admins only%' then 'A'
                  when v like 'ERR: permission denied%' then 'D'
                  when v like 'ERR: Level, hours, rating%' or v like 'ERR: A dispute%' or v like 'ERR: Only Tutorlage can change%' then 'H'
                  when v like 'ERR:%' then 'E[' || left(substr(v, 6), 60) || ']'
                  else 'ran' end $f$ $mk$;
  execute $mk$
    create function pg_temp.verdict(p_u uuid, p_sql text) returns text language sql as $f$
      select pg_temp.classify(pg_temp.run_as(p_u, p_sql)) $f$ $mk$;
  -- rows changed, or the one word when it was refused
  execute $mk$
    create function pg_temp.rw(p_u uuid, p_sql text) returns text language sql as $f$
      select case when a.res like 'ERR:%' then pg_temp.classify(a.res) else a.res end from (select pg_temp.run_as(p_u, p_sql) as res) a $f$ $mk$;

  -- ---- people (all made up, example.invalid; inserted as the owner) -------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_sa, z, 'authenticated', 'authenticated', 'r2.sa.' || v_sa || '@example.invalid', jsonb_build_object('first_name', 'Sue', 'surname', 'Super', 'date_of_birth', adult), '{}'),
    (v_fm, z, 'authenticated', 'authenticated', 'r2.fm.' || v_fm || '@example.invalid', jsonb_build_object('first_name', 'Fin', 'surname', 'Manager', 'date_of_birth', adult), '{}'),
    (v_su, z, 'authenticated', 'authenticated', 'r2.su.' || v_su || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
    (v_vo, z, 'authenticated', 'authenticated', 'r2.vo.' || v_vo || '@example.invalid', jsonb_build_object('first_name', 'Vera', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
    (v_of, z, 'authenticated', 'authenticated', 'r2.of.' || v_of || '@example.invalid', jsonb_build_object('first_name', 'Olly', 'surname', 'Off', 'date_of_birth', adult), '{}'),
    (v_l,  z, 'authenticated', 'authenticated', 'r2.l.'  || v_l  || '@example.invalid', jsonb_build_object('first_name', 'Lee', 'surname', 'Learner', 'date_of_birth', adult), '{}'),
    (v_t,  z, 'authenticated', 'authenticated', 'r2.t.'  || v_t  || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'surname', 'Tutor', 'date_of_birth', adult), '{}'),
    (v_o,  z, 'authenticated', 'authenticated', 'r2.o.'  || v_o  || '@example.invalid', jsonb_build_object('first_name', 'Otto', 'surname', 'Other', 'date_of_birth', adult), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (v_sa, 'Sue', 'Super', 'r2.sa.' || v_sa || '@example.invalid', '', 'super_admin', true),
    (v_fm, 'Fin', 'Manager', 'r2.fm.' || v_fm || '@example.invalid', '', 'finance_manager', true),
    (v_su, 'Sam', 'Support', 'r2.su.' || v_su || '@example.invalid', '', 'support_agent', true),
    (v_vo, 'Vera', 'Officer', 'r2.vo.' || v_vo || '@example.invalid', '', 'verification_officer', true),
    (v_of, 'Olly', 'Off', 'r2.of.' || v_of || '@example.invalid', '', 'super_admin', false);
  r := r || 'S0 setup: super admin, finance manager, support agent, verification officer, a switched-off super admin, a learner, a tutor, a stranger' || E'\n';


  insert into public.subject_candidates (subject_name, curriculum, requested_by) values ('Zorology', 'CAPS', v_t) returning id into sc;
  r := r || 'S1 setup: one subject suggestion from the tutor' || E'\n';
  execute $mk$
    create function pg_temp.profile_attack(p_u uuid, p_t uuid) returns text language plpgsql as $f$
    begin
      return array_to_string(array[
        -- the five columns the admin app writes: reject, suspend (rows)
        pg_temp.run_as(p_u, format($q$with u as (update public.tutor_profiles set onboarding_status = 'rejected', is_verified = false where id = %L returning 1) select count(*)::text from u$q$, p_t)),
        pg_temp.run_as(p_u, format($q$with u as (update public.tutor_profiles set is_dispatch_active = false, tier_frozen = true, freeze_reason = 'test' where id = %L returning 1) select count(*)::text from u$q$, p_t)),
        -- the figures the platform works out: hours, rating, level, fast track (H = held)
        pg_temp.rw(p_u, format($q$with u as (update public.tutor_profiles set total_completed_hours = 999 where id = %L returning 1) select count(*)::text from u$q$, p_t)),
        pg_temp.rw(p_u, format($q$with u as (update public.tutor_profiles set avg_rating = 5 where id = %L returning 1) select count(*)::text from u$q$, p_t)),
        pg_temp.rw(p_u, format($q$with u as (update public.tutor_profiles set current_sub_tier_id = '4D' where id = %L returning 1) select count(*)::text from u$q$, p_t)),
        pg_temp.rw(p_u, format($q$with u as (update public.tutor_profiles set fast_track_status = 'approved' where id = %L returning 1) select count(*)::text from u$q$, p_t))
      ], ' ');
    end $f$ $mk$;
  -- the Level card path first, while the tutor is not frozen: a SECURITY DEFINER function changes the level and the figures as the owner
  r := r || pg_temp.chk('F1', 'a super admin''s Assign a level (security definer, recalculates the tutor''s level) is not held by the new column guard',
    pg_temp.verdict(v_sa, format($q$select public.admin_assign_tier(%L, '2C', 'test reason here')::text$q$, v_t)), 'ran');
  select count(*)::text into t from public.tutor_credentials where tutor_id = v_t and assigned_sub_tier_id = '2C';
  r := r || pg_temp.chk('F2', 'and the assigned level is recorded', t, '1');
  r := r || pg_temp.chk('F3', 'the server''s key (service_role) can still change a tutor''s hours',
    pg_temp.as_service(format('with u as (update public.tutor_profiles set total_completed_hours = 5 where id = %L returning 1) select count(*)::text from u', v_t)), '1');

  -- reject, suspend, hours, rating, level, fast track
  r := r || pg_temp.chk('A1', 'SUPPORT AGENT: reject 0 rows, suspend 0 rows, the four figure changes 0 rows', pg_temp.profile_attack(v_su, v_t), '0 0 0 0 0 0');
  r := r || pg_temp.chk('A2', 'FINANCE MANAGER: the same', pg_temp.profile_attack(v_fm, v_t), '0 0 0 0 0 0');
  r := r || pg_temp.chk('A3', 'SWITCHED-OFF super admin: the same', pg_temp.profile_attack(v_of, v_t), '0 0 0 0 0 0');
  r := r || pg_temp.chk('A4', 'a LEARNER: the same', pg_temp.profile_attack(v_l, v_t), '0 0 0 0 0 0');
  select onboarding_status::text || ' ' || tier_frozen::text into t from public.tutor_profiles where id = v_t;
  r := r || pg_temp.chk('A5', 'the tutor is unchanged after those attempts (still pending_academic, not frozen)', t, 'pending_academic false');
  r := r || pg_temp.chk('A6', 'VERIFICATION OFFICER: reject 1, suspend 1, the four figure changes HELD (H)', pg_temp.profile_attack(v_vo, v_t), '1 1 H H H H');
  r := r || pg_temp.chk('A7', 'SUPER ADMIN: the same', pg_temp.profile_attack(v_sa, v_t), '1 1 H H H H');
  select onboarding_status::text || ' ' || tier_frozen::text || ' ' || total_completed_hours::text into t from public.tutor_profiles where id = v_t;
  r := r || pg_temp.chk('A8', 'the five admin-app columns moved (rejected, frozen) and the hours are still the server''s 5 (the figure changes did not happen)', regexp_replace(t, '5(\.0+)?$', '5'), 'rejected true 5');

  r := r || pg_temp.chk('B1', 'the tutor still edits their own headline (1 row)',
    pg_temp.run_as(v_t, format($q$with u as (update public.tutor_profiles set headline = 'hello' where id = %L returning 1) select count(*)::text from u$q$, v_t)), '1');
  r := r || pg_temp.chk('B2', 'the tutor still cannot verify themselves or change their rating (refused each)',
    pg_temp.nowrite(v_t, format($q$with u as (update public.tutor_profiles set is_verified = true where id = %L returning 1) select count(*)::text from u$q$, v_t)) || ' ' ||
    pg_temp.nowrite(v_t, format($q$with u as (update public.tutor_profiles set avg_rating = 5 where id = %L returning 1) select count(*)::text from u$q$, v_t)), 'true true');
  r := r || pg_temp.chk('B3', 'a stranger cannot change the tutor''s headline (0 rows or refused)',
    pg_temp.nowrite(v_o, format($q$with u as (update public.tutor_profiles set headline = 'hacked' where id = %L returning 1) select count(*)::text from u$q$, v_t)), 'true');

  -- subject_candidates: read, update (rows) ... for each admin role; the tutor reads and adds their own
  r := r || pg_temp.chk('C1', 'subject_candidates: every ACTIVE admin still reads it (1 1 1 1), a switched-off one does not (0)',
    pg_temp.run_as(v_su, format('select count(*)::text from public.subject_candidates where id = %L', sc)) || ' ' ||
    pg_temp.run_as(v_fm, format('select count(*)::text from public.subject_candidates where id = %L', sc)) || ' ' ||
    pg_temp.run_as(v_vo, format('select count(*)::text from public.subject_candidates where id = %L', sc)) || ' ' ||
    pg_temp.run_as(v_sa, format('select count(*)::text from public.subject_candidates where id = %L', sc)) || ' ' ||
    pg_temp.run_as(v_of, format('select count(*)::text from public.subject_candidates where id = %L', sc)), '1 1 1 1 0');
  r := r || pg_temp.chk('C2', 'subject_candidates: no admin can update it directly (support, verification officer, super admin, switched-off: 0 each), nor the tutor',
    pg_temp.run_as(v_su, format($q$with u as (update public.subject_candidates set status = 'approved' where id = %L returning 1) select count(*)::text from u$q$, sc)) || ' ' ||
    pg_temp.run_as(v_vo, format($q$with u as (update public.subject_candidates set status = 'approved' where id = %L returning 1) select count(*)::text from u$q$, sc)) || ' ' ||
    pg_temp.run_as(v_sa, format($q$with u as (update public.subject_candidates set status = 'approved' where id = %L returning 1) select count(*)::text from u$q$, sc)) || ' ' ||
    pg_temp.run_as(v_of, format($q$with u as (update public.subject_candidates set status = 'approved' where id = %L returning 1) select count(*)::text from u$q$, sc)) || ' ' ||
    pg_temp.run_as(v_t, format($q$with u as (update public.subject_candidates set status = 'approved' where id = %L returning 1) select count(*)::text from u$q$, sc)), '0 0 0 0 0');
  r := r || pg_temp.chk('C3', 'the tutor reads their own suggestion (1), a stranger reads none (0), the tutor can still add one (insert allowed = false)',
    pg_temp.run_as(v_t, format('select count(*)::text from public.subject_candidates where id = %L', sc)) || ' ' ||
    pg_temp.run_as(v_o, format('select count(*)::text from public.subject_candidates where id = %L', sc)) || ' ' ||
    pg_temp.refused(v_t, format($q$with i as (insert into public.subject_candidates (subject_name, curriculum, requested_by) values ('Yetiology', 'CAPS', %L) returning 1) select count(*)::text from i$q$, v_t)), '1 0 false');
  select count(*)::text into t from public.subject_candidates where id = sc and status <> 'pending';
  r := r || pg_temp.chk('C4', 'the suggestion is still pending after every attempt', t, '0');

  select coalesce(string_agg(tablename || ':' || policyname || ':' || cmd, ' | ' order by tablename, policyname), '(none)') into t from pg_policies
    where schemaname = 'public' and tablename in ('tutor_profiles', 'subject_candidates') and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  r := r || pg_temp.chk('P1', 'every policy that can write either table', t,
    'subject_candidates:Tutors insert own subject candidates:INSERT | tutor_profiles:Tutors can update own profile:UPDATE | tutor_profiles:Tutors insert own profile:INSERT | ' ||
    'tutor_profiles:Tutors update own profile:UPDATE | tutor_profiles:Verification staff update tutor profiles:UPDATE');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'TUTOR PROFILES UPDATE TEST (rolled back): % lines, % FAIL\n%', nlines, nfail, r;
end $$;
