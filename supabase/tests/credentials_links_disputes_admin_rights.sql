-- Rolled-back test of 20261116200200_credentials_links_disputes_admin_rights.sql (P2 security round 2, 16 Nov 2026): tutor_credentials, parent_student_links, platform_disputes
-- Run the migration together with this file in one rolled-back statement (migration first):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/credentials_links_disputes_admin_rights.sql supabase/migrations/20261116200200_credentials_links_disputes_admin_rights.sql
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
  cred text; c uuid; k uuid; s uuid; d uuid; v_p uuid := gen_random_uuid();
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


  select code into cred from public.credential_definitions where entry_sub_tier_id is not null and code <> 'admin_assigned' order by code limit 1;
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_p, z, 'authenticated', 'authenticated', 'r2.p.' || v_p || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pam', 'surname', 'Parent', 'date_of_birth', adult), '{}');
  insert into public.tutor_credentials (tutor_id, credential_code, status) values (v_t, cred, 'verified') returning id into c;
  insert into public.parent_student_links (parent_id, student_id, relationship, can_book_sessions) values (v_p, v_o, 'guardian', false) returning id into k;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
    values (v_l, v_t, v_l, now() + interval '1 day', 100, 20, 100, 80) returning id into s;
  insert into platform_disputes (session_id, raised_by_id, reason, description) values (s, v_l, 'other', 'fixture dispute for the round 2 test') returning id into d;
  r := r || 'S1 setup: one credential held by the tutor, one guardian link (parent -> the stranger as learner), one session and one open dispute' || E'\n';
  -- tutor_credentials: read, update (rows), delete (rows), insert refused
  execute $mk$
    create function pg_temp.cred_attack(p_u uuid, p_c uuid, p_t uuid, p_code text) returns text language plpgsql as $f$
    begin
      return array_to_string(array[
        pg_temp.run_as(p_u, format('select count(*)::text from public.tutor_credentials where id = %L', p_c)),
        pg_temp.run_as(p_u, format('with u as (update public.tutor_credentials set note = ''hacked'' where id = %L returning 1) select count(*)::text from u', p_c)),
        pg_temp.run_as(p_u, format('with d as (delete from public.tutor_credentials where id = %L returning 1) select count(*)::text from d', p_c)),
        pg_temp.refused(p_u, format('insert into public.tutor_credentials (tutor_id, credential_code, status) values (%L, %L, ''verified'')', p_t, p_code))
      ], ' ');
    end $f$ $mk$;
  -- parent_student_links: read, update (rows), delete (rows), insert refused
  execute $mk$
    create function pg_temp.link_attack(p_u uuid, p_k uuid, p_a uuid, p_b uuid) returns text language plpgsql as $f$
    begin
      return array_to_string(array[
        pg_temp.run_as(p_u, format('select count(*)::text from public.parent_student_links where id = %L', p_k)),
        pg_temp.run_as(p_u, format('with u as (update public.parent_student_links set can_book_sessions = true where id = %L returning 1) select count(*)::text from u', p_k)),
        pg_temp.run_as(p_u, format('with d as (delete from public.parent_student_links where id = %L returning 1) select count(*)::text from d', p_k)),
        pg_temp.refused(p_u, format('insert into public.parent_student_links (parent_id, student_id) values (%L, %L)', p_a, p_b))
      ], ' ');
    end $f$ $mk$;
  -- platform_disputes: read, resolve (the Disputes page's own five columns, rows), rewrite the words (H = held), delete (rows), insert refused
  execute $mk$
    create function pg_temp.dispute_attack(p_u uuid, p_d uuid, p_s uuid, p_l uuid) returns text language plpgsql as $f$
    begin
      return array_to_string(array[
        pg_temp.run_as(p_u, format('select count(*)::text from public.platform_disputes where id = %L', p_d)),
        pg_temp.run_as(p_u, format($q$with u as (update public.platform_disputes set status = 'under_investigation', resolution_notes = 'looking', refund_amount = null, resolved_at = null, assigned_admin_id = %L where id = %L returning 1) select count(*)::text from u$q$, p_u, p_d)),
        pg_temp.rw(p_u, format($q$with u as (update public.platform_disputes set description = 'rewritten' where id = %L returning 1) select count(*)::text from u$q$, p_d)),
        pg_temp.run_as(p_u, format('with d as (delete from public.platform_disputes where id = %L returning 1) select count(*)::text from d', p_d)),
        pg_temp.refused(p_u, format($q$insert into public.platform_disputes (session_id, raised_by_id, reason, description) values (%L, %L, 'other', 'admin made this')$q$, p_s, p_l))
      ], ' ');
    end $f$ $mk$;

  r := r || pg_temp.chk('C1', 'tutor_credentials, SUPPORT AGENT: reads 0, changes 0, deletes 0, insert refused', pg_temp.cred_attack(v_su, c, v_t, cred), '0 0 0 true');
  r := r || pg_temp.chk('C2', 'tutor_credentials, FINANCE MANAGER: the same', pg_temp.cred_attack(v_fm, c, v_t, cred), '0 0 0 true');
  r := r || pg_temp.chk('C3', 'tutor_credentials, VERIFICATION OFFICER: reads 1, writes nothing (levels change through the functions)', pg_temp.cred_attack(v_vo, c, v_t, cred), '1 0 0 true');
  r := r || pg_temp.chk('C4', 'tutor_credentials, SUPER ADMIN: reads 1, writes nothing', pg_temp.cred_attack(v_sa, c, v_t, cred), '1 0 0 true');
  r := r || pg_temp.chk('C5', 'tutor_credentials, SWITCHED-OFF super admin: nothing', pg_temp.cred_attack(v_of, c, v_t, cred), '0 0 0 true');
  r := r || pg_temp.chk('C6', 'the tutor still reads their own credential (1); a stranger reads none (0)',
    pg_temp.run_as(v_t, format('select count(*)::text from public.tutor_credentials where id = %L', c)) || ' ' || pg_temp.run_as(v_o, format('select count(*)::text from public.tutor_credentials where id = %L', c)), '1 0');
  select note is null into t from public.tutor_credentials where id = c;
  r := r || pg_temp.chk('C7', 'the credential row was not changed by any attempt (note still empty)', t, 'true');

  r := r || pg_temp.chk('L1', 'parent_student_links, SUPPORT AGENT: reads 1, changes 0, deletes 0, insert refused', pg_temp.link_attack(v_su, k, v_o, v_t), '1 0 0 true');
  r := r || pg_temp.chk('L2', 'parent_student_links, FINANCE MANAGER: the same', pg_temp.link_attack(v_fm, k, v_o, v_t), '1 0 0 true');
  r := r || pg_temp.chk('L3', 'parent_student_links, VERIFICATION OFFICER: the same', pg_temp.link_attack(v_vo, k, v_o, v_t), '1 0 0 true');
  r := r || pg_temp.chk('L4', 'parent_student_links, SUPER ADMIN: the same', pg_temp.link_attack(v_sa, k, v_o, v_t), '1 0 0 true');
  r := r || pg_temp.chk('L5', 'parent_student_links, SWITCHED-OFF super admin: nothing', pg_temp.link_attack(v_of, k, v_o, v_t), '0 0 0 true');
  r := r || pg_temp.chk('L6', 'the guardian and the learner each read the link (1 1); an unrelated tutor reads none (0)',
    pg_temp.run_as(v_p, format('select count(*)::text from public.parent_student_links where id = %L', k)) || ' ' ||
    pg_temp.run_as(v_o, format('select count(*)::text from public.parent_student_links where id = %L', k)) || ' ' ||
    pg_temp.run_as(v_t, format('select count(*)::text from public.parent_student_links where id = %L', k)), '1 1 0');
  select can_book_sessions::text into t from public.parent_student_links where id = k;
  r := r || pg_temp.chk('L7', 'the link was not changed by any attempt (can_book_sessions still false)', t, 'false');

  r := r || pg_temp.chk('D1', 'platform_disputes, SUPPORT AGENT: reads 1, resolves 1, rewriting the words HELD, deletes 0, insert refused', pg_temp.dispute_attack(v_su, d, s, v_l), '1 1 H 0 true');
  r := r || pg_temp.chk('D2', 'platform_disputes, SUPER ADMIN: the same', pg_temp.dispute_attack(v_sa, d, s, v_l), '1 1 H 0 true');
  r := r || pg_temp.chk('D3', 'platform_disputes, FINANCE MANAGER: reads 1, cannot resolve (0), rewrite 0 rows, deletes 0, insert refused', pg_temp.dispute_attack(v_fm, d, s, v_l), '1 0 0 0 true');
  r := r || pg_temp.chk('D4', 'platform_disputes, VERIFICATION OFFICER: reads 1, cannot resolve (0), rewrite 0 rows, deletes 0, insert refused', pg_temp.dispute_attack(v_vo, d, s, v_l), '1 0 0 0 true');
  r := r || pg_temp.chk('D5', 'platform_disputes, SWITCHED-OFF super admin: nothing', pg_temp.dispute_attack(v_of, d, s, v_l), '0 0 0 0 true');
  r := r || pg_temp.chk('D6', 'the person who raised it reads it (1) and cannot change it (0 rows or refused); a stranger reads none (0)',
    pg_temp.run_as(v_l, format('select count(*)::text from public.platform_disputes where id = %L', d)) || ' ' ||
    pg_temp.nowrite(v_l, format($q$with u as (update public.platform_disputes set status = 'dismissed' where id = %L returning 1) select count(*)::text from u$q$, d)) || ' ' ||
    pg_temp.run_as(v_o, format('select count(*)::text from public.platform_disputes where id = %L', d)), '1 true 0');
  select description || ' / ' || status::text || ' / ' || coalesce(resolution_notes, '-') into t from public.platform_disputes where id = d;
  r := r || pg_temp.chk('D7', 'the words are untouched and only the permitted columns moved (the support agent''s and the super admin''s resolve calls both ran, so under_investigation / looking)',
    t, 'fixture dispute for the round 2 test / under_investigation / looking');
  t := pg_temp.run_as(v_su, format($q$with u as (update public.platform_disputes set status = 'dismissed', resolution_notes = 'test', refund_amount = null, resolved_at = now(), assigned_admin_id = %L where id = %L returning 1) select count(*)::text from u$q$, v_su, d));
  select t || ' / ' || status::text into t from public.platform_disputes where id = d;
  r := r || pg_temp.chk('D8', 'the Disputes page''s own update (status, notes, refund amount, resolved at, admin) still works for a support agent', t, '1 / dismissed');
  update public.platform_disputes set description = 'owner rewrote it' where id = d;
  select description into t from public.platform_disputes where id = d;
  r := r || pg_temp.chk('D9', 'the owner (the retention and closure functions run as the owner) is not held by the column guard', t, 'owner rewrote it');
  r := r || pg_temp.chk('D10', 'the server''s key (service_role) can still update a dispute''s description',
    pg_temp.as_service(format($q$with u as (update public.platform_disputes set description = 'server wrote it' where id = %L returning 1) select count(*)::text from u$q$, d)), '1');

  select coalesce(string_agg(tablename || ':' || policyname || ':' || cmd, ' | ' order by tablename, policyname), '(none)') into t from pg_policies
    where schemaname = 'public' and tablename in ('tutor_credentials', 'parent_student_links', 'platform_disputes');
  r := r || pg_temp.chk('P1', 'every policy on the three tables', t,
    'parent_student_links:Admins read student links:SELECT | parent_student_links:Parents view own links:SELECT | parent_student_links:Students can view parent links:SELECT | ' ||
    'platform_disputes:Admins read disputes:SELECT | platform_disputes:Support and super admins resolve disputes:UPDATE | platform_disputes:Users can view own disputes:SELECT | ' ||
    'tutor_credentials:Admins read tutor credentials:SELECT | tutor_credentials:Tutors view own credentials:SELECT');
  select coalesce(string_agg(p2.proname, ',' order by p2.proname), '(none)') into t from pg_proc p2
    where p2.pronamespace = 'public'::regnamespace and p2.prokind = 'f' and not p2.prosecdef and p2.prorettype <> 'trigger'::regtype
      and p2.prosrc ~* '(update|insert\s+into|delete\s+from)\s+(public\.)?(tutor_credentials|parent_student_links|platform_disputes)\y';
  r := r || pg_temp.chk('X1', 'functions that write these tables and are NOT security definer', t, '(none)');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'CREDENTIALS LINKS DISPUTES TEST (rolled back): % lines, % FAIL\n%', nlines, nfail, r;
end $$;
