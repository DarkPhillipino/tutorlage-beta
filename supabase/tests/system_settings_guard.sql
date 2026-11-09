-- Rolled-back test of migration 20261104210000_system_settings_super_admin_guard.sql (4 Nov 2026).
-- Needs the wallet core migration on the database (it uses the existing setting wallet_topup_max_waiting and the wallet guard).
-- Run the migration together with this file in one rolled-back statement (migration first):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/system_settings_guard.sql supabase/migrations/20261104210000_system_settings_super_admin_guard.sql
-- or, once the migration is applied, paste this file alone. Fixtures are made-up people (example.invalid) and one made-up setting,
-- zz_guard_test. Every line ends "ok" or "FAIL (want ...)"; the block raises an error at the end on purpose so nothing is kept.
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
  v_ln uuid := gen_random_uuid();    -- an ordinary learner
  t text; nfail int; nlines int; n int;
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
  -- the stored value / description of the made-up setting, read as the owner
  execute $mk$ create function pg_temp.val() returns text language sql as $f$
      select coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'zz_guard_test'), '(no row)') $f$ $mk$;
  execute $mk$ create function pg_temp.dsc() returns text language sql as $f$
      select coalesce((select description from public.system_settings where setting_key = 'zz_guard_test'), '(no description)') $f$ $mk$;
  -- the stored value of the wallet setting used in W1 (read through a function, like val(), so it sees the update made in the same expression)
  execute $mk$ create function pg_temp.wmw() returns text language sql as $f$
      select coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'wallet_topup_max_waiting'), '(no row)') $f$ $mk$;
  -- one statement that reports how many rows it changed
  execute $mk$ create function pg_temp.upd(p_u uuid, p_set text, p_key text) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('with u as (update public.system_settings set %s where setting_key = %L returning 1) select count(*)::text from u', p_set, p_key)) $f$ $mk$;

  -- ---- people and one made-up setting -------------------------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_sa, z, 'authenticated', 'authenticated', 'sg.sa.' || v_sa || '@example.invalid', jsonb_build_object('first_name', 'Sue', 'surname', 'Super', 'date_of_birth', adult), '{}'),
    (v_fm, z, 'authenticated', 'authenticated', 'sg.fm.' || v_fm || '@example.invalid', jsonb_build_object('first_name', 'Fin', 'surname', 'Manager', 'date_of_birth', adult), '{}'),
    (v_su, z, 'authenticated', 'authenticated', 'sg.su.' || v_su || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
    (v_vo, z, 'authenticated', 'authenticated', 'sg.vo.' || v_vo || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Verify', 'date_of_birth', adult), '{}'),
    (v_of, z, 'authenticated', 'authenticated', 'sg.of.' || v_of || '@example.invalid', jsonb_build_object('first_name', 'Olly', 'surname', 'Off', 'date_of_birth', adult), '{}'),
    (v_ln, z, 'authenticated', 'authenticated', 'sg.ln.' || v_ln || '@example.invalid', jsonb_build_object('first_name', 'Lee', 'surname', 'Learner', 'date_of_birth', adult), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (v_sa, 'Sue', 'Super', 'sg.sa.' || v_sa || '@example.invalid', '', 'super_admin', true),
    (v_fm, 'Fin', 'Manager', 'sg.fm.' || v_fm || '@example.invalid', '', 'finance_manager', true),
    (v_su, 'Sam', 'Support', 'sg.su.' || v_su || '@example.invalid', '', 'support_agent', true),
    (v_vo, 'Vic', 'Verify', 'sg.vo.' || v_vo || '@example.invalid', '', 'verification_officer', true),
    (v_of, 'Olly', 'Off', 'sg.of.' || v_of || '@example.invalid', '', 'super_admin', false);
  insert into system_settings (setting_key, setting_value, description) values ('zz_guard_test', '"one"'::jsonb, 'keep me');
  r := r || 'S0 setup: a super admin, a finance manager, a support agent, a verification officer, a switched-off super admin, a learner, and the made-up setting zz_guard_test' || E'\n';

  -- ---- who counts as a super admin ----------------------------------------------------------------------------------------------------------
  select string_agg(pg_temp.run_as(x.u, 'select public.settings_is_super_admin()::text'), ' ' order by x.n) into t
    from (values (1, v_sa), (2, v_fm), (3, v_su), (4, v_vo), (5, v_of), (6, v_ln)) x(n, u);
  r := r || pg_temp.chk('H1', 'settings_is_super_admin(): super, finance, support, verification, switched-off super, learner', t, 'true false false false false false');
  r := r || pg_temp.chk('H2', 'a signed-out caller cannot ask', (pg_temp.run_as(null, 'select public.settings_is_super_admin()::text') like 'ERR: permission denied for function%')::text, 'true');

  -- ---- the super admin keeps every right (the CEO's admin app) --------------------------------------------------------------------------------
  r := r || pg_temp.chk('G1', 'a super admin changes a non-wallet setting (1 row, new value stored)',
    pg_temp.upd(v_sa, $q$setting_value = '"two"'::jsonb$q$, 'zz_guard_test') || ' / ' || pg_temp.val(), '1 / two');
  r := r || pg_temp.chk('G2', 'a super admin changes only the description',
    pg_temp.upd(v_sa, $q$description = 'new words'$q$, 'zz_guard_test') || ' / ' || pg_temp.dsc(), '1 / new words');
  r := r || pg_temp.chk('G3', 'a super admin adds a new non-wallet setting',
    pg_temp.run_as(v_sa, $q$with i as (insert into public.system_settings (setting_key, setting_value) values ('zz_guard_new', '1'::jsonb) returning 1) select count(*)::text from i$q$), '1');
  r := r || pg_temp.chk('G4', 'a super admin deletes it again',
    pg_temp.run_as(v_sa, $q$with d as (delete from public.system_settings where setting_key = 'zz_guard_new' returning 1) select count(*)::text from d$q$), '1');
  -- the admin app's 'Add / Update Setting' box is an upsert that sends no description (fix 3 of the same task): the saved words must stay
  t := pg_temp.run_as(v_sa, format($q$with u as (insert into public.system_settings (setting_key, setting_value, last_updated_by, updated_at)
      values ('zz_guard_test', '"three"'::jsonb, %L, now())
      on conflict (setting_key) do update set setting_value = excluded.setting_value, last_updated_by = excluded.last_updated_by, updated_at = excluded.updated_at
      returning 1) select count(*)::text from u$q$, v_sa));
  r := r || pg_temp.chk('G5', 'the admin app''s upsert without a description: 1 row, new value, description kept', t || ' / ' || pg_temp.val() || ' / ' || pg_temp.dsc(), '1 / three / new words');

  -- ---- every other role is refused on a non-wallet setting; nothing moves ----------------------------------------------------------------------
  r := r || pg_temp.chk('R1', 'a support agent cannot change a non-wallet setting', pg_temp.upd(v_su, $q$setting_value = '"hack"'::jsonb$q$, 'zz_guard_test') || ' / ' || pg_temp.val(),
    'ERR: Only a super admin can change system settings / three');
  r := r || pg_temp.chk('R2', 'a finance manager cannot', pg_temp.upd(v_fm, $q$setting_value = '"hack"'::jsonb$q$, 'zz_guard_test') || ' / ' || pg_temp.val(),
    'ERR: Only a super admin can change system settings / three');
  r := r || pg_temp.chk('R3', 'a verification officer cannot', pg_temp.upd(v_vo, $q$setting_value = '"hack"'::jsonb$q$, 'zz_guard_test') || ' / ' || pg_temp.val(),
    'ERR: Only a super admin can change system settings / three');
  r := r || pg_temp.chk('R4', 'a super admin whose access is switched off changes nothing (the row policy hides the row: 0 rows)', pg_temp.upd(v_of, $q$setting_value = '"hack"'::jsonb$q$, 'zz_guard_test') || ' / ' || pg_temp.val(),
    '0 / three');
  r := r || pg_temp.chk('R5', 'a support agent cannot change only the description', pg_temp.upd(v_su, $q$description = 'hack'$q$, 'zz_guard_test') || ' / ' || pg_temp.dsc(),
    'ERR: Only a super admin can change system settings / new words');
  r := r || pg_temp.chk('R6', 'a support agent cannot add a setting',
    pg_temp.run_as(v_su, $q$insert into public.system_settings (setting_key, setting_value) values ('zz_guard_new2', '1'::jsonb)$q$), 'ERR: Only a super admin can change system settings');
  r := r || pg_temp.chk('R7', 'a support agent cannot delete one (the row is still there)',
    pg_temp.run_as(v_su, $q$with d as (delete from public.system_settings where setting_key = 'zz_guard_test' returning 1) select count(*)::text from d$q$) || ' / ' || pg_temp.val(),
    'ERR: Only a super admin can change system settings / three');
  r := r || pg_temp.chk('R8', 'a finance manager cannot rename a non-wallet setting into a wallet_ name', pg_temp.upd(v_fm, $q$setting_key = 'wallet_zz_moved'$q$, 'zz_guard_test'),
    'ERR: Only a super admin can change system settings');
  r := r || pg_temp.chk('R9', 'nor rename a wallet setting out of the wallet_ names',
    pg_temp.upd(v_fm, $q$setting_key = 'zz_moved'$q$, 'wallet_topup_max_waiting') || ' / ' || (select count(*)::text from system_settings where setting_key = 'wallet_topup_max_waiting'),
    'ERR: Only a super admin can change system settings / 1');
  t := pg_temp.run_as(v_su, format($q$with u as (insert into public.system_settings (setting_key, setting_value, last_updated_by, updated_at)
      values ('zz_guard_test', '"hack"'::jsonb, %L, now())
      on conflict (setting_key) do update set setting_value = excluded.setting_value returning 1) select count(*)::text from u$q$, v_su));
  r := r || pg_temp.chk('R10', 'the same upsert from a support agent is refused before it reaches the row', t || ' / ' || pg_temp.val(),
    'ERR: Only a super admin can change system settings / three');
  t := pg_temp.upd(v_ln, $q$setting_value = '"hack"'::jsonb$q$, 'zz_guard_test');
  r := r || pg_temp.chk('R11', 'a learner changes nothing (0 rows or refused)', (t = '0' or t like 'ERR:%')::text || ' / ' || pg_temp.val(), 'true / three');
  t := pg_temp.upd(null, $q$setting_value = '"hack"'::jsonb$q$, 'zz_guard_test');
  r := r || pg_temp.chk('R12', 'a signed-out caller changes nothing (refused or 0 rows)', (t = '0' or t like 'ERR:%')::text || ' / ' || pg_temp.val(), 'true / three');

  -- ---- the wallet_ settings keep their own rule -------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('W1', 'a finance manager can still change a wallet_ setting (the Payments page)',
    pg_temp.upd(v_fm, $q$setting_value = '7'::jsonb$q$, 'wallet_topup_max_waiting') || ' / ' || pg_temp.wmw(), '1 / 7');
  r := r || pg_temp.chk('W2', 'a super admin can too', pg_temp.upd(v_sa, $q$setting_value = '8'::jsonb$q$, 'wallet_topup_max_waiting'), '1');
  r := r || pg_temp.chk('W3', 'a support agent is still refused by the wallet guard''s own words', pg_temp.upd(v_su, $q$setting_value = '9'::jsonb$q$, 'wallet_topup_max_waiting'),
    'ERR: Only a finance admin can change wallet settings');
  r := r || pg_temp.chk('W4', 'the wallet value check still applies to a finance manager (0 is refused)', pg_temp.upd(v_fm, $q$setting_value = '0'::jsonb$q$, 'wallet_topup_max_waiting'),
    'ERR: wallet_topup_max_waiting must be a whole number of at least 1');

  -- ---- the database's own functions are not held up ----------------------------------------------------------------------------------------------
  execute $mk$
    create function public.zz_settings_definer_probe() returns text language plpgsql security definer set search_path = public as $f$
    begin
      update public.system_settings set setting_value = '"by function"'::jsonb where setting_key = 'zz_guard_test';
      return 'done';
    end $f$ $mk$;
  grant execute on function public.zz_settings_definer_probe() to authenticated;
  r := r || pg_temp.chk('F1', 'a SECURITY DEFINER function run by a support agent can still write a setting (the guard stops API calls only)',
    pg_temp.run_as(v_su, 'select public.zz_settings_definer_probe()') || ' / ' || pg_temp.val(), 'done / by function');
  update system_settings set setting_value = '"owner"'::jsonb where setting_key = 'zz_guard_test';
  get diagnostics n = row_count;
  r := r || pg_temp.chk('F2', 'the owner running SQL is not held up (the fixtures above are the proof): one more write', n::text || ' / ' || pg_temp.val(), '1 / owner');

  -- ---- what is installed -------------------------------------------------------------------------------------------------------------------------
  select string_agg(tgname || '=' || (tgtype & 31)::text, ' ' order by tgname) into t from pg_trigger
    where tgrelid = 'public.system_settings'::regclass and not tgisinternal and tgname in ('system_settings_role_guard', 'wallet_settings_guard');
  r := r || pg_temp.chk('I1', 'both guards are row triggers BEFORE insert/update/delete (31 = row + before + insert + delete + update)', t, 'system_settings_role_guard=31 wallet_settings_guard=31');
  select (p.prosecdef)::text || ' ' || coalesce((p.proconfig::text like '%search_path=public%')::text, 'false') into t from pg_proc p where p.oid = 'public.system_settings_role_guard()'::regprocedure;
  r := r || pg_temp.chk('I2', 'the guard is SECURITY INVOKER (so current_user is the caller) and pins its search_path', t, 'false true');
  select (p.prosecdef)::text || ' ' || coalesce((p.proconfig::text like '%search_path=public%')::text, 'false') into t from pg_proc p where p.oid = 'public.settings_is_super_admin()'::regprocedure;
  r := r || pg_temp.chk('I3', 'the helper is SECURITY DEFINER and pins its search_path', t, 'true true');
  r := r || pg_temp.chk('I4', 'rights: nobody can run the guard; signed-in may ask the helper, signed-out may not',
    has_function_privilege('anon', 'public.system_settings_role_guard()', 'EXECUTE')::text || ' ' || has_function_privilege('authenticated', 'public.system_settings_role_guard()', 'EXECUTE')::text || ' ' ||
    has_function_privilege('service_role', 'public.system_settings_role_guard()', 'EXECUTE')::text || ' ' ||
    has_function_privilege('anon', 'public.settings_is_super_admin()', 'EXECUTE')::text || ' ' || has_function_privilege('authenticated', 'public.settings_is_super_admin()', 'EXECUTE')::text,
    'false false false false true');
  select count(*)::text into t from pg_policies where schemaname = 'public' and tablename = 'system_settings' and policyname = 'Admins manage system settings';
  r := r || pg_temp.chk('I5', 'the policy "Admins manage system settings" is untouched (still 1)', t, '1');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'SYSTEM SETTINGS GUARD TEST (rolled back): % lines, % FAIL\n%', nlines, nfail, r;
end $$;
