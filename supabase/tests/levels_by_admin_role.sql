-- Rolled-back test of 20261116200000_levels_functions_by_admin_role.sql (P2 security round 2, 16 Nov 2026): who may run the nine Levels functions and write credential_definitions
-- Run the migration together with this file in one rolled-back statement (migration first):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/levels_by_admin_role.sql supabase/migrations/20261116200000_levels_functions_by_admin_role.sql
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
  cred text;
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


  execute $mk$
    create function pg_temp.five(p_u uuid) returns text language plpgsql as $f$
    declare a text; b text; c text; d text; e text;
    begin
      a := pg_temp.verdict(p_u, $q$select public.admin_save_tier(97, 'Zed tier', 'a quote', 10, 20, 15)::text$q$);
      b := pg_temp.verdict(p_u, $q$select public.admin_save_sub_tier('9Z', 97, 55, 0, 0, 0, 0, 0, 0, 20)::text$q$);
      c := pg_temp.verdict(p_u, $q$select public.admin_save_credential_definition('zz_cred', 'Zed credential', '9Z', null, 'x')::text$q$);
      d := pg_temp.verdict(p_u, $q$select public.admin_delete_credential_definition('zz_cred')::text$q$);
      e := pg_temp.verdict(p_u, $q$select public.admin_recalculate_all_tiers()::text$q$);
      return a || ' ' || b || ' ' || c || ' ' || d || ' ' || e;
    end $f$ $mk$;
  select code into cred from public.credential_definitions where entry_sub_tier_id is not null and code <> 'admin_assigned' order by code limit 1;
  execute format($mk$
    create function pg_temp.four(p_u uuid, p_t uuid) returns text language plpgsql as $f$
    declare a text; b text; c text; d text; rid text;
    begin
      a := pg_temp.verdict(p_u, format('select public.admin_assign_tier(%%L, ''2C'', ''test reason here'')::text', p_t));
      rid := pg_temp.run_as(p_u, format('select public.admin_record_credential(%%L, %%L, current_date, null, ''n'')::text', p_t, %L));
      b := pg_temp.classify(rid);
      c := pg_temp.verdict(p_u, format('select public.admin_remove_credential(%%L, ''test reason here'')::text', case when rid ~ '^[0-9a-f-]{36}$' then rid else gen_random_uuid()::text end));
      d := pg_temp.verdict(p_u, format('select public.admin_clear_assigned_tier(%%L, ''test reason here'')::text', p_t));
      return a || ' ' || b || ' ' || c || ' ' || d;
    end $f$ $mk$, cred);
  r := r || pg_temp.chk('S1', 'a credential that starts a tutor at a level exists to use in the test', (cred is not null)::text, 'true');

  -- ---- who may run what (five = save tier, save level, save credential, delete credential, recalculate all; four = assign, record, remove, clear) --
  r := r || pg_temp.chk('A1', 'SUPPORT AGENT: the five refused (S), the four refused (V)', pg_temp.five(v_su) || ' / ' || pg_temp.four(v_su, v_t), 'S S S S S / V V V V');
  r := r || pg_temp.chk('A2', 'FINANCE MANAGER: the same', pg_temp.five(v_fm) || ' / ' || pg_temp.four(v_fm, v_t), 'S S S S S / V V V V');
  r := r || pg_temp.chk('A3', 'VERIFICATION OFFICER: the five refused, the four RUN (the Level card is on their page)', pg_temp.five(v_vo) || ' / ' || pg_temp.four(v_vo, v_t), 'S S S S S / ran ran ran ran');
  r := r || pg_temp.chk('A4', 'SUPER ADMIN: all nine run', pg_temp.five(v_sa) || ' / ' || pg_temp.four(v_sa, v_t), 'ran ran ran ran ran / ran ran ran ran');
  r := r || pg_temp.chk('A5', 'a SWITCHED-OFF super admin: all nine say Admins only (the old words)', pg_temp.five(v_of) || ' / ' || pg_temp.four(v_of, v_t), 'A A A A A / A A A A');
  r := r || pg_temp.chk('A6', 'a LEARNER: all nine say Admins only', pg_temp.five(v_l) || ' / ' || pg_temp.four(v_l, v_t), 'A A A A A / A A A A');
  r := r || pg_temp.chk('A7', 'a SIGNED-OUT caller: all nine refused (R: Admins only or permission denied)',
    regexp_replace(pg_temp.five(null) || ' / ' || pg_temp.four(null, v_t), '[AD]', 'R', 'g'), 'R R R R R / R R R R');

  -- ---- the table: no direct admin write at all -------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('T1', 'SUPPORT AGENT directly on credential_definitions: update 0 rows, insert refused, delete 0 rows',
    pg_temp.run_as(v_su, 'with u as (update public.credential_definitions set label = ''hacked'' returning 1) select count(*)::text from u') || ' ' ||
    pg_temp.refused(v_su, 'insert into public.credential_definitions (code, label, entry_sub_tier_id) values (''zz_direct'', ''x'', ''1A'')') || ' ' ||
    pg_temp.run_as(v_su, 'with d as (delete from public.credential_definitions returning 1) select count(*)::text from d'), '0 true 0');
  r := r || pg_temp.chk('T2', 'SUPER ADMIN directly on the table: the same (changes go through the audited functions)',
    pg_temp.run_as(v_sa, 'with u as (update public.credential_definitions set label = ''hacked'' returning 1) select count(*)::text from u') || ' ' ||
    pg_temp.refused(v_sa, 'insert into public.credential_definitions (code, label, entry_sub_tier_id) values (''zz_direct'', ''x'', ''1A'')') || ' ' ||
    pg_temp.run_as(v_sa, 'with d as (delete from public.credential_definitions returning 1) select count(*)::text from d'), '0 true 0');
  select count(*)::text into t from public.credential_definitions where label = 'hacked' or code = 'zz_direct';
  r := r || pg_temp.chk('T3', 'and nothing was changed or added by those attempts', t, '0');
  r := r || pg_temp.chk('T4', 'everyone can still READ the definitions: signed-out, a learner and a support agent each see rows',
    (pg_temp.run_as(null, 'select count(*)::text from public.credential_definitions')::int > 0)::text || ' ' ||
    (pg_temp.run_as(v_l, 'select count(*)::text from public.credential_definitions')::int > 0)::text || ' ' ||
    (pg_temp.run_as(v_su, 'select count(*)::text from public.credential_definitions')::int > 0)::text, 'true true true');
  r := r || pg_temp.chk('F1', 'the function path still writes the table (super admin saves a credential through admin_save_credential_definition)',
    pg_temp.verdict(v_sa, $q$select public.admin_save_credential_definition('zz_f1', 'F1 credential', '1A', null, 'x')::text$q$), 'ran');
  select count(*)::text into t from public.credential_definitions where code = 'zz_f1';
  r := r || pg_temp.chk('F2', 'and the row is there', t, '1');

  -- ---- what is installed -----------------------------------------------------------------------------------------------------------------------
  select coalesce(string_agg(policyname || ':' || cmd, ' | ' order by policyname), '(none)') into t from pg_policies
    where schemaname = 'public' and tablename = 'credential_definitions';
  r := r || pg_temp.chk('P1', 'every policy on credential_definitions: only the public read is left', t, 'Anyone can read credential definitions:SELECT');
  r := r || pg_temp.chk('P2', 'admin_role_in: signed-in may run it, signed-out may not',
    has_function_privilege('authenticated', 'public.admin_role_in(text[])', 'execute')::text || ' ' || has_function_privilege('anon', 'public.admin_role_in(text[])', 'execute')::text, 'true false');
  select count(*)::text into t from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('admin_save_tier', 'admin_save_sub_tier', 'admin_save_credential_definition', 'admin_delete_credential_definition', 'admin_recalculate_all_tiers',
                    'admin_assign_tier', 'admin_clear_assigned_tier', 'admin_record_credential', 'admin_remove_credential')
    and prosecdef and prosrc like '%admin_role_in%' and prosrc like '%Admins only%';
  r := r || pg_temp.chk('P3', 'all nine are still security definer, still say Admins only, and now carry the role check', t, '9');
  select coalesce(string_agg(p.proname, ',' order by p.proname), '(none)') into t from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and not p.prosecdef and p.prorettype <> 'trigger'::regtype
      and p.prosrc ~* '(update|insert\s+into|delete\s+from)\s+(public\.)?(credential_definitions|tutor_credentials|tier_definitions|sub_tier_definitions)\y';
  r := r || pg_temp.chk('X1', 'functions that write the definition tables and are NOT security definer (they would have relied on the admin''s row rights)', t, '(none)');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'LEVELS ADMIN ROLE TEST (rolled back): % lines, % FAIL\n%', nlines, nfail, r;
end $$;
