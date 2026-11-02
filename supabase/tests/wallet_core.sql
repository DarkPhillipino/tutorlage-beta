-- Rolled-back test of the WALLET CORE (phase 1 of the wallet + manual bank transfer system; migrations 20261102200000 and 20261102200100). See README.md.
-- Order: 20261102200000_wallet_audit_actions.sql must already be committed on the database (it only adds enum values, which the runner cannot use in
-- the same statement), then run the core migration together with this file in one rolled-back statement:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/wallet_core.sql supabase/migrations/20261102200100_wallet_core.sql
-- Every line ends "ok" or "FAIL (want ...)"; the first line gives the count. Fixtures are made-up people (example.invalid); nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '10 years')::date::text;
  v_l uuid := gen_random_uuid();    -- an adult learner
  v_o uuid := gen_random_uuid();    -- another adult learner
  v_c uuid := gen_random_uuid();    -- a third adult, credited through the card door
  v_m uuid := gen_random_uuid();    -- a learner under 18
  v_p uuid := gen_random_uuid();    -- a parent (the guardian of the learner under 18)
  v_t uuid := gen_random_uuid();    -- a tutor
  v_t2 uuid := gen_random_uuid();   -- a second tutor
  a_fin uuid := gen_random_uuid();  -- finance_manager
  a_sup uuid := gen_random_uuid();  -- super_admin
  a_spt uuid := gen_random_uuid();  -- support_agent (no wallet rights)
  a_off uuid := gen_random_uuid();  -- finance_manager who is switched off
  q1 uuid; q2 uuid; q3 uuid; qd uuid; qb uuid; qu uuid; qc uuid; qs1 uuid; qs2 uuid; qs3 uuid;
  po1 uuid; po2 uuid; po3 uuid; id1 uuid; id2 uuid;
  s_a uuid := gen_random_uuid(); s_b uuid := gen_random_uuid(); s_c uuid := gen_random_uuid();
  p1 text; p2 text; t text; t2 text; t3 text; u1 text; u2 text; i int; n int; n2 int; n3 int; a0 int; h0 int; ts timestamptz;
  j jsonb; nfail int; nlines int; rep text;
begin
  begin   -- everything below; an unexpected error is reported with the lines before it instead of hiding them

  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
    $f$ $mk$;
  -- run one statement (returning one value) as a signed-in user, or as a signed-out visitor when the id is null; an error comes back as its message
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
  -- the same as the server's role
  execute $mk$
    create function pg_temp.run_svc(p_sql text) returns text language plpgsql as $f$
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
  -- run a statement as the owner; 'ok' or the error (a failed statement undoes itself)
  execute $mk$
    create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
    begin
      execute p_sql;
      return 'ok';
    exception when others then
      return 'ERR: ' || sqlerrm;
    end $f$ $mk$;
  execute $mk$ create function pg_temp.has(p_res text, p_part text) returns text language sql as $f$
      select case when position(p_part in coalesce(p_res, '')) > 0 then 'yes' else coalesce(p_res, 'null') end $f$ $mk$;
  execute $mk$ create function pg_temp.nn(p_profile uuid, p_type text) returns int language sql as $f$
      select count(*)::int from public.notifications where profile_id = p_profile and type = p_type $f$ $mk$;

  -- ---- people ---------------------------------------------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l, z, 'authenticated', 'authenticated', 'w.l.' || v_l || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}'),
    (v_o, z, 'authenticated', 'authenticated', 'w.o.' || v_o || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Otto', 'date_of_birth', adult), '{}'),
    (v_c, z, 'authenticated', 'authenticated', 'w.c.' || v_c || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cleo', 'date_of_birth', adult), '{}'),
    (v_p, z, 'authenticated', 'authenticated', 'w.p.' || v_p || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pat', 'date_of_birth', adult, 'phone_number', '081 234 5678'), '{}'),
    (v_t, z, 'authenticated', 'authenticated', 'w.t.' || v_t || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'date_of_birth', adult), '{}'),
    (v_t2, z, 'authenticated', 'authenticated', 'w.t2.' || v_t2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tom', 'date_of_birth', adult), '{}'),
    (a_fin, z, 'authenticated', 'authenticated', 'w.a1.' || a_fin || '@example.invalid', '{}'::jsonb, '{}'),
    (a_sup, z, 'authenticated', 'authenticated', 'w.a2.' || a_sup || '@example.invalid', '{}'::jsonb, '{}'),
    (a_spt, z, 'authenticated', 'authenticated', 'w.a3.' || a_spt || '@example.invalid', '{}'::jsonb, '{}'),
    (a_off, z, 'authenticated', 'authenticated', 'w.a4.' || a_off || '@example.invalid', '{}'::jsonb, '{}');
  update profiles set date_of_birth = adult::date where id in (v_l, v_o, v_c, v_p, v_t, v_t2);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_m, z, 'authenticated', 'authenticated', 'w.m.' || v_m || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Mia', 'date_of_birth', minor),
     jsonb_build_object('created_by_guardian', v_p, 'relationship', 'mother'));
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (a_fin, 'Fin', 'Manager', 'w.a1.' || a_fin || '@example.invalid', '', 'finance_manager', true),
    (a_sup, 'Sup', 'Admin', 'w.a2.' || a_sup || '@example.invalid', '', 'super_admin', true),
    (a_spt, 'Spt', 'Agent', 'w.a3.' || a_spt || '@example.invalid', '', 'support_agent', true),
    (a_off, 'Off', 'Manager', 'w.a4.' || a_off || '@example.invalid', '', 'finance_manager', false);
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  r := r || 'S0 setup: 7 people (a parent, one under 18, two tutors), 4 admins (finance, super, support, one switched off)' || E'\n';

  -- ---- the switch, the settings and their guard -------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('W01', 'the wallet is closed after the migration', public.wallet_open()::text, 'false');
  t := pg_temp.run_as(v_l, 'select public.create_wallet_topup(200)::text');
  r := r || pg_temp.chk('W02', 'a closed wallet refuses a top-up', pg_temp.has(t, 'Wallet payments are not open.'), 'yes');
  r := r || pg_temp.chk('W03', 'a closed wallet shows no payment details', pg_temp.run_as(v_l, 'select public.wallet_payment_details()::text'), '{"open": false}');
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_payments_enabled';
  r := r || pg_temp.chk('W04', 'switch on: open', public.wallet_open()::text, 'true');
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'free_sessions_enabled';
  r := r || pg_temp.chk('W05', 'free sessions on: free wins, the wallet stays closed', public.wallet_open()::text, 'false');
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  select string_agg(setting_value #>> '{}', ' ' order by setting_key) into t from system_settings
    where setting_key in ('wallet_balance_cap_rand', 'wallet_topup_max_rand', 'wallet_topup_min_rand');
  r := r || pg_temp.chk('W06', 'limits seeded: cap, max, min', t, '10000 5000 50');
  t := pg_temp.run_as(a_spt, $q$ with u as (update system_settings set setting_value = '"X"'::jsonb where setting_key = 'wallet_bank_name' returning 1) select count(*)::text from u $q$);
  t2 := pg_temp.run_as(a_spt, $q$ with d as (delete from system_settings where setting_key = 'wallet_topup_min_rand' returning 1) select count(*)::text from d $q$);
  r := r || pg_temp.chk('W07', 'a support agent cannot change or delete a wallet setting', pg_temp.has(t, 'Only a finance admin') || ' ' || pg_temp.has(t2, 'Only a finance admin'), 'yes yes');
  t := pg_temp.run_as(a_fin, $q$ with u as (update system_settings set setting_value = '"Test Bank"'::jsonb where setting_key = 'wallet_bank_name' returning 1) select count(*)::text from u $q$);
  r := r || pg_temp.chk('W08', 'a finance admin can change a bank detail', t, '1');
  r := r || pg_temp.chk('W09', 'every active admin is told (finance, super, support) and the switched-off one is not', pg_temp.nn(a_fin, 'wallet_bank_changed') || ' ' || pg_temp.nn(a_sup, 'wallet_bank_changed') || ' '
    || pg_temp.nn(a_spt, 'wallet_bank_changed') || ' ' || pg_temp.nn(a_off, 'wallet_bank_changed'), '1 1 1 0');
  t := pg_temp.has(pg_temp.run_as(a_fin, $q$ with u as (update system_settings set setting_value = '6000'::jsonb where setting_key = 'wallet_topup_min_rand' returning 1) select count(*)::text from u $q$), 'limits must satisfy');
  t2 := pg_temp.has(pg_temp.run_as(a_fin, $q$ with u as (update system_settings set setting_value = '"yes"'::jsonb where setting_key = 'wallet_payments_enabled' returning 1) select count(*)::text from u $q$), 'true or false');
  t3 := pg_temp.has(pg_temp.run_as(a_fin, $q$ with u as (update system_settings set setting_value = '0'::jsonb where setting_key = 'wallet_balance_cap_rand' returning 1) select count(*)::text from u $q$), 'at least 1');
  r := r || pg_temp.chk('W10', 'nonsense values are refused: min above max, switch not true/false, cap 0', t || ' ' || t2 || ' ' || t3, 'yes yes yes');

  -- ---- rights ---------------------------------------------------------------------------------------------------------------------------
  select count(*) into n from unnest(array['wallets', 'wallet_ledger', 'wallet_topups', 'payout_requests', 'tutor_bank_details']) tb,
    unnest(array['anon', 'authenticated', 'service_role']) ro, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr
    where has_table_privilege(ro, 'public.' || tb, pr);
  r := r || pg_temp.chk('R01', 'no browser role or the server role can write, truncate or reference any of the five tables', n::text, '0');
  select count(*) filter (where ro = 'anon'), count(*) filter (where ro = 'service_role'), count(*) filter (where ro = 'authenticated') into n, n2, n3
    from unnest(array['wallets', 'wallet_ledger', 'wallet_topups', 'payout_requests', 'tutor_bank_details']) tb, unnest(array['anon', 'authenticated', 'service_role']) ro
    where has_any_column_privilege(ro, 'public.' || tb, 'SELECT');
  r := r || pg_temp.chk('R02', 'reading: signed-out none, server role none, signed-in all five (behind row rules)', n || ' ' || n2 || ' ' || n3, '0 0 5');
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('wallet_post', 'wallet_ensure', 'wallet_credit_topup', 'wallet_notify', 'wallet_notify_finance', 'wallet_int_setting', 'wallet_check_balances',
                      'wallet_balance_check_job', 'wallet_cancel_stale_topups', 'wallet_ledger_apply', 'wallets_guard', 'wallet_ledger_is_append_only',
                      'wallet_settings_guard', 'wallet_bank_setting_changed')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  r := r || pg_temp.chk('R03', 'no internal wallet function can be called by a browser role', n::text, '0');
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('wallet_post', 'wallet_ensure', 'wallet_notify', 'wallet_notify_finance', 'wallet_int_setting', 'wallet_check_balances', 'wallet_balance_check_job',
                      'wallet_cancel_stale_topups', 'wallet_ledger_apply', 'wallets_guard', 'wallet_ledger_is_append_only', 'wallet_settings_guard', 'wallet_bank_setting_changed')
    and has_function_privilege('service_role', p.oid, 'EXECUTE');
  r := r || pg_temp.chk('R04', 'the server role may use the top-up door and none of the other internal functions',
    has_function_privilege('service_role', 'public.wallet_credit_topup(uuid, integer, uuid, text)', 'EXECUTE')::text || ' ' || n, 'true 0');
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('wallet_is_finance_admin', 'wallet_payment_details', 'create_wallet_topup', 'attach_topup_proof', 'cancel_my_topup', 'save_my_bank_details', 'request_my_payout',
                      'admin_mark_topup_successful', 'admin_mark_topup_unsuccessful', 'admin_mark_payout_paid', 'admin_mark_payout_cannot_pay', 'admin_open_bank_details',
                      'admin_adjust_wallet', 'wallet_totals', 'admin_wallet_balance_check', 'wallet_may_upload_proof')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  r := r || pg_temp.chk('R05', 'a signed-out visitor can call none of the signed-in wallet functions', n::text, '0');
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('wallet_is_finance_admin', 'wallet_int_setting', 'wallet_open', 'wallet_notify', 'wallet_notify_finance', 'wallet_settings_guard', 'wallet_bank_setting_changed',
                      'wallets_guard', 'wallet_ensure', 'wallet_ledger_apply', 'wallet_ledger_is_append_only', 'wallet_post', 'wallet_credit_topup', 'wallet_payment_details',
                      'create_wallet_topup', 'attach_topup_proof', 'cancel_my_topup', 'save_my_bank_details', 'request_my_payout', 'admin_mark_topup_successful',
                      'admin_mark_topup_unsuccessful', 'admin_mark_payout_paid', 'admin_mark_payout_cannot_pay', 'admin_open_bank_details', 'admin_adjust_wallet', 'wallet_totals',
                      'wallet_check_balances', 'admin_wallet_balance_check', 'wallet_balance_check_job', 'wallet_cancel_stale_topups', 'wallet_may_upload_proof')
    and (p.proconfig is null or p.proconfig::text not like '%search_path=public%'
         or (not p.prosecdef and p.proname not in ('wallet_settings_guard', 'wallets_guard', 'wallet_ledger_is_append_only')));
  r := r || pg_temp.chk('R06', 'all 31 wallet functions pin their search path, and all but the three plain trigger functions are definers', n::text, '0');
  r := r || pg_temp.chk('R07', 'the full account number is unreadable through the API, the last four digits are readable',
    has_column_privilege('authenticated', 'public.payout_requests', 'account_number', 'SELECT')::text || ' ' || has_column_privilege('authenticated', 'public.tutor_bank_details', 'account_number', 'SELECT')::text || ' '
    || has_column_privilege('authenticated', 'public.payout_requests', 'account_last4', 'SELECT')::text || ' ' || has_column_privilege('authenticated', 'public.tutor_bank_details', 'account_last4', 'SELECT')::text,
    'false false true true');

  -- ---- the ledger -----------------------------------------------------------------------------------------------------------------------
  perform public.wallet_post(v_l, 'topup', 100, 0, 't:l:1');
  select available_rand || ' ' || held_rand into t from wallets where profile_id = v_l;
  r := r || pg_temp.chk('L01', 'a top-up line of R100 puts R100 in the wallet', t, '100 0');
  select available_after || ' ' || held_after into t from wallet_ledger where idempotency_key = 't:l:1';
  r := r || pg_temp.chk('L02', 'the line carries the balance after it', t, '100 0');
  t := pg_temp.try($q$ select public.wallet_post(gen_random_uuid(), 'topup', 5, 0, 't:ghost') $q$);
  r := r || pg_temp.chk('L03', 'a wallet cannot be made for a person who does not exist', pg_temp.has(t, 'No such person'), 'yes');
  t := pg_temp.try(format($q$ select public.wallet_post(%L, 'hold', -150, 150, 't:l:2') $q$, v_l));
  select available_rand || ' ' || held_rand into t2 from wallets where profile_id = v_l;
  r := r || pg_temp.chk('L04', 'holding more than the wallet has is refused (wallet_too_low) and nothing changes', pg_temp.has(t, 'wallet_too_low') || ' ' || t2, 'yes 100 0');
  perform public.wallet_post(v_l, 'hold', -40, 40, 't:l:3');
  select available_rand || ' ' || held_rand into t from wallets where profile_id = v_l;
  r := r || pg_temp.chk('L05', 'holding R40 moves it from available to on hold', t, '60 40');
  t := pg_temp.has(pg_temp.try(format($q$ select public.wallet_post(%L, 'hold', -10, 5, 't:l:4') $q$, v_l)), 'wallet_ledger_shape');
  t2 := pg_temp.has(pg_temp.try(format($q$ select public.wallet_post(%L, 'topup', -10, 0, 't:l:5') $q$, v_l)), 'wallet_ledger_shape');
  t3 := pg_temp.has(pg_temp.try(format($q$ select public.wallet_post(%L, 'gift', 10, 0, 't:l:6') $q$, v_l)), 'violates check constraint');
  r := r || pg_temp.chk('L06', 'a line whose two sides do not match its kind, or of an unknown kind, is refused', t || ' ' || t2 || ' ' || t3, 'yes yes yes');
  id1 := public.wallet_post(v_l, 'topup', 100, 0, 't:l:1');
  select count(*) into n from wallet_ledger where idempotency_key = 't:l:1';
  select available_rand || ' ' || held_rand into t from wallets where profile_id = v_l;
  r := r || pg_temp.chk('L07', 'repeating a posting returns the first line and moves nothing', (id1 = (select id from wallet_ledger where idempotency_key = 't:l:1'))::text || ' ' || n || ' ' || t, 'true 1 60 40');
  t := pg_temp.try(format($q$ select public.wallet_post(%L, 'topup', 90, 0, 't:l:1') $q$, v_l));
  r := r || pg_temp.chk('L08', 'the same key for a different posting is an error', pg_temp.has(t, 'already used for a different posting'), 'yes');
  t := pg_temp.has(pg_temp.try($q$ update public.wallet_ledger set note = 'x' $q$), 'can only be added to');
  t2 := pg_temp.has(pg_temp.try($q$ delete from public.wallet_ledger $q$), 'can only be added to');
  t3 := pg_temp.has(pg_temp.try($q$ truncate public.wallet_ledger $q$), 'can only be added to');
  r := r || pg_temp.chk('L09', 'even the owner cannot update, delete or truncate the ledger', t || ' ' || t2 || ' ' || t3, 'yes yes yes');
  t := pg_temp.has(pg_temp.run_as(v_l, $q$ with u as (update public.wallet_ledger set note = 'x' returning 1) select count(*)::text from u $q$), 'permission denied');
  t2 := pg_temp.has(pg_temp.run_svc($q$ delete from public.wallet_ledger $q$), 'permission denied');
  r := r || pg_temp.chk('L10', 'the line''s owner and the server role are refused at the door', t || ' ' || t2, 'yes yes');
  begin
    perform set_config('tutorlage.purging_wallet_ledger', 'on', true);
    delete from public.wallet_ledger where idempotency_key = 't:l:3';
    get diagnostics n = row_count;
    t := 'deleted ' || n;
    raise exception 'undo';
  exception when others then
    null;
  end;
  select count(*) into n from wallet_ledger where idempotency_key = 't:l:3';
  r := r || pg_temp.chk('L11', 'only the retention flag lets a line be deleted (tried and undone)', t || ', still there: ' || n, 'deleted 1, still there: 1');
  t := pg_temp.has(pg_temp.try(format($q$ update public.wallets set available_rand = 999999 where profile_id = %L $q$, v_l)), 'only through the ledger');
  t2 := pg_temp.has(pg_temp.try($q$ delete from public.wallets $q$), 'cannot be deleted');
  t3 := pg_temp.has(pg_temp.try($q$ truncate public.wallets $q$), 'cannot be truncated') || ' ' || pg_temp.has(pg_temp.try(format($q$ insert into public.wallets (profile_id, available_rand) values (%L, 5) $q$, gen_random_uuid())), 'starts empty');
  r := r || pg_temp.chk('L12', 'a balance cannot be edited, deleted or started non-empty, even by the owner', t || ' ' || t2 || ' ' || t3, 'yes yes yes yes');
  t := pg_temp.has(pg_temp.run_as(v_l, format($q$ with u as (update public.wallets set available_rand = 5000 where profile_id = %L returning 1) select count(*)::text from u $q$, v_l)), 'permission denied');
  r := r || pg_temp.chk('L13', 'the wallet''s own person cannot edit it through the API', t, 'yes');
  t := pg_temp.try(format($q$ select public.wallet_post(%L, 'topup', 50, 0, 't:m:1') $q$, v_m));
  r := r || pg_temp.chk('L14', 'a learner under 18 can have no wallet', pg_temp.has(t, 'under 18'), 'yes');
  t := pg_temp.try(format($q$ select public.wallet_post(%L, 'adjustment', -500, 0, 't:l:7') $q$, v_l));
  r := r || pg_temp.chk('L15', 'an adjustment cannot take a wallet below zero either', pg_temp.has(t, 'wallet_too_low'), 'yes');

  -- ---- top-ups: creating one -----------------------------------------------------------------------------------------------------------
  t := pg_temp.run_as(v_m, 'select public.create_wallet_topup(200)::text');
  r := r || pg_temp.chk('T01', 'a learner under 18 cannot add money (the parent does)', pg_temp.has(t, 'Only an adult'), 'yes');
  t := pg_temp.run_as(null, 'select public.create_wallet_topup(200)::text');
  r := r || pg_temp.chk('T02', 'a signed-out visitor cannot', pg_temp.has(t, 'permission denied'), 'yes');
  t := pg_temp.run_as(v_l, 'select public.create_wallet_topup(200)::text');
  r := r || pg_temp.chk('T03', 'until all four bank details are entered, no top-up can be made', pg_temp.has(t, 'bank details are not set up'), 'yes');
  perform set_config('request.jwt.claims', '', true);   -- the owner again, signed in as nobody (the audit line of a settings change reads the caller)
  update system_settings set setting_value = '"A B Account"'::jsonb where setting_key = 'wallet_bank_account_holder';
  update system_settings set setting_value = '"1234567890"'::jsonb where setting_key = 'wallet_bank_account_number';
  update system_settings set setting_value = '"250655"'::jsonb where setting_key = 'wallet_bank_branch_code';
  t := pg_temp.has(pg_temp.run_as(v_l, 'select public.create_wallet_topup(49)::text'), 'Add between R50 and R5000');
  t2 := pg_temp.has(pg_temp.run_as(v_l, 'select public.create_wallet_topup(5001)::text'), 'Add between R50 and R5000');
  t3 := pg_temp.has(pg_temp.run_as(v_l, 'select public.create_wallet_topup(0)::text'), 'Add between R50 and R5000');
  r := r || pg_temp.chk('T04', 'below the minimum, above the maximum and zero are refused', t || ' ' || t2 || ' ' || t3, 'yes yes yes');
  q1 := (pg_temp.run_as(v_l, 'select public.create_wallet_topup(200)::text')::jsonb ->> 'topup_id')::uuid;
  q2 := (pg_temp.run_as(v_l, 'select public.create_wallet_topup(100)::text')::jsonb ->> 'topup_id')::uuid;
  q3 := (pg_temp.run_as(v_l, 'select public.create_wallet_topup(50)::text')::jsonb ->> 'topup_id')::uuid;
  select status || ' ' || amount_rand || ' ' || (reference ~ '^TL-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$') into t from wallet_topups where id = q1;
  r := r || pg_temp.chk('T05', 'a valid top-up waits for proof and has a well-formed reference', t, 'awaiting_proof 200 true');
  r := r || pg_temp.chk('T06', 'the reference is unique (three top-ups, three references, and a unique constraint)',
    (select count(distinct reference) from wallet_topups where profile_id = v_l) || ' ' || (select count(*) from pg_constraint where conname = 'wallet_topups_reference_key'), '3 1');
  t := pg_temp.run_as(v_l, 'select public.create_wallet_topup(50)::text');
  r := r || pg_temp.chk('T07', 'a fourth top-up waiting for proof is refused', pg_temp.has(t, 'already have 3 top-ups'), 'yes');
  update system_settings set setting_value = '50'::jsonb where setting_key = 'wallet_topup_max_waiting';
  for i in 1..10 loop
    t := pg_temp.run_as(v_o, 'select public.create_wallet_topup(50)::text');
  end loop;
  select count(*) into n from wallet_topups where profile_id = v_o;
  t := pg_temp.run_as(v_o, 'select public.create_wallet_topup(50)::text');
  update system_settings set setting_value = '3'::jsonb where setting_key = 'wallet_topup_max_waiting';
  r := r || pg_temp.chk('T08', 'ten top-ups in a day are allowed, the eleventh is refused', n || ' ' || pg_temp.has(t, 'many top-up requests today'), '10 yes');
  perform public.wallet_post(v_t2, 'topup', 9900, 0, 'cap:t2');
  t := pg_temp.run_as(v_t2, 'select public.create_wallet_topup(200)::text');
  t2 := pg_temp.run_as(v_t2, 'select public.create_wallet_topup(100)::text');
  r := r || pg_temp.chk('T09', 'a top-up that would take the wallet above the R10 000 cap is refused with the room left; the exact room is accepted',
    pg_temp.has(t, 'You can add up to R100 now.') || ' ' || (t2::jsonb ->> 'status'), 'yes awaiting_proof');
  t := pg_temp.run_as(v_l, 'select public.wallet_payment_details()::text');
  r := r || pg_temp.chk('T10', 'an open wallet shows the bank details and limits', (t::jsonb ->> 'bank_name') || '|' || (t::jsonb ->> 'account_number') || '|' || (t::jsonb ->> 'min_rand') || '|' || (t::jsonb ->> 'cap_rand'), 'Test Bank|1234567890|50|10000');
  r := r || pg_temp.chk('T11', 'the table refuses a bad state: successful with no ledger line, unsuccessful with no comment',
    pg_temp.has(pg_temp.try(format($q$ update public.wallet_topups set status = 'successful', received_rand = 200, decided_at = now() where id = %L $q$, q1)), 'wallet_topups_state') || ' '
    || pg_temp.has(pg_temp.try(format($q$ update public.wallet_topups set status = 'unsuccessful', decided_at = now() where id = %L $q$, q1)), 'wallet_topups_state'), 'yes yes');

  -- ---- proof of payment: the private bucket ------------------------------------------------------------------------------------------------
  p1 := v_l::text || '/' || q1::text || '.pdf';
  p2 := v_l::text || '/' || q2::text || '.png';
  r := r || pg_temp.chk('P01', 'the bucket is private, 5 MB, PDF/JPG/PNG', (select public::text || ' ' || file_size_limit || ' ' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'payment-proofs'), 'false 5242880 application/pdf,image/jpeg,image/png');
  t := pg_temp.run_as(v_l, format($q$ with i as (insert into storage.objects (bucket_id, name) values ('payment-proofs', %L) returning 1) select count(*)::text from i $q$, p1));
  r := r || pg_temp.chk('P02', 'a payer can upload a proof for their own top-up that waits for proof', t, '1');
  t := pg_temp.has(pg_temp.run_as(v_o, format($q$ with i as (insert into storage.objects (bucket_id, name) values ('payment-proofs', %L) returning 1) select count(*)::text from i $q$, v_l::text || '/' || q2::text || '.png')), 'row-level security');
  t2 := pg_temp.has(pg_temp.run_as(v_l, format($q$ with i as (insert into storage.objects (bucket_id, name) values ('payment-proofs', %L) returning 1) select count(*)::text from i $q$, v_l::text || '/' || gen_random_uuid()::text || '.pdf')), 'row-level security');
  t3 := pg_temp.has(pg_temp.run_as(v_l, format($q$ with i as (insert into storage.objects (bucket_id, name) values ('payment-proofs', %L) returning 1) select count(*)::text from i $q$, v_l::text || '/' || q2::text || '.exe')), 'row-level security')
        || ' ' || pg_temp.has(pg_temp.run_as(v_l, format($q$ with i as (insert into storage.objects (bucket_id, name) values ('payment-proofs', %L) returning 1) select count(*)::text from i $q$, v_l::text || '/' || (select id from wallet_topups where profile_id = v_o limit 1)::text || '.pdf')), 'row-level security');
  r := r || pg_temp.chk('P03', 'refused: another person''s folder, a top-up that does not exist, a wrong file type, someone else''s top-up', t || ' ' || t2 || ' ' || t3, 'yes yes yes yes');
  r := r || pg_temp.chk('P04', 'before logging: the payer reads their own file, another learner, a support agent and a finance admin see none',
    pg_temp.run_as(v_l, $q$ select count(*)::text from storage.objects where bucket_id = 'payment-proofs' $q$) || ' ' || pg_temp.run_as(v_o, $q$ select count(*)::text from storage.objects where bucket_id = 'payment-proofs' $q$) || ' '
    || pg_temp.run_as(a_spt, $q$ select count(*)::text from storage.objects where bucket_id = 'payment-proofs' $q$) || ' ' || pg_temp.run_as(a_fin, $q$ select count(*)::text from storage.objects where bucket_id = 'payment-proofs' $q$), '1 0 0 0');
  t := pg_temp.run_as(v_l, format($q$ select public.attach_topup_proof(%L, %L)::text $q$, q2, p2));
  t2 := pg_temp.run_as(v_l, format($q$ select public.attach_topup_proof(%L, %L)::text $q$, q1, v_o::text || '/' || q1::text || '.pdf'));
  r := r || pg_temp.chk('P05', 'attaching is refused when the file is not in storage, or the path is not the payer''s own', pg_temp.has(t, 'not found') || ' ' || pg_temp.has(t2, 'must be stored under'), 'yes yes');
  t := pg_temp.run_as(v_o, format($q$ select public.attach_topup_proof(%L, %L)::text $q$, q1, p1));
  r := r || pg_temp.chk('P06', 'someone else cannot attach a proof to another''s top-up', pg_temp.has(t, 'No such top-up'), 'yes');
  t := pg_temp.run_as(v_l, format($q$ select public.attach_topup_proof(%L, %L)::text $q$, q1, p1));
  select status || ' ' || (proof_path = p1) into t2 from wallet_topups where id = q1;
  r := r || pg_temp.chk('P07', 'attaching moves the top-up to proof_sent', case when t = '' then 'attached' else t end || ' ' || t2, 'attached proof_sent true');
  r := r || pg_temp.chk('P08', 'the finance admins are told (finance, super), the support agent and the switched-off admin are not', pg_temp.nn(a_fin, 'wallet_proof_waiting') || ' ' || pg_temp.nn(a_sup, 'wallet_proof_waiting') || ' '
    || pg_temp.nn(a_spt, 'wallet_proof_waiting') || ' ' || pg_temp.nn(a_off, 'wallet_proof_waiting'), '1 1 0 0');
  t := pg_temp.run_as(v_l, format($q$ select public.attach_topup_proof(%L, %L)::text $q$, q1, p1));
  r := r || pg_temp.chk('P09', 'a second proof for the same top-up is refused', pg_temp.has(t, 'already has its proof'), 'yes');
  -- (Supabase refuses a direct DELETE on its storage table, so the removal rule is proved through the function the delete policy uses)
  r := r || pg_temp.chk('P10', 'the rule that lets a payer remove an unattached proof (a retry): allowed while the top-up waits for proof, refused once attached; the delete policy exists',
    pg_temp.run_as(v_l, format($q$ select public.wallet_may_upload_proof(%L)::text $q$, p1)) || ' ' || pg_temp.run_as(v_l, format($q$ select public.wallet_may_upload_proof(%L)::text $q$, p2)) || ' '
    || (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Payment proofs: payer removes an unattached file'), 'false true 1');
  t := pg_temp.has(pg_temp.run_as(a_spt, format($q$ select public.log_document_access('payment-proofs', %L)::text $q$, p1)), 'Finance admins only');
  t2 := pg_temp.has(pg_temp.run_as(a_off, format($q$ select public.log_document_access('payment-proofs', %L)::text $q$, p1)), 'Admins only');
  r := r || pg_temp.chk('P11', 'a support agent and a switched-off finance admin cannot get an access line for a proof', t || ' ' || t2, 'yes yes');
  t := pg_temp.run_as(a_fin, format($q$ select public.log_document_access('payment-proofs', %L)::text $q$, p1));
  select bucket || ' ' || (subject_id = v_l) || ' ' || document_type || ' ' || (admin_id = a_fin) into t2 from document_access_log where document_path = p1;
  r := r || pg_temp.chk('P12', 'the finance admin''s opening is logged: bucket, whose, type, who', t2, 'payment-proofs true payment_proof true');
  r := r || pg_temp.chk('P13', 'with a fresh line the finance admin reads it; the support agent and the other learner still cannot',
    pg_temp.run_as(a_fin, $q$ select count(*)::text from storage.objects where bucket_id = 'payment-proofs' $q$) || ' ' || pg_temp.run_as(a_spt, $q$ select count(*)::text from storage.objects where bucket_id = 'payment-proofs' $q$) || ' '
    || pg_temp.run_as(v_o, $q$ select count(*)::text from storage.objects where bucket_id = 'payment-proofs' $q$), '1 0 0');
  alter table public.document_access_log disable trigger document_access_log_no_change;
  update public.document_access_log set created_at = created_at - interval '6 minutes' where document_path = p1;
  alter table public.document_access_log enable trigger document_access_log_no_change;
  r := r || pg_temp.chk('P14', 'six minutes later the same line no longer opens it', pg_temp.run_as(a_fin, $q$ select count(*)::text from storage.objects where bucket_id = 'payment-proofs' $q$), '0');
  t := pg_temp.has(pg_temp.run_as(a_fin, $q$ select public.log_document_access('nope', 'x/y.pdf')::text $q$), 'Unknown document store');
  insert into storage.objects (bucket_id, name) values ('tutor-documents', v_t::text || '/id.pdf');
  t2 := pg_temp.run_as(a_fin, format($q$ select (public.log_document_access('tutor-documents', %L) is not null)::text $q$, v_t::text || '/id.pdf'));
  select (pg_get_constraintdef(oid) like '%tutor-documents%' and pg_get_constraintdef(oid) like '%school-results%' and pg_get_constraintdef(oid) like '%payment-proofs%')::text into t3
    from pg_constraint where conname = 'document_access_log_bucket_check';
  r := r || pg_temp.chk('P15', 'the access log still refuses unknown stores, still logs the old stores, and its check lists all three buckets', t || ' ' || t2 || ' ' || t3, 'yes true true');
  perform pg_temp.run_as(v_l, format($q$ select public.cancel_my_topup(%L)::text $q$, q3));
  select status into t from wallet_topups where id = q3;
  t2 := pg_temp.run_as(v_l, format($q$ select public.cancel_my_topup(%L)::text $q$, q1));
  t3 := pg_temp.run_as(v_o, format($q$ select public.cancel_my_topup(%L)::text $q$, q2));
  r := r || pg_temp.chk('P16', 'a payer can cancel a top-up still waiting for proof; not one already sent, not someone else''s', t || ' ' || pg_temp.has(t2, 'Only a top-up still waiting') || ' ' || pg_temp.has(t3, 'Only a top-up still waiting'), 'cancelled yes yes');

  -- ---- deciding a top-up ---------------------------------------------------------------------------------------------------------------
  t := pg_temp.has(pg_temp.run_as(a_spt, format($q$ select public.admin_mark_topup_successful(%L, 200)::text $q$, q1)), 'Finance admins only');
  t2 := pg_temp.has(pg_temp.run_as(a_off, format($q$ select public.admin_mark_topup_successful(%L, 200)::text $q$, q1)), 'Finance admins only');
  t3 := pg_temp.has(pg_temp.run_as(v_l, format($q$ select public.admin_mark_topup_successful(%L, 200)::text $q$, q1)), 'Finance admins only') || ' '
        || pg_temp.has(pg_temp.run_as(a_spt, format($q$ select public.admin_mark_topup_unsuccessful(%L, 'no')::text $q$, q1)), 'Finance admins only') || ' '
        || pg_temp.has(pg_temp.run_as(null, format($q$ select public.admin_mark_topup_successful(%L, 200)::text $q$, q1)), 'permission denied');
  r := r || pg_temp.chk('D01', 'support agent, switched-off admin, the payer and a signed-out visitor cannot decide a top-up', t || ' ' || t2 || ' ' || t3, 'yes yes yes yes yes');
  select available_rand, held_rand into a0, h0 from wallets where profile_id = v_l;
  t := pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_successful(%L, 200)::text $q$, q1));
  select available_rand || ' ' || held_rand into t2 from wallets where profile_id = v_l;
  r := r || pg_temp.chk('D02', 'Successful transfer credits exactly the amount received to the payer''s wallet', ((t::jsonb ->> 'already') || ' ' || t2), 'false ' || (a0 + 200) || ' ' || h0);
  select status || ' ' || received_rand || ' ' || (ledger_id is not null) || ' ' || (decided_by = a_fin) into t from wallet_topups where id = q1;
  select count(*) into n from wallet_ledger where idempotency_key = 'topup:' || q1;
  select count(*) into n2 from admin_audit_logs where action::text = 'wallet_topup_successful' and target_entity_id = q1;
  r := r || pg_temp.chk('D03', 'the top-up records the decision; one ledger line; one audit line; the payer is told', t || ' | ' || n || ' ' || n2 || ' ' || pg_temp.nn(v_l, 'wallet_topup_added'), 'successful 200 true true | 1 1 1');
  t := pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_successful(%L, 200)::text $q$, q1));
  t2 := pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_successful(%L, 999)::text $q$, q1));
  select count(*) into n from wallet_ledger where topup_id = q1;
  select available_rand into n2 from wallets where profile_id = v_l;
  select count(*) into n3 from admin_audit_logs where action::text = 'wallet_topup_successful' and target_entity_id = q1;
  r := r || pg_temp.chk('D04', 'a double click or a re-run credits nothing more: same answer, one line, same balance, one audit line, one message', ((t::jsonb ->> 'already') || ' ' || (t2::jsonb ->> 'already') || ' ' || (t2::jsonb ->> 'received_rand')
    || ' ' || n || ' ' || n2 || ' ' || n3 || ' ' || pg_temp.nn(v_l, 'wallet_topup_added')), 'true true 200 1 ' || (a0 + 200) || ' 1 1');
  t := pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_unsuccessful(%L, 'Changed my mind')::text $q$, q1));
  r := r || pg_temp.chk('D05', 'a top-up credited cannot then be marked unsuccessful', pg_temp.has(t, 'already decided'), 'yes');
  insert into wallet_topups (profile_id, reference, amount_rand, status, proof_path) values (v_o, 'TL-XDEFF2', 300, 'proof_sent', 'x/y.pdf') returning id into qd;
  insert into wallet_topups (profile_id, reference, amount_rand) values (v_o, 'TL-XBAD22', 100) returning id into qb;
  insert into wallet_topups (profile_id, reference, amount_rand) values (v_o, 'TL-XUNS22', 100) returning id into qu;
  t := pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_successful(%L, 250)::text $q$, qd)), 'comment is needed');
  t2 := pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_successful(%L, 250, 'ab')::text $q$, qd)), 'comment is needed');
  select count(*) into n from wallet_ledger where topup_id = qd;
  r := r || pg_temp.chk('D06', 'an amount received that differs from the claim needs a real comment; nothing is credited without it', t || ' ' || t2 || ' ' || n, 'yes yes 0');
  t := pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_successful(%L, 250, 'The bank took a fee')::text $q$, qd));
  select status || ' ' || received_rand || ' ' || decision_comment into t2 from wallet_topups where id = qd;
  r := r || pg_temp.chk('D07', 'with a comment the amount received (not the claim) is credited and the learner is told both numbers', (t::jsonb ->> 'received_rand') || ' | ' || t2 || ' | ' || (select available_rand from wallets where profile_id = v_o)::text || ' | '
    || (select count(*) from notifications where profile_id = v_o and type = 'wallet_topup_added' and body like '%You said R300; we received R250.%'), '250 | successful 250 The bank took a fee | 250 | 1');
  r := r || pg_temp.chk('D08', 'received 0, negative or above R100 000 is refused', pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_successful(%L, 0, 'x')::text $q$, qb)), 'Say the amount received') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_successful(%L, -5, 'x')::text $q$, qb)), 'Say the amount received') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_successful(%L, 100001, 'a long comment')::text $q$, qb)), 'Say the amount received'), 'yes yes yes');
  t := pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_unsuccessful(%L, '')::text $q$, qu)), 'Write a comment');
  t2 := pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_unsuccessful(%L, 'ab')::text $q$, qu)), 'Write a comment');
  select available_rand into n from wallets where profile_id = v_o;
  t3 := pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_unsuccessful(%L, 'No money arrived in our account')::text $q$, qu));
  select available_rand into n2 from wallets where profile_id = v_o;
  select count(*) into n3 from wallet_ledger where topup_id = qu;
  r := r || pg_temp.chk('D09', 'Unsuccessful needs a comment, credits nothing, leaves no ledger line', t || ' ' || t2 || ' ' || (t3::jsonb ->> 'status') || ' ' || (n2 - n) || ' ' || n3, 'yes yes unsuccessful 0 0');
  r := r || pg_temp.chk('D10', 'the learner is told and can read the comment on their own top-up', pg_temp.nn(v_o, 'wallet_topup_not_received') || ' ' || pg_temp.run_as(v_o, format($q$ select decision_comment from public.wallet_topups where id = %L $q$, qu)), '1 No money arrived in our account');
  t := pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_successful(%L, 100)::text $q$, qu)), 'already decided');
  t2 := pg_temp.run_as(a_fin, format($q$ select public.admin_mark_topup_unsuccessful(%L, 'again')::text $q$, qu));
  r := r || pg_temp.chk('D11', 'an unsuccessful top-up cannot be credited later; marking it again is a harmless repeat', t || ' ' || (t2::jsonb ->> 'already') || ' ' || pg_temp.nn(v_o, 'wallet_topup_not_received'), 'yes true 1');
  select count(*) into n from admin_audit_logs where action::text = 'wallet_topup_unsuccessful' and target_entity_id = qu;
  r := r || pg_temp.chk('D12', 'one audit line for the unsuccessful decision', n::text, '1');
  insert into wallet_topups (profile_id, reference, amount_rand) values (v_c, 'TL-XCARD2', 120) returning id into qc;
  t := pg_temp.has(pg_temp.run_as(v_l, format($q$ select public.wallet_credit_topup(%L, 120, null, null)::text $q$, qc)), 'permission denied');
  t2 := pg_temp.run_svc(format($q$ select public.wallet_credit_topup(%L, 120, null, null)::text $q$, qc));
  select available_rand into n from wallets where profile_id = v_c;
  r := r || pg_temp.chk('D13', 'the door: a browser role is refused; the server role (a future card top-up) credits it, with no admin involved', t || ' ' || (t2::jsonb ->> 'already') || ' ' || n, 'yes false 120');
  r := r || pg_temp.chk('D14', 'who sees which top-ups: the payer only their own, the support agent none, the finance admin all',
    pg_temp.run_as(v_l, format($q$ select count(*)::text from public.wallet_topups where profile_id <> %L $q$, v_l)) || ' ' || pg_temp.run_as(a_spt, $q$ select count(*)::text from public.wallet_topups $q$) || ' '
    || pg_temp.run_as(a_fin, format($q$ select (count(*) >= 15)::text from public.wallet_topups $q$)), '0 0 true');
  r := r || pg_temp.chk('D15', 'the wallets and the ledger follow the same rows', pg_temp.run_as(v_o, format($q$ select count(*)::text from public.wallets where profile_id <> %L $q$, v_o)) || ' ' || pg_temp.run_as(a_spt, $q$ select count(*)::text from public.wallet_ledger $q$) || ' '
    || pg_temp.run_as(a_fin, $q$ select (count(*) >= 5)::text from public.wallet_ledger $q$), '0 0 true');

  -- ---- tutors: bank details and payouts ------------------------------------------------------------------------------------------------
  t := pg_temp.has(pg_temp.run_as(v_l, $q$ select public.save_my_bank_details('FNB', '62123456789', '250655', 'J Smith')::text $q$), 'Only a tutor');
  t2 := pg_temp.has(pg_temp.run_as(v_t, $q$ select public.save_my_bank_details('FNB', '62123456789', '25065', 'J Smith')::text $q$), 'branch code');
  t3 := pg_temp.has(pg_temp.run_as(v_t, $q$ select public.save_my_bank_details('FNB', 'ABC123456', '250655', 'J Smith')::text $q$), 'account number')
        || ' ' || pg_temp.has(pg_temp.run_as(v_t, $q$ select public.save_my_bank_details('', '62123456789', '250655', 'J Smith')::text $q$), 'Choose your bank');
  r := r || pg_temp.chk('B01', 'bank details: a learner is refused; bad branch code, letters in the number and no bank are refused', t || ' ' || t2 || ' ' || t3, 'yes yes yes yes');
  perform pg_temp.run_as(v_t, $q$ select public.save_my_bank_details('FNB', '62-1234 5678 9', '250 655', ' J Smith ')::text $q$);
  select account_number || ' ' || account_last4 || ' ' || branch_code || ' ' || account_holder into t from tutor_bank_details where tutor_id = v_t;
  r := r || pg_temp.chk('B02', 'spaces and dashes are stripped, the last four are kept', t, '62123456789 6789 250655 J Smith');
  r := r || pg_temp.chk('B03', 'through the API: the tutor reads last four, not the full number (nor select *); another tutor sees none; the finance admin sees last four only',
    pg_temp.run_as(v_t, 'select account_last4 from public.tutor_bank_details') || ' ' || pg_temp.has(pg_temp.run_as(v_t, 'select account_number from public.tutor_bank_details'), 'permission denied') || ' '
    || pg_temp.has(pg_temp.run_as(v_t, 'select count(*)::text from (select * from public.tutor_bank_details) x'), 'permission denied') || ' '
    || pg_temp.run_as(v_t2, 'select count(*)::text from public.tutor_bank_details') || ' ' || pg_temp.run_as(a_fin, 'select account_last4 from public.tutor_bank_details') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, 'select account_number from public.tutor_bank_details'), 'permission denied'), '6789 yes yes 0 6789 yes');
  t := pg_temp.has(pg_temp.run_as(v_t, 'select public.request_my_payout()::text'), 'nothing to pay out');
  t2 := pg_temp.has(pg_temp.run_as(v_t2, 'select public.request_my_payout()::text'), 'Add your bank details first');
  t3 := pg_temp.has(pg_temp.run_as(v_l, 'select public.request_my_payout()::text'), 'Only a tutor');
  r := r || pg_temp.chk('B04', 'a payout is refused with nothing to pay, with no bank details, and for a non-tutor', t || ' ' || t2 || ' ' || t3, 'yes yes yes');
  perform public.wallet_post(v_t, 'session_credit', 360, 0, 'credit:' || s_a, null, null, null, s_a, null, null);
  perform public.wallet_post(v_t, 'session_credit', 280, 0, 'credit:' || s_b, null, null, null, s_b, null, null);
  select updated_at into ts from tutor_bank_details where tutor_id = v_t;
  t := pg_temp.run_as(v_t, 'select public.request_my_payout()::text');
  po1 := (t::jsonb ->> 'payout_id')::uuid;
  select available_rand || ' ' || held_rand into t2 from wallets where profile_id = v_t;
  r := r || pg_temp.chk('B05', 'Transact: the whole available R640 moves to on hold', (t::jsonb ->> 'amount_rand') || ' ' || t2, '640 0 640');
  select status || ' ' || amount_rand || ' ' || account_last4 || ' ' || cardinality(session_ids) || ' ' || (session_ids @> array[s_a, s_b]) || ' ' || (bank_details_changed_at = ts) into t from payout_requests where id = po1;
  select count(*) into n from wallet_ledger where idempotency_key = 'payhold:' || po1 and payout_id = po1 and kind = 'payout_hold';
  r := r || pg_temp.chk('B06', 'the request copies the bank details, lists the two sessions credited, notes when the details last changed; one hold line', t || ' | ' || n, 'requested 640 6789 2 true true | 1');
  r := r || pg_temp.chk('B07', 'the finance admins and the tutor are told; the support agent is not', pg_temp.nn(a_fin, 'wallet_payout_requested') || ' ' || pg_temp.nn(a_sup, 'wallet_payout_requested') || ' ' || pg_temp.nn(a_spt, 'wallet_payout_requested') || ' '
    || pg_temp.nn(v_t, 'wallet_payout_requested'), '1 1 0 1');
  t := pg_temp.has(pg_temp.run_as(v_t, 'select public.request_my_payout()::text'), 'already have a payout request waiting');
  t2 := pg_temp.has(pg_temp.run_as(v_t, $q$ select public.save_my_bank_details('FNB', '62123456789', '250655', 'J Smith')::text $q$), 'payout request waiting');
  r := r || pg_temp.chk('B08', 'one open request at a time, and the bank details are locked while it is open', t || ' ' || t2, 'yes yes');
  update tutor_bank_details set account_number = '99999999999', updated_at = now() + interval '1 hour' where tutor_id = v_t;
  select account_last4 || ' ' || (bank_details_changed_at = ts) into t from payout_requests where id = po1;
  r := r || pg_temp.chk('B09', 'changing the details later cannot redirect the open request', t, '6789 true');
  update tutor_bank_details set account_number = '62123456789', updated_at = ts where tutor_id = v_t;
  t := pg_temp.run_as(a_fin, format($q$ select (public.admin_open_bank_details(%L) ->> 'account_number') $q$, po1));
  perform pg_temp.run_as(a_fin, format($q$ select public.admin_open_bank_details(%L)::text $q$, po1));
  select count(*) into n from admin_audit_logs where action::text = 'wallet_bank_details_opened' and target_entity_id = po1;
  r := r || pg_temp.chk('B10', 'the finance admin opens the full number; every opening writes an audit line (two openings, two lines)', t || ' ' || n, '62123456789 2');
  t := pg_temp.has(pg_temp.run_as(a_spt, format($q$ select public.admin_open_bank_details(%L)::text $q$, po1)), 'Finance admins only');
  t2 := pg_temp.has(pg_temp.run_as(v_t, format($q$ select public.admin_open_bank_details(%L)::text $q$, po1)), 'Finance admins only');
  r := r || pg_temp.chk('B11', 'a support agent and the tutor themselves cannot open the full number', t || ' ' || t2, 'yes yes');
  r := r || pg_temp.chk('B12', 'the tutor reads their own request (last four only); another tutor sees none',
    pg_temp.run_as(v_t, format($q$ select status || ' ' || amount_rand || ' ' || account_last4 from public.payout_requests where id = %L $q$, po1)) || ' ' || pg_temp.has(pg_temp.run_as(v_t, 'select account_number from public.payout_requests'), 'permission denied') || ' '
    || pg_temp.run_as(v_t2, 'select count(*)::text from public.payout_requests'), 'requested 640 6789 yes 0');
  t := pg_temp.has(pg_temp.run_as(a_spt, format($q$ select public.admin_mark_payout_paid(%L)::text $q$, po1)), 'Finance admins only');
  t2 := pg_temp.run_as(a_fin, format($q$ select public.admin_mark_payout_paid(%L, 'FNB ref 123')::text $q$, po1));
  select available_rand || ' ' || held_rand into t3 from wallets where profile_id = v_t;
  r := r || pg_temp.chk('B13', 'Mark paid: refused for support; for finance the on-hold R640 is gone and the wallet is empty', t || ' ' || (t2::jsonb ->> 'status') || ' ' || t3, 'yes paid 0 0');
  select status || ' ' || (paid_on = (now() at time zone 'Africa/Johannesburg')::date) || ' ' || bank_reference || ' ' || (decided_by = a_fin) into t from payout_requests where id = po1;
  select count(*) into n from wallet_ledger where payout_id = po1;
  select count(*) into n2 from admin_audit_logs where action::text = 'wallet_payout_paid' and target_entity_id = po1;
  r := r || pg_temp.chk('B14', 'the request is marked paid with today''s date (SAST) and the bank reference; two ledger lines (hold, paid); one audit line; the tutor is told',
    t || ' | ' || n || ' ' || n2 || ' ' || pg_temp.nn(v_t, 'wallet_payout_paid'), 'paid true FNB ref 123 true | 2 1 1');
  t := pg_temp.run_as(a_fin, format($q$ select public.admin_mark_payout_paid(%L)::text $q$, po1));
  select count(*) into n from wallet_ledger where payout_id = po1;
  select held_rand into n2 from wallets where profile_id = v_t;
  r := r || pg_temp.chk('B15', 'paying twice pays once: same answer, no new line, nothing taken again; Cannot pay after paid is refused', (t::jsonb ->> 'already') || ' ' || n || ' ' || n2 || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_payout_cannot_pay(%L, 'too late')::text $q$, po1)), 'already paid'), 'true 2 0 yes');
  perform public.wallet_post(v_t, 'session_credit', 300, 0, 'credit:' || s_c, null, null, null, s_c, null, null);
  po2 := (pg_temp.run_as(v_t, 'select public.request_my_payout()::text')::jsonb ->> 'payout_id')::uuid;
  select cardinality(session_ids) || ' ' || (session_ids = array[s_c]) into t from payout_requests where id = po2;
  r := r || pg_temp.chk('B16', 'after a paid request the tutor can ask again; the new request lists only the session not yet covered', t, '1 true');
  t := pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_payout_cannot_pay(%L, '')::text $q$, po2)), 'Write a comment');
  t2 := pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_payout_cannot_pay(%L, 'ab')::text $q$, po2)), 'Write a comment');
  t3 := pg_temp.run_as(a_fin, format($q$ select public.admin_mark_payout_cannot_pay(%L, 'The bank rejected the account')::text $q$, po2));
  select available_rand || ' ' || held_rand into u1 from wallets where profile_id = v_t;
  select status || ' ' || decision_comment into u2 from payout_requests where id = po2;
  r := r || pg_temp.chk('B17', 'Cannot pay needs a comment, and returns the money to the tutor''s available balance', t || ' ' || t2 || ' ' || (t3::jsonb ->> 'status') || ' ' || u1 || ' | ' || u2, 'yes yes could_not_pay 300 0 | could_not_pay The bank rejected the account');
  select count(*) into n from wallet_ledger where payout_id = po2;
  select count(*) into n2 from admin_audit_logs where action::text = 'wallet_payout_cannot_pay' and target_entity_id = po2;
  r := r || pg_temp.chk('B18', 'two ledger lines (hold, release), one audit line, the tutor told with the reason; paying it afterwards is refused; repeating Cannot pay is harmless',
    n || ' ' || n2 || ' ' || (select count(*) from notifications where profile_id = v_t and type = 'wallet_payout_failed' and body like '%The bank rejected the account%') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_mark_payout_paid(%L)::text $q$, po2)), 'already returned') || ' '
    || (pg_temp.run_as(a_fin, format($q$ select public.admin_mark_payout_cannot_pay(%L, 'again')::text $q$, po2))::jsonb ->> 'already'), '2 1 1 yes true');
  po3 := (pg_temp.run_as(v_t, 'select public.request_my_payout()::text')::jsonb ->> 'payout_id')::uuid;
  r := r || pg_temp.chk('B19', 'after a returned request the tutor can ask again (the session is listed again)', (select amount_rand || ' ' || (session_ids = array[s_c]) from payout_requests where id = po3), '300 true');

  -- ---- adjustments by hand -----------------------------------------------------------------------------------------------------------
  select available_rand into a0 from wallets where profile_id = v_c;
  id1 := gen_random_uuid();
  t := pg_temp.has(pg_temp.run_as(a_fin, format($q$ select public.admin_adjust_wallet(%L, 50, 'goodwill credit', %L)::text $q$, v_c, id1)), 'Super admins only');
  t2 := pg_temp.run_as(a_sup, format($q$ select public.admin_adjust_wallet(%L, 50, 'goodwill credit', %L)::text $q$, v_c, id1));
  t3 := pg_temp.run_as(a_sup, format($q$ select public.admin_adjust_wallet(%L, 50, 'goodwill credit', %L)::text $q$, v_c, id1));
  select available_rand into n from wallets where profile_id = v_c;
  select count(*) into n2 from admin_audit_logs where action::text = 'wallet_adjusted' and target_entity_id = v_c;
  r := r || pg_temp.chk('A01', 'only a super admin adjusts; the same click twice (same key) adjusts once, one audit line, the person is told',
    t || ' ' || (t2::jsonb ->> 'already') || ' ' || (t3::jsonb ->> 'already') || ' ' || (n - a0) || ' ' || n2 || ' ' || pg_temp.nn(v_c, 'wallet_adjusted'), 'yes false true 50 1 1');
  select kind || ' ' || note || ' ' || (actor_id = a_sup) into t from wallet_ledger where idempotency_key = 'adjust:' || id1;
  r := r || pg_temp.chk('A02', 'the adjustment is its own ledger line with the reason and who', t, 'adjustment goodwill credit true');
  t := pg_temp.has(pg_temp.run_as(a_sup, format($q$ select public.admin_adjust_wallet(%L, -1000, 'take back', %L)::text $q$, v_c, gen_random_uuid())), 'never takes it below zero');
  t2 := pg_temp.has(pg_temp.run_as(a_sup, format($q$ select public.admin_adjust_wallet(%L, 10, '', %L)::text $q$, v_c, gen_random_uuid())), 'written reason');
  t3 := pg_temp.has(pg_temp.run_as(a_sup, format($q$ select public.admin_adjust_wallet(%L, 0, 'nothing here', %L)::text $q$, v_c, gen_random_uuid())), 'not 0');
  r := r || pg_temp.chk('A03', 'an adjustment below zero, with no reason, or of 0 is refused', t || ' ' || t2 || ' ' || t3, 'yes yes yes');

  -- ---- totals and the balance check ----------------------------------------------------------------------------------------------------
  t := pg_temp.run_as(a_fin, 'select public.wallet_totals()::text');
  select coalesce(sum(available_rand + held_rand), 0) into n from wallets;
  select count(*) into n2 from payout_requests where status = 'requested';
  r := r || pg_temp.chk('C01', 'wallet_totals: the total is what is in the wallets; open payouts counted', (t::jsonb ->> 'total_rand') || ' ' || (t::jsonb ->> 'payouts_requested') || ' ' || (t::jsonb ->> 'payouts_requested_rand'), n || ' ' || n2 || ' 300');
  r := r || pg_temp.chk('C02', 'wallet_totals and the on-demand check are refused to a support agent and a tutor', pg_temp.has(pg_temp.run_as(a_spt, 'select public.wallet_totals()::text'), 'Finance admins only') || ' '
    || pg_temp.has(pg_temp.run_as(v_t, 'select public.admin_wallet_balance_check()::text'), 'Finance admins only'), 'yes yes');
  r := r || pg_temp.chk('C03', 'conservation: the sum of every ledger line equals the sum of every wallet',
    ((select coalesce(sum(available_delta + held_delta), 0) from wallet_ledger) = (select coalesce(sum(available_rand + held_rand), 0) from wallets))::text, 'true');
  t := pg_temp.run_as(a_fin, 'select public.admin_wallet_balance_check()::text');
  r := r || pg_temp.chk('C04', 'the balance check on a clean database finds nothing wrong', (t::jsonb ->> 'mismatch_count') || ' ' || ((t::jsonb ->> 'checked')::int >= 5), '0 true');
  perform public.wallet_balance_check_job();
  r := r || pg_temp.chk('C05', 'a clean daily check sends no alert', (pg_temp.nn(a_fin, 'wallet_mismatch') + pg_temp.nn(a_sup, 'wallet_mismatch'))::text, '0');
  -- damage a wallet on purpose (the guard is switched off just for this, then back on)
  alter table public.wallets disable trigger wallets_guard_row;
  update public.wallets set available_rand = available_rand + 7 where profile_id = v_c;
  t3 := pg_temp.has(pg_temp.try(format($q$ update public.wallets set available_rand = -1 where profile_id = %L $q$, v_c)), 'violates check constraint');
  alter table public.wallets enable trigger wallets_guard_row;
  t := pg_temp.run_as(a_fin, 'select public.admin_wallet_balance_check()::text');
  r := r || pg_temp.chk('C06', 'a deliberately damaged wallet (R7 too much) is found, named, with the difference; a negative balance is refused by the table itself',
    (t::jsonb ->> 'mismatch_count') || ' ' || ((t::jsonb -> 'mismatches' -> 0 ->> 'profile_id') = v_c::text) || ' ' || (((t::jsonb -> 'mismatches' -> 0 ->> 'stored_available')::int) - ((t::jsonb -> 'mismatches' -> 0 ->> 'ledger_available')::int)) || ' ' || t3, '1 true 7 yes');
  perform public.wallet_balance_check_job();
  r := r || pg_temp.chk('C07', 'the daily check alerts the finance admins about it (finance, super) and not the support agent', pg_temp.nn(a_fin, 'wallet_mismatch') || ' ' || pg_temp.nn(a_sup, 'wallet_mismatch') || ' ' || pg_temp.nn(a_spt, 'wallet_mismatch'), '1 1 0');
  alter table public.wallets disable trigger wallets_guard_row;
  update public.wallets set available_rand = available_rand - 7 where profile_id = v_c;
  alter table public.wallets enable trigger wallets_guard_row;
  alter table public.wallet_ledger disable trigger wallet_ledger_no_change;
  update public.wallet_ledger set available_after = available_after + 3 where idempotency_key = 'adjust:' || id1;
  alter table public.wallet_ledger enable trigger wallet_ledger_no_change;
  t := pg_temp.run_as(a_fin, 'select public.admin_wallet_balance_check()::text');
  r := r || pg_temp.chk('C08', 'a damaged ledger snapshot (a broken chain) is found too', (t::jsonb ->> 'mismatch_count') || ' ' || ((t::jsonb -> 'mismatches' -> 0 ->> 'broken_links')::int >= 1), '1 true');
  alter table public.wallet_ledger disable trigger wallet_ledger_no_change;
  update public.wallet_ledger set available_after = available_after - 3 where idempotency_key = 'adjust:' || id1;
  alter table public.wallet_ledger enable trigger wallet_ledger_no_change;
  r := r || pg_temp.chk('C09', 'repaired: the check is clean again', (public.wallet_check_balances() ->> 'mismatch_count'), '0');

  -- ---- stale top-ups and the schedule --------------------------------------------------------------------------------------------------
  insert into wallet_topups (profile_id, reference, amount_rand, created_at) values (v_l, 'TL-XSTA22', 100, now() - interval '8 days') returning id into qs1;
  insert into wallet_topups (profile_id, reference, amount_rand) values (v_l, 'TL-XSTA23', 100) returning id into qs2;
  insert into wallet_topups (profile_id, reference, amount_rand, status, proof_path, created_at) values (v_l, 'TL-XSTA24', 100, 'proof_sent', 'x/y.pdf', now() - interval '8 days') returning id into qs3;
  n := public.wallet_cancel_stale_topups();
  r := r || pg_temp.chk('C10', 'the daily job cancels only the top-up that waited over 7 days for proof; a recent one and one with a proof stay; the owner is told',
    n || ' ' || (select status from wallet_topups where id = qs1) || ' ' || (select status from wallet_topups where id = qs2) || ' ' || (select status from wallet_topups where id = qs3) || ' ' || pg_temp.nn(v_l, 'wallet_topup_cancelled'),
    '1 cancelled awaiting_proof proof_sent 1');
  select count(*) into n from pg_extension where extname = 'pg_cron';
  if n > 0 then
    select string_agg(jobname, ',' order by jobname) into t from cron.job where jobname in ('wallet-balance-check', 'wallet-stale-topups');
  else
    t := 'no pg_cron here';
  end if;
  r := r || pg_temp.chk('C11', 'the two daily jobs are scheduled', t, case when n > 0 then 'wallet-balance-check,wallet-stale-topups' else 'no pg_cron here' end);
  select count(*) into n from wallet_ledger where kind not in ('topup', 'hold', 'release', 'charge', 'refund', 'session_credit', 'payout_hold', 'payout_paid', 'payout_release', 'adjustment');
  r := r || pg_temp.chk('C12', 'every ledger line is of a known kind', n::text, '0');

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool cuts the middle of a long error, so each report line is shortened to its id and its value (the part after the
  -- first ": "; a FAIL or STOPPED line stays whole). The FAIL count counts whole lines.
  select count(*) filter (where l like '%FAIL%' or l like 'STOPPED%'), count(*) filter (where l <> '')
    into nfail, nlines from regexp_split_to_table(r, E'\n') as l;
  select string_agg(case when l like '%FAIL%' or l like 'STOPPED%' then l else regexp_replace(l, '^(\S+) [^:]*: ', E'\\1 ') end, E'\n' order by o)
    into rep from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', format(E'WALLET-CORE TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, nlines, rep), true);
  else
    raise exception E'WALLET-CORE TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, nlines, rep;
  end if;
end $$;
