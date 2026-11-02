-- Rolled-back test of WALLET BOOKING (phase 2 of the wallet + manual bank transfer system; migration 20261102210000). See README.md.
-- Needs phase 1 (20261102200100_wallet_core.sql) already on the database. Run the booking migration together with this file in one rolled-back statement:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/wallet_booking.sql supabase/migrations/20261102210000_wallet_booking.sql supabase/migrations/20261102210000_wallet_booking.sql
-- (the migration twice on purpose: the second run must change nothing). Every line ends "ok" or "FAIL (want ...)"; the first line gives the count.
-- Fixtures are made-up people (example.invalid) and the subject "Zorology", so real data cannot change a count. Time is not faked: requests are for days
-- one to two weeks ahead; "a session that has ended" is made by moving its start back.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '10 years')::date::text;
  v_l uuid := gen_random_uuid();   -- an adult learner who pays from a wallet
  v_o uuid := gen_random_uuid();   -- a second learner (a stranger; also pays for the rounding grid)
  v_p uuid := gen_random_uuid();   -- a parent
  v_m uuid := gen_random_uuid();   -- the parent's child, under 18
  v_s uuid := gen_random_uuid();   -- a third learner with a small wallet
  v_t uuid := gen_random_uuid();   -- a verified tutor, level 1A, police clearance, approved for Zorology, free every day
  a_fin uuid := gen_random_uuid(); -- finance_manager
  a_spt uuid := gen_random_uuid(); -- support_agent
  c_caps uuid; s1 uuid; e_l uuid; e_o uuid; e_m uuid; e_s uuid;
  q1 uuid; q2a uuid; q2b uuid; qusd uuid; qk uuid; qe1 uuid; qe2 uuid; qd uuid; qc uuid; qf0 uuid; q3 uuid; q4 uuid; q5 uuid; q6 uuid; qf1 uuid; qx uuid;
  qp uuid; rq1 uuid; rq2 uuid; rq3 uuid; fr1 uuid; fr2 uuid; qg uuid; qold1 uuid; qold2 uuid; qn uuid; qh0 uuid; qh1 uuid; qh2 uuid; qh3 uuid;
  s_1 uuid; s_3 uuid; s_4 uuid; s_5 uuid; s_6 uuid; s_f uuid; s_p uuid;
  n int; n2 int; n3 int; nq int; t text; t2 text; t3 text; ss record; j jsonb; bad text; ex_c int; px int; pct0 numeric; pct numeric; rate numeric;
  prices int[] := array[63, 33, 75, 188, 1, 2];
  prices2 int[] := array[188, 33, 75];
  nfail int; nlines int; rep text;
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
  -- the live accept (what the Worker calls), as the server's role
  execute $mk$
    create function pg_temp.try_claim(p_q uuid, p_u uuid) returns text language plpgsql as $f$
    declare j jsonb;
    begin
      set local role service_role;
      begin
        select public.claim_session_request(p_q, p_u) into j;
        reset role;
        return 'accepted (' || (j->>'mode') || ')';
      exception when others then
        reset role;
        return sqlerrm;
      end;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.inbox(p_q uuid, p_tutor uuid) returns int language plpgsql as $f$
    declare n int;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', p_tutor, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into n from public.available_requests_for_tutor() where id = p_q;
      reset role;
      return n;
    end $f$ $mk$;
  -- day n and hour n of a made-up timetable: six one-hour slots a day from 08:00, starting on a Monday two weeks ahead (the tutor is free every day)
  execute $mk$
    create function pg_temp.slot(n int) returns timestamptz language sql as $f$
      select ((date_trunc('week', now() at time zone 'Africa/Johannesburg') + interval '14 days')::date + (n / 6) + time '08:00' + (n % 6) * interval '2 hours') at time zone 'Africa/Johannesburg' $f$ $mk$;
  -- a request in the state a new one starts in ('initiated'); optionally addressed to a tutor
  execute $mk$
    create function pg_temp.mkreq(p_by uuid, p_stu uuid, p_enr uuid, p_slot int, p_price numeric, p_addr uuid default null, p_cur text default 'ZAR') returns uuid language plpgsql as $f$
    declare v uuid;
    begin
      insert into public.session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference,
             min_sub_tier_id, tier_id, charged_amount, institution_id, requested_tutor_id, expires_at, currency_code)
      values (p_stu, p_enr, p_by, pg_temp.slot(p_slot), 1, 'pending', 'initiated', 'wb_' || gen_random_uuid(), '1A', 1, p_price,
              (select id from public.schools_institutions where name = 'ZZ Wallet test school'), p_addr,
              case when p_addr is null then null else now() + interval '48 hours' end, p_cur)
      returning id into v;
      return v;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.send(p_u uuid, p_q uuid) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select concat_ws(''/'', x->>''held_rand'', x->>''available_rand'', x->>''already'') from (select public.send_request_wallet(%L) as x) s', p_q)) $f$ $mk$;
  execute $mk$ create function pg_temp.wb(p uuid) returns text language sql as $f$
      select coalesce((select available_rand || '/' || held_rand from public.wallets where profile_id = p), '0/0') $f$ $mk$;
  execute $mk$ create function pg_temp.nl(p_key text) returns int language sql as $f$
      select count(*)::int from public.wallet_ledger where idempotency_key = p_key $f$ $mk$;
  execute $mk$ create function pg_temp.nn(p_profile uuid, p_type text, p_like text) returns int language sql as $f$
      select count(*)::int from public.notifications where profile_id = p_profile and type = p_type and body like p_like $f$ $mk$;
  execute $mk$ create function pg_temp.netq() returns int language plpgsql as $f$
    declare n int; begin select count(*) into n from net.http_request_queue; return n; exception when others then return -1; end $f$ $mk$;
  execute $mk$ create function pg_temp.top(p_profile uuid, p_amount int) returns void language sql as $f$
      select public.wallet_post(p_profile, 'topup', p_amount, 0, 'wb-top:' || gen_random_uuid(), null, 'test top-up') $f$ $mk$;

  -- ---- people, school, subject, hours ---------------------------------------------------------------------------------------------------
  select id into c_caps from curricula where code = 'CAPS';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l, z, 'authenticated', 'authenticated', 'b.l.' || v_l || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}'),
    (v_o, z, 'authenticated', 'authenticated', 'b.o.' || v_o || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Otto', 'date_of_birth', adult), '{}'),
    (v_s, z, 'authenticated', 'authenticated', 'b.s.' || v_s || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Sam', 'date_of_birth', adult), '{}'),
    (v_p, z, 'authenticated', 'authenticated', 'b.p.' || v_p || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pat', 'date_of_birth', adult, 'phone_number', '081 234 5678'), '{}'),
    (v_t, z, 'authenticated', 'authenticated', 'b.t.' || v_t || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'date_of_birth', adult), '{}'),
    (a_fin, z, 'authenticated', 'authenticated', 'b.a1.' || a_fin || '@example.invalid', '{}'::jsonb, '{}'),
    (a_spt, z, 'authenticated', 'authenticated', 'b.a2.' || a_spt || '@example.invalid', '{}'::jsonb, '{}');
  update profiles set date_of_birth = adult::date where id in (v_l, v_o, v_s, v_p, v_t);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_m, z, 'authenticated', 'authenticated', 'b.m.' || v_m || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Mia', 'date_of_birth', minor),
     jsonb_build_object('created_by_guardian', v_p, 'relationship', 'mother'));
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (a_fin, 'Fin', 'Manager', 'b.a1.' || a_fin || '@example.invalid', '', 'finance_manager', true),
    (a_spt, 'Spt', 'Agent', 'b.a2.' || a_spt || '@example.invalid', '', 'support_agent', true);
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null, is_verified = true where id = v_t;
  insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    values (v_t, 'police_clearance'::public.doc_type, 'fixture/police-' || v_t, 'verified'::public.verification_status, (now() at time zone 'Africa/Johannesburg')::date);
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Wallet test school', 'caps', c_caps) returning id into s1;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    values (v_t, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified');
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) select v_t, d, '00:00', '24:00' from generate_series(0, 6) d;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_l, 'Zorology', 'Grade 10') returning id into e_l;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_o, 'Zorology', 'Grade 10') returning id into e_o;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_m, 'Zorology', 'Grade 10') returning id into e_m;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_s, 'Zorology', 'Grade 10') returning id into e_s;
  update system_settings set setting_value = 'false'::jsonb where setting_key in ('free_sessions_enabled', 'wallet_payments_enabled');
  r := r || 'S0 setup: 5 learners and parents (one child under 18), a verified tutor, 2 admins, a made-up school and subject' || E'\n';
  nq := pg_temp.netq();

  -- ---- sending a request: the switch, the wallet, the shortfall -------------------------------------------------------------------------------
  q1 := pg_temp.mkreq(v_l, v_l, e_l, 0, 180);
  pct0 := public.request_commission_pct(q1, 1);
  r := r || pg_temp.chk('B01', 'wallet closed: a request cannot be sent from the wallet', pg_temp.send(v_l, q1), 'ERR: Wallet payments are not open.');
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_payments_enabled';
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'free_sessions_enabled';
  r := r || pg_temp.chk('B02', 'free sessions on: free wins, the wallet stays closed', pg_temp.send(v_l, q1), 'ERR: Wallet payments are not open.');
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  r := r || pg_temp.chk('B03', 'a stranger cannot send someone else''s request', pg_temp.send(v_o, q1), 'ERR: That request is not yours, or does not exist.');
  r := r || pg_temp.chk('B04', 'a signed-out visitor cannot call it at all', substr(pg_temp.send(null, q1), 1, 36), 'ERR: permission denied for function ');
  perform pg_temp.top(v_l, 120);
  r := r || pg_temp.chk('B05', 'R120 in the wallet, R180 price: refused with the shortfall in words', pg_temp.send(v_l, q1), 'ERR: Your wallet has R120. This session is R180. Add R60 or more.');
  select payment_status || ' ' || paid_from_wallet || ' ' || coalesce(wallet_hold_rand::text, 'null') into t from session_requests where id = q1;
  r := r || pg_temp.chk('B06', 'the request stays as it was, the wallet is untouched, nothing is held, no tutor sees it',
    t || ' / ' || pg_temp.wb(v_l) || ' / ' || pg_temp.nl('hold:' || q1) || ' / ' || pg_temp.inbox(q1, v_t), 'initiated false null / 120/0 / 0 / 0');
  perform pg_temp.top(v_l, 380);
  r := r || pg_temp.chk('B07', 'R500 in the wallet: sent; R180 held, R320 left', pg_temp.send(v_l, q1), '180/320/false');
  select payment_status || ' ' || paid_from_wallet || ' ' || wallet_hold_rand into t from session_requests where id = q1;
  r := r || pg_temp.chk('B08', 'the request is now a verified request with the wallet flag; the wallet shows 320 available, 180 on hold', t || ' / ' || pg_temp.wb(v_l), 'card_verified true 180 / 320/180');
  select kind || ' ' || available_delta || ' ' || held_delta || ' ' || (request_id = q1) into t from wallet_ledger where idempotency_key = 'hold:' || q1;
  r := r || pg_temp.chk('B09', 'one hold line, keyed hold:<request>, moving 180 from available to on hold', t, 'hold -180 180 true');
  r := r || pg_temp.chk('B10', 'a second send changes nothing and says so', pg_temp.send(v_l, q1) || ' / ' || pg_temp.wb(v_l) || ' / ' || pg_temp.nl('hold:' || q1), '180/true / 320/180 / 1');
  r := r || pg_temp.chk('B11', 'now the verified tutor sees it in their requests, like any other', pg_temp.inbox(q1, v_t)::text, '1');

  perform pg_temp.top(v_o, 200);
  q2a := pg_temp.mkreq(v_o, v_o, e_o, 1, 150);
  q2b := pg_temp.mkreq(v_o, v_o, e_o, 2, 150);
  r := r || pg_temp.chk('B12', 'two requests, a wallet for one: the first is held', pg_temp.send(v_o, q2a), '150/50/false');
  r := r || pg_temp.chk('B13', 'the second is refused with the shortfall', pg_temp.send(v_o, q2b), 'ERR: Your wallet has R50. This session is R150. Add R100 or more.');
  select payment_status || ' / ' || (select count(*) from wallet_ledger where profile_id = v_o and kind = 'hold') into t from session_requests where id = q2b;
  r := r || pg_temp.chk('B14', 'the same rand is never held twice: one hold line, the second request unsent', t, 'initiated / 1');
  select string_agg(c, ' ') into t from (select code c from currencies where code <> 'ZAR' order by code limit 1) x;
  qusd := pg_temp.mkreq(v_l, v_l, e_l, 3, 100, null, coalesce(t, 'ZAR'));
  r := r || pg_temp.chk('B15', 'a request in another currency cannot be paid from the wallet', case when t is null then 'n/a' else pg_temp.send(v_l, qusd) end,
    case when t is null then 'n/a' else 'ERR: The wallet can only pay for requests in rand (ZAR).' end);
  perform pg_temp.top(v_p, 100);
  qk := pg_temp.mkreq(v_p, v_m, e_m, 4, 90);
  r := r || pg_temp.chk('B16', 'a parent pays for their child: the hold is on the parent''s wallet and the child has no wallet',
    pg_temp.send(v_p, qk) || ' / ' || pg_temp.wb(v_p) || ' / ' || (select count(*) from wallets where profile_id = v_m), '90/10/false / 10/90 / 0');

  -- ---- the hold goes back: expiry, decline, cancel (each once) ---------------------------------------------------------------------------------
  qe1 := pg_temp.mkreq(v_l, v_l, e_l, 5, 40);
  perform pg_temp.send(v_l, qe1);
  r := r || pg_temp.chk('B17', 'R40 more on hold', pg_temp.wb(v_l), '280/220');
  update session_requests set requested_start = now() - interval '2 hours' where id = qe1;
  perform public.expire_stale_paid_requests();
  select status into t from session_requests where id = qe1;
  r := r || pg_temp.chk('B18', 'expiry: the request is expired and the R40 is back', t || ' / ' || pg_temp.wb(v_l) || ' / ' || pg_temp.nl('release:' || qe1), 'expired / 320/180 / 1');
  perform public.expire_stale_paid_requests();
  r := r || pg_temp.chk('B19', 'the job run again releases nothing more', pg_temp.wb(v_l) || ' / ' || pg_temp.nl('release:' || qe1), '320/180 / 1');
  r := r || pg_temp.chk('B20', 'the learner is told the money is back, not that a card was not charged',
    pg_temp.nn(v_l, 'request_expired', '%R40 is back in your wallet%') || ' ' || pg_temp.nn(v_l, 'request_expired', '%card was not charged%'), '1 0');
  qe2 := pg_temp.mkreq(v_l, v_l, e_l, 6, 60, v_t);
  perform pg_temp.send(v_l, qe2);
  update session_requests set expires_at = now() - interval '1 minute' where id = qe2;
  perform public.expire_stale_paid_requests();
  r := r || pg_temp.chk('B21', 'an addressed request that the tutor let lapse: released once, with the wallet wording',
    pg_temp.wb(v_l) || ' / ' || pg_temp.nl('release:' || qe2) || ' / ' || pg_temp.nn(v_l, 'request_expired', '%R60 is back in your wallet%'), '320/180 / 1 / 1');
  qd := pg_temp.mkreq(v_l, v_l, e_l, 7, 70, v_t);
  perform pg_temp.send(v_l, qd);
  r := r || pg_temp.chk('B22', 'the tutor declines it', pg_temp.run_as(v_t, format('select (select 1 from (select public.decline_session_request(%L)) x)::text', qd)), '1');
  select status into t from session_requests where id = qd;
  r := r || pg_temp.chk('B23', 'declined: released once, the learner told in wallet words',
    t || ' / ' || pg_temp.wb(v_l) || ' / ' || pg_temp.nl('release:' || qd) || ' / ' || pg_temp.nn(v_l, 'request_declined', '%R70 is back in your wallet%'), 'declined / 320/180 / 1 / 1');
  qc := pg_temp.mkreq(v_l, v_l, e_l, 8, 30);
  perform pg_temp.send(v_l, qc);
  update session_requests set status = 'cancelled' where id = qc;
  update session_requests set status = 'pending' where id = qc;
  update session_requests set status = 'cancelled' where id = qc;
  r := r || pg_temp.chk('B24', 'cancelled (what an account closure does), even moved there twice: released once', pg_temp.wb(v_l) || ' / ' || pg_temp.nl('release:' || qc), '320/180 / 1');
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id,
         charged_amount, institution_id, free_session)
    values (v_l, e_l, v_l, now() - interval '2 hours', 1, 'pending', 'card_verified', 'wb_free0', '1A', 1, 50, s1, true) returning id into qf0;
  perform public.expire_stale_paid_requests();
  select status into t from session_requests where id = qf0;
  r := r || pg_temp.chk('B25', 'a free request that expires touches no wallet', t || ' / ' || pg_temp.wb(v_l) || ' / ' || (select count(*) from wallet_ledger where request_id = qf0), 'expired / 320/180 / 0');

  -- ---- accepting: the hold becomes the session's money ----------------------------------------------------------------------------------------
  pct := public.request_commission_pct(q1, 1);
  ex_c := floor(180 * pct / 100 + 0.5)::int;
  r := r || pg_temp.chk('B26', 'the tutor accepts: booked, answered like a paid request', pg_temp.try_claim(q1, v_t), 'accepted (already_paid)');
  r := r || pg_temp.chk('B27', 'no Paystack call was queued', (pg_temp.netq() - nq)::text, '0');
  select s.id, s.wallet_paid, s.free_session, s.gross_amount::int g, s.tutor_payout_amount::int p, s.platform_commission_pct = pct as same_pct, s.status, s.tutor_id into ss
    from sessions s join session_requests q on q.resulting_session_id = s.id where q.id = q1;
  s_1 := ss.id;
  r := r || pg_temp.chk('B28', 'the session is wallet-paid, not free, scheduled for the right tutor, carries the price and the whole-rand split',
    format('%s %s %s %s %s %s %s', ss.wallet_paid::text, ss.free_session::text, ss.g, ss.p, ss.same_pct::text, ss.status, (ss.tutor_id = v_t)::text), format('true false 180 %s true scheduled true', 180 - ex_c));
  select payment_status || ' ' || status || ' ' || commission_amount::int || ' ' || (charged_at is not null) || ' ' || (tutor_id = v_t) into t from session_requests where id = q1;
  r := r || pg_temp.chk('B29', 'the request ends "wallet_paid", accepted, with the commission and the time the money was committed', t, format('wallet_paid accepted %s true true', ex_c));
  select kind || ' ' || available_delta || ' ' || held_delta || ' ' || (session_id = s_1) into t from wallet_ledger where idempotency_key = 'charge:' || q1;
  r := r || pg_temp.chk('B30', 'one charge line takes the 180 out of on-hold; the hold is not released; the wallet shows 320 available, 0 on hold',
    t || ' / ' || pg_temp.nl('release:' || q1) || ' / ' || pg_temp.wb(v_l), 'charge 0 -180 true / 0 / 320/0');
  r := r || pg_temp.chk('B31', 'the learner is told what was taken from the wallet', pg_temp.nn(v_l, 'request_accepted', '%R180 was taken from your wallet%')::text, '1');
  r := r || pg_temp.chk('B32', 'a second accept is refused as for any request already taken', pg_temp.try_claim(q1, v_t), 'Another tutor already accepted this request, or it is no longer available.');
  r := r || pg_temp.chk('B33', 'the tutor is NOT credited yet', pg_temp.wb(v_t) || ' / ' || (select count(*) from wallet_ledger where profile_id = v_t), '0/0 / 0');
  select count(*) into n from unnest(array['public.create_wallet_session(uuid,uuid,integer)', 'public.wallet_hold_for_request(uuid,uuid,integer)', 'public.resend_request_without_card(uuid)',
    'public.wallet_booking_totals(jsonb)', 'public.wallet_release_hold()', 'public.wallet_credit_tutor()', 'public.guard_wallet_flags()']) f,
    unnest(array['anon', 'authenticated', 'service_role']) ro where has_function_privilege(ro, f, 'EXECUTE');
  r := r || pg_temp.chk('B34', 'no browser role and not the server role can run any private function', n::text, '0');
  r := r || pg_temp.chk('B35', 'only a signed-in user can run send_request_wallet', has_function_privilege('authenticated', 'public.send_request_wallet(uuid)', 'EXECUTE')::text
    || ' ' || has_function_privilege('anon', 'public.send_request_wallet(uuid)', 'EXECUTE')::text, 'true false');
  t := pg_temp.run_as(a_fin, 'select public.wallet_totals()::text');
  j := t::jsonb;
  r := r || pg_temp.chk('B36', 'wallet_totals: one booked session, its tutor share counted, and the figure to find in the bank',
    (j ->> 'booked_sessions') || ' ' || (j ->> 'booked_tutor_share_rand') || ' ' || ((j ->> 'held_for_others_rand')::int - (j ->> 'total_rand')::int), format('1 %s %s', 180 - ex_c, 180 - ex_c));

  -- ---- cancelling: refunded as wallet credit ------------------------------------------------------------------------------------------------------
  update session_requests set charged_at = now() - interval '8 days' where id = q1;
  r := r || pg_temp.chk('B37', 'the learner is bound by the cancellation window, as for a card',
    pg_temp.run_as(v_l, format('select (select 1 from (select public.cancel_session(%L, null)) x)::text', s_1)), 'ERR: The 7 day cancellation window for this booking has closed');
  select status::text into t from sessions where id = s_1;
  r := r || pg_temp.chk('B38', 'and nothing moved', t || ' / ' || pg_temp.wb(v_l) || ' / ' || pg_temp.nl('refund:' || s_1), 'scheduled / 320/0 / 0');
  r := r || pg_temp.chk('B39', 'the tutor can always cancel', pg_temp.run_as(v_t, format('select (select 1 from (select public.cancel_session(%L, ''tutor ill'')) x)::text', s_1)), '1');
  select s.status::text || ' ' || q.status || ' ' || q.payment_status into t from sessions s join session_requests q on q.resulting_session_id = s.id where s.id = s_1;
  select kind || ' ' || available_delta || ' ' || held_delta into t2 from wallet_ledger where idempotency_key = 'refund:' || s_1;
  r := r || pg_temp.chk('B40', 'session cancelled by the tutor, request wallet_refunded, one refund line, the full R180 back as credit, no Paystack call',
    t || ' / ' || t2 || ' / ' || pg_temp.wb(v_l) || ' / ' || (pg_temp.netq() - nq), 'cancelled_by_tutor cancelled wallet_refunded / refund 180 0 / 500/0 / 0');
  r := r || pg_temp.chk('B41', 'the learner is told', pg_temp.nn(v_l, 'session_cancelled', '%R180 is back in your wallet as credit%')::text, '1');
  r := r || pg_temp.chk('B42', 'cancelling again is refused and refunds nothing more', substr(pg_temp.run_as(v_t, format('select (select 1 from (select public.cancel_session(%L, null)) x)::text', s_1)), 1, 55)
    || ' / ' || pg_temp.nl('refund:' || s_1), 'ERR: Only an upcoming session can be cancelled / 1');
  q3 := pg_temp.mkreq(v_l, v_l, e_l, 9, 100);
  perform pg_temp.send(v_l, q3);
  perform pg_temp.try_claim(q3, v_t);
  select resulting_session_id into s_3 from session_requests where id = q3;
  r := r || pg_temp.chk('B43', 'the learner cancels inside the window', pg_temp.run_as(v_l, format('select (select 1 from (select public.cancel_session(%L, ''test'')) x)::text', s_3)), '1');
  select s.status::text || ' ' || q.payment_status into t from sessions s join session_requests q on q.resulting_session_id = s.id where s.id = s_3;
  r := r || pg_temp.chk('B44', 'cancelled by the learner, refunded as credit; the tutor and the payer are told',
    t || ' / ' || pg_temp.wb(v_l) || ' / ' || pg_temp.nn(v_t, 'session_cancelled', 'The learner cancelled the session. Reason: test') || ' ' || pg_temp.nn(v_l, 'session_cancelled', '%R100 is back in your wallet as credit%'),
    'cancelled_by_student wallet_refunded / 500/0 / 1 1');
  q4 := pg_temp.mkreq(v_l, v_l, e_l, 10, 80);
  perform pg_temp.send(v_l, q4);
  perform pg_temp.try_claim(q4, v_t);
  select resulting_session_id into s_4 from session_requests where id = q4;
  t := public.closure_cancel_session(s_4, false);
  select q.status || ' ' || q.payment_status into t2 from session_requests q where q.id = q4;
  r := r || pg_temp.chk('B45', 'an account closure refunds a wallet session as credit, once, and releases nothing extra',
    t || ' / ' || t2 || ' / ' || pg_temp.wb(v_l) || ' / ' || pg_temp.nl('refund:' || s_4) || ' / ' || pg_temp.nl('release:' || q4), 'refunded / cancelled wallet_refunded / 500/0 / 1 / 0');
  r := r || pg_temp.chk('B46', 'run again it skips and refunds nothing more', public.closure_cancel_session(s_4, false) || ' / ' || pg_temp.nl('refund:' || s_4), 'skipped / 1');

  -- ---- completing: the tutor is credited once, only then -------------------------------------------------------------------------------------------
  q5 := pg_temp.mkreq(v_l, v_l, e_l, 11, 200);
  perform pg_temp.send(v_l, q5);
  perform pg_temp.try_claim(q5, v_t);
  select resulting_session_id into s_5 from session_requests where id = q5;
  ex_c := floor(200 * pct / 100 + 0.5)::int;
  r := r || pg_temp.chk('B47', 'before completion the tutor has nothing', pg_temp.wb(v_t), '0/0');
  update sessions set scheduled_start = now() - interval '3 hours' where id = s_5;
  r := r || pg_temp.chk('B48', 'the tutor marks the session complete once it has ended', pg_temp.run_as(v_t, format('select (select 1 from (select public.complete_session(%L)) x)::text', s_5)), '1');
  select kind || ' ' || available_delta || ' ' || held_delta || ' ' || (session_id = s_5) || ' ' || (request_id = q5) into t from wallet_ledger where idempotency_key = 'credit:' || s_5;
  r := r || pg_temp.chk('B49', 'the tutor''s share is credited: one session_credit line carrying the session id; the learner''s wallet does not move',
    t || ' / ' || pg_temp.wb(v_t) || ' / ' || pg_temp.wb(v_l), format('session_credit %s 0 true true / %s/0 / 300/0', 200 - ex_c, 200 - ex_c));
  r := r || pg_temp.chk('B50', 'the tutor is told', pg_temp.nn(v_t, 'wallet_session_credit', '%added to your wallet%')::text, '1');
  update sessions set status = 'scheduled' where id = s_5;
  update sessions set status = 'completed' where id = s_5;
  r := r || pg_temp.chk('B51', 'completed twice: still credited once', pg_temp.nl('credit:' || s_5) || ' / ' || pg_temp.wb(v_t), format('1 / %s/0', 200 - ex_c));
  q6 := pg_temp.mkreq(v_l, v_l, e_l, 12, 100);
  perform pg_temp.send(v_l, q6);
  perform pg_temp.try_claim(q6, v_t);
  select resulting_session_id into s_6 from session_requests where id = q6;
  update sessions set scheduled_start = now() - interval '60 hours' where id = s_6;
  insert into platform_disputes (session_id, raised_by_id, reason, description, status) values (s_6, v_l, 'no_show', 'The tutor did not join the call', 'open');
  perform public.auto_complete_sessions();
  select status::text into t from sessions where id = s_6;
  r := r || pg_temp.chk('B52', 'an open problem report blocks the automatic completion, so there is no credit', t || ' / ' || pg_temp.nl('credit:' || s_6), 'scheduled / 0');
  update platform_disputes set status = 'dismissed' where session_id = s_6;
  perform public.auto_complete_sessions();
  perform public.auto_complete_sessions();
  select status::text into t from sessions where id = s_6;
  r := r || pg_temp.chk('B53', 'report closed: completed automatically (job run twice) and the tutor credited once', t || ' / ' || pg_temp.nl('credit:' || s_6) || ' / ' || pg_temp.wb(v_t),
    format('completed / 1 / %s/0', (200 - ex_c) + (100 - floor(100 * pct / 100 + 0.5)::int)));
  r := r || pg_temp.chk('B54', 'completed sessions leave the booked-tutor-share total',
    (pg_temp.run_as(a_fin, 'select public.wallet_totals()::text')::jsonb ->> 'booked_sessions'), '0');
  qf1 := pg_temp.mkreq(v_l, v_l, e_l, 13, 50);
  update session_requests set payment_status = 'card_verified', free_session = true where id = qf1;
  r := r || pg_temp.chk('B55', 'a free request is accepted the free way', pg_temp.try_claim(qf1, v_t), 'accepted (already_paid)');
  select resulting_session_id into s_f from session_requests where id = qf1;
  update sessions set scheduled_start = now() - interval '3 hours' where id = s_f;
  perform pg_temp.run_as(v_t, format('select (select 1 from (select public.complete_session(%L)) x)::text', s_f));
  select status::text || ' ' || wallet_paid into t from sessions where id = s_f;
  r := r || pg_temp.chk('B56', 'a free session completes and never credits the tutor', t || ' / ' || pg_temp.nl('credit:' || s_f) || ' / ' || (select count(*) from wallet_ledger where session_id = s_f), 'completed false / 0 / 0');

  -- ---- the flags cannot be set from outside ------------------------------------------------------------------------------------------------------------
  qx := pg_temp.mkreq(v_l, v_l, e_l, 14, 25);
  r := r || pg_temp.chk('B57', 'a learner cannot update their own request through the API (no row is reachable)',
    pg_temp.run_as(v_l, format('with u as (update public.session_requests set paid_from_wallet = true, wallet_hold_rand = 25, payment_status = ''wallet_paid'' where id = %L returning 1) select count(*)::text from u', qx)), '0');
  r := r || pg_temp.chk('B58', 'an admin''s update of the same row goes through but cannot change the wallet flags or the wallet states',
    pg_temp.run_as(a_fin, format('with u as (update public.session_requests set paid_from_wallet = true, wallet_hold_rand = 25, payment_status = ''wallet_paid'' where id = %L returning 1) select count(*)::text from u', qx))
    || ' ' || (select paid_from_wallet || ' ' || coalesce(wallet_hold_rand::text, 'null') || ' ' || payment_status from session_requests where id = qx), '1 false null initiated');
  r := r || pg_temp.chk('B59', 'an admin cannot flag a session as wallet-paid either', pg_temp.run_as(a_fin, format('with u as (update public.sessions set wallet_paid = true where id = %L returning 1) select count(*)::text from u', s_f))
    || ' ' || (select wallet_paid::text from sessions where id = s_f), '1 false');
  select max_allowed_rate into rate from sub_tier_definitions where id = '1A';
  update sub_tier_definitions set max_allowed_rate = 75 where id = '1A';   -- real rates are multiples of 10, so a half rand cannot arise today: make one
  t := pg_temp.run_as(v_l, format($q$with i as (insert into public.session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference,
      min_sub_tier_id, tier_id, charged_amount, institution_id, currency_code, paid_from_wallet, wallet_hold_rand)
      values (%L, %L, %L, %L, 1.5, 'wb_api_round', '1A', 1, 1, %L, 'ZAR', true, 99) returning charged_amount, paid_from_wallet, wallet_hold_rand, payment_status)
    select (charged_amount = round(%s * 1.5))::text || ' ' || (charged_amount = trunc(charged_amount))::text || ' ' || paid_from_wallet || ' ' || coalesce(wallet_hold_rand::text, 'null') || ' ' || payment_status from i$q$,
    v_l, e_l, v_l, pg_temp.slot(15), s1, 75));
  r := r || pg_temp.chk('B60', 'a learner''s own insert gets a price rounded to a whole rand (1.5 h at R75 an hour = R112.50), the wallet flags cleared, the usual start state', t, 'true true false null initiated');
  select charged_amount::numeric into pct from session_requests where paystack_reference = 'wb_api_round';
  r := r || pg_temp.chk('B61', 'a price with half a rand rounds up to the next rand (R112.50 becomes R113)', pct::int::text, '113');
  update sub_tier_definitions set max_allowed_rate = rate where id = '1A';
  pct := pct0;

  -- ---- price, commission and share are whole rands, and always add up -----------------------------------------------------------------------------------
  perform pg_temp.top(v_o, 5000);
  bad := '';
  for i in 1..array_length(prices, 1) loop
    qg := pg_temp.mkreq(v_o, v_o, e_o, 15 + i, prices[i]);
    perform pg_temp.send(v_o, qg);
    px := (public.request_commission_pct(qg, 1) * 100)::int;
    ex_c := (prices[i] * px + 5000) / 10000;
    perform pg_temp.try_claim(qg, v_t);
    select s.gross_amount::int g, s.tutor_payout_amount::int p, q.commission_amount::int c, s.gross_amount = trunc(s.gross_amount) and s.tutor_payout_amount = trunc(s.tutor_payout_amount) as whole into ss
      from sessions s join session_requests q on q.resulting_session_id = s.id where q.id = qg;
    if ss.g <> prices[i] or ss.c <> ex_c or ss.p <> prices[i] - ex_c or ss.g <> ss.p + ss.c or not ss.whole then
      bad := bad || format('[price %s pct %s: got %s+%s=%s want commission %s] ', prices[i], px, ss.p, ss.c, ss.g, ex_c);
    end if;
  end loop;
  r := r || pg_temp.chk('B62', format('the grid at the %s%% commission: 6 prices, each split into whole rands that add up to the price', pct0), coalesce(nullif(bad, ''), 'none'), 'none');
  update sub_tier_definitions set commission_rate_pct = 17.5 where id = '1A';
  update tier_definitions set commission_rate_pct = 17.5 where id = 1;
  bad := '';
  for i in 1..array_length(prices2, 1) loop
    qg := pg_temp.mkreq(v_o, v_o, e_o, 21 + i, prices2[i]);
    perform pg_temp.send(v_o, qg);
    px := (public.request_commission_pct(qg, 1) * 100)::int;
    if px <> 1750 then
      bad := bad || format('[commission read as %s, not 1750] ', px);
    end if;
    ex_c := (prices2[i] * 1750 + 5000) / 10000;
    perform pg_temp.try_claim(qg, v_t);
    select s.gross_amount::int g, s.tutor_payout_amount::int p, q.commission_amount::int c, true as whole into ss
      from sessions s join session_requests q on q.resulting_session_id = s.id where q.id = qg;
    if ss.g <> prices2[i] or ss.c <> ex_c or ss.p <> prices2[i] - ex_c or ss.g <> ss.p + ss.c then
      bad := bad || format('[price %s at 17.5: got %s+%s=%s want commission %s] ', prices2[i], ss.p, ss.c, ss.g, ex_c);
    end if;
  end loop;
  r := r || pg_temp.chk('B63', 'the grid at 17.5%: R188 pays R33 commission and R155 to the tutor, and the others add up too', coalesce(nullif(bad, ''), 'none'), 'none');
  update sub_tier_definitions set commission_rate_pct = pct0 where id = '1A';
  update tier_definitions set commission_rate_pct = pct0 where id = 1;

  -- ---- sending the same request to anyone ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.top(v_l, 1000);
  rq1 := pg_temp.mkreq(v_l, v_l, e_l, 25, 90, v_t);
  perform pg_temp.send(v_l, rq1);
  perform pg_temp.run_as(v_t, format('select (select 1 from (select public.decline_session_request(%L)) x)::text', rq1));
  t2 := pg_temp.wb(v_l);
  t := pg_temp.run_as(v_l, format('select public.resend_request_to_anyone(%L)::text', rq1));
  qn := case when t ~ '^[0-9a-f-]{36}$' then t::uuid end;
  select paid_from_wallet || ' ' || payment_status || ' ' || coalesce(wallet_hold_rand::text, 'null') || ' ' || (resent_from = rq1) || ' ' || (requested_tutor_id is null) || ' ' || status into t2
    from session_requests where id = qn;
  r := r || pg_temp.chk('B64', 'declined, then sent to anyone: a new request with its own hold (the old one was released), no card involved', coalesce(t2, t),
    'true card_verified 90 true true pending');
  r := r || pg_temp.chk('B65', 'the wallet shows the new hold once; the old request''s hold stays released',
    pg_temp.nl('hold:' || qn) || ' ' || pg_temp.nl('release:' || rq1) || ' / ' || pg_temp.wb(v_l), '1 1 / 1110/90');
  r := r || pg_temp.chk('B66', 'sending it to anyone twice is refused', pg_temp.run_as(v_l, format('select public.resend_request_to_anyone(%L)::text', rq1)), 'ERR: You already sent this request to anyone else.');
  perform pg_temp.top(v_s, 100);
  rq2 := pg_temp.mkreq(v_s, v_s, e_s, 26, 100, v_t);
  perform pg_temp.send(v_s, rq2);
  perform pg_temp.run_as(v_t, format('select (select 1 from (select public.decline_session_request(%L)) x)::text', rq2));
  perform public.wallet_post(v_s, 'adjustment', -100, 0, 'wb-spend:' || v_s, null, 'spent elsewhere');
  r := r || pg_temp.chk('B67', 'a learner whose wallet is now empty cannot send a declined request on: refused with the shortfall, nothing created',
    pg_temp.run_as(v_s, format('select public.resend_request_to_anyone(%L)::text', rq2)) || ' / ' || (select count(*) from session_requests where resent_from = rq2),
    'ERR: Your wallet has R0. This session is R100. Add R100 or more. / 0');
  rq3 := pg_temp.mkreq(v_l, v_l, e_l, 27, 20, v_t);
  perform pg_temp.send(v_l, rq3);
  t2 := pg_temp.wb(v_l);
  t := pg_temp.run_as(v_l, format('select public.resend_request_to_anyone(%L)::text', rq3));
  select (requested_tutor_id is null)::text into t from session_requests where id = rq3;
  r := r || pg_temp.chk('B68', 'a request still waiting is simply opened to anyone: no new request, no new hold', t || ' / ' || (t2 = pg_temp.wb(v_l)) || ' / ' || pg_temp.nl('hold:' || rq3), 'true / true / 1');
  -- the fold-in: in free mode a lapsed or declined request is sent on without looking for a saved card
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'free_sessions_enabled';
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id,
         charged_amount, institution_id, free_session, requested_tutor_id)
    values (v_l, e_l, v_l, pg_temp.slot(28), 1, 'declined', 'card_verified', 'wb_fr1', '1A', 1, 50, s1, true, v_t) returning id into fr1;
  t := pg_temp.run_as(v_l, format('select public.resend_request_to_anyone(%L)::text', fr1));
  qn := case when t ~ '^[0-9a-f-]{36}$' then t::uuid end;
  select free_session || ' ' || payment_status || ' ' || coalesce(payment_card_id::text, 'no card') || ' ' || (resent_from = fr1) || ' ' || paid_from_wallet into t2 from session_requests where id = qn;
  r := r || pg_temp.chk('B69', 'free mode: a declined free request is sent to anyone without a card (this used to be refused)', coalesce(t2, t), 'true card_verified no card true false');
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id,
         charged_amount, institution_id, free_session, requested_tutor_id)
    values (v_l, e_l, v_l, pg_temp.slot(29), 1, 'expired', 'card_verified', 'wb_fr2', '1A', 1, 50, s1, true, v_t) returning id into fr2;
  r := r || pg_temp.chk('B70', 'free mode off: a free request cannot be sent on', pg_temp.run_as(v_l, format('select public.resend_request_to_anyone(%L)::text', fr2)), 'ERR: Free sessions are not open any more. Send a new request.');

  -- ---- the retention job's settled list ----------------------------------------------------------------------------------------------------------------------
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id,
         charged_amount, institution_id, free_session, created_at, responded_at)
    values (v_l, e_l, v_l, now() - interval '10 years', 1, 'expired', 'free', 'wb_old1', '1A', 1, 50, s1, true, now() - interval '10 years', now() - interval '10 years') returning id into qold1;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id,
         charged_amount, institution_id, paid_from_wallet, wallet_hold_rand, created_at, responded_at)
    values (v_l, e_l, v_l, now() - interval '10 years', 1, 'expired', 'wallet_paid', 'wb_old2', '1A', 1, 50, s1, true, 50, now() - interval '10 years', now() - interval '10 years') returning id into qold2;
  r := r || pg_temp.chk('B71', 'retention: an old free request is now due for deletion; an old wallet-paid request is kept until phase 6 decides',
    (select count(*) from public.retention_due_requests() where rec_id = qold1) || ' ' || (select count(*) from public.retention_due_requests() where rec_id = qold2), '1 0');

  -- ---- the old paid path is untouched ----------------------------------------------------------------------------------------------------------------------------
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id,
         charged_amount, institution_id)
    values (v_l, e_l, v_l, pg_temp.slot(30), 1, 'pending', 'paid', 'wb_paid', '1A', 1, 50, s1) returning id into qp;
  r := r || pg_temp.chk('B72', 'a request paid up front by card is still accepted the old way', pg_temp.try_claim(qp, v_t), 'accepted (already_paid)');
  select s.wallet_paid || ' ' || s.free_session || ' ' || q.payment_status || ' ' || (select count(*) from wallet_ledger where request_id = qp) into t from sessions s join session_requests q on q.resulting_session_id = s.id where q.id = qp;
  s_p := (select resulting_session_id from session_requests where id = qp);
  r := r || pg_temp.chk('B73', 'it is not wallet-paid, not free, stays "paid" and has no wallet lines', t, 'false false paid 0');
  r := r || pg_temp.chk('B74', 'cancelling it reaches the old refund step (starts one, or says refunds are not set up here)',
    case when pg_temp.run_as(v_t, format('select (select 1 from (select public.cancel_session(%L, null)) x)::text', s_p)) in ('1', 'ERR: Refunds aren''t set up on this server yet — contact support') then 'refund step' else 'other' end, 'refund step');

  -- ---- the books balance -------------------------------------------------------------------------------------------------------------------------------------------
  j := public.wallet_check_balances();
  r := r || pg_temp.chk('B75', 'the balance check finds nothing wrong after all of this', (j ->> 'mismatch_count') || ' of ' || (j ->> 'checked'), '0 of ' || (j ->> 'checked'));
  r := r || pg_temp.chk('B76', 'conservation: the sum of all ledger lines equals the sum of all wallets',
    ((select coalesce(sum(available_delta + held_delta), 0) from wallet_ledger) = (select coalesce(sum(available_rand + held_rand), 0) from wallets))::text, 'true');
  r := r || pg_temp.chk('B77', 'the wallet shape rule: no request carries a hold amount without the flag', (select count(*) from session_requests where paid_from_wallet <> (wallet_hold_rand is not null))::text, '0');

  -- ---- booking is exactly as today while free sessions are on and the wallet switch is off (the state production stays in until phase 7) ---------------
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'free_sessions_enabled';
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'wallet_payments_enabled';
  qh0 := pg_temp.mkreq(v_l, v_l, e_l, 31, 70);
  r := r || pg_temp.chk('B78', 'free on, wallet off: a request cannot be sent from the wallet, and nothing about it changes',
    pg_temp.send(v_l, qh0) || ' / ' || (select payment_status || ' ' || paid_from_wallet || ' ' || coalesce(wallet_hold_rand::text, 'null') from session_requests where id = qh0) || ' / ' || pg_temp.nl('hold:' || qh0),
    'ERR: Wallet payments are not open. / initiated false null / 0');
  qh1 := pg_temp.mkreq(v_l, v_l, e_l, 32, 70);
  t := pg_temp.run_as(v_l, format('select public.send_request_free(%L)', qh1));
  t2 := pg_temp.try_claim(qh1, v_t);
  select s.free_session::text || ' ' || s.wallet_paid::text || ' ' || s.gross_amount::int || ' ' || s.tutor_payout_amount::int || ' ' || q.payment_status || ' ' || q.paid_from_wallet::text into t3
    from sessions s join session_requests q on q.resulting_session_id = s.id where q.id = qh1;
  r := r || pg_temp.chk('B79', 'free on, wallet off: a free request is sent and accepted exactly as before (free session, money stored as 0, request ends "free", no wallet line)',
    t || ' / ' || t2 || ' / ' || t3 || ' / ' || (select count(*) from wallet_ledger where request_id = qh1), 'free / accepted (already_paid) / true false 0 0 free false / 0');
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id,
         charged_amount, institution_id)
    values (v_l, e_l, v_l, pg_temp.slot(33), 1, 'pending', 'paid', 'wb_paid2', '1A', 1, 50, s1) returning id into qh2;
  t2 := pg_temp.try_claim(qh2, v_t);
  select s.wallet_paid::text || ' ' || s.free_session::text || ' ' || q.payment_status into t3 from sessions s join session_requests q on q.resulting_session_id = s.id where q.id = qh2;
  r := r || pg_temp.chk('B80', 'free on, wallet off: a request paid up front by card is accepted the old way, stays "paid", no wallet line', t2 || ' / ' || t3 || ' / ' || (select count(*) from wallet_ledger where request_id = qh2),
    'accepted (already_paid) / false false paid / 0');
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id,
         charged_amount, institution_id)
    values (v_l, e_l, v_l, pg_temp.slot(34), 1, 'pending', 'card_verified', 'wb_card3', '1A', 1, 50, s1) returning id into qh3;
  r := r || pg_temp.chk('B81', 'free on, wallet off: an ordinary card-checked request still goes down the card path (the wallet block does not touch it)',
    (position('Add your bank details in your tutor account' in pg_temp.try_claim(qh3, v_t)) > 0)::text, 'true');

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
    perform set_config('test.report', format(E'WALLET-BOOKING TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, nlines, rep), true);
  else
    raise exception E'WALLET-BOOKING TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, nlines, rep;
  end if;
end $$;
