-- Rolled-back test of charging at acceptance with Paystack splits (migration 20260930239500, master
-- backlog 7a). The server's calls are made as service_role, as server/index.ts makes them. Paystack's
-- replies to the recovery job are faked in net._http_response. See README.md.
do $$
declare
  r text := E'\n';
  v_learner uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  v_tutor2 uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  q_bad uuid; q_nosave uuid; q1 uuid; q2 uuid; q3 uuid; q_old uuid; q_exp uuid; q_sub uuid;
  q_ok uuid; q_gone uuid; q_wait uuid; q_mis uuid;
  v_enr uuid; v_sess uuid; v_sess2 uuid;
  j jsonb; n int; s text; x text; num numeric; num2 numeric; t timestamptz;
  auth_ok jsonb := '{"authorization_code":"AUTH_test123","reusable":true,"signature":"SIG_abc","last4":"4081","card_type":"visa ","bank":"TEST BANK","exp_month":"12","exp_year":"2030"}';
  adult text := (current_date - interval '30 years')::date::text;
  z uuid := '00000000-0000-0000-0000-000000000000';
  base bigint := 9200000000000;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_learner, z,'authenticated','authenticated','t.l.'||v_learner||'@example.invalid', jsonb_build_object('first_name','Learner','date_of_birth',adult), '{}'),
    (v_tutor, z,'authenticated','authenticated','t.t.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor','first_name','Tutor','date_of_birth',adult), '{}'),
    (v_tutor2, z,'authenticated','authenticated','t.t2.'||v_tutor2||'@example.invalid', jsonb_build_object('role','tutor','first_name','Tutor2','date_of_birth',adult), '{}'),
    (v_admin, z,'authenticated','authenticated','t.ad.'||v_admin||'@example.invalid', jsonb_build_object('first_name','Admin','date_of_birth',adult), '{}');
  insert into admin_profiles (id, first_name, surname, email) values (v_admin, 'Test', 'Admin', 't.ad.'||v_admin||'@example.invalid');
  update profiles set date_of_birth = adult::date where id in (v_tutor, v_tutor2);
  update tutor_profiles set is_verified = true, current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null
  where id in (v_tutor, v_tutor2);
  insert into tutor_subject_competencies (tutor_id, subject_name, min_grade_level, max_grade_level, verification_status)
  values (v_tutor, 'Mathematics', 'Grade 8', 'Grade 12', 'verified'), (v_tutor2, 'Mathematics', 'Grade 8', 'Grade 12', 'verified');

  -- The learner sends requests (as the browser does): R50 for an hour at level 1A.
  perform set_config('request.jwt.claims', json_build_object('sub', v_learner, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_learner, 'Mathematics', 'Grade 10') returning id into v_enr;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, enrollment_id)
  values (v_learner, v_learner, now() + interval '2 days', 1, 'ta_bad', '1A', v_enr) returning id into q_bad;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, enrollment_id)
  values (v_learner, v_learner, now() + interval '2 days', 1, 'ta_nosave', '1A', v_enr) returning id into q_nosave;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, enrollment_id)
  values (v_learner, v_learner, now() + interval '2 days', 1, 'ta_1', '1A', v_enr) returning id into q1;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, enrollment_id)
  values (v_learner, v_learner, now() + interval '2 days', 1, 'ta_2', '1A', v_enr) returning id into q2;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, enrollment_id)
  values (v_learner, v_learner, now() + interval '2 days', 1, 'ta_3', '1A', v_enr) returning id into q3;
  reset role;
  select payment_status, charged_amount into s, num from session_requests where id = q1;
  r := r || format('A1 new request starts %s at R%s (want initiated, 50.00)', s, num) || E'\n';

  -- Card checks, recorded by the server.
  set local role service_role;
  select public.record_card_verification('ta_bad', 5000, 'ZAR', auth_ok, 'l@example.invalid') into s;
  r := r || format('A2 card check for R50 instead of R1 -> %s (want failed)', s) || E'\n';
  select public.record_card_verification('ta_nosave', 100, 'ZAR', auth_ok || '{"reusable":false}', 'l@example.invalid') into s;
  r := r || format('A3 card that can''t be reused -> %s (want failed)', s) || E'\n';
  select public.record_card_verification('ta_1', 100, 'ZAR', auth_ok, 'l@example.invalid') into s;
  r := r || format('A4 good card check -> %s (want card_verified)', s) || E'\n';
  select public.record_card_verification('ta_1', 100, 'ZAR', auth_ok, 'l@example.invalid') into s;
  select public.record_card_verification('ta_2', 100, 'ZAR', auth_ok, 'l@example.invalid') into x;
  select public.record_card_verification('ta_3', 100, 'ZAR', auth_ok, 'l@example.invalid') into x;
  reset role;
  select count(*) into n from payment_cards where profile_id = v_learner;
  r := r || format('A5 repeat + same card on two more requests: %s, cards saved=%s (want card_verified, 1)', s, n) || E'\n';
  select charge_failure_reason into x from session_requests where id = q_nosave;
  r := r || format('A5b the learner is told why: "%s"', x) || E'\n';

  -- What the learner can and can't read.
  perform set_config('request.jwt.claims', json_build_object('sub', v_learner, 'role','authenticated')::text, true);
  set local role authenticated;
  select last4 into x from payment_cards where profile_id = v_learner;
  r := r || format('A6 learner sees their card''s last 4: %s (want 4081)', x) || E'\n';
  begin
    select authorization_code into x from payment_cards where profile_id = v_learner;
    r := r || 'A7 FAIL learner read the card''s authorization code' || E'\n';
  exception when others then r := r || 'A7 ok authorization code hidden: ' || sqlerrm || E'\n'; end;
  reset role;

  -- The tutor: can't write their own payout account; can't accept without one; can't use the old path.
  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into tutor_payout_accounts (tutor_id, bank_name, account_holder_name, is_verified) values (v_tutor, 'X', 'Me', true);
    r := r || 'A8 FAIL tutor wrote their own payout account' || E'\n';
  exception when others then r := r || 'A8 ok tutor can''t write a payout account: ' || sqlerrm || E'\n'; end;
  begin
    perform public.accept_session_request(q1);
    r := r || 'A9 FAIL tutor accepted from the browser (no charge)' || E'\n';
  exception when others then r := r || 'A9 ok browser accept closed: ' || sqlerrm || E'\n'; end;
  begin
    perform public.claim_session_request(q1, v_tutor);
    r := r || 'A10 FAIL tutor called claim_session_request directly' || E'\n';
  exception when others then r := r || 'A10 ok claim is server-only: ' || sqlerrm || E'\n'; end;
  select count(*) into n from session_requests where id in (q1, q2, q3);
  r := r || format('A11 tutor sees the card-checked requests: %s (want 3)', n) || E'\n';
  reset role;

  set local role service_role;
  begin
    perform public.claim_session_request(q1, v_tutor);
    r := r || 'A12 FAIL accepted with no bank details' || E'\n';
  exception when others then r := r || 'A12 ok no bank details, refused: ' || sqlerrm || E'\n'; end;
  begin
    perform public.save_tutor_payout_account(v_tutor, '632005', 'Absa', 'Tutor Test', '123456789', 'ACCT_x', 'validated', '{}');
    r := r || 'A13 FAIL a full account number was stored' || E'\n';
  exception when others then r := r || 'A13 ok full account number refused: ' || sqlerrm || E'\n'; end;
  perform public.save_tutor_payout_account(v_tutor, '632005', 'Absa Bank Limited, South Africa', 'Tutor Test', '6789',
                                           'ACCT_testtutor1', 'validated', '{"accountHolderMatch":true}');
  perform public.save_tutor_payout_account(v_tutor2, '632005', 'Absa Bank Limited, South Africa', 'Tutor Two', '1111',
                                           'ACCT_testtutor2', 'recorded_test_mode', '{}');

  select public.claim_session_request(q1, v_tutor) into j;
  r := r || format('A14 claim -> mode %s, %s cents, commission %s, bearer %s, subaccount %s (want charge, 5000, 1500, account, ACCT_testtutor1)',
                   j->>'mode', j->>'amount_cents', j->>'commission_cents', j->>'bearer', j->>'subaccount') || E'\n';
  begin
    perform public.claim_session_request(q1, v_tutor2);
    r := r || 'A15 FAIL a second tutor claimed the same request' || E'\n';
  exception when others then r := r || 'A15 ok second tutor refused: ' || sqlerrm || E'\n'; end;

  begin
    perform public.finalize_session_charge(q1, j->>'charge_reference', 4000, 'ZAR', 250);
    r := r || 'A16 FAIL finalized a charge for the wrong amount' || E'\n';
  exception when others then r := r || 'A16 ok wrong amount refused: ' || sqlerrm || E'\n'; end;
  select public.finalize_session_charge(q1, j->>'charge_reference', 5000, 'ZAR', 282) into v_sess;
  select public.finalize_session_charge(q1, j->>'charge_reference', 5000, 'ZAR', 282) into v_sess2;
  reset role;
  select gross_amount, tutor_payout_amount, platform_commission_pct::text into num, num2, x from sessions where id = v_sess;
  r := r || format('A17 session: gross %s, tutor %s, commission %s%% (want 50.00, 35.00, 30.00)', num, num2, x) || E'\n';
  select payment_status, paystack_fee, charged_at into s, num, t from session_requests where id = q1;
  r := r || format('A18 request %s, Paystack fee %s, charged_at set=%s; repeat finalize same session=%s (want paid, 2.82, true, true)',
                   s, num, t is not null, v_sess = v_sess2) || E'\n';
  select count(*) into n from notifications where profile_id = v_learner and type = 'request_accepted';
  r := r || format('A19 learner told a tutor accepted: %s (want 1)', n) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor2, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from session_requests where id = q1;
  r := r || format('A20 the other tutor can no longer see the accepted request: %s (want 0)', n) || E'\n';
  reset role;

  -- A failed charge: the request is cancelled, nobody charged, learner told.
  set local role service_role;
  select public.claim_session_request(q2, v_tutor) into j;
  perform public.release_session_charge(q2, j->>'charge_reference', 'Declined by the bank');
  reset role;
  select payment_status || '/' || status || '/tutor ' || coalesce(tutor_id::text, 'none') || '/' || charge_failure_reason into s from session_requests where id = q2;
  r := r || format('A21 release -> %s (want charge_failed/cancelled/tutor none/Declined by the bank)', s) || E'\n';
  select count(*) into n from notifications where profile_id = v_learner and type = 'charge_failed';
  r := r || format('A22 learner told the charge failed: %s (want 1)', n) || E'\n';

  -- Tutor bears the fee: the tutor's share is reduced by it.
  update system_settings set setting_value = '"subaccount"'::jsonb where setting_key = 'paystack_fee_bearer';
  set local role service_role;
  select public.claim_session_request(q3, v_tutor2) into j;
  select public.finalize_session_charge(q3, j->>'charge_reference', 5000, 'ZAR', 282) into v_sess2;
  reset role;
  update system_settings set setting_value = '"account"'::jsonb where setting_key = 'paystack_fee_bearer';
  select tutor_payout_amount into num from sessions where id = v_sess2;
  r := r || format('A23 bearer=subaccount: tutor gets %s (want 32.18)', num) || E'\n';

  -- A request paid up front under the old flow is booked without a second charge.
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, min_sub_tier_id, tier_id, status, payment_status)
  values (v_learner, v_learner, now() + interval '3 days', 'ta_old', 50, '1A', 1, 'pending', 'paid') returning id into q_old;
  set local role service_role;
  select public.claim_session_request(q_old, v_tutor) into j;
  reset role;
  select tutor_payout_amount into num from sessions where id = (j->>'session_id')::uuid;
  r := r || format('A24 legacy paid request -> mode %s, tutor gets %s (want already_paid, 35.00)', j->>'mode', num) || E'\n';

  -- Cancelling refunds the charge itself, not the R1 card check.
  perform set_config('request.jwt.claims', json_build_object('sub', v_learner, 'role','authenticated')::text, true);
  set local role authenticated;
  -- Caught so the suite still reports on a database with no Paystack key in its Vault (production
  -- until the CEO adds it): there cancel_session refuses, and A25, A29 and A33 show the gap.
  begin
    perform public.cancel_session(v_sess, 'Plans changed');
  exception when others then r := r || 'A25 cancel refused: ' || sqlerrm || E'\n'; end;
  reset role;
  select count(*) into n from net.http_request_queue qq join session_requests sr on sr.refund_request_id = qq.id
  where sr.id = q1 and convert_from(qq.body, 'utf8')::jsonb->>'transaction' = sr.charge_reference;
  r := r || format('A25 cancel sends the refund for the charge reference: %s (want 1)', n) || E'\n';

  -- An unmatched card-checked request just expires: no charge, no refund.
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, min_sub_tier_id, status, payment_status)
  values (v_learner, v_learner, now() - interval '1 hour', 'ta_exp', 50, '1A', 'pending', 'card_verified') returning id into q_exp;
  perform public.expire_stale_paid_requests();
  select status || '/' || payment_status || '/refund ' || coalesce(refund_request_id::text, 'none') into s from session_requests where id = q_exp;
  r := r || format('A26 unmatched after its time -> %s (want expired/card_verified/refund none)', s) || E'\n';

  -- The recovery job settles acceptances left in 'charging'.
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, min_sub_tier_id, status, payment_status, tutor_id, claimed_at, charge_reference, commission_amount, fee_bearer, charge_check_request_id)
  values
    (v_learner, v_learner, now() + interval '4 days', 'ta_ok', 50, '1A', 'pending', 'charging', v_tutor, now() - interval '10 minutes', 'chg_ok', 15, 'account', base + 1),
    (v_learner, v_learner, now() + interval '4 days', 'ta_gone', 50, '1A', 'pending', 'charging', v_tutor, now() - interval '10 minutes', 'chg_gone', 15, 'account', base + 2),
    (v_learner, v_learner, now() + interval '4 days', 'ta_wait', 50, '1A', 'pending', 'charging', v_tutor, now() - interval '10 minutes', 'chg_wait', 15, 'account', base + 3),
    (v_learner, v_learner, now() + interval '4 days', 'ta_mis', 50, '1A', 'pending', 'charging', v_tutor, now() - interval '10 minutes', 'chg_mis', 15, 'account', base + 4);
  select id into q_ok from session_requests where paystack_reference = 'ta_ok';
  select id into q_gone from session_requests where paystack_reference = 'ta_gone';
  select id into q_wait from session_requests where paystack_reference = 'ta_wait';
  select id into q_mis from session_requests where paystack_reference = 'ta_mis';
  insert into net._http_response (id, status_code, content) values
    (base + 1, 200, '{"status":true,"data":{"status":"success","amount":5000,"currency":"ZAR","fees":282}}'),
    (base + 2, 400, '{"status":false,"message":"Transaction reference not found"}'),
    (base + 3, 200, '{"status":true,"data":{"status":"ongoing","amount":5000,"currency":"ZAR"}}'),
    (base + 4, 200, '{"status":true,"data":{"status":"success","amount":9900,"currency":"ZAR","fees":282}}');
  perform public.reconcile_stale_charges();
  select payment_status || '/' || status into s from session_requests where id = q_ok;
  r := r || format('A27 Paystack says success -> %s (want paid/accepted)', s) || E'\n';
  select payment_status || '/' || status into s from session_requests where id = q_gone;
  r := r || format('A28 Paystack never got the charge -> %s (want charge_failed/cancelled)', s) || E'\n';
  select payment_status || '/asked again ' || (charge_check_request_id > 0 and charge_check_request_id <> base + 3)
  into s from session_requests where id = q_wait;
  r := r || format('A29 still ongoing -> %s (want charging/asked again true)', s) || E'\n';
  select payment_status || '/check ' || charge_check_request_id into s from session_requests where id = q_mis;
  r := r || format('A30 amount mismatch -> %s (want charging/check -1, parked for a person)', s) || E'\n';
  select count(*) into n from notifications where profile_id = v_admin and type in ('charge_mismatch', 'charge_needs_attention');
  r := r || format('A31 admin told about the mismatch: %s (want 1 — finalize''s notice rolls back with its error, the job''s own stays)', n) || E'\n';
  perform public.reconcile_stale_charges();
  select count(*) into n from notifications where profile_id = v_admin and type in ('charge_mismatch', 'charge_needs_attention');
  r := r || format('A32 second run: the parked mismatch isn''t re-notified (%s, want 1)', n) || E'\n';

  -- Paystack's refund webhook, matched by the charge reference.
  set local role service_role;
  select public.apply_refund_webhook(987654, (select charge_reference from session_requests where id = q1), 'processed', now()) into x;
  reset role;
  select payment_status || '/' || coalesce(paystack_refund_id::text, 'none') into s from session_requests where id = q1;
  r := r || format('A33 refund.processed webhook -> %s (want refunded/987654)', s) || E'\n';

  -- Tutors read their payout row, not Paystack's validation detail.
  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role','authenticated')::text, true);
  set local role authenticated;
  select bank_name || ' ••' || account_number_last4 || ' ' || validation_status into s from tutor_payout_accounts where tutor_id = v_tutor;
  r := r || format('A34 tutor sees "%s" (want Absa… ••6789 validated)', s) || E'\n';
  begin
    select validation_detail::text into x from tutor_payout_accounts where tutor_id = v_tutor;
    r := r || 'A35 FAIL tutor read validation_detail' || E'\n';
  exception when others then r := r || 'A35 ok validation detail hidden: ' || sqlerrm || E'\n'; end;
  select count(*) into n from tutor_payout_accounts where tutor_id = v_tutor2;
  r := r || format('A36 tutor sees another tutor''s payout row: %s (want 0)', n) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  set local role anon;
  begin
    select count(*) into n from payment_cards;
    r := r || format('A37 FAIL anon read payment_cards (%s)', n) || E'\n';
  exception when others then r := r || 'A37 ok anon refused: ' || sqlerrm || E'\n'; end;
  reset role;

  raise exception 'SPLIT PAYMENTS TEST (rolled back): %', r;
end $$;
