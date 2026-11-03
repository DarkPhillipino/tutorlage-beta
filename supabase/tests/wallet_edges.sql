-- Rolled-back test of WALLET EDGES (phase 6 of the wallet + manual bank transfer system; migrations 20261103090000 and 20261103100000). See README.md.
-- Needs phases 1 and 2 and both phase 6 migrations already on the database (the audit labels file must have COMMITTED). Run alone, rolled back:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/wallet_edges.sql supabase/migrations/20261103100000_wallet_edges.sql supabase/migrations/20261103100000_wallet_edges.sql
-- (before applying: the migration twice on purpose, the second run must change nothing) or, once applied, this file by itself: it raises its own report.
-- Every line ends "ok" or "FAIL (want ...)"; the first line gives the count. Fixtures are made-up people (example.invalid) and the subject "Zorology", so real
-- data cannot change a count. Time is not faked: "old" is made by moving dates back (the append-only triggers are switched off for that and on again).
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_l uuid := gen_random_uuid();    -- the learner who pays from a wallet
  v_o uuid := gen_random_uuid();    -- a second learner (hand top-up, money returned)
  v_e uuid := gen_random_uuid();    -- a learner with no wallet at all
  v_c1 uuid := gen_random_uuid();   -- a learner who closes the account with money in the wallet
  v_t uuid := gen_random_uuid();    -- a verified tutor, level 1A, free every day
  v_t2 uuid := gen_random_uuid();   -- a tutor who closes the account with money and an open payout request
  a_fin uuid := gen_random_uuid();  -- finance_manager
  a_sup uuid := gen_random_uuid();  -- super_admin
  a_spt uuid := gen_random_uuid();  -- support_agent
  c_caps uuid; s1 uuid; e_l uuid; e_c1 uuid;
  qA uuid; qB uuid; qC uuid; qD uuid; qE uuid; qF uuid; qold uuid; qc1 uuid; qr1 uuid; qr2 uuid; qr3 uuid; qh1 uuid; qh2 uuid; qh3 uuid; qh0 uuid;
  sA uuid; sB uuid; sC uuid; sD uuid; sE uuid; sold uuid;
  tp_c1 uuid; tp_c1b uuid; tp1 uuid; tp2 uuid; tp3 uuid; tp4 uuid; tp5 uuid; tp_hand uuid; po_t2 uuid; po_old uuid; po_new uuid; po_open uuid;
  k1 uuid; k2 uuid;
  n int; n2 int; n3 int; t text; t2 text; t3 text; j jsonb; share int; red1 int; pct numeric; ex_c int;
  w_old uuid; w_bal uuid := gen_random_uuid(); w_new uuid := gen_random_uuid(); w_open uuid := gen_random_uuid();   -- four wallets for the retention checks (w_old is v_e)
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
    create function pg_temp.slot(n int) returns timestamptz language sql as $f$
      select ((date_trunc('week', now() at time zone 'Africa/Johannesburg') + interval '14 days')::date + (n / 6) + time '08:00' + (n % 6) * interval '2 hours') at time zone 'Africa/Johannesburg' $f$ $mk$;
  execute $mk$
    create function pg_temp.mkreq(p_by uuid, p_stu uuid, p_enr uuid, p_slot int, p_price numeric) returns uuid language plpgsql as $f$
    declare v uuid;
    begin
      insert into public.session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference,
             min_sub_tier_id, tier_id, charged_amount, institution_id, expires_at, currency_code)
      values (p_stu, p_enr, p_by, pg_temp.slot(p_slot), 1, 'pending', 'initiated', 'we_' || gen_random_uuid(), '1A', 1, p_price,
              (select id from public.schools_institutions where name = 'ZZ Edges test school'), null, 'ZAR')
      returning id into v;
      return v;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.send(p_u uuid, p_q uuid) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select concat_ws(''/'', x->>''held_rand'', x->>''available_rand'') from (select public.send_request_wallet(%L) as x) s', p_q)) $f$ $mk$;
  execute $mk$ create function pg_temp.wb(p uuid) returns text language sql as $f$
      select coalesce((select available_rand || '/' || held_rand from public.wallets where profile_id = p), '0/0') $f$ $mk$;
  execute $mk$ create function pg_temp.nl(p_key text) returns int language sql as $f$
      select count(*)::int from public.wallet_ledger where idempotency_key = p_key $f$ $mk$;
  execute $mk$ create function pg_temp.nn(p_profile uuid, p_type text, p_like text) returns int language sql as $f$
      select count(*)::int from public.notifications where profile_id = p_profile and type = p_type and body like p_like $f$ $mk$;
  execute $mk$ create function pg_temp.top(p_profile uuid, p_amount int) returns void language sql as $f$
      select public.wallet_post(p_profile, 'topup', p_amount, 0, 'we-top:' || gen_random_uuid(), null, 'test top-up') $f$ $mk$;
  execute $mk$ create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
      begin execute p_sql; return 'ok'; exception when others then return 'ERR: ' || sqlerrm; end $f$ $mk$;
  execute $mk$ create function pg_temp.has(p_res text, p_part text) returns text language sql as $f$
      select case when position(p_part in coalesce(p_res, '')) > 0 then 'yes' else coalesce(p_res, 'null') end $f$ $mk$;
  execute $mk$ create function pg_temp.aud(p_action text, p_id uuid) returns int language sql as $f$
      select count(*)::int from public.admin_audit_logs where action::text = p_action and target_entity_id = p_id $f$ $mk$;
  -- a request accepted and made a completed session (the tutor is credited by the trigger); returns the session id
  execute $mk$
    create function pg_temp.paid_done(p_q uuid, p_tutor uuid, p_done boolean) returns uuid language plpgsql as $f$
    declare v uuid;
    begin
      perform pg_temp.try_claim(p_q, p_tutor);
      select resulting_session_id into v from public.session_requests where id = p_q;
      if p_done then
        update public.sessions set scheduled_start = now() - interval '3 hours' where id = v;
        update public.sessions set status = 'completed', completed_at = now() where id = v;
      end if;
      return v;
    end $f$ $mk$;

  -- ---- people, school, subject, hours ---------------------------------------------------------------------------------------------------
  select id into c_caps from curricula where code = 'CAPS';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l, z, 'authenticated', 'authenticated', 'e.l.' || v_l || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}'),
    (v_o, z, 'authenticated', 'authenticated', 'e.o.' || v_o || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Otto', 'date_of_birth', adult), '{}'),
    (v_e, z, 'authenticated', 'authenticated', 'e.e.' || v_e || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Eve', 'date_of_birth', adult), '{}'),
    (v_c1, z, 'authenticated', 'authenticated', 'e.c1.' || v_c1 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cleo', 'date_of_birth', adult), '{}'),
    (v_t, z, 'authenticated', 'authenticated', 'e.t.' || v_t || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'date_of_birth', adult), '{}'),
    (v_t2, z, 'authenticated', 'authenticated', 'e.t2.' || v_t2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tom', 'date_of_birth', adult), '{}'),
    (a_fin, z, 'authenticated', 'authenticated', 'e.a1.' || a_fin || '@example.invalid', '{}'::jsonb, '{}'),
    (a_sup, z, 'authenticated', 'authenticated', 'e.a2.' || a_sup || '@example.invalid', '{}'::jsonb, '{}'),
    (a_spt, z, 'authenticated', 'authenticated', 'e.a3.' || a_spt || '@example.invalid', '{}'::jsonb, '{}'),
    (w_bal, z, 'authenticated', 'authenticated', 'e.w1.' || w_bal || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Wim', 'date_of_birth', adult), '{}'),
    (w_new, z, 'authenticated', 'authenticated', 'e.w2.' || w_new || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Wes', 'date_of_birth', adult), '{}'),
    (w_open, z, 'authenticated', 'authenticated', 'e.w3.' || w_open || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Win', 'date_of_birth', adult), '{}');
  w_old := v_e;
  update profiles set date_of_birth = adult::date where id in (v_l, v_o, v_e, v_c1, v_t, v_t2, w_bal, w_new, w_open);
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (a_fin, 'Fin', 'Manager', 'e.a1.' || a_fin || '@example.invalid', '', 'finance_manager', true),
    (a_sup, 'Sue', 'Super', 'e.a2.' || a_sup || '@example.invalid', '', 'super_admin', true),
    (a_spt, 'Spt', 'Agent', 'e.a3.' || a_spt || '@example.invalid', '', 'support_agent', true);
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null, is_verified = true where id = v_t;
  insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    values (v_t, 'police_clearance'::public.doc_type, 'fixture/police-' || v_t, 'verified'::public.verification_status, (now() at time zone 'Africa/Johannesburg')::date);
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Edges test school', 'caps', c_caps) returning id into s1;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    values (v_t, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified');
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) select v_t, d, '00:00', '24:00' from generate_series(0, 6) d;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_l, 'Zorology', 'Grade 10') returning id into e_l;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_c1, 'Zorology', 'Grade 10') returning id into e_c1;
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_payments_enabled';
  r := r || 'S0 setup: 6 people, a verified tutor, 3 admins (finance, super, support), a made-up school and subject, wallet switch ON for the run' || E'\n';

  -- ---- a refund after the tutor was credited ------------------------------------------------------------------------------------------------
  perform pg_temp.top(v_l, 1000);
  qA := pg_temp.mkreq(v_l, v_l, e_l, 0, 200);
  perform pg_temp.send(v_l, qA);
  sA := pg_temp.paid_done(qA, v_t, true);
  select tutor_payout_amount::int into share from sessions where id = sA;
  r := r || pg_temp.chk('E01', 'setup: a R200 session paid from the wallet and completed; the tutor was credited their share once', pg_temp.wb(v_l) || ' / ' || pg_temp.wb(v_t) || ' / ' || pg_temp.nl('credit:' || sA),
    format('800/0 / %s/0 / 1', share));
  r := r || pg_temp.chk('E02', 'a support agent cannot refund', pg_temp.run_as(a_spt, format('select public.admin_refund_to_wallet(%L, 50, ''problem reported'', true, %L)::text', sA, gen_random_uuid())), 'ERR: Finance admins only');
  r := r || pg_temp.chk('E03', 'a signed-out visitor cannot call it', substr(pg_temp.run_as(null, format('select public.admin_refund_to_wallet(%L, 50, ''problem reported'', true, %L)::text', sA, gen_random_uuid())), 1, 36),
    'ERR: permission denied for function ');
  r := r || pg_temp.chk('E04', 'amount 0 and a missing reason are both refused',
    pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_refund_to_wallet(%L, 0, ''problem reported'', true, %L)::text', sA, gen_random_uuid())), 'Give the amount to refund') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_refund_to_wallet(%L, 50, ''  '', true, %L)::text', sA, gen_random_uuid())), 'A written reason is needed'), 'yes yes');
  r := r || pg_temp.chk('E05', 'a session that does not exist is refused', pg_temp.run_as(a_fin, format('select public.admin_refund_to_wallet(%L, 50, ''problem reported'', true, %L)::text', gen_random_uuid(), gen_random_uuid())), 'ERR: No such session');
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id,
         charged_amount, institution_id)
    values (v_l, e_l, v_l, pg_temp.slot(1), 1, 'pending', 'paid', 'we_paid', '1A', 1, 50, s1) returning id into qold;
  sold := pg_temp.paid_done(qold, v_t, true);
  r := r || pg_temp.chk('E06', 'a session paid by card (not from a wallet) cannot be refunded here', pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_refund_to_wallet(%L, 10, ''problem reported'', true, %L)::text', sold, gen_random_uuid())), 'was not paid from a wallet'), 'yes');
  qB := pg_temp.mkreq(v_l, v_l, e_l, 2, 100);
  perform pg_temp.send(v_l, qB);
  sB := pg_temp.paid_done(qB, v_t, false);
  perform pg_temp.top(v_l, 100);   -- puts the R100 this booked session took back, so the numbers below stay round
  r := r || pg_temp.chk('E07', 'a booked session that has not happened is refused (it is cancelled instead)', pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_refund_to_wallet(%L, 10, ''problem reported'', true, %L)::text', sB, gen_random_uuid())), 'Only a finished session'), 'yes');

  k1 := gen_random_uuid();
  t := pg_temp.run_as(a_fin, format('select public.admin_refund_to_wallet(%L, 80, ''Session did not happen as agreed'', true, %L)::text', sA, k1));
  red1 := floor(80 * share / 200.0 + 0.5)::int;
  r := r || pg_temp.chk('E08', 'refund R80: the answer, the learner has R80 more, the tutor loses the same share of their credit',
    (t::jsonb ->> 'already') || ' ' || (t::jsonb ->> 'refunded_rand') || ' ' || (t::jsonb ->> 'tutor_reduced_rand') || ' ' || (t::jsonb ->> 'tutor_shortfall_rand') || ' / ' || pg_temp.wb(v_l) || ' / ' || pg_temp.wb(v_t),
    format('false 80 %s 0 / 880/0 / %s/0', red1, share - red1));
  select l.kind || ' ' || l.available_delta || ' ' || (l.session_id = sA) || ' ' || (l.actor_id = a_fin) into t2 from wallet_ledger l where l.idempotency_key = 'adminrefund:' || k1;
  select l.kind || ' ' || l.available_delta || ' ' || (l.session_id = sA) into t3 from wallet_ledger l where l.idempotency_key = 'adminrefundtutor:' || k1;
  r := r || pg_temp.chk('E09', 'two ledger lines: a refund for the learner and a refund_reversal for the tutor, both tied to the session', t2 || ' / ' || t3, format('refund 80 true true / refund_reversal %s true', -red1));
  r := r || pg_temp.chk('E10', 'both are told (the learner reads the reason, the tutor is not told it), and one audit line',
    pg_temp.nn(v_l, 'wallet_refunded', '%R80 was added%Session did not happen as agreed') || ' ' || pg_temp.nn(v_t, 'wallet_adjusted', format('R%s was taken from your wallet%%', red1)) || ' ' || pg_temp.nn(v_t, 'wallet_adjusted', '%did not happen%') || ' ' || pg_temp.aud('wallet_refunded_to_learner', sA), '1 1 0 1');
  t := pg_temp.run_as(a_fin, format('select public.admin_refund_to_wallet(%L, 80, ''Session did not happen as agreed'', true, %L)::text', sA, k1));
  r := r || pg_temp.chk('E11', 'the same click again (same key) changes nothing and says so', (t::jsonb ->> 'already') || ' / ' || pg_temp.wb(v_l) || ' / ' || pg_temp.wb(v_t) || ' / ' || pg_temp.aud('wallet_refunded_to_learner', sA),
    format('true / 880/0 / %s/0 / 1', share - red1));
  k2 := gen_random_uuid();
  t := pg_temp.run_as(a_sup, format('select public.admin_refund_to_wallet(%L, 120, ''Rest of the session refunded'', true, %L)::text', sA, k2));
  select coalesce(-sum(available_delta), 0)::int into n from wallet_ledger where kind = 'refund_reversal' and session_id = sA;
  r := r || pg_temp.chk('E12', 'the rest (R120, by a super admin): the learner is whole again, and the two reductions add up to exactly the tutor''s credit, never more',
    (t::jsonb ->> 'refunded_total_rand') || ' / ' || pg_temp.wb(v_l) || ' / ' || n || ' / ' || pg_temp.wb(v_t), format('200 / 1000/0 / %s / 0/0', share));
  r := r || pg_temp.chk('E13', 'one rand more is refused: nothing is left to refund', pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_refund_to_wallet(%L, 1, ''too much'', true, %L)::text', sA, gen_random_uuid())), 'At most R0 can still be refunded'), 'yes');

  -- the tutor is left alone when the finance admin says so, and when the wallet cannot cover it
  qC := pg_temp.mkreq(v_l, v_l, e_l, 3, 200);
  perform pg_temp.send(v_l, qC);
  sC := pg_temp.paid_done(qC, v_t, true);
  t := pg_temp.run_as(a_fin, format('select public.admin_refund_to_wallet(%L, 50, ''Part refund, tutor not charged'', false, %L)::text', sC, gen_random_uuid()));
  r := r || pg_temp.chk('E14', 'take-back switched off: the learner gets R50, the tutor keeps their whole credit, no reversal line',
    (t::jsonb ->> 'tutor_reduced_rand') || ' / ' || pg_temp.wb(v_l) || ' / ' || pg_temp.wb(v_t) || ' / ' || (select count(*) from wallet_ledger where kind = 'refund_reversal' and session_id = sC),
    format('0 / 850/0 / %s/0 / 0', share));
  qD := pg_temp.mkreq(v_l, v_l, e_l, 4, 200);
  perform pg_temp.send(v_l, qD);
  sD := pg_temp.paid_done(qD, v_t, true);
  t := pg_temp.run_as(v_t, $q$ select public.save_my_bank_details('Test Bank', '12345678', '250655', 'T Tutor') $q$);
  t := pg_temp.run_as(v_t, $q$ select public.request_my_payout()::text $q$);
  r := r || pg_temp.chk('E15', 'the tutor then asks to be paid: everything is on hold, nothing available', pg_temp.wb(v_t), format('0/%s', 2 * share));
  t := pg_temp.run_as(a_fin, format('select public.admin_refund_to_wallet(%L, 100, ''Problem reported after payout'', true, %L)::text', sD, gen_random_uuid()));
  red1 := floor(100 * share / 200.0 + 0.5)::int;
  r := r || pg_temp.chk('E16', 'the tutor cannot cover it: the learner is still refunded in full, nothing is taken from the tutor, the shortfall is reported and nothing goes below zero',
    (t::jsonb ->> 'tutor_reduced_rand') || ' ' || (t::jsonb ->> 'tutor_shortfall_rand') || ' / ' || pg_temp.wb(v_l) || ' / ' || pg_temp.wb(v_t) || ' / ' || (select count(*) from wallet_ledger where kind = 'refund_reversal' and session_id = sD),
    format('0 %s / 750/0 / 0/%s / 0', red1, 2 * share));
  j := (pg_temp.run_as(a_fin, format('select jsonb_agg(to_jsonb(x))::text from public.admin_wallet_sessions(%L) x', v_l)))::jsonb;
  select count(*)::text || ' ' || bool_and((x ->> 'price_rand')::int > 0)::text into t from jsonb_array_elements(j) x;
  r := r || pg_temp.chk('E17', 'the sessions a wallet paid for are listed for the refund screen (the 4 wallet sessions), each with a price', t, '4 true');
  select (x ->> 'refunded_rand') || ' ' || (x ->> 'tutor_credited') || ' ' || (x ->> 'tutor_reduced_rand') || ' ' || (x ->> 'status') into t from jsonb_array_elements(j) x where (x ->> 'session_id')::uuid = sA;
  r := r || pg_temp.chk('E18', 'the refunded session shows what went back and what the tutor lost', t, format('200 true %s completed', share));
  r := r || pg_temp.chk('E19', 'a support agent cannot list them', pg_temp.run_as(a_spt, format('select count(*)::text from public.admin_wallet_sessions(%L)', v_l)), 'ERR: Finance admins only');

  -- ---- money out by hand, and a transfer credited by hand ---------------------------------------------------------------------------------------
  k1 := gen_random_uuid();
  t := pg_temp.run_as(a_fin, format('select public.admin_add_topup_by_hand(%L, 300, ''FNB 4471'', ''Paid with the wrong reference, checked in the bank app'', %L)::text', v_o, k1));
  tp_hand := k1;
  select tp.status || ' ' || tp.received_rand || ' ' || (tp.reference ~ '^TL-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$')::text || ' ' || (tp.decision_comment like 'Added by hand: Paid with the wrong reference%(bank reference FNB 4471)') into t2
    from wallet_topups tp where tp.id = tp_hand;
  r := r || pg_temp.chk('E20', 'a transfer with no proof is credited by hand: a real top-up record (successful, with a reference and the reason), R300 in the wallet, the learner told, one audit line',
    t2 || ' / ' || pg_temp.wb(v_o) || ' / ' || pg_temp.nn(v_o, 'wallet_topup_added', '%R300 was added%') || ' / ' || pg_temp.aud('wallet_topup_successful', tp_hand), 'successful 300 true true / 300/0 / 1 / 1');
  t := pg_temp.run_as(a_fin, format('select public.admin_add_topup_by_hand(%L, 300, ''FNB 4471'', ''Paid with the wrong reference, checked in the bank app'', %L)::text', v_o, k1));
  r := r || pg_temp.chk('E21', 'the same click again credits nothing more', (t::jsonb ->> 'already') || ' / ' || pg_temp.wb(v_o) || ' / ' || (select count(*) from wallet_topups where profile_id = v_o), 'true / 300/0 / 1');
  r := r || pg_temp.chk('E22', 'a support agent cannot, and a reason, an amount and a person are all required',
    pg_temp.run_as(a_spt, format('select public.admin_add_topup_by_hand(%L, 10, null, ''because'', %L)::text', v_o, gen_random_uuid())) || ' / '
    || pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_add_topup_by_hand(%L, 10, null, ''x'', %L)::text', v_o, gen_random_uuid())), 'A written reason is needed') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_add_topup_by_hand(%L, 0, null, ''a real reason'', %L)::text', v_o, gen_random_uuid())), 'Give the amount received') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_add_topup_by_hand(%L, 10, null, ''a real reason'', %L)::text', gen_random_uuid(), gen_random_uuid())), 'No such person'),
    'ERR: Finance admins only / yes yes yes');
  t := pg_temp.run_as(a_fin, format('select public.admin_add_topup_by_hand(%L, 10000, null, ''Large transfer, checked in the bank app'', %L)::text', v_o, gen_random_uuid()));
  r := r || pg_temp.chk('E23', 'the balance cap does not stop a transfer that is already in the bank', pg_temp.wb(v_o), '10300/0');

  k1 := gen_random_uuid();
  t := pg_temp.run_as(a_fin, format('select public.admin_return_wallet_money(%L, 100, ''Learner asked support to take R100 out'', ''EFT-77'', %L)::text', v_o, k1));
  select l.kind || ' ' || l.available_delta || ' ' || l.held_delta || ' ' || (l.note like 'Returned by hand: Learner asked support to take R100 out (bank reference EFT-77)') into t2 from wallet_ledger l where l.idempotency_key = 'return:' || k1;
  r := r || pg_temp.chk('E24', 'R100 returned by hand: a withdrawal line with the reason and the bank reference, the wallet down by R100, the person told, one audit line',
    t2 || ' / ' || pg_temp.wb(v_o) || ' / ' || pg_temp.nn(v_o, 'wallet_money_returned', '%R100%') || ' / ' || pg_temp.aud('wallet_money_returned', v_o), 'withdrawal -100 0 true / 10200/0 / 1 / 1');
  t := pg_temp.run_as(a_fin, format('select public.admin_return_wallet_money(%L, 100, ''Learner asked support to take R100 out'', ''EFT-77'', %L)::text', v_o, k1));
  r := r || pg_temp.chk('E25', 'the same click again returns nothing more', (t::jsonb ->> 'already') || ' / ' || pg_temp.wb(v_o), 'true / 10200/0');
  r := r || pg_temp.chk('E26', 'more than is available, a missing reason, amount 0, a person with no wallet and a support agent are all refused',
    pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_return_wallet_money(%L, 99999, ''too much'', null, %L)::text', v_o, gen_random_uuid())), 'The wallet has R10200 available') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_return_wallet_money(%L, 5, ''  '', null, %L)::text', v_o, gen_random_uuid())), 'A written reason is needed') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_return_wallet_money(%L, 0, ''a real reason'', null, %L)::text', v_o, gen_random_uuid())), 'Give the amount returned') || ' '
    || pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_return_wallet_money(%L, 5, ''a real reason'', null, %L)::text', v_e, gen_random_uuid())), 'That person has no wallet') || ' '
    || pg_temp.run_as(a_spt, format('select public.admin_return_wallet_money(%L, 5, ''a real reason'', null, %L)::text', v_o, gen_random_uuid())),
    'yes yes yes yes ERR: Finance admins only');
  r := r || pg_temp.chk('E27', 'money on hold (a tutor''s open payout request) cannot be returned this way', pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_return_wallet_money(%L, 5, ''a real reason'', null, %L)::text', v_t, gen_random_uuid())), 'Money on hold belongs to a payout request'), 'yes');
  t := pg_temp.run_as(a_fin, format('select public.admin_open_tutor_bank_details(%L)::text', v_t));
  r := r || pg_temp.chk('E28', 'a tutor''s full bank details open for the finance admin with an audit line; a support agent and a person with none are refused',
    (t::jsonb ->> 'account_number') || ' ' || pg_temp.aud('wallet_bank_details_opened', v_t) || ' / ' || pg_temp.run_as(a_spt, format('select public.admin_open_tutor_bank_details(%L)::text', v_t)) || ' / '
    || pg_temp.has(pg_temp.run_as(a_fin, format('select public.admin_open_tutor_bank_details(%L)::text', v_t2)), 'No bank details are kept'), '12345678 1 / ERR: Finance admins only / yes');
  r := r || pg_temp.chk('E29', 'the ledger still refuses an edit or a delete, even for the owner', pg_temp.has(pg_temp.try($q$ delete from public.wallet_ledger where idempotency_key like 'adminrefund:%' $q$), 'can only be added to') || ' '
    || pg_temp.has(pg_temp.try($q$ update public.wallet_ledger set note = 'x' where idempotency_key like 'adminrefund:%' $q$), 'can only be added to'), 'yes yes');
  r := r || pg_temp.chk('E30', 'the new ledger kinds keep the money rules (a withdrawal or a reversal that adds money is refused)',
    pg_temp.has(pg_temp.try(format($q$ select public.wallet_post(%L, 'withdrawal', 5, 0, 'bad:' || gen_random_uuid()) $q$, v_o)), 'wallet_ledger_shape') || ' '
    || pg_temp.has(pg_temp.try(format($q$ select public.wallet_post(%L, 'refund_reversal', 5, 0, 'bad:' || gen_random_uuid()) $q$, v_t)), 'wallet_ledger_shape'), 'yes yes');
  j := public.wallet_check_balances();
  r := r || pg_temp.chk('E31', 'the balance check finds nothing wrong after all of this, and the books balance',
    (j ->> 'mismatch_count') || ' ' || ((select coalesce(sum(available_delta + held_delta), 0) from wallet_ledger) = (select coalesce(sum(available_rand + held_rand), 0) from wallets))::text, '0 true');

  -- ---- closing an account with money in the wallet ---------------------------------------------------------------------------------------------
  perform pg_temp.top(v_c1, 500);
  qc1 := pg_temp.mkreq(v_c1, v_c1, e_c1, 5, 70);
  perform pg_temp.send(v_c1, qc1);
  insert into wallet_topups (profile_id, reference, amount_rand) values (v_c1, 'TL-ABCDEF', 90) returning id into tp_c1;
  insert into wallet_topups (profile_id, reference, amount_rand) values (v_c1, 'TL-GHJKLM', 150) returning id into tp_c1b;
  update wallet_topups set status = 'proof_sent', proof_path = v_c1 || '/' || tp_c1b || '.pdf', proof_attached_at = now() where id = tp_c1b;
  t := pg_temp.run_as(v_c1, 'select public.preview_account_closure(null)::text');
  j := t::jsonb;
  r := r || pg_temp.chk('E40', 'the closing screen shows the wallet: available, on hold, open top-ups, and the bank transfer not yet confirmed',
    (j -> 'accounts' -> 0 -> 'wallet' ->> 'available_rand') || ' ' || (j -> 'accounts' -> 0 -> 'wallet' ->> 'held_rand') || ' ' || (j -> 'accounts' -> 0 -> 'wallet' ->> 'open_topups') || ' ' || (j -> 'accounts' -> 0 -> 'wallet' ->> 'unconfirmed_rand'),
    '430 70 2 150');
  r := r || pg_temp.chk('E41', 'a person with nothing in a wallet gets no wallet section', jsonb_typeof((pg_temp.run_as(v_e, 'select public.preview_account_closure(null)::text'))::jsonb -> 'accounts' -> 0 -> 'wallet'), 'null');
  perform public.wallet_post(v_t2, 'session_credit', 120, 0, 'we-cr:' || gen_random_uuid(), null, 'test credit');
  t := pg_temp.run_as(v_t2, $q$ select public.save_my_bank_details('Test Bank', '87654321', '250655', 'Tom Two') $q$);
  t := pg_temp.run_as(v_t2, $q$ select public.request_my_payout()::text $q$);
  select id into po_t2 from payout_requests where tutor_id = v_t2 and status = 'requested';
  perform public.wallet_post(v_t2, 'session_credit', 20, 0, 'we-cr:' || gen_random_uuid(), null, 'test credit 2');
  j := (pg_temp.run_as(v_t2, 'select public.preview_account_closure(null)::text'))::jsonb;
  r := r || pg_temp.chk('E42', 'a tutor''s closing screen: owed = the whole wallet (R20 available + R120 in an open payout request)',
    ((j -> 'accounts' -> 0 ->> 'payout_owed')::numeric)::int || ' ' || (j -> 'accounts' -> 0 -> 'wallet' ->> 'available_rand') || ' ' || (j -> 'accounts' -> 0 -> 'wallet' ->> 'held_rand') || ' ' || (j -> 'accounts' -> 0 -> 'wallet' ->> 'open_payout_rand'), '140 20 120 120');
  j := (pg_temp.run_as(v_t, 'select public.preview_account_closure(null)::text'))::jsonb;
  select coalesce(sum(s.tutor_payout_amount), 0)::int into n from sessions s where s.tutor_id = v_t and s.status = 'completed' and s.completed_at > now() - interval '7 days' and not s.wallet_paid;
  select coalesce(available_rand + held_rand, 0) into n2 from wallets where profile_id = v_t;
  r := r || pg_temp.chk('E43', 'wallet-paid sessions finished this week are not counted twice (owed = the wallet + only the sessions not paid from a wallet)',
    (j -> 'accounts' -> 0 ->> 'payout_owed')::numeric::int || '', (n + n2)::text);

  perform public.closure_run(array[v_c1], a_fin, 'admin_request', 'Tester', now() - interval '1 hour', 'checked by the test', 'REF-E1', null);
  select status into t from session_requests where id = qc1;
  select string_agg(status, ',' order by reference) into t2 from wallet_topups where profile_id = v_c1;
  r := r || pg_temp.chk('E44', 'closing a learner: the pending request is withdrawn and its hold goes back, the top-up with no proof is cancelled, the one with proof stays, and NO balance is touched',
    t || ' / ' || pg_temp.wb(v_c1) || ' / ' || t2, 'cancelled / 500/0 / cancelled,proof_sent');
  r := r || pg_temp.chk('E45', 'the finance admins (finance and super) are told, nobody else',
    pg_temp.nn(a_fin, 'closure_wallet_money', '%R500 available%') || ' ' || pg_temp.nn(a_sup, 'closure_wallet_money', '%R500 available%') || ' ' || pg_temp.nn(a_spt, 'closure_wallet_money', '%'), '1 1 0');
  perform public.closure_run(array[v_t2], a_fin, 'admin_request', 'Tester', now() - interval '1 hour', 'checked by the test', 'REF-E2', null);
  select p.status || ' ' || p.amount_rand into t from payout_requests p where p.id = po_t2;
  r := r || pg_temp.chk('E46', 'closing a tutor: the open payout request and the balance stay exactly as they were; the finance admins are told',
    t || ' / ' || pg_temp.wb(v_t2) || ' / ' || pg_temp.nn(a_fin, 'closure_wallet_money', '%R20 available and R120 on hold (R120 of it in an open payout request)%'), 'requested 120 / 20/120 / 1');
  j := (pg_temp.run_as(a_fin, 'select jsonb_agg(to_jsonb(x))::text from public.admin_closed_account_wallets() x'))::jsonb;
  select count(*)::text || ' ' || coalesce(string_agg((x ->> 'available_rand') || '/' || (x ->> 'held_rand') || '/' || (x ->> 'open_payout_rand') || '/' || (x ->> 'unconfirmed_rand') || '/' || (x ->> 'has_bank_details'), ' ' order by (x ->> 'role')), '') into t
    from jsonb_array_elements(j) x where (x ->> 'profile_id')::uuid in (v_c1, v_t2);
  r := r || pg_temp.chk('E47', 'the finance admin''s list of closed accounts with money shows both (learner and tutor), with the figures and whether bank details are kept', t, '2 500/0/0/150/false 20/120/120/0/true');
  r := r || pg_temp.chk('E48', 'a support agent cannot read that list', pg_temp.run_as(a_spt, 'select count(*)::text from public.admin_closed_account_wallets()'), 'ERR: Finance admins only');

  -- day 30: the daily job runs; money is owed, so nothing about money is deleted
  insert into storage.objects (bucket_id, name) values ('payment-proofs', v_c1 || '/' || tp_c1b || '.pdf');
  update account_closures set due_at = now() - interval '1 day' where profile_id in (v_c1, v_t2);
  perform public.run_account_closures();
  select string_agg(status || ' ' || payout_kept::text, ',' order by profile_id = v_c1) into t from account_closures where profile_id in (v_c1, v_t2);
  r := r || pg_temp.chk('E49', 'day 30 with money still owed: both closures are marked "money kept" (they cannot finish), the tutor''s bank details stay, no proof file is queued yet',
    t || ' / ' || (select count(*) from tutor_bank_details where tutor_id = v_t2) || ' / ' || (select count(*) from account_closure_tasks where profile_id = v_c1 and kind = 'storage_remove' and payload ->> 'bucket' = 'payment-proofs'),
    'db_deleted true,db_deleted true / 1 / 0');
  r := r || pg_temp.chk('E50', 'the balances and the open payout request are still there after the deletion day', pg_temp.wb(v_c1) || ' ' || pg_temp.wb(v_t2) || ' ' || (select status from payout_requests where id = po_t2), '500/0 20/120 requested');
  r := r || pg_temp.chk('E51', 'a closed person with a wallet keeps the name key (the tombstone) because a kept record still points at them',
    public.retention_has_kept_records(v_c1)::text || ' ' || public.retention_has_kept_records(gen_random_uuid())::text, 'true false');

  -- the finance admin returns the money by hand; the next daily run then lets the rest go
  t := pg_temp.run_as(a_fin, format('select public.admin_mark_topup_unsuccessful(%L, ''Not received in the bank'')::text', tp_c1b));
  t := pg_temp.run_as(a_fin, format('select public.admin_return_wallet_money(%L, 500, ''Closed account: money returned to the account it came from'', ''EFT-C1'', %L)::text', v_c1, gen_random_uuid()));
  r := r || pg_temp.chk('E52', 'money returned to a closed learner: R500 out, the transfer with proof decided, and NO bell message is written for a closed account',
    pg_temp.wb(v_c1) || ' / ' || (select status from wallet_topups where id = tp_c1b) || ' / ' || pg_temp.nn(v_c1, 'wallet_money_returned', '%'), '0/0 / unsuccessful / 0');
  t := pg_temp.run_as(a_fin, format('select public.admin_mark_payout_paid(%L, ''EFT-T2'', null)::text', po_t2));
  t := pg_temp.run_as(a_fin, format('select public.admin_return_wallet_money(%L, 20, ''Closed account: balance returned'', ''EFT-T2b'', %L)::text', v_t2, gen_random_uuid()));
  r := r || pg_temp.chk('E53', 'the tutor''s payout is marked paid and the remaining R20 is returned: the wallet is empty', pg_temp.wb(v_t2) || ' / ' || public.closure_wallet_owes(v_t2)::text || ' ' || public.closure_wallet_owes(v_c1)::text, '0/0 / false false');
  perform public.run_account_closures();
  select string_agg(status || ' ' || payout_kept::text, ',' order by profile_id = v_c1) into t from account_closures where profile_id in (v_c1, v_t2);
  select p.account_number || ' ' || p.account_holder || ' ' || p.account_last4 into t2 from payout_requests p where p.id = po_t2;
  r := r || pg_temp.chk('E54', 'nothing owed any more: "money kept" is cleared, the tutor''s bank details are deleted, the paid request keeps only the last four digits and no holder name',
    t || ' / ' || (select count(*) from tutor_bank_details where tutor_id = v_t2) || ' / ' || t2, 'db_deleted false,db_deleted false / 0 / 0000004321 Closed account 4321');
  select count(*) || ' ' || coalesce(min(payload -> 'paths' ->> 0), '') = '1 ' || v_c1 || '/' || tp_c1b || '.pdf' into t
    from account_closure_tasks where profile_id = v_c1 and kind = 'storage_remove' and payload ->> 'bucket' = 'payment-proofs';
  r := r || pg_temp.chk('E55', 'the learner''s proof file is queued for the Worker to remove, once, and the top-up is marked', t || ' / ' || (select (proof_deleted_at is not null)::text from wallet_topups where id = tp_c1b), 'true / true');
  perform public.run_account_closures();
  r := r || pg_temp.chk('E56', 'the daily job run again queues no second removal', (select count(*) from account_closure_tasks where profile_id = v_c1 and kind = 'storage_remove' and payload ->> 'bucket' = 'payment-proofs')::text, '1');

  -- ---- retention -------------------------------------------------------------------------------------------------------------------------------
  qr1 := pg_temp.mkreq(v_l, v_l, e_l, 6, 100);
  qr2 := pg_temp.mkreq(v_l, v_l, e_l, 7, 100);
  qr3 := pg_temp.mkreq(v_l, v_l, e_l, 8, 100);
  update session_requests set status = 'cancelled', payment_status = 'wallet_refunded', created_at = now() - interval '9 years', requested_start = now() - interval '9 years' where id = qr1;
  update session_requests set status = 'cancelled', payment_status = 'wallet_refunded' where id = qr3;
  update session_requests set status = 'accepted', payment_status = 'wallet_paid', created_at = now() - interval '9 years', requested_start = now() - interval '9 years' where id = qr2;
  select count(*) filter (where rec_id = qr1), count(*) filter (where rec_id = qr2), count(*) filter (where rec_id = qr3) into n, n2, n3 from public.retention_due_requests();
  r := r || pg_temp.chk('E60', 'retention: an old refunded wallet request and an old wallet-paid request are due; a recent one is not', n || ' ' || n2 || ' ' || n3, '1 1 0');

  -- a wallet is purged only together with its whole ledger, only at zero, and not while anything is open or recent
  alter table public.wallet_ledger disable trigger wallet_ledger_no_change;
  alter table public.wallets disable trigger wallets_guard_row;
  perform public.wallet_post(w_old, 'topup', 100, 0, 'we-w:' || w_old || ':1', null, 'old');   -- w_old: zero balance, 9 years old
  perform public.wallet_post(w_old, 'withdrawal', -100, 0, 'we-w:' || w_old || ':2', null, 'old');
  perform public.wallet_post(w_bal, 'topup', 100, 0, 'we-w:' || w_bal || ':1', null, 'old');   -- w_bal: old but R100 inside
  perform public.wallet_post(w_new, 'topup', 100, 0, 'we-w:' || w_new || ':1', null, 'new');   -- w_new: zero, a recent line
  perform public.wallet_post(w_new, 'withdrawal', -100, 0, 'we-w:' || w_new || ':2', null, 'new');
  perform public.wallet_post(w_open, 'topup', 100, 0, 'we-w:' || w_open || ':1', null, 'old'); -- w_open: zero and old but a payout request is open
  perform public.wallet_post(w_open, 'withdrawal', -100, 0, 'we-w:' || w_open || ':2', null, 'old');
  update public.wallet_ledger set created_at = now() - interval '9 years' where profile_id in (w_old, w_bal, w_open) or idempotency_key = 'we-w:' || w_new || ':1';
  update public.wallets set created_at = now() - interval '9 years', updated_at = now() - interval '9 years' where profile_id in (w_old, w_bal, w_open);
  alter table public.wallet_ledger enable trigger wallet_ledger_no_change;
  alter table public.wallets enable trigger wallets_guard_row;
  insert into payout_requests (tutor_id, amount_rand, status, bank_name, account_holder, branch_code, account_number, requested_at)
    values (w_open, 50, 'requested', 'Test Bank', 'Open Holder', '250655', '11112222', now() - interval '9 years') returning id into po_open;
  insert into payout_requests (tutor_id, amount_rand, status, bank_name, account_holder, branch_code, account_number, requested_at, decided_at, decided_by, paid_on)
    values (w_old, 60, 'paid', 'Test Bank', 'Old Holder', '250655', '33334444', now() - interval '9 years', now() - interval '9 years', a_fin, (now() - interval '9 years')::date) returning id into po_old;
  insert into payout_requests (tutor_id, amount_rand, status, bank_name, account_holder, branch_code, account_number, requested_at, decided_at, decided_by, paid_on)
    values (w_new, 60, 'paid', 'Test Bank', 'New Holder', '250655', '55556666', now() - interval '2 days', now() - interval '1 day', a_fin, current_date) returning id into po_new;
  insert into wallet_topups (profile_id, reference, amount_rand, status, decided_at, decision_comment, created_at, updated_at)
    values (w_old, 'TL-NNNNNN', 100, 'unsuccessful', now() - interval '9 years', 'old and settled', now() - interval '9 years', now() - interval '9 years') returning id into tp1;
  insert into wallet_topups (profile_id, reference, amount_rand, status, decided_at, decision_comment, created_at, updated_at)
    values (w_old, 'TL-PPPPPP', 100, 'unsuccessful', now() - interval '9 years', 'old, file still there', now() - interval '9 years', now() - interval '9 years') returning id into tp2;
  insert into storage.objects (bucket_id, name) values ('payment-proofs', w_old || '/' || tp2 || '.pdf');
  j := public.retention_run_wallet_records();
  select (select count(*) from wallets where profile_id = w_old) || ' ' || (select count(*) from wallet_ledger where profile_id = w_old) || ' / ' || (select count(*) from wallets where profile_id in (w_bal, w_new, w_open)) || ' ' || (select count(*) from wallet_ledger where profile_id in (w_bal, w_new, w_open)) into t;
  r := r || pg_temp.chk('E61', 'a zero wallet that is 9 years old goes TOGETHER WITH ITS WHOLE LEDGER; a wallet with money in it, a recent one and one with an open payout request all stay',
    t || ' / ' || (j -> 'deleted' ->> 'wallets') || ' ' || (j -> 'deleted' ->> 'wallet_ledger'), '0 0 / 3 5 / 1 2');
  select (select count(*) from payout_requests where id = po_old) || ' ' || (select count(*) from payout_requests where id = po_new) || ' ' || (select count(*) from payout_requests where id = po_open) || ' ' || (select count(*) from wallet_topups where id = tp1) || ' ' || (select count(*) from wallet_topups where id = tp2) into t;
  r := r || pg_temp.chk('E62', 'an old paid payout request and an old decided top-up are deleted; a recent one, an open one and a top-up whose proof file is still stored stay', t, '0 1 1 0 1');
  update wallet_topups set proof_deleted_at = now() where id = tp2;   -- this old top-up still has a stored file: keep it out of the proof-deletion checks below
  j := public.wallet_check_balances();
  r := r || pg_temp.chk('E63', 'after a purge every remaining chain still starts at zero: the balance check finds nothing wrong', (j ->> 'mismatch_count'), '0');
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'retention_jobs_enabled';
  j := public.run_retention_jobs();
  select count(*) filter (where category in ('tutor_documents', 'consent_records', 'problem_reports', 'money_records', 'wallet_records', 'tombstones')), count(*) filter (where error is not null)
    into n, n2 from retention_deletion_records where run_id = (j ->> 'run_id')::uuid;
  r := r || pg_temp.chk('E64', 'the daily retention job now runs six categories, wallet_records among them, and none fails', n || ' ' || n2, '6 0');
  insert into retention_deletion_records (run_id, category) values (gen_random_uuid(), 'wallet_records'), (gen_random_uuid(), 'payment_proofs');
  r := r || pg_temp.chk('E65', 'the journal accepts the two new categories', 'yes', 'yes');

  -- ---- proof files: 90 days after a successful transfer, 30 after an unsuccessful one --------------------------------------------------------------
  insert into wallet_topups (profile_id, reference, amount_rand) values (v_l, 'TL-QQQQQQ', 100) returning id into tp1;
  insert into wallet_topups (profile_id, reference, amount_rand) values (v_l, 'TL-RRRRRR', 100) returning id into tp2;
  insert into wallet_topups (profile_id, reference, amount_rand) values (v_o, 'TL-SSSSSS', 100) returning id into tp3;
  insert into wallet_topups (profile_id, reference, amount_rand) values (v_o, 'TL-TTTTTT', 100) returning id into tp4;
  insert into wallet_topups (profile_id, reference, amount_rand) values (v_l, 'TL-UUUUUU', 100) returning id into tp5;
  update wallet_topups set status = 'proof_sent', proof_path = profile_id || '/' || id || '.pdf', proof_attached_at = now() where id in (tp1, tp2, tp3, tp4, tp5);
  perform public.wallet_credit_topup(tp1, 100, a_fin, null);
  perform public.wallet_credit_topup(tp2, 100, a_fin, null);
  perform public.wallet_credit_topup(tp5, 100, a_fin, null);
  update wallet_topups set status = 'unsuccessful', received_rand = null, ledger_id = null, decided_by = a_fin, decided_at = now(), decision_comment = 'not received' where id in (tp3, tp4);
  update wallet_topups set decided_at = now() - interval '91 days' where id = tp1;
  update wallet_topups set decided_at = now() - interval '89 days' where id = tp2;
  update wallet_topups set decided_at = now() - interval '31 days' where id = tp3;
  update wallet_topups set decided_at = now() - interval '29 days' where id = tp4;
  update wallet_topups set decided_at = now() - interval '100 days' where id = tp5;
  insert into storage.objects (bucket_id, name) select 'payment-proofs', profile_id || '/' || id || '.pdf' from wallet_topups where id in (tp1, tp2, tp3, tp4);
  j := public.wallet_delete_old_proofs();
  select string_agg(((proof_deleted_at is not null)::int)::text, '' order by reference) into t from wallet_topups where id in (tp1, tp2, tp3, tp4, tp5);
  r := r || pg_temp.chk('E70', 'proofs: a successful transfer 91 days ago and an unsuccessful one 31 days ago are queued; 89 and 29 days are not; a top-up with no file stored is not',
    (j ->> 'files_queued') || ' ' || (j ->> 'topups') || ' / ' || t, '2 2 / 10100');
  select count(*) || ' ' || coalesce(sum(jsonb_array_length(payload -> 'paths')), 0) into t from account_closure_tasks
    where kind = 'storage_remove' and payload ->> 'bucket' = 'payment-proofs' and (payload::text like '%' || tp1 || '%' or payload::text like '%' || tp3 || '%');
  r := r || pg_temp.chk('E71', 'the Worker is given one removal step per person, naming exactly those two files, and the journal records what was queued',
    t || ' / ' || (select files_queued || ' ' || coalesce(error, 'no error') from retention_deletion_records where run_id = (j ->> 'run_id')::uuid and category = 'payment_proofs'), '2 2 / 2 no error');
  j := public.wallet_delete_old_proofs();
  r := r || pg_temp.chk('E72', 'run again at once: nothing is queued twice', (j ->> 'files_queued'), '0');
  update wallet_topups set proof_deleted_at = now() - interval '3 days' where id = tp1;
  j := public.wallet_delete_old_proofs();
  r := r || pg_temp.chk('E73', 'a file still in Storage three days after it was queued is queued again (a failed removal is not forgotten)', (j ->> 'files_queued'), '1');
  update system_settings set setting_value = '60'::jsonb where setting_key = 'wallet_proof_keep_days_successful';
  j := public.wallet_delete_old_proofs();
  r := r || pg_temp.chk('E74', 'the days come from System Settings: with 60 days a successful transfer from 89 days ago is queued too', (j ->> 'files_queued'), '1');
  r := r || pg_temp.chk('E75', 'the daily job is scheduled', coalesce((select schedule from cron.job where jobname = 'wallet-delete-proofs'), 'missing'), '55 3 * * *');

  -- ---- the old paths are exactly as before while free sessions are on and the wallet switch is off (production''s state until the go-live) -------------
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'free_sessions_enabled';
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'wallet_payments_enabled';
  qh0 := pg_temp.mkreq(v_l, v_l, e_l, 31, 70);
  r := r || pg_temp.chk('F01', 'free on, wallet off: a request cannot be sent from the wallet, and nothing about it changes',
    pg_temp.send(v_l, qh0) || ' / ' || (select payment_status || ' ' || paid_from_wallet || ' ' || coalesce(wallet_hold_rand::text, 'null') from session_requests where id = qh0) || ' / ' || pg_temp.nl('hold:' || qh0),
    'ERR: Wallet payments are not open. / initiated false null / 0');
  qh1 := pg_temp.mkreq(v_l, v_l, e_l, 32, 70);
  t := pg_temp.run_as(v_l, format('select public.send_request_free(%L)', qh1));
  t2 := pg_temp.try_claim(qh1, v_t);
  select s.free_session::text || ' ' || s.wallet_paid::text || ' ' || s.gross_amount::int || ' ' || s.tutor_payout_amount::int || ' ' || q.payment_status || ' ' || q.paid_from_wallet::text into t3
    from sessions s join session_requests q on q.resulting_session_id = s.id where q.id = qh1;
  r := r || pg_temp.chk('F02', 'a free request is sent and accepted exactly as before (free session, money stored as 0, request ends "free", no wallet line)',
    t || ' / ' || t2 || ' / ' || t3 || ' / ' || (select count(*) from wallet_ledger where request_id = qh1), 'free / accepted (already_paid) / true false 0 0 free false / 0');
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id,
         charged_amount, institution_id)
    values (v_l, e_l, v_l, pg_temp.slot(33), 1, 'pending', 'paid', 'we_paid2', '1A', 1, 50, s1) returning id into qh2;
  t2 := pg_temp.try_claim(qh2, v_t);
  select s.wallet_paid::text || ' ' || s.free_session::text || ' ' || q.payment_status into t3 from sessions s join session_requests q on q.resulting_session_id = s.id where q.id = qh2;
  r := r || pg_temp.chk('F03', 'a request paid up front by card (the old style) is accepted the old way, stays "paid", no wallet line', t2 || ' / ' || t3 || ' / ' || (select count(*) from wallet_ledger where request_id = qh2),
    'accepted (already_paid) / false false paid / 0');
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id,
         charged_amount, institution_id)
    values (v_l, e_l, v_l, pg_temp.slot(34), 1, 'pending', 'card_verified', 'we_card3', '1A', 1, 50, s1) returning id into qh3;
  r := r || pg_temp.chk('F04', 'an ordinary card-checked request still goes down the card path',
    (position('Add your bank details in your tutor account' in pg_temp.try_claim(qh3, v_t)) > 0)::text, 'true');

  -- ---- rights and the patches ------------------------------------------------------------------------------------------------------------------
  select count(*) into n from unnest(array['public.closure_wallet_summary(uuid)', 'public.closure_wallet_owes(uuid)', 'public.closure_wallet_cleanup(uuid,uuid)',
    'public.retention_run_wallet_records()', 'public.wallet_delete_old_proofs()']) f, unnest(array['anon', 'authenticated', 'service_role']) ro where has_function_privilege(ro, f, 'EXECUTE');
  r := r || pg_temp.chk('G01', 'no browser role and not the server role can run any of the five internal functions', n::text, '0');
  select count(*) into n from unnest(array['public.admin_refund_to_wallet(uuid,integer,text,boolean,uuid)', 'public.admin_return_wallet_money(uuid,integer,text,text,uuid)',
    'public.admin_add_topup_by_hand(uuid,integer,text,text,uuid)', 'public.admin_open_tutor_bank_details(uuid)', 'public.admin_wallet_sessions(uuid)', 'public.admin_closed_account_wallets()']) f
    where has_function_privilege('anon', f, 'EXECUTE');
  r := r || pg_temp.chk('G02', 'a signed-out visitor can call none of the six admin functions', n::text, '0');
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('closure_wallet_summary', 'closure_wallet_owes', 'closure_wallet_cleanup', 'retention_run_wallet_records', 'wallet_delete_old_proofs', 'admin_refund_to_wallet',
                      'admin_return_wallet_money', 'admin_add_topup_by_hand', 'admin_open_tutor_bank_details', 'admin_wallet_sessions', 'admin_closed_account_wallets')
    and (p.proconfig is null or p.proconfig::text not like '%search_path=public%' or not p.prosecdef);
  r := r || pg_temp.chk('G03', 'all 11 new functions are definers with a pinned search path', n::text, '0');
  select count(*) into n from unnest(array['public.preview_account_closure(uuid)|WALLET EDGES preview 1', 'public.preview_account_closure(uuid)|WALLET EDGES preview 2', 'public.preview_account_closure(uuid)|WALLET EDGES preview 3',
    'public.closure_start(uuid, uuid, text, uuid, text, timestamptz, text, text, text)|WALLET EDGES closure 1', 'public.closure_start(uuid, uuid, text, uuid, text, timestamptz, text, text, text)|WALLET EDGES closure 2',
    'public.closure_delete_money(uuid)|WALLET EDGES delete money 1', 'public.closure_delete_money(uuid)|WALLET EDGES delete money 2', 'public.retention_due_requests()|WALLET EDGES retention requests',
    'public.retention_has_kept_records(uuid)|WALLET EDGES kept records 1', 'public.retention_has_kept_records(uuid)|WALLET EDGES kept records 2', 'public.run_retention_jobs()|WALLET EDGES retention jobs 1',
    'public.run_retention_jobs()|WALLET EDGES retention jobs 2', 'public.run_retention_jobs()| of 6 categories failed']) x
    where (length(pg_get_functiondef(split_part(x, '|', 1)::regprocedure)) - length(replace(pg_get_functiondef(split_part(x, '|', 1)::regprocedure), split_part(x, '|', 2), ''))) / length(split_part(x, '|', 2)) <> 1;
  r := r || pg_temp.chk('G04', 'all 13 patch markers occur exactly once (a re-run of the migration changes nothing)', n::text, '0');

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
    perform set_config('test.report', format(E'WALLET-EDGES TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, nlines, rep), true);
  else
    raise exception E'WALLET-EDGES TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, nlines, rep;
  end if;
end $$;
