-- WALLET ONLINE TOP-UPS (Ozow phase 1), database suite, chunk 1 of 3: the mode and the staff list, creating an online top-up and its limits, who can read what, the rights of every
-- new function and table, claim / attach / create-failed / check-now / due-checks (checks C01 to C38). Read supabase/tests/README.md first.
-- RUN IT AFTER the migration 20261109110000_wallet_online_topups.sql is applied (or in ONE statement with it: node scripts/run-rolled-back-test.mjs <out.sql> <this file> <the migration>).
-- It is ONE statement that makes made-up people (example.invalid), acts as them, and ends with an error on purpose, which rolls back EVERYTHING it made. Nothing is kept and nothing is sent.
-- The verdict is the END of the error text: "RESULT chunk 1 of 3: N of 38 checks ran, M FAIL" and then "FAILING: <names>" (or none). The three chunks do not depend on each other.
-- Real data cannot change a count: fixtures are new rows and every count is of those rows. The settings it needs are set inside the transaction (and rolled back with it).
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '10 years')::date::text;
  p1 uuid := gen_random_uuid();     -- a parent (the payer)
  p2 uuid := gen_random_uuid();     -- a second parent (a stranger to the first)
  p3 uuid := gen_random_uuid();     -- a third parent (cap and per-day limits)
  m1 uuid := gen_random_uuid();     -- a learner under 18, the child of p1
  a_fin uuid := gen_random_uuid();  -- finance_manager
  a_sup uuid := gen_random_uuid();  -- super_admin
  a_spt uuid := gen_random_uuid();  -- support_agent
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid; t7 uuid; t8 uuid; t9 uuid; t10 uuid;
  t text; t2x text; j jsonb; n int; n2 int; nfail int; nlines int; rep text; okids text; failnames text; ref1 text;
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
  execute $mk$ create function pg_temp.person(p_id uuid, p_role text, p_first text, p_dob text) returns void language plpgsql as $f$
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
        (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'o.' || p_id || '@example.invalid',
         jsonb_build_object('role', p_role, 'first_name', p_first, 'date_of_birth', p_dob) || case when p_role = 'parent' then jsonb_build_object('phone_number', '081 234 5678') else '{}'::jsonb end, '{}');
      update public.profiles set date_of_birth = p_dob::date where id = p_id;
    end $f$ $mk$;
  -- an online top-up straight into the table (as the owner), with or without a payment already attached
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

  -- ---- people and settings ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.person(p1, 'parent', 'Pat', adult);
  perform pg_temp.person(p2, 'parent', 'Quin', adult);
  perform pg_temp.person(p3, 'parent', 'Rae', adult);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (m1, z, 'authenticated', 'authenticated', 'o.m1.' || m1 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Mia', 'date_of_birth', minor),
     jsonb_build_object('created_by_guardian', p1, 'relationship', 'mother')),
    (a_fin, z, 'authenticated', 'authenticated', 'o.a1.' || a_fin || '@example.invalid', '{}'::jsonb, '{}'),
    (a_sup, z, 'authenticated', 'authenticated', 'o.a2.' || a_sup || '@example.invalid', '{}'::jsonb, '{}'),
    (a_spt, z, 'authenticated', 'authenticated', 'o.a3.' || a_spt || '@example.invalid', '{}'::jsonb, '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (a_fin, 'Fin', 'Manager', 'o.a1.' || a_fin || '@example.invalid', '', 'finance_manager', true),
    (a_sup, 'Sup', 'Admin', 'o.a2.' || a_sup || '@example.invalid', '', 'super_admin', true),
    (a_spt, 'Spt', 'Agent', 'o.a3.' || a_spt || '@example.invalid', '', 'support_agent', true);
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_payments_enabled';
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  update system_settings set setting_value = '50'::jsonb where setting_key = 'wallet_topup_min_rand';
  update system_settings set setting_value = '5000'::jsonb where setting_key = 'wallet_topup_max_rand';
  update system_settings set setting_value = '10000'::jsonb where setting_key = 'wallet_balance_cap_rand';
  update system_settings set setting_value = '3'::jsonb where setting_key = 'wallet_topup_max_waiting';
  update system_settings set setting_value = '10'::jsonb where setting_key = 'wallet_topup_max_per_day';
  update system_settings set setting_value = '"Test Bank"'::jsonb where setting_key = 'wallet_bank_name';
  update system_settings set setting_value = '"Tutorlage"'::jsonb where setting_key = 'wallet_bank_account_holder';
  update system_settings set setting_value = '"1234567890"'::jsonb where setting_key = 'wallet_bank_account_number';
  update system_settings set setting_value = '"250655"'::jsonb where setting_key = 'wallet_bank_branch_code';
  update system_settings set setting_value = '"off"'::jsonb where setting_key = 'wallet_online_mode';
  -- 24 Nov 2026 (U2): pinned, the suite no longer reads the live provider name (production reads another value than the seeded 'ozow')
  update system_settings set setting_value = '"ozow"'::jsonb where setting_key = 'wallet_online_provider';
  r := r || 'S0 setup: 3 parents, a child, 3 admins (finance, super, support); the wallet open; online mode off' || E'\n';

  -- ---- the mode and the staff list --------------------------------------------------------------------------------------------------------
  select count(*) into n from system_settings where setting_key in ('wallet_online_mode', 'wallet_online_provider', 'wallet_online_expire_minutes', 'wallet_online_check_after_minutes');
  r := r || pg_temp.chk('C01', 'the four online settings exist', n::text, '4');
  r := r || pg_temp.chk('C02', 'mode off: the online option is not offered', pg_temp.run_as(p1, 'select public.wallet_online_available()::text'), 'false');
  r := r || pg_temp.chk('C03', 'mode off: creating an online top-up is refused with a plain sentence', pg_temp.run_as(p1, 'select public.create_online_topup(200)::text'), 'ERR: Paying with your bank is not switched on yet.');
  r := r || pg_temp.chk('C04', 'a signed-out visitor cannot even ask', pg_temp.has(pg_temp.run_as(null, 'select public.wallet_online_available()::text'), 'permission denied'), 'yes');
  update system_settings set setting_value = '"staff"'::jsonb where setting_key = 'wallet_online_mode';
  r := r || pg_temp.chk('C05', 'mode staff, nobody listed: not offered, and creating is refused',
    pg_temp.run_as(p1, 'select public.wallet_online_available()::text') || ' / ' || pg_temp.has(pg_temp.run_as(p1, 'select public.create_online_topup(200)::text'), 'not switched on yet'), 'false / yes');
  insert into wallet_online_staff (profile_id, note) values (p1, 'test');
  r := r || pg_temp.chk('C06', 'mode staff: only the listed parent is offered it (a stranger and a child are not)',
    pg_temp.run_as(p1, 'select public.wallet_online_available()::text') || ' ' || pg_temp.run_as(p2, 'select public.wallet_online_available()::text') || ' ' || pg_temp.run_as(m1, 'select public.wallet_online_available()::text'), 'true false false');
  update system_settings set setting_value = '"on"'::jsonb where setting_key = 'wallet_online_mode';
  r := r || pg_temp.chk('C07', 'mode on: every adult is offered it, a child still is not',
    pg_temp.run_as(p2, 'select public.wallet_online_available()::text') || ' ' || pg_temp.run_as(m1, 'select public.wallet_online_available()::text'), 'true false');
  update system_settings set setting_value = '"ON "'::jsonb where setting_key = 'wallet_online_mode';
  t := pg_temp.run_as(p2, 'select public.wallet_online_available()::text');
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_online_mode';
  t2x := pg_temp.run_as(p2, 'select public.wallet_online_available()::text');
  update system_settings set setting_value = '"maybe"'::jsonb where setting_key = 'wallet_online_mode';
  r := r || pg_temp.chk('C08', 'a mis-typed mode never opens anything by mistake: "ON " reads as on, the JSON value true and "maybe" read as off',
    t || ' ' || t2x || ' ' || pg_temp.run_as(p2, 'select public.wallet_online_available()::text'), 'true false false');
  update system_settings set setting_value = '"on"'::jsonb where setting_key = 'wallet_online_mode';

  -- ---- creating an online top-up ----------------------------------------------------------------------------------------------------------
  t := pg_temp.run_as(p1, 'select public.create_online_topup(200)::text');
  j := case when t like 'ERR:%' then '{}'::jsonb else t::jsonb end;
  t1 := (j ->> 'topup_id')::uuid;
  ref1 := j ->> 'reference';
  r := r || pg_temp.chk('C09', 'a parent creates an online top-up of R200: awaiting payment, method online, a TL- reference',
    concat_ws(' ', j ->> 'status', j ->> 'method', j ->> 'amount_rand', (ref1 ~ '^TL-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$')::text), 'awaiting_payment online 200 true');
  select concat_ws(' ', tp.method, tp.status, tp.amount_rand, tp.received_rand is null, tp.ledger_id is null, tp.decided_at is null, tp.profile_id = p1,
                   exists (select 1 from wallet_online_attempts a where a.topup_id = tp.id)) into t from wallet_topups tp where tp.id = t1;
  r := r || pg_temp.chk('C10', 'the stored row is clean (no money, no decision, no attempt yet)', t, 'online awaiting_payment 200 t t t t f');
  r := r || pg_temp.chk('C11', 'the payer reads their own online top-up; a stranger reads none',
    pg_temp.run_as(p1, 'select count(*)::text from public.wallet_topups where id = ' || quote_literal(t1)) || ' ' || pg_temp.run_as(p2, 'select count(*)::text from public.wallet_topups where id = ' || quote_literal(t1)), '1 0');
  r := r || pg_temp.chk('C12', 'browsers cannot read the attempts table or the staff list at all',
    pg_temp.has(pg_temp.run_as(p1, 'select count(*)::text from public.wallet_online_attempts'), 'permission denied') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, 'select count(*)::text from public.wallet_online_attempts'), 'permission denied') || ' '
    || pg_temp.has(pg_temp.run_as(p1, 'select count(*)::text from public.wallet_online_staff'), 'permission denied'), 'yes yes yes');
  perform public.wallet_online_log('ozow', 'webhook', 'evt-c13', t1, ref1, 'txn-c13', 'Pending', '200.00', 'ZAR', 'ignored', 'Not finished yet (pending)');
  r := r || pg_temp.chk('C13', 'provider events: a finance admin reads them, a support agent and a parent see none, nobody can write one',
    pg_temp.run_as(a_fin, 'select (count(*) filter (where event_id = ''evt-c13''))::text from public.wallet_provider_events') || ' ' || pg_temp.run_as(a_spt, 'select count(*)::text from public.wallet_provider_events') || ' '
    || pg_temp.run_as(p1, 'select count(*)::text from public.wallet_provider_events') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, $q$insert into public.wallet_provider_events (provider, source, outcome) values ('ozow', 'admin', 'ignored')$q$), 'permission denied'), '1 0 0 yes');
  r := r || pg_temp.chk('C14', 'a child cannot start one (the parent''s wallet is used)', pg_temp.has(pg_temp.run_as(m1, 'select public.create_online_topup(200)::text'), 'Only an adult can add lesson credit'), 'yes');
  r := r || pg_temp.chk('C15', 'a signed-out visitor cannot call it', pg_temp.has(pg_temp.run_as(null, 'select public.create_online_topup(200)::text'), 'permission denied'), 'yes');
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'wallet_payments_enabled';
  t := pg_temp.run_as(p1, 'select public.create_online_topup(200)::text');
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_payments_enabled';
  r := r || pg_temp.chk('C16', 'a closed wallet refuses an online top-up too', t, 'ERR: Wallet payments are not open.');
  r := r || pg_temp.chk('C17', 'the amount limits: 49 and 5001 and nothing are refused with the limits in the sentence',
    pg_temp.run_as(p2, 'select public.create_online_topup(49)::text') || ' | ' || pg_temp.run_as(p2, 'select public.create_online_topup(5001)::text') || ' | ' || pg_temp.has(pg_temp.run_as(p2, 'select public.create_online_topup(null)::text'), 'Add between R50 and R5000'),
    'ERR: Add between R50 and R5000 at a time, in whole rands. | ERR: Add between R50 and R5000 at a time, in whole rands. | yes');
  -- the waiting limit: p1 has one waiting; two more are fine, the fourth is refused
  t := pg_temp.run_as(p1, 'select public.create_online_topup(100)::text');
  t2x := pg_temp.run_as(p1, 'select public.create_online_topup(100)::text');
  r := r || pg_temp.chk('C18', 'three online payments may wait at once; the fourth is refused',
    (t not like 'ERR%')::text || ' ' || (t2x not like 'ERR%')::text || ' ' || pg_temp.has(pg_temp.run_as(p1, 'select public.create_online_topup(100)::text'), 'You already have 3 online payments waiting'), 'true true yes');
  -- the manual transfer is untouched: it still works in every mode and has its own waiting count
  t := pg_temp.run_as(p1, 'select public.create_wallet_topup(100)::text');
  j := case when t like 'ERR:%' then '{}'::jsonb else t::jsonb end;
  select concat_ws(' ', j ->> 'status', tp.method) into t from wallet_topups tp where tp.id = (j ->> 'topup_id')::uuid;
  r := r || pg_temp.chk('C19', 'the manual bank transfer still works next to three waiting online payments, and stays a transfer', t, 'awaiting_proof eft');
  -- the daily limit counts both ways: p2 has 3 closed ones today
  update system_settings set setting_value = '3'::jsonb where setting_key = 'wallet_topup_max_per_day';
  insert into wallet_topups (profile_id, reference, amount_rand, status) values
    (p2, 'TL-AAAAA2', 100, 'cancelled'), (p2, 'TL-AAAAA3', 100, 'cancelled'), (p2, 'TL-AAAAA4', 100, 'cancelled');
  r := r || pg_temp.chk('C20', 'the per-day limit counts earlier top-ups of any kind', pg_temp.run_as(p2, 'select public.create_online_topup(100)::text'), 'ERR: You have made many top-up requests today. Please try again tomorrow.');
  update system_settings set setting_value = '10'::jsonb where setting_key = 'wallet_topup_max_per_day';
  -- the cap counts online payments waiting
  update system_settings set setting_value = '1000'::jsonb where setting_key = 'wallet_topup_max_rand';   -- the settings guard needs: smallest <= largest <= cap
  update system_settings set setting_value = '1000'::jsonb where setting_key = 'wallet_balance_cap_rand';
  t := pg_temp.run_as(p3, 'select public.create_online_topup(800)::text');
  r := r || pg_temp.chk('C21', 'the cap: R800 then R300 is refused (R200 would fit); R200 is allowed exactly to the cap',
    (t not like 'ERR%')::text || ' / ' || pg_temp.run_as(p3, 'select public.create_online_topup(300)::text') || ' / ' || (pg_temp.run_as(p3, 'select public.create_online_topup(200)::text') not like 'ERR%')::text,
    'true / ERR: That would take your credit above R1000. You can add up to R200 now. / true');
  update system_settings set setting_value = '10000'::jsonb where setting_key = 'wallet_balance_cap_rand';
  update system_settings set setting_value = '5000'::jsonb where setting_key = 'wallet_topup_max_rand';

  -- ---- the table's checks ------------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('C22', 'the table refuses an awaiting-payment row that is not online, one with a decision, an unknown status and an unknown method',
    pg_temp.has(pg_temp.try($q$insert into wallet_topups (profile_id, method, status, reference, amount_rand) values ('$q$ || p2 || $q$', 'eft', 'awaiting_payment', 'TL-BBBBB2', 100)$q$), 'wallet_topups_state') || ' '
    || pg_temp.has(pg_temp.try($q$insert into wallet_topups (profile_id, method, status, reference, amount_rand, decided_at) values ('$q$ || p2 || $q$', 'online', 'awaiting_payment', 'TL-BBBBB3', 100, now())$q$), 'wallet_topups_state') || ' '
    || pg_temp.has(pg_temp.try($q$insert into wallet_topups (profile_id, method, status, reference, amount_rand) values ('$q$ || p2 || $q$', 'online', 'weird', 'TL-BBBBB4', 100)$q$), 'violates check constraint') || ' '
    || pg_temp.has(pg_temp.try($q$insert into wallet_topups (profile_id, method, status, reference, amount_rand) values ('$q$ || p2 || $q$', 'cash', 'cancelled', 'TL-BBBBB5', 100)$q$), 'wallet_topups_method_check'),
    'yes yes yes yes');

  -- ---- who may run what -------------------------------------------------------------------------------------------------------------------
  with f(sig, want) as (values
      ('public.create_online_topup(integer)', 'f t f'), ('public.wallet_online_available()', 'f t f'),
      ('public.wallet_online_claim(uuid, uuid)', 'f f t'), ('public.wallet_online_attach(uuid, text, text)', 'f f t'), ('public.wallet_online_create_failed(uuid, text)', 'f f t'),
      ('public.wallet_online_apply(text, text, text, text, text, text, text, text, boolean, text, boolean, text)', 'f f t'),
      ('public.wallet_online_record_event(text, text, text, text, text)', 'f f t'), ('public.wallet_online_check_request(uuid, uuid)', 'f f t'),
      ('public.wallet_online_mark_checked(uuid)', 'f f t'), ('public.wallet_online_due_checks(integer)', 'f f t'),
      ('public.wallet_online_mode()', 'f f f'), ('public.wallet_online_allowed(uuid)', 'f f f'), ('public.wallet_online_iso(timestamptz)', 'f f f'),
      ('public.wallet_online_log(text, text, text, uuid, text, text, text, text, text, text, text, boolean)', 'f f f'),
      ('public.wallet_online_close_expired()', 'f f f'), ('public.wallet_online_backstop_job()', 'f f f'), ('public.wallet_online_daily_job()', 'f f f'))
  select coalesce(string_agg(f.sig || ' is ' || got, '; '), 'all as designed') into t from (
    select f.sig, f.want, concat_ws(' ', substr(has_function_privilege('anon', to_regprocedure(f.sig), 'execute')::text, 1, 1), substr(has_function_privilege('authenticated', to_regprocedure(f.sig), 'execute')::text, 1, 1),
                                    substr(has_function_privilege('service_role', to_regprocedure(f.sig), 'execute')::text, 1, 1)) as got from f) f where f.got <> f.want;
  r := r || pg_temp.chk('C23', 'execute rights of the 17 new functions: browsers get two, the Worker gets eight, jobs and helpers none', t, 'all as designed');
  select coalesce(string_agg(x.tbl || ' ' || x.who || ' ' || x.pr, '; '), 'all closed') into t from (
    select tb.tbl, ro.who, pr.pr from (values ('wallet_online_attempts'), ('wallet_online_staff'), ('wallet_provider_events')) tb(tbl),
           (values ('anon'), ('authenticated'), ('service_role')) ro(who), (values ('select'), ('insert'), ('update'), ('delete')) pr(pr)
    where has_table_privilege(ro.who, 'public.' || tb.tbl, pr.pr) and not (tb.tbl = 'wallet_provider_events' and ro.who = 'authenticated' and pr.pr = 'select')) x;
  r := r || pg_temp.chk('C24', 'table rights: all three tables closed to anon and service_role; browsers may only read events (the row rule limits that to finance admins)', t, 'all closed');
  select string_agg(c.relname || ':' || c.relrowsecurity::text, ' ' order by c.relname) into t from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname in ('wallet_online_attempts', 'wallet_online_staff', 'wallet_provider_events');
  r := r || pg_temp.chk('C25', 'row security is on for all three tables', t, 'wallet_online_attempts:true wallet_online_staff:true wallet_provider_events:true');

  -- ---- claim, attach, create-failed --------------------------------------------------------------------------------------------------------
  t2 := pg_temp.ot(p1, 200, null, false);
  t := pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t2, p1));
  j := case when t like 'ERR:%' then '{}'::jsonb else t::jsonb end;
  select concat_ws(' ', (a.provider_payment_id is null)::text, (a.redirect_url is null)::text, (a.expires_at > now() + interval '59 minutes' and a.expires_at < now() + interval '61 minutes')::text)
    into t from wallet_online_attempts a where a.topup_id = t2;
  r := r || pg_temp.chk('C26', 'the first claim says create, with the amount, the reference, an expiry in 60 minutes and a fixed idempotency key; the attempt row exists',
    concat_ws(' ', j ->> 'action', j ->> 'provider', j ->> 'amount_rand', (j ->> 'idempotency_key' = 'topup-' || t2)::text, (j ->> 'expires_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$')::text, t),
    'create ozow 200 true true true true true');
  r := r || pg_temp.chk('C27', 'a second claim while the first is working says busy', (pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t2, p1))::jsonb) ->> 'action', 'busy');
  r := r || pg_temp.chk('C28', 'another person, and a manual top-up, are "No such top-up"',
    pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t2, p2)) || ' | ' || pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', (select id from wallet_topups where profile_id = p1 and method = 'eft' limit 1), p1)),
    'ERR: No such top-up | ERR: No such top-up');
  r := r || pg_temp.chk('C29', 'attach refuses a web address that is not https, a blank id and a very long one',
    pg_temp.has(pg_temp.run_svc(format('select public.wallet_online_attach(%L, %L, %L)::text', t2, 'pay-1', 'http://pay.example.invalid/1')), 'starting with https://') || ' '
    || pg_temp.has(pg_temp.run_svc(format('select public.wallet_online_attach(%L, %L, %L)::text', t2, '  ', 'https://pay.example.invalid/1')), 'payment id is missing') || ' '
    || pg_temp.has(pg_temp.run_svc(format('select public.wallet_online_attach(%L, %L, %L)::text', t2, 'pay-1', 'https://pay.example.invalid/' || repeat('x', 2000))), 'starting with https://'), 'yes yes yes');
  j := pg_temp.run_svc(format('select public.wallet_online_attach(%L, %L, %L)::text', t2, 'pay-1', 'https://pay.example.invalid/1'))::jsonb;
  select concat_ws(' ', a.provider_payment_id, a.redirect_url) into t from wallet_online_attempts a where a.topup_id = t2;
  r := r || pg_temp.chk('C30', 'attach saves the payment id and the link exactly as given', concat_ws(' ', j ->> 'attached', j ->> 'again', t), 'true false pay-1 https://pay.example.invalid/1');
  j := pg_temp.run_svc(format('select public.wallet_online_attach(%L, %L, %L)::text', t2, 'pay-1', 'https://pay.example.invalid/1'))::jsonb;
  t3 := pg_temp.ot(p1, 100, null, true);
  r := r || pg_temp.chk('C31', 'attaching the same id again is harmless; a different id, or an id already on another top-up, is refused',
    concat_ws(' ', j ->> 'attached', j ->> 'again') || ' | ' || pg_temp.has(pg_temp.run_svc(format('select public.wallet_online_attach(%L, %L, %L)::text', t2, 'pay-2', 'https://pay.example.invalid/2')), 'different payment is already saved') || ' '
    || pg_temp.has(pg_temp.run_svc(format('select public.wallet_online_attach(%L, %L, %L)::text', t3, 'pay-1', 'https://pay.example.invalid/1')), 'duplicate key'), 'true true | yes yes');
  j := pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t2, p1))::jsonb;
  r := r || pg_temp.chk('C32', 'after attaching, a claim resumes with the stored link', concat_ws(' ', j ->> 'action', j ->> 'redirect_url'), 'resume https://pay.example.invalid/1');
  update system_settings set setting_value = '"off"'::jsonb where setting_key = 'wallet_online_mode';
  j := pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t2, p1))::jsonb;
  t4 := pg_temp.ot(p1, 100, null, false);
  r := r || pg_temp.chk('C33', 'with the mode off a link already made still resumes, but a top-up never started cannot start',
    (j ->> 'action') || ' / ' || (pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t4, p1))::jsonb)::text, 'resume / {"why": "off", "action": "closed", "status": "awaiting_payment"}');
  update system_settings set setting_value = '"on"'::jsonb where setting_key = 'wallet_online_mode';
  update wallet_online_attempts set expires_at = now() - interval '1 minute' where topup_id = t2;
  j := pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t2, p1))::jsonb;
  r := r || pg_temp.chk('C34', 'a link past its expiry is not resumed', concat_ws(' ', j ->> 'action', j ->> 'why', j ->> 'status'), 'closed expired awaiting_payment');
  -- create-failed: refused once a payment exists; closes a top-up that never got one, tells the payer, records it
  t5 := pg_temp.ot(p1, 100, null, false);
  perform pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t5, p1));
  n := pg_temp.nn(p1, 'wallet_topup_cancelled');
  t := pg_temp.run_svc(format('select public.wallet_online_create_failed(%L, %L)::text', t2, 'x'));
  j := pg_temp.run_svc(format('select public.wallet_online_create_failed(%L, %L)::text', t5, 'Ozow said no'))::jsonb;
  n2 := pg_temp.nn(p1, 'wallet_topup_cancelled');
  select concat_ws(' ', tp.status, tp.decision_comment, tp.decided_at is not null, (select count(*) from wallet_provider_events e where e.topup_id = tp.id and e.outcome = 'attempt_failed' and e.detail = 'Could not start: Ozow said no')) into t2x
    from wallet_topups tp where tp.id = t5;
  r := r || pg_temp.chk('C35', 'create-failed does nothing once a payment exists; otherwise it closes the top-up as unsuccessful, tells the payer once and records why',
    (t::jsonb ->> 'closed') || ' | ' || concat_ws(' ', j ->> 'closed', j ->> 'status') || ' | ' || t2x || ' | ' || (n2 - n)::text, 'false | true unsuccessful | unsuccessful We could not start the online payment t 1 | 1');
  -- a claim lost for more than two minutes is closed on the next claim
  t6 := pg_temp.ot(p1, 100, null, false);
  perform pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t6, p1));
  update wallet_online_attempts set claimed_at = now() - interval '3 minutes' where topup_id = t6;
  n := pg_temp.nn(p1, 'wallet_topup_cancelled');
  j := pg_temp.run_svc(format('select public.wallet_online_claim(%L, %L)::text', t6, p1))::jsonb;
  n2 := pg_temp.nn(p1, 'wallet_topup_cancelled');
  select tp.status into t from wallet_topups tp where tp.id = t6;
  r := r || pg_temp.chk('C36', 'a claim older than 2 minutes with no payment id is closed as unsuccessful and the payer told once', concat_ws(' ', j ->> 'action', j ->> 'status', t, (n2 - n)::text), 'closed unsuccessful unsuccessful 1');

  -- ---- check now and the backstop's list ---------------------------------------------------------------------------------------------------
  t7 := pg_temp.ot(p3, 100, 'pay-7', true);
  t8 := pg_temp.ot(p3, 100, null, true);
  j := pg_temp.run_svc(format('select public.wallet_online_check_request(%L, %L)::text', t7, p3))::jsonb;
  t := (pg_temp.run_svc(format('select public.wallet_online_check_request(%L, %L)::text', t7, p3))::jsonb) ->> 'action';
  update wallet_online_attempts set check_requested_at = now() - interval '16 seconds' where topup_id = t7;
  r := r || pg_temp.chk('C37', 'check-now: allowed once, then "wait", allowed again after 15 seconds; nothing to check without a payment; closed and strangers are told so',
    concat_ws(' ', j ->> 'action', j ->> 'provider_payment_id') || ' | ' || t || ' | ' || (pg_temp.run_svc(format('select public.wallet_online_check_request(%L, %L)::text', t7, p3))::jsonb ->> 'action') || ' | '
    || (pg_temp.run_svc(format('select public.wallet_online_check_request(%L, %L)::text', t8, p3))::jsonb ->> 'action') || ' | ' || (pg_temp.run_svc(format('select public.wallet_online_check_request(%L, %L)::text', t5, p1))::jsonb ->> 'action') || ' | '
    || pg_temp.run_svc(format('select public.wallet_online_check_request(%L, %L)::text', t7, p2)),
    'check pay-7 | wait | check | nothing_to_check | closed | ERR: No such top-up');
  -- the backstop's list: a payment exists, older than 10 minutes, not asked in the last 10 minutes; a closed top-up and one without a payment never
  t9 := pg_temp.ot(p3, 100, 'pay-9', true);
  select count(*) into n from wallet_online_due_checks(100) d where d.topup_id = t9;
  update wallet_topups set created_at = now() - interval '11 minutes' where id = t9;
  update wallet_topups set created_at = now() - interval '11 minutes' where id in (t8, t5);
  select count(*) into n2 from wallet_online_due_checks(100) d where d.topup_id in (t9, t8, t5);
  perform pg_temp.run_svc(format('select public.wallet_online_mark_checked(%L)', t9));
  select count(*) into nfail from wallet_online_due_checks(100) d where d.topup_id = t9;
  select (a.checked_at is not null)::text into t from wallet_online_attempts a where a.topup_id = t9;
  update wallet_online_attempts set checked_at = now() - interval '11 minutes' where topup_id = t9;
  select count(*) into nlines from wallet_online_due_checks(100) d where d.topup_id = t9;
  r := r || pg_temp.chk('C38', 'due checks: a young top-up is not due, an old one with a payment is, one just checked is not, one checked 11 minutes ago is again; none without a payment or closed',
    concat_ws(' ', n, n2, nfail, t, nlines), '0 1 0 true 1');
  nfail := 0; nlines := 0;

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool shows only the START and the END of a long error. So: the passing ids are one short line, a failing check is printed in full, and the verdict and
  -- the NAMES of the failing checks come LAST. "N of 38 checks ran" is less than 38 when the chunk stopped early (the stop is then also named).
  select count(*) filter (where l ~ '^C[0-9]+ '),
         count(*) filter (where l ~ '^C[0-9]+ ' and l like '% FAIL (want %'),
         string_agg(split_part(l, ' ', 1), ' ') filter (where l ~ '^C[0-9]+ ' and l not like '% FAIL (want %'),
         string_agg(l, E'\n') filter (where l like '% FAIL (want %' or l like 'STOPPED%'),
         string_agg(case when l like 'STOPPED%' then 'STOPPED-EARLY' else split_part(l, ' ', 1) end, ', ') filter (where l like '% FAIL (want %' or l like 'STOPPED%')
    into nlines, nfail, okids, rep, failnames
    from regexp_split_to_table(r, E'\n') as l;
  raise exception E'WALLET ONLINE CHUNK 1 of 3 (rolled back, nothing kept)\nPASSED: %\n%\nRESULT chunk 1 of 3: % of 38 checks ran, % FAIL\nFAILING: %',
    coalesce(okids, 'none'), coalesce(rep, '(no failing line)'), nlines, nfail, coalesce(failnames, 'none');
end $$;
