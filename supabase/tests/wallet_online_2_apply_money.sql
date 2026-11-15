-- WALLET ONLINE TOP-UPS (Ozow phase 1), database suite, chunk 2 of 3: the money rules of wallet_online_apply (the one decision point): a payment credits once and only once, every message that does
-- not match is never credited, the patch to wallet_credit_topup, the Worker's "record an event" door (checks A01 to A34). Read supabase/tests/README.md first.
-- RUN IT AFTER the migration 20261109110000_wallet_online_topups.sql is applied (or in ONE statement with it: node scripts/run-rolled-back-test.mjs <out.sql> <this file> <the migration>).
-- It is ONE statement that makes made-up people (example.invalid), acts as them and as the server's role, and ends with an error on purpose, which rolls back EVERYTHING it made. Nothing is kept.
-- The verdict is the END of the error text: "RESULT chunk 2 of 3: N of 34 checks ran, M FAIL" and then "FAILING: <names>" (or none). The three chunks do not depend on each other.
-- Real data cannot change a count: fixtures are new rows and every count is of those rows, except two things the suite clears first INSIDE the transaction (rolled back with it): any real
-- "rejected" events and "wallet_online_rejected" notices of the last hour, so the hourly cap and the one-alert-an-hour rule can be counted.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  p1 uuid := gen_random_uuid();     -- the payer
  p2 uuid := gen_random_uuid();     -- a second parent
  a_fin uuid := gen_random_uuid();  -- finance_manager
  a_sup uuid := gen_random_uuid();  -- super_admin
  a_spt uuid := gen_random_uuid();  -- support_agent
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; t8 uuid; t9 uuid; t10 uuid; t11 uuid; t12 uuid; t13 uuid; t14 uuid;
  ref text; ref2 text; t text; t2x text; j jsonb; j2 jsonb; n int; n2 int; n3 int; b0 int; nfail int; nlines int; rep text; okids text; failnames text;
begin
  begin   -- everything below; an unexpected error is reported with the lines before it instead of hiding them

  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
    $f$ $mk$;
  execute $mk$
    create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
    declare v text;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
      set local role authenticated;
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
  execute $mk$ create function pg_temp.has(p_res text, p_part text) returns text language sql as $f$
      select case when position(p_part in coalesce(p_res, '')) > 0 then 'yes' else coalesce(p_res, 'null') end $f$ $mk$;
  execute $mk$ create function pg_temp.nn(p_profile uuid, p_type text) returns int language sql as $f$
      select count(*)::int from public.notifications where profile_id = p_profile and type = p_type $f$ $mk$;
  execute $mk$ create function pg_temp.bal(p_profile uuid) returns int language sql as $f$
      select coalesce((select available_rand from public.wallets where profile_id = p_profile), 0) $f$ $mk$;
  execute $mk$ create function pg_temp.person(p_id uuid, p_role text, p_first text, p_dob text) returns void language plpgsql as $f$
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
        (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'o.' || p_id || '@example.invalid',
         jsonb_build_object('role', p_role, 'first_name', p_first, 'date_of_birth', p_dob) || case when p_role = 'parent' then jsonb_build_object('phone_number', '081 234 5678') else '{}'::jsonb end, '{}');
      update public.profiles set date_of_birth = p_dob::date where id = p_id;
    end $f$ $mk$;
  execute $mk$ create function pg_temp.ot(p_profile uuid, p_amount int, p_pay text default null) returns uuid language plpgsql as $f$
    declare v_id uuid;
    begin
      insert into public.wallet_topups (profile_id, method, status, reference, amount_rand)
        values (p_profile, 'online', 'awaiting_payment', 'TL-' || translate(substr(md5(gen_random_uuid()::text), 1, 6), '0123456789abcdef', 'ABCDEFGHJKLMNPQR'), p_amount) returning id into v_id;
      insert into public.wallet_online_attempts (topup_id, provider, expires_at, provider_payment_id, redirect_url)
        values (v_id, 'ozow', date_trunc('second', now() + interval '1 hour'), p_pay, case when p_pay is not null then 'https://pay.example.invalid/' || p_pay end);
      return v_id;
    end $f$ $mk$;
  execute $mk$ create function pg_temp.refof(p_id uuid) returns text language sql as $f$ select reference from public.wallet_topups where id = p_id $f$ $mk$;
  -- the server's call of the one decision point; an error comes back as {"error": ...}
  execute $mk$
    create function pg_temp.ap(p_ref text, p_txn text, p_status text, p_amount text, p_event text default null, p_cur text default 'ZAR', p_site boolean default true,
                               p_test text default 'False', p_allow boolean default false, p_src text default 'webhook', p_reason text default null, p_prov text default 'ozow') returns jsonb language plpgsql as $f$
    declare v text;
    begin
      set local role service_role;
      begin
        execute format('select public.wallet_online_apply(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)::text', p_prov, p_src, p_event, p_ref, p_txn, p_status, p_amount, p_cur, p_site, p_test, p_allow, p_reason) into v;
        reset role;
      exception when others then
        reset role;
        return jsonb_build_object('error', sqlerrm);
      end;
      return v::jsonb;
    end $f$ $mk$;

  -- ---- people and settings ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.person(p1, 'parent', 'Pat', adult);
  perform pg_temp.person(p2, 'parent', 'Quin', adult);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (a_fin, z, 'authenticated', 'authenticated', 'o.a1.' || a_fin || '@example.invalid', '{}'::jsonb, '{}'),
    (a_sup, z, 'authenticated', 'authenticated', 'o.a2.' || a_sup || '@example.invalid', '{}'::jsonb, '{}'),
    (a_spt, z, 'authenticated', 'authenticated', 'o.a3.' || a_spt || '@example.invalid', '{}'::jsonb, '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (a_fin, 'Fin', 'Manager', 'o.a1.' || a_fin || '@example.invalid', '', 'finance_manager', true),
    (a_sup, 'Sup', 'Admin', 'o.a2.' || a_sup || '@example.invalid', '', 'super_admin', true),
    (a_spt, 'Spt', 'Agent', 'o.a3.' || a_spt || '@example.invalid', '', 'support_agent', true);
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_payments_enabled';
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  update system_settings set setting_value = '"on"'::jsonb where setting_key = 'wallet_online_mode';
  r := r || 'S0 setup: 2 parents, 3 admins (finance, super, support); the wallet open; online mode on' || E'\n';

  -- ---- a payment credits once, and only once -----------------------------------------------------------------------------------------------
  t1 := pg_temp.ot(p1, 200, 'pay-a1');
  ref := pg_temp.refof(t1);
  b0 := pg_temp.bal(p1);
  j := pg_temp.ap(ref, 'txn-a1', 'Successful', '200.00', 'evt-a1');
  r := r || pg_temp.chk('A01', 'a full "Successful" message for the right reference, amount (200.00), currency and site credits the top-up', concat_ws(' ', j ->> 'outcome', j ->> 'status'), 'credited successful');
  select concat_ws(' ', tp.status, tp.received_rand, tp.decided_by is null, tp.ledger_id is not null, tp.decision_comment) into t from wallet_topups tp where tp.id = t1;
  r := r || pg_temp.chk('A02', 'the top-up is successful for exactly R200, decided by nobody (the system), with the provider and transaction in the comment', t, 'successful 200 t t Paid online (ozow), transaction txn-a1');
  n := pg_temp.bal(p1);
  select count(*) into n2 from wallet_ledger l where l.topup_id = t1 and l.kind = 'topup' and l.idempotency_key = 'topup:' || t1::text and l.available_delta = 200 and l.actor_id is null;
  select position(ref in body) > 0 into t from notifications where profile_id = p1 and type = 'wallet_topup_added';
  r := r || pg_temp.chk('A03', 'the wallet rose by R200, through one ledger line keyed topup:<id>, and the payer got the usual notice with the reference', concat_ws(' ', n - b0, n2, pg_temp.nn(p1, 'wallet_topup_added'), t), '200 1 1 true');
  select concat_ws(' ', e.outcome, e.source, e.reference = ref, e.provider_txn_id, e.amount_text, e.currency, e.provider_status, e.topup_id = t1) into t from wallet_provider_events e where e.event_id = 'evt-a1';
  r := r || pg_temp.chk('A04', 'the audit row says credited, from the webhook, with ids and status words only', t, 'credited webhook t txn-a1 200.00 ZAR Successful t');
  j := pg_temp.ap(ref, 'txn-a1', 'Successful', '200.00', 'evt-a1');
  r := r || pg_temp.chk('A05', 'the same delivery again (same event id) changes nothing', concat_ws(' ', j ->> 'outcome', (pg_temp.bal(p1) - b0)::text, pg_temp.nn(p1, 'wallet_topup_added')), 'duplicate 200 1');
  j := pg_temp.ap(ref, 'txn-a1', 'Successful', '200.00', 'evt-a1-other');
  n := pg_temp.bal(p1);
  select count(*) into n2 from wallet_ledger l where l.topup_id = t1;
  r := r || pg_temp.chk('A06', 'a different event id for the same transaction credits nothing more', concat_ws(' ', j ->> 'outcome', (n - b0)::text, n2, pg_temp.nn(p1, 'wallet_topup_added')), 'already 200 1 1');
  j := pg_temp.ap(ref, 'txn-a1', 'successful', '200.00', null, 'ZAR', true, null, false, 'status_check');
  select count(*) into n from wallet_provider_events e where e.topup_id = t1 and e.outcome = 'already';
  r := r || pg_temp.chk('A07', 'the status check telling the same fact (status in lower case) credits nothing and does not pile up audit rows', concat_ws(' ', j ->> 'outcome', n), 'already 1');

  -- ---- other messages: nothing is credited -------------------------------------------------------------------------------------------------
  t2 := pg_temp.ot(p1, 100, 'pay-a2');
  ref2 := pg_temp.refof(t2);
  j := pg_temp.ap(lower(ref2), 'txn-a2', 'SUCCESSFUL', '100.00', 'evt-a2');
  r := r || pg_temp.chk('A08', 'a reference in lower case and a status in capitals still credit (compared without case)', concat_ws(' ', j ->> 'outcome', (pg_temp.bal(p1) - b0)::text), 'credited 300');
  t3 := pg_temp.ot(p1, 100, 'pay-a3');
  j := pg_temp.ap(pg_temp.refof(t3), 'txn-a3', 'Pending', '100.00', 'evt-a3p');
  j2 := pg_temp.ap(pg_temp.refof(t3), 'txn-a3', 'Incomplete', null, 'evt-a3i');
  select concat_ws(' ', tp.status, a.last_status) into t from wallet_topups tp join wallet_online_attempts a on a.topup_id = tp.id where tp.id = t3;
  r := r || pg_temp.chk('A09', '"Pending" and "Incomplete" are only recorded: nothing credited, the top-up stays open, no alert to finance',
    concat_ws(' ', j ->> 'outcome', j2 ->> 'outcome', t, pg_temp.nn(a_fin, 'wallet_online_review')), 'ignored ignored awaiting_payment Incomplete 0');
  j := pg_temp.ap(pg_temp.refof(t3), 'txn-a3', 'Error', null, 'evt-a3e', 'ZAR', true, 'False', false, 'webhook', 'Cancelled by the payer');
  select concat_ws(' ', tp.status, a.last_status, a.last_reason) into t from wallet_topups tp join wallet_online_attempts a on a.topup_id = tp.id where tp.id = t3;
  r := r || pg_temp.chk('A10', '"Error" records the reason on the attempt and leaves the top-up open', concat_ws(' ', j ->> 'outcome', t), 'attempt_failed awaiting_payment Error Cancelled by the payer');
  j := pg_temp.ap(pg_temp.refof(t3), 'txn-a3b', 'Successful', '100.00', 'evt-a3s');
  r := r || pg_temp.chk('A11', 'a second transaction after the error can still pay the same top-up', concat_ws(' ', j ->> 'outcome', (pg_temp.bal(p1) - b0)::text), 'credited 400');
  t4 := pg_temp.ot(p1, 100, 'pay-a4');
  j := pg_temp.ap(pg_temp.refof(t4), 'txn-a4', 'Voided', null, 'evt-a4v');
  j2 := pg_temp.ap(pg_temp.refof(t4), 'txn-a4', 'Abandoned', null, 'evt-a4a');
  select tp.status into t from wallet_topups tp where tp.id = t4;
  r := r || pg_temp.chk('A12', 'voided and abandoned transactions pay nothing, leave the top-up open and raise no alert', concat_ws(' ', j ->> 'outcome', j2 ->> 'outcome', t, pg_temp.nn(a_fin, 'wallet_online_review')), 'ignored ignored awaiting_payment 0');
  j := pg_temp.ap(pg_temp.refof(t4), 'txn-a4', 'Refunded', '100.00', 'evt-a4r');
  n := pg_temp.nn(a_fin, 'wallet_online_review');
  n2 := pg_temp.nn(a_sup, 'wallet_online_review');
  n3 := pg_temp.nn(a_spt, 'wallet_online_review');
  r := r || pg_temp.chk('A13', 'a status we do not know ("Refunded") goes to a person: not credited, the finance manager and super admin told once each, the support agent not', concat_ws(' ', j ->> 'outcome', n, n2, n3, (pg_temp.bal(p1) - b0)::text), 'needs_review 1 1 0 400');

  -- ---- the checks on amount, currency, site, test flag, reference ---------------------------------------------------------------------------
  t5 := pg_temp.ot(p1, 200, 'pay-a5');
  ref := pg_temp.refof(t5);
  j := pg_temp.ap(ref, 'txn-a5', 'Successful', '150.00', 'evt-a5a');
  select concat_ws(' ', tp.status, tp.ledger_id is null) into t from wallet_topups tp where tp.id = t5;
  r := r || pg_temp.chk('A14', 'a wrong amount is never credited, says what differs, and leaves the top-up open', concat_ws(' ', j ->> 'outcome', j ->> 'detail', t), 'needs_review Paid R150.00 but the top-up is R200 awaiting_payment t');
  select string_agg(coalesce(pg_temp.ap(ref, 'txn-a5-' || x.i, 'Successful', x.amt, 'evt-a5-' || x.i) ->> 'outcome', 'null'), ' ' order by x.i) into t
    from (values (1, '200'), (2, '200.0'), (3, '2e2'), (4, 'abc'), (5, ''), (6, '-200.00'), (7, '200.000'), (8, ' 20 0.00')) x(i, amt);
  r := r || pg_temp.chk('A15', 'an amount that is not two-decimal digits (200, 200.0, 2e2, abc, empty, negative, three decimals, spaces inside) is refused each time', t, 'needs_review needs_review needs_review needs_review needs_review needs_review needs_review needs_review');
  j := pg_temp.ap(ref, 'txn-a5b', 'Successful', '200.00', 'evt-a5b', 'USD');
  j2 := pg_temp.ap(ref, 'txn-a5c', 'Successful', '200.00', 'evt-a5c', '');
  r := r || pg_temp.chk('A16', 'a currency other than ZAR (or none) is refused', concat_ws(' ', j ->> 'outcome', j ->> 'detail', '|', j2 ->> 'outcome'), 'needs_review The currency is not ZAR (USD) | needs_review');
  j := pg_temp.ap(ref, 'txn-a5d', 'Successful', '200.00', 'evt-a5d', 'ZAR', false);
  j2 := pg_temp.ap(ref, 'txn-a5e', 'Successful', '200.00', 'evt-a5e', 'ZAR', true, 'True', false);
  r := r || pg_temp.chk('A17', 'a site code that is not ours, and a test payment on the live site, are refused', concat_ws(' ', j ->> 'detail', '|', j2 ->> 'detail'), 'The site code does not match ours | A test payment arrived on the live site');
  j := pg_temp.ap(ref, '', 'Successful', '200.00', 'evt-a5f');
  j2 := pg_temp.ap(ref, null, 'Successful', '200.00', 'evt-a5g');
  select tp.status into t from wallet_topups tp where tp.id = t5;
  r := r || pg_temp.chk('A18', 'a missing transaction id is refused; after all those refusals the top-up is still open and unpaid', concat_ws(' ', j ->> 'detail', j2 ->> 'outcome', t, (pg_temp.bal(p1) - b0)::text), 'There is no transaction id needs_review awaiting_payment 400');
  j := pg_temp.ap(ref, 'txn-a5-final', 'Successful', '200.00', 'evt-a5z', 'ZAR', true, 'True', true);
  r := r || pg_temp.chk('A19', 'staging (the Worker says test payments are allowed) credits a test payment, and the right message after all the wrong ones credits once', concat_ws(' ', j ->> 'outcome', (pg_temp.bal(p1) - b0)::text), 'credited 600');
  t6 := pg_temp.ot(p1, 100, 'pay-a6');
  t7 := pg_temp.ot(p2, 100, 'pay-a7');
  insert into wallet_topups (profile_id, method, status, reference, amount_rand) values (p2, 'eft', 'awaiting_proof', 'TL-CCCCC3', 100);
  perform pg_temp.ap(pg_temp.refof(t6), 'txn-a6', 'Successful', '100.00', 'evt-a6');
  j := pg_temp.ap(pg_temp.refof(t7), 'txn-a6', 'Successful', '100.00', 'evt-a7');
  select concat_ws(' ', tp.status, a.provider_txn_id is null) into t from wallet_topups tp join wallet_online_attempts a on a.topup_id = tp.id where tp.id = t7;
  r := r || pg_temp.chk('A20', 'a transaction id already used on another top-up is refused', concat_ws(' ', j ->> 'outcome', j ->> 'detail', t), 'needs_review This transaction is already on another top-up awaiting_payment t');
  j := pg_temp.ap('TL-ZZZZZ9', 'txn-a8', 'Successful', '100.00', 'evt-a8');
  j2 := pg_temp.ap('TL-CCCCC3', 'txn-a9', 'Successful', '100.00', 'evt-a9');
  select count(*) into n from wallet_provider_events e where e.event_id in ('evt-a8', 'evt-a9') and e.topup_id is null and e.outcome = 'needs_review';
  r := r || pg_temp.chk('A21', 'an unknown reference, and the reference of a bank-transfer top-up, find nothing: refused and recorded without a top-up',
    concat_ws(' ', j ->> 'detail', '|', j2 ->> 'detail', '|', n, (select status from wallet_topups where reference = 'TL-CCCCC3')), 'No online top-up has this reference | No online top-up has this reference | 2 awaiting_proof');
  j := pg_temp.ap(pg_temp.refof(t7), 'txn-a10', 'Successful', '100.00', 'evt-a10', 'ZAR', true, 'False', false, 'webhook', null, 'someone-else');
  r := r || pg_temp.chk('A22', 'a message addressed to another provider does not match an Ozow top-up', j ->> 'detail', 'No online top-up has this reference');
  j := pg_temp.ap(pg_temp.refof(t7), 'txn-a7', 'Successful', '100.00', 'evt-a7b', 'ZAR', true, 'False', false, 'bogus');
  j2 := pg_temp.ap(pg_temp.refof(t7), 'txn-a7', 'Successful', '100.00', 'evt-a7c', 'ZAR', true, 'False', false, 'webhook', null, '  ');
  r := r || pg_temp.chk('A23', 'an unknown source and a blank provider are refused outright', concat_ws(' | ', j ->> 'error', j2 ->> 'error'), 'Unknown source | Say which provider');
  -- the same fact told twice with different event ids is recorded and alerted once
  n := pg_temp.nn(a_fin, 'wallet_online_review');
  perform pg_temp.ap('TL-ZZZZZ8', 'txn-a11', 'Successful', '100.00', 'evt-a11a');
  perform pg_temp.ap('TL-ZZZZZ8', 'txn-a11', 'Successful', '100.00', 'evt-a11b');
  select count(*) into n2 from wallet_provider_events e where e.reference = 'TL-ZZZZZ8';
  r := r || pg_temp.chk('A24', 'the same unmatched message arriving twice is one audit row and one alert', concat_ws(' ', n2, pg_temp.nn(a_fin, 'wallet_online_review') - n), '1 1');

  -- ---- paid twice, paid late, switch off, a failing credit --------------------------------------------------------------------------------
  t8 := pg_temp.ot(p2, 300, 'pay-a12');
  ref := pg_temp.refof(t8);
  perform pg_temp.ap(ref, 'txn-b1', 'Successful', '300.00', 'evt-b1');
  b0 := pg_temp.bal(p2);
  j := pg_temp.ap(ref, 'txn-b2', 'Successful', '300.00', 'evt-b2');
  j2 := pg_temp.ap(ref, 'txn-b2', 'successful', '300.00', null, 'ZAR', true, null, false, 'status_check');
  select count(*) into n from wallet_ledger l where l.topup_id = t8;
  select count(*) into n2 from wallet_provider_events e where e.topup_id = t8 and e.outcome = 'needs_review';
  r := r || pg_temp.chk('A25', 'a second successful transaction on a credited top-up (paid twice) credits nothing, is flagged for a refund once, and the status check repeating it adds nothing',
    concat_ws(' ', pg_temp.has(j ->> 'detail', 'Paid twice'), j2 ->> 'outcome', (pg_temp.bal(p2) - b0)::text, n, n2), 'yes needs_review 0 1 1');
  t9 := pg_temp.ot(p2, 100, 'pay-a13');
  update wallet_topups set status = 'cancelled', decision_comment = 'closed early' where id = t9;
  b0 := pg_temp.bal(p2);
  j := pg_temp.ap(pg_temp.refof(t9), 'txn-b3', 'Successful', '100.00', 'evt-b3');
  select tp.status into t from wallet_topups tp where tp.id = t9;
  r := r || pg_temp.chk('A26', 'money for a top-up that was closed too early is not credited by the system: flagged "Late payment" for a person', concat_ws(' ', pg_temp.has(j ->> 'detail', 'Late payment: the top-up was already cancelled'), t, (pg_temp.bal(p2) - b0)::text), 'yes cancelled 0');
  update system_settings set setting_value = '"off"'::jsonb where setting_key = 'wallet_online_mode';
  t10 := pg_temp.ot(p2, 100, 'pay-a14');
  b0 := pg_temp.bal(p2);
  j := pg_temp.ap(pg_temp.refof(t10), 'txn-b4', 'Successful', '100.00', 'evt-b4');
  r := r || pg_temp.chk('A27', 'with the mode off, money already paid is still credited', concat_ws(' ', j ->> 'outcome', (pg_temp.bal(p2) - b0)::text), 'credited 100');
  update system_settings set setting_value = '"on"'::jsonb where setting_key = 'wallet_online_mode';
  t11 := pg_temp.ot(p2, 100001, 'pay-a15');
  j := pg_temp.ap(pg_temp.refof(t11), 'txn-b5', 'Successful', '100001.00', 'evt-b5');
  select concat_ws(' ', tp.status, a.provider_txn_id is null, (select count(*) from wallet_ledger l where l.topup_id = t11)) into t from wallet_topups tp join wallet_online_attempts a on a.topup_id = tp.id where tp.id = t11;
  r := r || pg_temp.chk('A28', 'if the wallet refuses the credit, nothing is half-done: needs_review with the reason, top-up open, no transaction id stored, no ledger line',
    concat_ws(' ', j ->> 'outcome', pg_temp.has(j ->> 'detail', 'The credit failed: Say the amount received'), t), 'needs_review yes awaiting_payment t 0');

  -- ---- the patch to wallet_credit_topup, and the old ways still work -------------------------------------------------------------------------
  t := pg_get_functiondef('public.wallet_credit_topup(uuid, integer, uuid, text)'::regprocedure);
  n := (length(t) - length(replace(t, 'ONLINE TOP-UP (Ozow phase 1', ''))) / length('ONLINE TOP-UP (Ozow phase 1');
  r := r || pg_temp.chk('A29', 'wallet_credit_topup carries the patch exactly once and still holds its old text (the proof statuses, the ledger key, the notice)',
    concat_ws(' ', n, position('awaiting_proof' in t) > 0, position('''topup:'' || t.id' in t) > 0, position('wallet_notify' in t) > 0, position('already decided' in t) > 0), '1 t t t t');
  insert into wallet_topups (profile_id, method, status, reference, amount_rand) values (p2, 'eft', 'awaiting_proof', 'TL-CCCCC4', 100), (p2, 'eft', 'cancelled', 'TL-CCCCC5', 100);
  b0 := pg_temp.bal(p2);
  t13 := (select id from wallet_topups where reference = 'TL-CCCCC4');
  t14 := (select id from wallet_topups where reference = 'TL-CCCCC5');
  t := pg_temp.run_svc(format('select public.wallet_credit_topup(%L, 100, null, null)::text', t13));
  t2x := pg_temp.run_svc(format('select public.wallet_credit_topup(%L, 100, null, null)::text', t14));
  r := r || pg_temp.chk('A30', 'a bank-transfer top-up is credited exactly as before, and a cancelled one is still refused',
    concat_ws(' ', pg_temp.has(t, '"status": "successful"'), (pg_temp.bal(p2) - b0)::text, pg_temp.has(t2x, 'This top-up was already decided (cancelled)')), 'yes 100 yes');
  t12 := pg_temp.ot(p1, 250, 'pay-a16');
  b0 := pg_temp.bal(p1);
  t := pg_temp.run_as(a_fin, format('select public.admin_mark_topup_successful(%L, 250, null)::text', t12));
  n := pg_temp.bal(p1);
  select tp.status into t2x from wallet_topups tp where tp.id = t12;
  j := pg_temp.ap(pg_temp.refof(t12), 'txn-b6', 'Successful', '250.00', 'evt-b6');
  r := r || pg_temp.chk('A31', 'a finance admin can credit a waiting online top-up by hand (R250, once); a later "Successful" message for it is then flagged, not credited again',
    concat_ws(' ', t2x, n - b0, pg_temp.bal(p1) - b0, j ->> 'outcome'), 'successful 250 250 needs_review');
  perform public.wallet_credit_topup(t12, 250, null, null);
  select count(*) into n from wallet_ledger l where l.topup_id = t12;
  r := r || pg_temp.chk('A32', 'the books stay sound: one ledger line for that top-up, and the nightly balance check finds nothing wrong for these wallets',
    concat_ws(' ', n, (select count(*) from jsonb_array_elements(public.wallet_check_balances() -> 'mismatches') m where (m ->> 'profile_id')::uuid in (p1, p2))), '1 0');

  -- ---- the Worker's "record an event" door -------------------------------------------------------------------------------------------------
  delete from wallet_provider_events where outcome = 'rejected' and created_at > now() - interval '1 hour';
  delete from notifications where type = 'wallet_online_rejected' and created_at > now() - interval '1 hour';
  n := 0;
  for i in 1..25 loop
    j := pg_temp.run_svc(format('select public.wallet_online_record_event(%L, %L, %L, %L, %L)::text', 'ozow', 'webhook', 'rej-' || i, 'rejected', 'bad signature'))::jsonb;
    if (j ->> 'recorded')::boolean then n := n + 1; end if;
  end loop;
  r := r || pg_temp.chk('A33', 'rejected deliveries: 25 arrive, 20 are recorded in the hour, and finance is told once (not 25 times)',
    concat_ws(' ', n, (select count(*) from wallet_provider_events where outcome = 'rejected' and event_id like 'rej-%'), pg_temp.nn(a_fin, 'wallet_online_rejected'), pg_temp.nn(a_spt, 'wallet_online_rejected')), '20 20 1 0');
  r := r || pg_temp.chk('A34', 'only rejected, needs_review and ignored can be recorded this way; a "credited" claim and a bad source are refused',
    pg_temp.run_svc(format('select public.wallet_online_record_event(%L, %L, %L, %L, %L)::text', 'ozow', 'webhook', 'x1', 'credited', 'x')) || ' | '
    || pg_temp.run_svc(format('select public.wallet_online_record_event(%L, %L, %L, %L, %L)::text', 'ozow', 'cron', 'x2', 'ignored', 'x')),
    'ERR: That outcome cannot be recorded here | ERR: Unknown source');

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool shows only the START and the END of a long error. So: the passing ids are one short line, a failing check is printed in full, and the verdict and
  -- the NAMES of the failing checks come LAST. "N of 34 checks ran" is less than 34 when the chunk stopped early (the stop is then also named).
  select count(*) filter (where l ~ '^A[0-9]+ '),
         count(*) filter (where l ~ '^A[0-9]+ ' and l like '% FAIL (want %'),
         string_agg(split_part(l, ' ', 1), ' ') filter (where l ~ '^A[0-9]+ ' and l not like '% FAIL (want %'),
         string_agg(l, E'\n') filter (where l like '% FAIL (want %' or l like 'STOPPED%'),
         string_agg(case when l like 'STOPPED%' then 'STOPPED-EARLY' else split_part(l, ' ', 1) end, ', ') filter (where l like '% FAIL (want %' or l like 'STOPPED%')
    into nlines, nfail, okids, rep, failnames
    from regexp_split_to_table(r, E'\n') as l;
  raise exception E'WALLET ONLINE CHUNK 2 of 3 (rolled back, nothing kept)\nPASSED: %\n%\nRESULT chunk 2 of 3: % of 34 checks ran, % FAIL\nFAILING: %',
    coalesce(okids, 'none'), coalesce(rep, '(no failing line)'), nlines, nfail, coalesce(failnames, 'none');
end $$;
