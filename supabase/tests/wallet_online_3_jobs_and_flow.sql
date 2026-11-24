-- WALLET ONLINE TOP-UPS (Ozow phase 1), database suite, chunk 3 of 3: the backstop (what is closed and what is NEVER closed too early), the job that wakes the Worker, the nightly check and its
-- 7-year purge, the schedules, what browsers cannot touch, and two whole journeys as the Worker will drive them (paid; and expired with a late payment) (checks J01 to J20). Read supabase/tests/README.md first.
-- RUN IT AFTER the migration 20261109110000_wallet_online_topups.sql is applied (or in ONE statement with it: node scripts/run-rolled-back-test.mjs <out.sql> <this file> <the migration>).
-- It is ONE statement that makes made-up people (example.invalid), acts as them and as the server's role, and ends with an error on purpose, which rolls back EVERYTHING it made. Nothing is kept and
-- nothing is sent: the request the job queues for the Worker lives in pg_net's queue table inside this transaction and is rolled back with it.
-- The verdict is the END of the error text: "RESULT chunk 3 of 3: N of 20 checks ran, M FAIL" and then "FAILING: <names>" (or none). The three chunks do not depend on each other.
-- Inside the transaction (rolled back) it also: removes any real wallet_job_secret from the Vault and puts a made-up one back, points the Worker address at example.invalid, and marks every real online
-- attempt as checked, so the job sees only this suite's rows.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  p1 uuid := gen_random_uuid();     -- a parent
  p2 uuid := gen_random_uuid();     -- a second parent
  a_fin uuid := gen_random_uuid();  -- finance_manager
  a_sup uuid := gen_random_uuid();  -- super_admin
  a_spt uuid := gen_random_uuid();  -- support_agent
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; t8 uuid; t9 uuid; t10 uuid; t11 uuid; t12 uuid; t13 uuid;
  ref text; ref2 text; t text; t2x text; j jsonb; j2 jsonb; j3 jsonb; n int; n2 int; n3 int; n4 int; n5 int; b0 int; nfail int; nlines int; rep text; okids text; failnames text;
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
  execute $mk$ create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
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
  execute $mk$ create function pg_temp.bal(p_profile uuid) returns int language sql as $f$
      select coalesce((select available_rand from public.wallets where profile_id = p_profile), 0) $f$ $mk$;
  execute $mk$ create function pg_temp.person(p_id uuid, p_role text, p_first text, p_dob text) returns void language plpgsql as $f$
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
        (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'o.' || p_id || '@example.invalid',
         jsonb_build_object('role', p_role, 'first_name', p_first, 'date_of_birth', p_dob) || case when p_role = 'parent' then jsonb_build_object('phone_number', '081 234 5678') else '{}'::jsonb end, '{}');
      update public.profiles set date_of_birth = p_dob::date where id = p_id;
    end $f$ $mk$;
  -- an online top-up straight into the table (as the owner); with or without an attempt; the times can be moved back
  execute $mk$ create function pg_temp.ot(p_profile uuid, p_amount int, p_pay text default null, p_attempt boolean default true) returns uuid language plpgsql as $f$
    declare v_id uuid;
    begin
      insert into public.wallet_topups (profile_id, method, status, reference, amount_rand)
        values (p_profile, 'online', 'awaiting_payment', 'TL-' || translate(substr(md5(gen_random_uuid()::text), 1, 6), '0123456789abcdef', 'ABCDEFGHJKLMNPQR'), p_amount) returning id into v_id;
      if p_attempt then
        insert into public.wallet_online_attempts (topup_id, provider, expires_at, provider_payment_id, redirect_url)
          values (v_id, 'ozow', date_trunc('second', now() + interval '1 hour'), p_pay, case when p_pay is not null then 'https://pay.example.invalid/' || p_pay end);
      end if;
      return v_id;
    end $f$ $mk$;
  execute $mk$ create function pg_temp.refof(p_id uuid) returns text language sql as $f$ select reference from public.wallet_topups where id = p_id $f$ $mk$;
  execute $mk$ create function pg_temp.st(p_id uuid) returns text language sql as $f$ select status from public.wallet_topups where id = p_id $f$ $mk$;
  execute $mk$
    create function pg_temp.ap(p_ref text, p_txn text, p_status text, p_amount text, p_event text default null) returns jsonb language plpgsql as $f$
    declare v text;
    begin
      set local role service_role;
      begin
        execute format('select public.wallet_online_apply(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)::text', 'ozow', 'webhook', p_event, p_ref, p_txn, p_status, p_amount, 'ZAR', true, 'False', false, null) into v;
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
  update system_settings set setting_value = '60'::jsonb where setting_key = 'wallet_online_expire_minutes';
  update system_settings set setting_value = '10'::jsonb where setting_key = 'wallet_online_check_after_minutes';
  update system_settings set setting_value = '50'::jsonb where setting_key = 'wallet_topup_max_waiting';
  update system_settings set setting_value = '100'::jsonb where setting_key = 'wallet_topup_max_per_day';
  -- 24 Nov 2026 (U2): pinned, the suite no longer reads the live provider name (production reads another value than the seeded 'ozow')
  update system_settings set setting_value = '"ozow"'::jsonb where setting_key = 'wallet_online_provider';
  r := r || 'S0 setup: 2 parents, 3 admins (finance, super, support); the wallet open; online mode on; 60-minute links; first check after 10 minutes' || E'\n';

  -- ---- the backstop: what it closes, and what it never closes too early -------------------------------------------------------------------
  t1 := pg_temp.ot(p1, 100, null, true);     -- (a) claimed 3 minutes ago, never got a payment id
  update wallet_online_attempts set claimed_at = now() - interval '3 minutes' where topup_id = t1;
  t2 := pg_temp.ot(p1, 100, null, true);     -- (a) claimed just now: still being created
  t3 := pg_temp.ot(p2, 100, null, false);    -- (b) never started, 74 minutes old: not yet
  t4 := pg_temp.ot(p2, 100, null, false);    -- (b) never started, 76 minutes old: cancelled
  update wallet_topups set created_at = now() - interval '74 minutes' where id = t3;
  update wallet_topups set created_at = now() - interval '76 minutes' where id = t4;
  t5 := pg_temp.ot(p1, 100, 'pay-j5');       -- (c) link long expired, never checked: stays open
  t6 := pg_temp.ot(p1, 100, 'pay-j6');       -- (c) checked 14 minutes after expiry: stays open
  t7 := pg_temp.ot(p1, 100, 'pay-j7');       -- (c) checked 15 minutes after expiry: closed
  t8 := pg_temp.ot(p1, 100, 'pay-j8');       -- (c) not expired yet, just checked: stays open
  update wallet_online_attempts set expires_at = now() - interval '2 hours' where topup_id in (t5, t6, t7);
  update wallet_online_attempts set checked_at = expires_at + interval '14 minutes' where topup_id = t6;
  update wallet_online_attempts set checked_at = expires_at + interval '15 minutes' where topup_id = t7;
  update wallet_online_attempts set checked_at = now() where topup_id = t8;
  t9 := pg_temp.ot(p1, 100, 'pay-j9');       -- paid: never touched even with an old link
  ref := pg_temp.refof(t9);
  perform pg_temp.ap(ref, 'txn-j9', 'Successful', '100.00', 'evt-j9');
  update wallet_online_attempts set expires_at = now() - interval '2 hours', checked_at = now() where topup_id = t9;
  perform public.wallet_online_close_expired();
  r := r || pg_temp.chk('J01', '(a) a claim lost for more than 2 minutes is closed as unsuccessful; one made a moment ago is left alone', pg_temp.st(t1) || ' / ' || pg_temp.st(t2), 'unsuccessful / awaiting_payment');
  r := r || pg_temp.chk('J02', '(b) a top-up never started is cancelled after the link time plus 15 minutes (76 minutes) and not before (74)', pg_temp.st(t4) || ' / ' || pg_temp.st(t3), 'cancelled / awaiting_payment');
  r := r || pg_temp.chk('J03', '(c) a top-up with a payment is closed only after a clean check made 15 minutes after its link expired: never checked, or checked after 14, stays open; after 15 it is closed; a paid one is untouched',
    concat_ws(' ', pg_temp.st(t5), pg_temp.st(t6), pg_temp.st(t7), pg_temp.st(t8), pg_temp.st(t9)), 'awaiting_payment awaiting_payment cancelled awaiting_payment successful');
  select count(*) into n from wallet_provider_events e where e.topup_id in (t1, t4, t7) and e.outcome in ('attempt_failed', 'ignored');
  r := r || pg_temp.chk('J04', 'each closing is told to the payer once and recorded: p1 (two closed) has 2 notices, p2 (one) has 1, and 3 audit rows exist',
    concat_ws(' ', pg_temp.nn(p1, 'wallet_topup_cancelled'), pg_temp.nn(p2, 'wallet_topup_cancelled'), n), '2 1 3');
  select tp.decision_comment into t from wallet_topups tp where tp.id = t7;
  perform public.wallet_online_close_expired();
  r := r || pg_temp.chk('J05', 'running the backstop again closes nothing more and tells nobody twice; the reason is kept on the top-up',
    concat_ws(' ', pg_temp.nn(p1, 'wallet_topup_cancelled'), pg_temp.nn(p2, 'wallet_topup_cancelled'), t), '2 1 The online payment window ended without a successful payment');

  -- ---- the job that wakes the Worker ----------------------------------------------------------------------------------------------------------
  t := pg_temp.try($q$delete from vault.secrets where name = 'wallet_job_secret'$q$);
  update system_settings set setting_value = '"https://worker.example.invalid"'::jsonb where setting_key = 'account_closure_worker_url';
  update wallet_online_attempts set checked_at = now();
  t10 := pg_temp.ot(p1, 100, 'pay-j10');
  update wallet_topups set created_at = now() - interval '11 minutes' where id = t10;
  update wallet_online_attempts set checked_at = null where topup_id = t10;
  select count(*) into n from net.http_request_queue;
  perform public.wallet_online_backstop_job();
  select count(*) into n2 from net.http_request_queue;
  t2x := pg_temp.try($q$select vault.create_secret('job-secret-test-value-not-real', 'wallet_job_secret')$q$);
  update system_settings set setting_value = '""'::jsonb where setting_key = 'account_closure_worker_url';
  perform public.wallet_online_backstop_job();
  select count(*) into n3 from net.http_request_queue;
  update system_settings set setting_value = '"https://worker.example.invalid"'::jsonb where setting_key = 'account_closure_worker_url';
  update wallet_online_attempts set checked_at = now();
  perform public.wallet_online_backstop_job();
  select count(*) into n4 from net.http_request_queue;
  update wallet_online_attempts set checked_at = null where topup_id = t10;
  perform public.wallet_online_backstop_job();
  select count(*) into n5 from net.http_request_queue;
  r := r || pg_temp.chk('J06', 'the 5-minute job calls the Worker only when it must: not without the Vault secret, not without the Worker address, not when nothing is due; once when a top-up is due (requests queued: 0 0 0 1; the Vault set-up steps: delete=' || t || ', create=' || left(t2x, 60) || ')',
    concat_ws(' ', n2 - n, n3 - n2, n4 - n3, n5 - n4), '0 0 0 1');
  select concat_ws(' ', q.url, (q.headers ->> 'x-job-secret' is not null)::text, q.method) into t from net.http_request_queue q order by q.id desc limit 1;
  r := r || pg_temp.chk('J07', 'the request goes to the wallet check route with the job-secret header (the secret itself is never printed here)', t, 'https://worker.example.invalid/api/internal/wallet/online-check true POST');

  -- ---- the nightly check and the 7-year purge -----------------------------------------------------------------------------------------------
  t11 := pg_temp.ot(p2, 100, 'pay-j11');
  update wallet_topups set created_at = now() - interval '2 days' where id = t11;
  perform public.wallet_online_log('ozow', 'webhook', 'evt-j11a', null, 'TL-QQQQQ2', null, 'Successful', '1.00', 'ZAR', 'needs_review', 'a message nobody has looked at', false);
  perform public.wallet_online_log('ozow', 'webhook', 'evt-j11b', t11, pg_temp.refof(t11), 'txn-j11', 'Successful', '100.00', 'ZAR', 'credited', 'credited but no ledger line', false);
  j := public.wallet_online_daily_job();
  r := r || pg_temp.chk('J08', 'the nightly job counts what is stuck (waiting over a day, messages needing a person, credited without a ledger line) and tells finance once; a support agent is not told',
    concat_ws(' ', ((j ->> 'waiting_over_a_day')::int >= 1)::text, ((j ->> 'needs_a_person')::int >= 1)::text, ((j ->> 'credited_without_ledger')::int >= 1)::text, pg_temp.nn(a_fin, 'wallet_online_daily'), pg_temp.nn(a_spt, 'wallet_online_daily')),
    'true true true 1 0');
  insert into wallet_provider_events (provider, source, outcome, detail, created_at) values
    ('ozow', 'system', 'ignored', 'old-ignored', now() - interval '8 years'), ('ozow', 'system', 'needs_review', 'old-open-review', now() - interval '8 years'),
    ('ozow', 'system', 'ignored', 'recent-6-years', now() - interval '6 years');
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'retention_jobs_enabled';
  update system_settings set setting_value = '7'::jsonb where setting_key = 'retention_money_years';
  j := public.wallet_online_daily_job();
  select count(*) into n from wallet_provider_events where detail in ('old-ignored', 'old-open-review', 'recent-6-years');
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'retention_jobs_enabled';
  j2 := public.wallet_online_daily_job();
  select string_agg(detail, ' ' order by detail) into t from wallet_provider_events where detail in ('old-ignored', 'old-open-review', 'recent-6-years');
  r := r || pg_temp.chk('J09', 'provider events are kept 7 years: with the retention switch off nothing is purged; with it on, an 8-year-old settled event goes, an 8-year-old one still needing a person and a 6-year-old one stay',
    concat_ws(' ', n, j ->> 'purged', '|', j2 ->> 'purged', '|', t), '3 0 | 1 | old-open-review recent-6-years');
  select string_agg(jobname || '=' || schedule, ' ' order by jobname) into t from cron.job where jobname in ('wallet-online-backstop', 'wallet-online-daily');
  r := r || pg_temp.chk('J10', 'the two jobs are scheduled: every 5 minutes, and nightly at 02:30', t, 'wallet-online-backstop=*/5 * * * * wallet-online-daily=30 2 * * *');

  -- ---- what browsers cannot touch; deleting a top-up (retention) keeps the audit trail -----------------------------------------------------------
  t12 := pg_temp.ot(p1, 100, 'pay-j12');
  update wallet_topups set status = 'cancelled', decision_comment = 'test' where id = t12;
  perform public.wallet_online_log('ozow', 'system', 'evt-j12', t12, pg_temp.refof(t12), null, null, null, null, 'ignored', 'to be kept', false);
  delete from wallet_topups where id = t12;
  select count(*) into n from wallet_online_attempts where topup_id = t12;
  select concat_ws(' ', e.topup_id is null, e.reference is not null) into t from wallet_provider_events e where e.event_id = 'evt-j12';
  r := r || pg_temp.chk('J11', 'when a top-up is deleted (the 7-year clean-up), its attempt goes with it and the audit row stays with the reference, without the link', concat_ws(' ', n, t), '0 t t');
  r := r || pg_temp.chk('J12', 'nobody signed in, a finance admin included, can change or delete a provider event',
    pg_temp.has(pg_temp.run_as(a_fin, 'delete from public.wallet_provider_events'), 'permission denied') || ' ' || pg_temp.has(pg_temp.run_as(a_fin, $q$update public.wallet_provider_events set detail = 'x'$q$), 'permission denied') || ' '
    || pg_temp.has(pg_temp.run_as(p1, $q$update public.wallet_online_attempts set provider_payment_id = 'x'$q$), 'permission denied'), 'yes yes yes');

  -- ---- the whole journey as the Worker will drive it: paid ---------------------------------------------------------------------------------
  b0 := pg_temp.bal(p1);
  t := pg_temp.run_as(p1, 'select public.create_online_topup(300)::text');
  j := case when t like 'ERR:%' then '{}'::jsonb else t::jsonb end;
  t13 := (j ->> 'topup_id')::uuid;
  ref := j ->> 'reference';
  j := pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t13, p1))::jsonb;
  j2 := pg_temp.run_svc(format('select public.wallet_online_attach(%L, %L, %L)::text', t13, 'pay-e2e', 'https://pay.example.invalid/e2e'))::jsonb;
  r := r || pg_temp.chk('J13', 'journey 1, steps: create (the payer), claim says create, attach saves the link', concat_ws(' ', ref is not null, j ->> 'action', j2 ->> 'attached', pg_temp.st(t13)), 't create true awaiting_payment');
  j3 := pg_temp.ap(ref, 'txn-e2e', 'Successful', '300.00', 'evt-e2e');
  n := pg_temp.bal(p1);
  t := pg_temp.run_as(p1, format('select status from public.wallet_topups where id = %L', t13));
  r := r || pg_temp.chk('J14', 'journey 1, end: the message credits R300, the payer sees the top-up successful and the wallet R300 higher, and nothing is left for the backstop',
    concat_ws(' ', j3 ->> 'outcome', t, n - b0, (select count(*) from wallet_online_due_checks(100) d where d.topup_id = t13)), 'credited successful 300 0');

  -- ---- the whole journey as the Worker will drive it: expired, then a late payment ------------------------------------------------------------
  b0 := pg_temp.bal(p2);
  t := pg_temp.run_as(p2, 'select public.create_online_topup(100)::text');
  j := case when t like 'ERR:%' then '{}'::jsonb else t::jsonb end;
  t9 := (j ->> 'topup_id')::uuid;
  ref2 := j ->> 'reference';
  perform pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t9, p2));
  perform pg_temp.run_svc(format('select public.wallet_online_attach(%L, %L, %L)::text', t9, 'pay-e2f', 'https://pay.example.invalid/e2f'));
  update wallet_topups set created_at = now() - interval '3 hours' where id = t9;
  update wallet_online_attempts set expires_at = now() - interval '2 hours', claimed_at = now() - interval '3 hours' where topup_id = t9;
  select count(*) into n from wallet_online_due_checks(100) d where d.topup_id = t9;
  perform pg_temp.run_svc(format('select public.wallet_online_mark_checked(%L)', t9));
  perform public.wallet_online_close_expired();
  n2 := pg_temp.nn(p2, 'wallet_topup_cancelled');
  r := r || pg_temp.chk('J15', 'journey 2, expiry: the backstop lists it, a clean check is recorded, and the next backstop run cancels it and tells the payer ("was not completed in time")',
    concat_ws(' ', n, pg_temp.st(t9), n2, (select count(*) from notifications nt where nt.profile_id = p2 and nt.type = 'wallet_topup_cancelled' and nt.body like '%not completed in time%')), '1 cancelled 2 1');
  j := pg_temp.ap(ref2, 'txn-e2f', 'Successful', '100.00', 'evt-e2f');
  r := r || pg_temp.chk('J16', 'journey 2, late payment: money arriving after the cancel is not credited by the system; it is flagged for a person with the reason, and finance is told',
    concat_ws(' ', pg_temp.has(j ->> 'detail', 'Late payment'), (pg_temp.bal(p2) - b0)::text, pg_temp.nn(a_fin, 'wallet_online_review')), 'yes 0 1');

  -- ---- shape guards -----------------------------------------------------------------------------------------------------------------------
  select string_agg(column_name, ' ' order by ordinal_position) into t from information_schema.columns where table_schema = 'public' and table_name = 'wallet_provider_events';
  r := r || pg_temp.chk('J17', 'the provider events table holds ids, status words and short reasons only: no body, no name, no e-mail, no phone',
    t, 'id provider event_id source topup_id reference provider_txn_id provider_status amount_text currency outcome detail resolved_at resolved_note created_at');
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'wallet_topups';
  select count(*) into n2 from information_schema.columns where table_schema = 'public' and table_name = 'wallet_topups' and column_name like 'provider%';
  r := r || pg_temp.chk('J18', 'wallet_topups gained no column (provider details live in the closed attempts table, which browsers cannot read)', n || ' ' || n2, '16 0');
  r := r || pg_temp.chk('J19', 'who may change the mode: a finance admin yes, a support agent and a parent no',
    pg_temp.run_as(a_fin, $q$with u as (update system_settings set setting_value = '"staff"'::jsonb where setting_key = 'wallet_online_mode' returning 1) select count(*)::text from u$q$) || ' '
    || pg_temp.has(pg_temp.run_as(a_spt, $q$update system_settings set setting_value = '"on"'::jsonb where setting_key = 'wallet_online_mode'$q$), 'Only a finance admin') || ' '
    || pg_temp.run_as(p1, $q$with u as (update system_settings set setting_value = '"on"'::jsonb where setting_key = 'wallet_online_mode' returning 1) select count(*)::text from u$q$), '1 yes 0');
  n := (select count(*) from wallet_topups where method = 'eft' and status = 'awaiting_payment');
  r := r || pg_temp.chk('J20', 'the manual and card methods can never be in the online state', n::text, '0');

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool shows only the START and the END of a long error. So: the passing ids are one short line, a failing check is printed in full, and the verdict and
  -- the NAMES of the failing checks come LAST. "N of 20 checks ran" is less than 20 when the chunk stopped early (the stop is then also named).
  select count(*) filter (where l ~ '^J[0-9]+ '),
         count(*) filter (where l ~ '^J[0-9]+ ' and l like '% FAIL (want %'),
         string_agg(split_part(l, ' ', 1), ' ') filter (where l ~ '^J[0-9]+ ' and l not like '% FAIL (want %'),
         string_agg(l, E'\n') filter (where l like '% FAIL (want %' or l like 'STOPPED%'),
         string_agg(case when l like 'STOPPED%' then 'STOPPED-EARLY' else split_part(l, ' ', 1) end, ', ') filter (where l like '% FAIL (want %' or l like 'STOPPED%')
    into nlines, nfail, okids, rep, failnames
    from regexp_split_to_table(r, E'\n') as l;
  raise exception E'WALLET ONLINE CHUNK 3 of 3 (rolled back, nothing kept)\nPASSED: %\n%\nRESULT chunk 3 of 3: % of 20 checks ran, % FAIL\nFAILING: %',
    coalesce(okids, 'none'), coalesce(rep, '(no failing line)'), nlines, nfail, coalesce(failnames, 'none');
end $$;
