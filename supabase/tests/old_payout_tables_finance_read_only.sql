-- Rolled-back test of 20261116200100_old_payout_tables_finance_read_only.sql (P2 security round 2, 16 Nov 2026): payouts and payout_batches readable by finance only, writable by nobody through the API
-- Run the migration together with this file in one rolled-back statement (migration first):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/old_payout_tables_finance_read_only.sql supabase/migrations/20261116200100_old_payout_tables_finance_read_only.sql
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
  p uuid; b uuid;
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


  insert into public.payouts (tutor_id, period_start, period_end, total_amount) values (v_t, current_date, current_date, 100) returning id into p;
  insert into public.payout_batches (batch_reference) values ('zz_' || gen_random_uuid()) returning id into b;
  r := r || 'S1 setup: one payout row for the tutor and one batch row (both tables were empty)' || E'\n';
  execute $mk$
    create function pg_temp.attack(p_u uuid, p_p uuid, p_b uuid, p_tut uuid) returns text language plpgsql as $f$
    begin
      return array_to_string(array[
        pg_temp.run_as(p_u, format('select count(*)::text from public.payouts where id = %L', p_p)),
        pg_temp.run_as(p_u, format('select count(*)::text from public.payout_batches where id = %L', p_b)),
        pg_temp.run_as(p_u, format('with u as (update public.payouts set total_amount = 1 where id = %L returning 1) select count(*)::text from u', p_p)),
        pg_temp.run_as(p_u, format('with d as (delete from public.payouts where id = %L returning 1) select count(*)::text from d', p_p)),
        pg_temp.refused(p_u, format('insert into public.payouts (tutor_id, period_start, period_end, total_amount) values (%L, current_date, current_date, 1)', p_tut)),
        pg_temp.run_as(p_u, format('with u as (update public.payout_batches set total_amount_paid = 1 where id = %L returning 1) select count(*)::text from u', p_b)),
        pg_temp.run_as(p_u, format('with d as (delete from public.payout_batches where id = %L returning 1) select count(*)::text from d', p_b)),
        pg_temp.refused(p_u, 'insert into public.payout_batches (batch_reference) values (''zz_probe'')')
      ], ' ');
    end $f$ $mk$;
  -- the eight answers: read payout, read batch, update payout (rows), delete payout (rows), insert payout refused, update batch, delete batch, insert batch refused
  r := r || pg_temp.chk('A1', 'SUPPORT AGENT: reads nothing, writes nothing', pg_temp.attack(v_su, p, b, v_t), '0 0 0 0 true 0 0 true');
  r := r || pg_temp.chk('A2', 'VERIFICATION OFFICER: reads nothing, writes nothing', pg_temp.attack(v_vo, p, b, v_t), '0 0 0 0 true 0 0 true');
  r := r || pg_temp.chk('A3', 'FINANCE MANAGER: reads both, writes nothing', pg_temp.attack(v_fm, p, b, v_t), '1 1 0 0 true 0 0 true');
  r := r || pg_temp.chk('A4', 'SUPER ADMIN: reads both, writes nothing', pg_temp.attack(v_sa, p, b, v_t), '1 1 0 0 true 0 0 true');
  r := r || pg_temp.chk('A5', 'a SWITCHED-OFF super admin: reads nothing, writes nothing', pg_temp.attack(v_of, p, b, v_t), '0 0 0 0 true 0 0 true');
  r := r || pg_temp.chk('A6', 'a stranger: reads nothing, writes nothing', pg_temp.attack(v_o, p, b, v_t), '0 0 0 0 true 0 0 true');
  r := r || pg_temp.chk('A7', 'a SIGNED-OUT caller: reads nothing, writes nothing (a permission-denied answer counts as 0)', regexp_replace(pg_temp.attack(null, p, b, v_t), 'ERR: permission denied for table [a-z_]+', '0', 'g'), '0 0 0 0 true 0 0 true');
  r := r || pg_temp.chk('B1', 'the tutor still reads their OWN payout (1) and a stranger reads none (0)',
    pg_temp.run_as(v_t, format('select count(*)::text from public.payouts where id = %L', p)) || ' ' || pg_temp.run_as(v_o, format('select count(*)::text from public.payouts where id = %L', p)), '1 0');
  r := r || pg_temp.chk('B2', 'the tutor cannot change their own payout (0 rows or refused)',
    pg_temp.nowrite(v_t, format('with u as (update public.payouts set total_amount = 1 where id = %L returning 1) select count(*)::text from u', p)), 'true');
  select regexp_replace(total_amount::text, '\.0+$', '') || ' ' || (select count(*) from public.payout_batches where id = b)::text into t from public.payouts where id = p;
  r := r || pg_temp.chk('B3', 'both rows are still there and the amount is unchanged (100, 1 batch)', t, '100 1');
  r := r || pg_temp.chk('F1', 'the server''s key (service_role) can still update a payout',
    pg_temp.as_service(format('with u as (update public.payouts set status = ''failed'' where id = %L returning 1) select count(*)::text from u', p)), '1');
  select coalesce(string_agg(tablename || ':' || policyname || ':' || cmd, ' | ' order by tablename, policyname), '(none)') into t from pg_policies
    where schemaname = 'public' and tablename in ('payouts', 'payout_batches');
  r := r || pg_temp.chk('P1', 'every policy on the two tables', t,
    'payout_batches:Finance reads payout batches:SELECT | payouts:Finance reads payouts:SELECT | payouts:Tutors view own payouts:SELECT');
  select coalesce(string_agg(p2.proname, ',' order by p2.proname), '(none)') into t from pg_proc p2
    where p2.pronamespace = 'public'::regnamespace and p2.prokind = 'f' and not p2.prosecdef and p2.prorettype <> 'trigger'::regtype
      and p2.prosrc ~* '(update|insert\s+into|delete\s+from)\s+(public\.)?(payouts|payout_batches)\y';
  r := r || pg_temp.chk('X1', 'functions that write either table and are NOT security definer', t, '(none)');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'OLD PAYOUT TABLES TEST (rolled back): % lines, % FAIL\n%', nlines, nfail, r;
end $$;
