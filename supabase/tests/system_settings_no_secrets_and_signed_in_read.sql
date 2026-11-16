-- Rolled-back test of 20261116200500_system_settings_no_secrets.sql (P2 security round 2, 16 Nov 2026): no secret can be saved (20261116200500) and only signed-in users read the settings (20261116200600)
-- Run the migration together with this file in one rolled-back statement (migration first):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/system_settings_no_secrets_and_signed_in_read.sql supabase/migrations/20261116200500_system_settings_no_secrets.sql supabase/migrations/20261116200600_system_settings_signed_in_read_only.sql
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


  -- the secret-shaped values are built from pieces so this file itself holds nothing key-shaped
  execute $mk$
    create function pg_temp.try_save(p_key text, p_val text) returns text language plpgsql as $f$
    begin
      begin
        insert into public.system_settings (setting_key, setting_value) values (p_key, to_jsonb(p_val)) on conflict (setting_key) do update set setting_value = excluded.setting_value;
        return 'saved';
      exception when others then
        return 'refused';
      end;
    end $f$ $mk$;
  -- 6a: the secret lock (it applies to every caller, the owner included)
  r := r || pg_temp.chk('K1', 'keys that name a secret are refused: secret, api_key, token, service_role, password',
    pg_temp.try_save('zz_secret', 'x') || ' ' || pg_temp.try_save('zz_api_key', 'x') || ' ' || pg_temp.try_save('my_token_value', 'x') || ' ' ||
    pg_temp.try_save('zz_service_role', 'x') || ' ' || pg_temp.try_save('zz_password', 'x'), 'refused refused refused refused refused');
  r := r || pg_temp.chk('K2', 'ordinary keys that only look similar are saved: zz_tokenizer_note, zz_monkey, zz_apiary, paystack_fee_bearer''s sort of name',
    pg_temp.try_save('zz_tokenizer_note', 'x') || ' ' || pg_temp.try_save('zz_monkey', 'x') || ' ' || pg_temp.try_save('zz_apiary', 'x') || ' ' || pg_temp.try_save('zz_fee_bearer', 'x'), 'saved saved saved saved');
  r := r || pg_temp.chk('V1', 'values that look like a secret are refused: a secret key, a webhook secret, a service key, a JSON web token, a private key, a password in a web address',
    pg_temp.try_save('zz_v1', 'sk' || '_live_' || repeat('a', 12)) || ' ' || pg_temp.try_save('zz_v2', 'whsec' || '_' || repeat('b', 8)) || ' ' ||
    pg_temp.try_save('zz_v3', 'sb' || '_secret_' || repeat('c', 8)) || ' ' || pg_temp.try_save('zz_v4', 'eyJ' || repeat('a', 12) || '.' || repeat('b', 12) || '.sig') || ' ' ||
    pg_temp.try_save('zz_v5', '-----BEGIN ' || 'RSA PRIVATE KEY' || '-----') || ' ' || pg_temp.try_save('zz_v6', 'https://user:pass' || '@example.invalid/x'),
    'refused refused refused refused refused refused');
  r := r || pg_temp.chk('V2', 'ordinary values are saved: words with an @, a web address without a password, a number, a list',
    pg_temp.try_save('zz_w1', 'write to help@example.invalid') || ' ' || pg_temp.try_save('zz_w2', 'https://example.invalid/path?x=1') || ' ' ||
    pg_temp.try_save('zz_w3', '42') || ' ' || pg_temp.try_save('zz_w4', 'a, b, c'), 'saved saved saved saved');
  select count(*)::text into t from public.system_settings
    where (setting_key ~* '(^|_)(secret|token|password|passwd|private_key|api_key|apikey|service_role|signing_key|access_key|client_secret)($|_)'
       or setting_value::text ~* '(sk_(live|test)_[a-z0-9]{10}|whsec_|sb_secret_|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.|-----BEGIN [A-Z ]*PRIVATE KEY|://[^/\s:@"]+:[^/\s@"]+@)')
       and setting_key not like 'zz\_%';
  r := r || pg_temp.chk('K3', 'none of the settings already saved is a secret by the new rules (so no existing save is blocked)', t, '0');
  r := r || pg_temp.chk('K4', 'a super admin through the API can still save an ordinary setting (1 row) and still not a secret one (refused)',
    pg_temp.run_as(v_sa, $q$with u as (update public.system_settings set setting_value = to_jsonb('zz new words'::text) where setting_key = 'zz_w1' returning 1) select count(*)::text from u$q$) || ' ' ||
    pg_temp.refused(v_sa, $q$update public.system_settings set setting_value = to_jsonb('https://user:pass' || '@example.invalid') where setting_key = 'zz_w1'$q$), '1 true');
  r := r || pg_temp.chk('K5', 'the existing guards still stand: a support agent cannot change an ordinary setting (0 rows or refused)',
    pg_temp.nowrite(v_su, $q$with u as (update public.system_settings set setting_value = to_jsonb('hacked'::text) where setting_key = 'zz_w2' returning 1) select count(*)::text from u$q$), 'true');
  r := r || pg_temp.chk('K6', 'the finance manager can still save a wallet_ setting through the API (the wallet guard): topup_max_waiting set to its own value',
    pg_temp.run_as(v_fm, $q$with u as (update public.system_settings set setting_value = setting_value where setting_key = 'wallet_topup_max_waiting' returning 1) select count(*)::text from u$q$), '1');

  -- 6b: signed-in read only
  select count(*)::text into t from public.system_settings;
  r := r || pg_temp.chk('R0', 'the table holds settings (so the read checks mean something)', (t::int > 40)::text, 'true');
  r := r || pg_temp.chk('R1', 'a SIGNED-OUT caller reads no settings (0; permission denied counts as 0)', regexp_replace(pg_temp.run_as(null, 'select count(*)::text from public.system_settings'), 'ERR: permission denied for table [a-z_]+', '0'), '0');
  r := r || pg_temp.chk('R2', 'signed-in users read them: a learner, a tutor, a support agent, a finance manager, a super admin (each sees all)',
    pg_temp.run_as(v_l, 'select (count(*) > 40)::text from public.system_settings') || ' ' || pg_temp.run_as(v_t, 'select (count(*) > 40)::text from public.system_settings') || ' ' ||
    pg_temp.run_as(v_su, 'select (count(*) > 40)::text from public.system_settings') || ' ' || pg_temp.run_as(v_fm, 'select (count(*) > 40)::text from public.system_settings') || ' ' ||
    pg_temp.run_as(v_sa, 'select (count(*) > 40)::text from public.system_settings'), 'true true true true true');
  r := r || pg_temp.chk('R3', 'what a signed-out visitor still needs works: the Terms and Privacy versions, the free-sessions switch (no error)',
    pg_temp.classify(pg_temp.run_as(null, 'select (select count(*) from public.current_policy_versions())::text')) || ' ' ||
    pg_temp.classify(pg_temp.run_as(null, 'select public.free_sessions_open()::text')), 'ran ran');
  r := r || pg_temp.chk('R4', 'the wallet switch still answers a signed-in learner (no error)', pg_temp.classify(pg_temp.run_as(v_l, 'select public.wallet_open()::text')), 'ran');
  select coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text, ' | ' order by policyname), '(none)') into t from pg_policies where schemaname = 'public' and tablename = 'system_settings';
  r := r || pg_temp.chk('P1', 'every policy on system_settings', t, 'Admins manage system settings:ALL:{authenticated} | Signed-in users read system settings:SELECT:{authenticated}');
  select count(*)::text into t from pg_trigger where tgrelid = 'public.system_settings'::regclass and tgname in ('system_settings_no_secrets', 'system_settings_role_guard', 'wallet_settings_guard') and not tgisinternal;
  r := r || pg_temp.chk('P2', 'the new secret lock is installed beside the two guards that were already there', t, '3');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'SYSTEM SETTINGS TEST (rolled back): % lines, % FAIL\n%', nlines, nfail, r;
end $$;
