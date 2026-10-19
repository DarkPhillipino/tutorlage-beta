-- Rolled-back test of master 7aa + 7da + 7db, "keep or swap" (migration 20261014200000). See README.md.
-- Run it TOGETHER with the migration in one statement (scripts/run-rolled-back-test.mjs) before the migration is applied,
-- or on its own after. Every check prints its result; "FAIL" marks a real problem.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '15 years')::date::text;
  auth_ok jsonb := '{"authorization_code":"AUTH_kos123","reusable":true,"signature":"SIG_kos","last4":"4081","card_type":"visa ","bank":"TEST BANK","exp_month":"12","exp_year":"2030"}';
  v_l uuid := gen_random_uuid();       -- an adult learner
  v_x uuid := gen_random_uuid();       -- a stranger (an adult learner who never met these tutors)
  v_p uuid := gen_random_uuid();       -- a parent
  v_c uuid := gen_random_uuid();       -- the parent's child (under 18, own sign-in)
  v_a uuid := gen_random_uuid();       -- tutor A: approved, Mathematics, has taught L and C
  v_b uuid := gen_random_uuid();       -- tutor B: approved, Mathematics, has taught L
  v_h uuid := gen_random_uuid();       -- tutor H: approved, History only, has taught L
  v_u uuid := gen_random_uuid();       -- tutor U: NOT approved, has taught L
  v_d uuid := gen_random_uuid();       -- tutor D: approved, Mathematics, has taught nobody
  v_admin uuid := gen_random_uuid();
  e_l uuid; e_c uuid;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; qo uuid; qc uuid; qx uuid; qn uuid;
  s_la uuid; s_ca uuid;
  v_cnt int; n int; t text; t2 text; j jsonb; b boolean; u uuid;
begin
  -- ---- people ------------------------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l, z,'authenticated','authenticated','k.l.'||v_l||'@example.invalid', jsonb_build_object('role','student','first_name','Lee','date_of_birth',adult), '{}'),
    (v_x, z,'authenticated','authenticated','k.x.'||v_x||'@example.invalid', jsonb_build_object('role','student','first_name','Xavi','date_of_birth',adult), '{}'),
    (v_p, z,'authenticated','authenticated','k.p.'||v_p||'@example.invalid', jsonb_build_object('role','parent','first_name','Pat','date_of_birth',adult,'phone_number','081 234 5678'), '{}'),
    (v_a, z,'authenticated','authenticated','k.a.'||v_a||'@example.invalid', jsonb_build_object('role','tutor','first_name','Alpha','date_of_birth',adult), '{}'),
    (v_b, z,'authenticated','authenticated','k.b.'||v_b||'@example.invalid', jsonb_build_object('role','tutor','first_name','Bravo','date_of_birth',adult), '{}'),
    (v_h, z,'authenticated','authenticated','k.h.'||v_h||'@example.invalid', jsonb_build_object('role','tutor','first_name','Hotel','date_of_birth',adult), '{}'),
    (v_u, z,'authenticated','authenticated','k.u.'||v_u||'@example.invalid', jsonb_build_object('role','tutor','first_name','Uniform','date_of_birth',adult), '{}'),
    (v_d, z,'authenticated','authenticated','k.d.'||v_d||'@example.invalid', jsonb_build_object('role','tutor','first_name','Delta','date_of_birth',adult), '{}'),
    (v_admin, z,'authenticated','authenticated','k.ad.'||v_admin||'@example.invalid', '{}'::jsonb, '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_c, z,'authenticated','authenticated','k.c.'||v_c||'@example.invalid', jsonb_build_object('role','student','first_name','Chi','date_of_birth',minor),
       jsonb_build_object('created_by_guardian', v_p, 'relationship','mother'));
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_admin, 'K', 'Admin', 'x@example.invalid', '');
  update profiles set date_of_birth = adult::date where id in (v_a, v_b, v_h, v_u, v_d);
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null where id in (v_a, v_b, v_h, v_u, v_d);
  update tutor_profiles set is_verified = true where id in (v_a, v_b, v_h, v_d);   -- U stays unapproved
  insert into tutor_subject_competencies (tutor_id, subject_name, min_grade_level, max_grade_level, verification_status) values
    (v_a, 'Mathematics', 'Grade 8', 'Grade 12', 'verified'), (v_b, 'Mathematics', 'Grade 8', 'Grade 12', 'verified'),
    (v_h, 'History', 'Grade 8', 'Grade 12', 'verified'), (v_u, 'Mathematics', 'Grade 8', 'Grade 12', 'verified'),
    (v_d, 'Mathematics', 'Grade 8', 'Grade 12', 'verified');
  -- A tutor with no weekly working hours cannot be matched (migration 20261019090000), so every tutor here works every day all day.
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time)
    select x, d, '00:00', '24:00' from unnest(array[v_a, v_b, v_h, v_u, v_d]) x, generate_series(0, 6) d;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_l, 'Mathematics', 'Grade 11') returning id into e_l;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_c, 'Mathematics', 'Grade 9') returning id into e_c;

  -- completed sessions: L with A, B, H and U; the child with A (booked by the parent)
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, enrollment_id)
    values (v_l, v_a, v_l, now() - interval '10 days', 50, 30, 50, 35, 'completed', e_l) returning id into s_la;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, enrollment_id)
    values (v_l, v_b, v_l, now() - interval '9 days', 50, 30, 50, 35, 'completed', e_l), (v_l, v_h, v_l, now() - interval '8 days', 50, 30, 50, 35, 'completed', e_l),
           (v_l, v_u, v_l, now() - interval '7 days', 50, 30, 50, 35, 'completed', e_l);
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, enrollment_id)
    values (v_c, v_a, v_p, now() - interval '6 days', 50, 30, 50, 35, 'completed', e_c) returning id into s_ca;
  select count(*) into n from sessions where status = 'completed' and student_id in (v_l, v_c);
  r := r || format('K0 setup: completed sessions=%s (want 5)', n) || E'\n';

  set local role service_role;
  perform public.save_tutor_payout_account(v_a, '632005', 'Absa Bank Limited, South Africa', 'Alpha Tutor', '6789', 'ACCT_kosA', 'recorded_test_mode', '{}');
  perform public.save_tutor_payout_account(v_b, '632005', 'Absa Bank Limited, South Africa', 'Bravo Tutor', '1111', 'ACCT_kosB', 'recorded_test_mode', '{}');
  reset role;

  -- ---- choosing ------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_tutor_choice(v_l, v_a, 'keep');
  select count(*) into v_cnt from learner_tutor_choices where learner_id = v_l and tutor_id = v_a and choice = 'keep';
  r := r || format('K1 a learner keeps a tutor they have had: rows=%s (want 1)', v_cnt) || E'\n';
  begin
    perform public.set_tutor_choice(v_l, v_d, 'avoid');
    r := r || 'K2 FAIL: chose about a tutor never met' || E'\n';
  exception when others then r := r || format('K2 a tutor never met cannot be chosen about: %s', sqlerrm) || E'\n'; end;
  begin
    perform public.set_tutor_choice(v_l, v_a, 'maybe');
    r := r || 'K2b FAIL: a made-up choice was accepted' || E'\n';
  exception when others then r := r || format('K2b a made-up choice is refused: %s', sqlerrm) || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_tutor_choice(v_l, v_a, 'avoid');
    r := r || 'K3 FAIL: a stranger chose for another adult' || E'\n';
  exception when others then r := r || format('K3 a stranger cannot choose for another adult: %s', sqlerrm) || E'\n'; end;
  begin
    perform public.set_tutor_choice(v_c, v_a, 'avoid');
    r := r || 'K3b FAIL: a stranger chose for someone else''s child' || E'\n';
  exception when others then r := r || format('K3b a stranger cannot choose for someone else''s child: %s', sqlerrm) || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_tutor_choice(v_c, v_a, 'keep');
  select count(*) into v_cnt from learner_tutor_choices where learner_id = v_c and tutor_id = v_a;
  r := r || format('K4 a parent chooses for their child: rows=%s (want 1)', v_cnt) || E'\n';
  select count(*) into v_cnt from learner_tutor_choices;
  r := r || format('K4b the parent reads the child''s choice (and no one else''s): %s (want 1)', v_cnt) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_tutor_choice(v_c, v_a, 'avoid');
    r := r || 'K5 FAIL: a learner under 18 with their own sign-in chose' || E'\n';
  exception when others then r := r || format('K5 a learner under 18 cannot choose for themselves: %s', sqlerrm) || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from learner_tutor_choices;
  r := r || format('K6 a tutor cannot read what learners chose about them: rows seen=%s (want 0)', v_cnt) || E'\n';
  begin
    insert into learner_tutor_choices (learner_id, tutor_id, choice, chosen_by) values (v_x, v_a, 'keep', v_a);
    r := r || 'K6b FAIL: a direct insert worked' || E'\n';
  exception when others then r := r || format('K6b a direct insert is refused: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- ---- addressed requests: what is allowed ---------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
    values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_q1', '1A', v_a) returning id into q1;
  reset role;
  select format('tutor_id null=%s, status=%s, pay=%s, addressed=%s, hours to end=%s', tutor_id is null, status, payment_status, requested_tutor_id = v_a,
                round(extract(epoch from (expires_at - now())) / 3600.0)) into t from session_requests where id = q1;
  r := r || format('K7 an addressed request is accepted: %s (want true, pending, initiated, true, 48)', t) || E'\n';

  -- a short-notice one ends 30 minutes after its start, not 48 hours after sending
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
    values (v_l, e_l, v_l, now() + interval '2 hours', 1, 'kos_q2', '1A', v_a) returning id into q2;
  reset role;
  select round(extract(epoch from (expires_at - now())) / 60.0) into n from session_requests where id = q2;
  r := r || format('K8 a request for a session in 2 hours ends 30 minutes after its start: minutes to end=%s (want 150)', n) || E'\n';

  -- forged fields are reset
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id,
                                expires_at, reminder_sent_at, resent_from)
    values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_q3', '1A', v_a, now() + interval '30 days', now(), q1) returning id into q3;
  reset role;
  select format('hours to end=%s, reminder null=%s, resent_from null=%s', round(extract(epoch from (expires_at - now())) / 3600.0), reminder_sent_at is null, resent_from is null)
    into t from session_requests where id = q3;
  r := r || format('K9 forged end time, reminder and resend fields are reset: %s (want 48, true, true)', t) || E'\n';

  -- the fourth waiting request for the same tutor is refused (3 are already open: q1, q2, q3)
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
      values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_q4x', '1A', v_a);
    r := r || 'K10 FAIL: a 4th waiting request for the same tutor was accepted' || E'\n';
  exception when others then r := r || format('K10 a 4th waiting request for the same tutor is refused: %s', sqlerrm) || E'\n'; end;

  -- not allowed: a tutor never met, an unapproved tutor, a tutor of another subject, a higher price level than the tutor's
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
      values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_d1', '1A', v_d);
    r := r || 'K11 FAIL: addressed a tutor never met' || E'\n';
  exception when others then r := r || format('K11 a tutor never met is refused: %s', sqlerrm) || E'\n'; end;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
      values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_u1', '1A', v_u);
    r := r || 'K12 FAIL: addressed an unapproved tutor' || E'\n';
  exception when others then r := r || format('K12 an unapproved tutor is refused: %s', sqlerrm) || E'\n'; end;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
      values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_h1', '1A', v_h);
    r := r || 'K13 FAIL: addressed a tutor who does not teach the subject' || E'\n';
  exception when others then r := r || format('K13 a tutor who does not teach the subject is refused: %s', sqlerrm) || E'\n'; end;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
      values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_b2a', '2A', v_b);
    r := r || 'K14 FAIL: addressed a tutor at a higher price level than theirs' || E'\n';
  exception when others then r := r || format('K14 a higher price level than the tutor''s is refused: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- a stranger cannot address a request for someone else's learner, and cannot probe with the checking function
  perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
      values (v_l, e_l, v_x, now() + interval '3 days', 1, 'kos_x1', '1A', v_a);
    r := r || 'K15 FAIL: a stranger addressed a request for another adult' || E'\n';
  exception when others then r := r || format('K15 a stranger cannot address a request for another adult: %s', sqlerrm) || E'\n'; end;
  select public.addressed_request_problem(v_l, v_l, v_a, '1A', e_l, null) into t;
  r := r || format('K15b the checking function tells a stranger nothing about others: %s', t) || E'\n';
  reset role;

  -- ---- making them visible: the card check passes ---------------------------------------------------------------------------
  set local role service_role;
  select public.record_card_verification('kos_q1', 100, 'ZAR', auth_ok, 'k@example.invalid') into t;
  select public.record_card_verification('kos_q2', 100, 'ZAR', auth_ok, 'k@example.invalid') into t;
  select public.record_card_verification('kos_q3', 100, 'ZAR', auth_ok, 'k@example.invalid') into t;
  reset role;
  select count(*) into v_cnt from notifications where type = 'request_for_you' and profile_id = v_a;
  r := r || format('K16 tutor A hears of each addressed request once its card check passes: notes=%s (want 3)', v_cnt) || E'\n';

  -- an ordinary (anonymous) request from L, and one from the parent for the child
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id)
    values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_qo', '1A') returning id into qo;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id)
    values (v_c, e_c, v_p, now() + interval '3 days 3 hours', 1, 'kos_qc', '1A') returning id into qc;   -- later than q1, which tutor A accepts: one tutor cannot be in two places
  reset role;
  set local role service_role;
  select public.record_card_verification('kos_qo', 100, 'ZAR', auth_ok, 'k@example.invalid') into t;
  select public.record_card_verification('kos_qc', 100, 'ZAR', auth_ok, 'k@example.invalid') into t;
  reset role;

  -- ---- who sees what (7db) --------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from available_requests_for_tutor() where id = q1 and sent_to_you;
  select count(*) into n from available_requests_for_tutor() where id = qo and not sent_to_you;
  r := r || format('K17 tutor A sees the request addressed to them (%s, want 1) and an ordinary one (%s, want 1)', v_cnt, n) || E'\n';
  select subject_name || ' / ' || grade_level || ' / level ' || level_id into t from available_requests_for_tutor() where id = qo;
  r := r || format('K17b what a tutor is shown: %s (want Mathematics / Grade 11 / level 1A)', t) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from available_requests_for_tutor() where id in (q1, q2, q3);
  select count(*) into n from available_requests_for_tutor() where id = qo;
  r := r || format('K18 tutor B does not see requests addressed to A (%s, want 0) but sees the ordinary one (%s, want 1)', v_cnt, n) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from available_requests_for_tutor();
  r := r || format('K19 an unapproved tutor sees nothing: %s (want 0)', v_cnt) || E'\n';
  reset role;

  -- only what the tutor could accept: not another subject, not a higher level
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount)
    values (v_x, null, v_x, now() + interval '3 days', 1, 'pending', 'card_verified', 'kos_hi', '2A', 2, 180) returning id into qx;
  perform set_config('request.jwt.claims', json_build_object('sub', v_h, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from available_requests_for_tutor() where id = qo;
  r := r || format('K19b a tutor who teaches another subject does not see a Mathematics request: %s (want 0)', v_cnt) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from available_requests_for_tutor() where id = qx;
  r := r || format('K19c a request above the tutor''s price level is not shown to them: %s (want 0)', v_cnt) || E'\n';
  reset role;
  update session_requests set status = 'cancelled' where id = qx;

  perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from available_requests_for_tutor();
  select count(*) into n from session_requests;
  r := r || format('K20 a learner who is not a tutor sees nothing through the tutor function (%s) and no request in the table (%s) (want 0, 0)', v_cnt, n) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from session_requests;
  r := r || format('K21 7db: an approved tutor who accepted nothing can read no waiting request in the table: %s (want 0)', n) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from session_requests;
  r := r || format('K21b a learner still reads their own requests: %s (want 4: q1, q2, q3 and the ordinary one)', n) || E'\n';
  reset role;

  -- ---- claiming ----------------------------------------------------------------------------------------------------------------------
  set local role service_role;
  begin
    select public.claim_session_request(q1, v_b) into j;
    r := r || format('K22 FAIL: tutor B claimed a request addressed to A (mode %s)', j->>'mode') || E'\n';
  exception when others then r := r || format('K22 tutor B cannot claim a request addressed to A: %s', sqlerrm) || E'\n'; end;
  select public.claim_session_request(q1, v_a) into j;
  r := r || format('K23 tutor A claims it: mode %s (want charge)', j->>'mode') || E'\n';
  select public.claim_session_request(qo, v_b) into j;
  r := r || format('K24 an ordinary request is claimable by an approved tutor: mode %s (want charge)', j->>'mode') || E'\n';
  reset role;

  -- an end time in the past stops a claim even before the job has run
  update session_requests set expires_at = now() - interval '1 minute' where id = q3;
  set local role service_role;
  begin
    select public.claim_session_request(q3, v_a) into j;
    r := r || 'K25 FAIL: claimed a request past its end' || E'\n';
  exception when others then r := r || format('K25 a request past its end cannot be claimed: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- ---- trying someone else ---------------------------------------------------------------------------------------------------------------
  -- L tries someone else instead of B: B no longer sees L's requests and cannot claim them; whatever was waiting for B is withdrawn.
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, requested_tutor_id, expires_at)
    values (v_l, e_l, v_l, now() + interval '3 days', 1, 'pending', 'card_verified', 'kos_wb', '1A', 1, 50, v_b, now() + interval '40 hours') returning id into qx;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount)
    values (v_l, e_l, v_l, now() + interval '3 days 3 hours', 1, 'pending', 'card_verified', 'kos_o2', '1A', 1, 50) returning id into qn;   -- later than qo, which tutor B accepts
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_tutor_choice(v_l, v_b, 'avoid');
  reset role;
  select status into t from session_requests where id = qx;
  r := r || format('K26 choosing "try someone else" withdraws what was waiting for that tutor: status=%s (want cancelled)', t) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from available_requests_for_tutor() where id = qn;
  r := r || format('K27 the tutor tried-someone-else-instead-of no longer sees that learner''s requests: %s (want 0)', v_cnt) || E'\n';
  reset role;
  set local role service_role;
  begin
    select public.claim_session_request(qn, v_b) into j;
    r := r || 'K28 FAIL: the avoided tutor claimed an ordinary request' || E'\n';
  exception when others then r := r || format('K28 the avoided tutor cannot claim it either: %s', sqlerrm) || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
      values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_b3', '1A', v_b);
    r := r || 'K29 FAIL: addressed an avoided tutor' || E'\n';
  exception when others then r := r || format('K29 the learner cannot address a tutor they tried someone else instead of: %s', sqlerrm) || E'\n'; end;
  perform public.clear_tutor_choice(v_l, v_b);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from available_requests_for_tutor() where id = qn;
  r := r || format('K30 undoing it lets the tutor see the learner''s requests again: %s (want 1)', v_cnt) || E'\n';
  reset role;

  -- ---- a tutor declines ------------------------------------------------------------------------------------------------------------------
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, requested_tutor_id, expires_at)
    values (v_c, e_c, v_p, now() + interval '3 days', 1, 'pending', 'card_verified', 'kos_dec', '1A', 1, 50, v_a, now() + interval '40 hours') returning id into q4;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.decline_session_request(q4);
    r := r || 'K31 FAIL: another tutor declined it' || E'\n';
  exception when others then r := r || format('K31 another tutor cannot decline it: %s', sqlerrm) || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.decline_session_request(qn);
    r := r || 'K32 FAIL: declined an ordinary request' || E'\n';
  exception when others then r := r || format('K32 an ordinary request cannot be declined: %s', sqlerrm) || E'\n'; end;
  perform public.decline_session_request(q4);
  reset role;
  select status into t from session_requests where id = q4;
  select count(*) into v_cnt from notifications where type = 'request_declined' and profile_id in (v_c, v_p);
  r := r || format('K33 the addressed tutor declines: status=%s (want declined); the child and the parent are each told: notes=%s (want 2)', t, v_cnt) || E'\n';

  -- ---- a tutor ends a pairing ---------------------------------------------------------------------------------------------------------------
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, requested_tutor_id, expires_at)
    values (v_c, e_c, v_p, now() + interval '3 days', 1, 'pending', 'card_verified', 'kos_end', '1A', 1, 50, v_a, now() + interval '40 hours');
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.end_tutor_pairing(v_c);
    r := r || 'K34 FAIL: a tutor who never taught the learner ended a pairing' || E'\n';
  exception when others then r := r || format('K34 a tutor who never taught the learner cannot end a pairing: %s', sqlerrm) || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.end_tutor_pairing(v_c);
  perform public.end_tutor_pairing(v_c);
  reset role;
  select count(*) into v_cnt from notifications where type = 'pairing_ended' and profile_id in (v_c, v_p);
  select string_agg(distinct body, ' | ') into t from notifications where type = 'pairing_ended' and profile_id in (v_c, v_p);
  r := r || format('K35 ending a pairing (twice) tells the child and the parent once each: notes=%s (want 2); words: %s', v_cnt, t) || E'\n';
  select count(*) into v_cnt from session_requests where paystack_reference = 'kos_end' and status = 'declined';
  r := r || format('K36 what was waiting for that tutor is declined: %s (want 1)', v_cnt) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
      values (v_c, e_c, v_p, now() + interval '3 days', 1, 'kos_end2', '1A', v_a);
    r := r || 'K37 FAIL: addressed a tutor who ended the pairing' || E'\n';
  exception when others then r := r || format('K37 the parent cannot address the tutor who ended the pairing: %s', sqlerrm) || E'\n'; end;
  select count(*) into v_cnt from learner_tutor_choices;
  select count(*) into n from tutor_ended_pairings;
  r := r || format('K38 the parent cannot see that the tutor ended it: rows in tutor_ended_pairings=%s (want 0)', n) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from tutor_ended_pairings;
  reset role;
  r := r || format('K38b the tutor sees their own ended pairing: %s (want 1)', n) || E'\n';
  -- the child's ordinary request is hidden from A and cannot be claimed by A
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from available_requests_for_tutor() where id = qc;
  reset role;
  r := r || format('K39 an ordinary request from the learner whose pairing the tutor ended is hidden from that tutor: %s (want 0)', v_cnt) || E'\n';
  set local role service_role;
  begin
    select public.claim_session_request(qc, v_a) into j;
    r := r || 'K40 FAIL: the tutor claimed a request of a learner whose pairing they ended' || E'\n';
  exception when others then r := r || format('K40 nor can they claim it: %s', sqlerrm) || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.resume_tutor_pairing(v_c);
  select count(*) into v_cnt from available_requests_for_tutor() where id = qc;
  reset role;
  r := r || format('K41 resuming brings the learner''s requests back: %s (want 1)', v_cnt) || E'\n';

  -- ---- the 48 hours, the reminder and the usual end ---------------------------------------------------------------------------------------------
  -- (clear the board of earlier pending rows so the job only touches ours)
  update session_requests set status = 'cancelled' where status = 'pending' and paystack_reference like 'kos\_%';
  insert into session_requests (id, student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, requested_tutor_id, expires_at, created_at) values
    (gen_random_uuid(), v_l, e_l, v_l, now() + interval '3 days', 1, 'pending', 'card_verified', 'kos_e1', '1A', 1, 50, v_a, now() - interval '1 minute', now() - interval '49 hours'),
    (gen_random_uuid(), v_l, e_l, v_l, now() - interval '31 minutes', 1, 'pending', 'card_verified', 'kos_e2', '1A', 1, 50, v_a, null, now() - interval '3 hours'),
    (gen_random_uuid(), v_l, e_l, v_l, now() + interval '3 days', 1, 'pending', 'card_verified', 'kos_e3', '1A', 1, 50, v_a, now() + interval '23 hours', now() - interval '25 hours'),
    (gen_random_uuid(), v_l, e_l, v_l, now() - interval '31 minutes', 1, 'pending', 'card_verified', 'kos_e4', '1A', 1, 50, null, null, now() - interval '3 hours'),
    (gen_random_uuid(), v_l, e_l, v_l, now() + interval '3 days', 1, 'pending', 'card_verified', 'kos_e5', '1A', 1, 50, null, null, now() - interval '60 hours');
  perform public.expire_stale_paid_requests();
  perform public.expire_stale_paid_requests();
  select string_agg(paystack_reference || '=' || status, ', ' order by paystack_reference) into t from session_requests where paystack_reference in ('kos_e1','kos_e2','kos_e3','kos_e4','kos_e5');
  r := r || format('K42 the job: %s (want e1=expired, e2=expired, e3=pending, e4=expired, e5=pending)', t) || E'\n';
  select string_agg(distinct title, ' | ') into t from notifications where type = 'request_expired' and profile_id = v_l and created_at > now() - interval '1 minute';
  r := r || format('K43 the learner is told in words that fit: %s', t) || E'\n';
  select count(*) into v_cnt from notifications where type = 'request_for_you_reminder' and profile_id = v_a;
  r := r || format('K44 the tutor is reminded once after 24 hours (job run twice): notes=%s (want 1)', v_cnt) || E'\n';

  -- ---- one tap: send it to any available tutor ------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
    values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_r1', '1A', v_a) returning id into q1;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, requested_tutor_id)
    values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_r2', '1A', v_a) returning id into q2;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id)
    values (v_l, e_l, v_l, now() + interval '3 days', 1, 'kos_r3', '1A') returning id into q3;
  reset role;
  set local role service_role;
  select public.record_card_verification('kos_r1', 100, 'ZAR', auth_ok, 'k@example.invalid') into t;
  select public.record_card_verification('kos_r2', 100, 'ZAR', auth_ok, 'k@example.invalid') into t;
  select public.record_card_verification('kos_r3', 100, 'ZAR', auth_ok, 'k@example.invalid') into t;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  u := public.resend_request_to_anyone(q1);
  reset role;
  select format('same id=%s, addressed=%s, end set=%s', u = q1, requested_tutor_id is not null, expires_at is not null) into t from session_requests where id = q1;
  r := r || format('K45 a waiting request becomes an ordinary one: %s (want true, false, false)', t) || E'\n';

  update session_requests set status = 'expired' where id = q2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  u := public.resend_request_to_anyone(q2);
  reset role;
  select format('new row=%s, pending=%s, card checked=%s, same card=%s, addressed=%s, from the first=%s, ref ok=%s', u <> q2, status = 'pending', payment_status = 'card_verified',
                payment_card_id = (select payment_card_id from session_requests where id = q2), requested_tutor_id is not null, resent_from = q2, paystack_reference like 'rs\_%')
    into t from session_requests where id = u;
  r := r || format('K46 an expired one is sent again as a new ordinary request without a second card check: %s (want true x4, false, true, true)', t) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.resend_request_to_anyone(q2);
    r := r || 'K47 FAIL: sent the same request again twice' || E'\n';
  exception when others then r := r || format('K47 it can be sent again only once: %s', sqlerrm) || E'\n'; end;
  begin
    perform public.resend_request_to_anyone(q3);
    r := r || 'K48 FAIL: resent an ordinary request' || E'\n';
  exception when others then r := r || format('K48 an ordinary request cannot be resent: %s', sqlerrm) || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.resend_request_to_anyone(q2);
    r := r || 'K49 FAIL: a stranger resent someone else''s request' || E'\n';
  exception when others then r := r || format('K49 a stranger cannot: %s', sqlerrm) || E'\n'; end;
  reset role;
  update session_requests set status = 'expired', requested_tutor_id = v_a, requested_start = now() + interval '5 minutes' where id = q3;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.resend_request_to_anyone(q3);
    r := r || 'K50 FAIL: resent a request whose time is nearly gone' || E'\n';
  exception when others then r := r || format('K50 a request whose time is nearly gone cannot be resent: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- ---- My tutors ------------------------------------------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from my_tutors(v_l);
  select format('%s / %s / sessions %s / book again %s', first_name, choice, sessions_together, can_book_again) into t from my_tutors(v_l) where tutor_id = v_a;
  select can_book_again into b from my_tutors(v_l) where tutor_id = v_u;
  select format('%s / %s / %s', last_subject, last_grade, coalesce(request_status, 'no request')) into t2 from my_tutors(v_l) where tutor_id = v_a;
  reset role;
  r := r || format('K51 My tutors lists the four tutors L has had (%s, want 4); Alpha: %s (want Alpha / keep / sessions 1 / book again true); an unapproved tutor can be booked again=%s (want false)', v_cnt, t, b) || E'\n';
  r := r || format('K51b what Alpha last taught and the latest request: %s (want Mathematics / Grade 11 / and a request status)', t2) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from my_tutors(v_l);
  reset role;
  r := r || format('K52 a stranger asking for someone else''s tutors gets nothing: %s (want 0)', v_cnt) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from my_tutors(v_c);
  reset role;
  r := r || format('K53 a parent sees their child''s tutors: %s (want 1)', v_cnt) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from my_tutors(v_c);
  reset role;
  r := r || format('K54 a learner under 18 with their own sign-in gets nothing (they cannot choose): %s (want 0)', v_cnt) || E'\n';

  -- ---- admin and who may call what ------------------------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from learner_tutor_choices;
  select count(*) into n from tutor_ended_pairings;
  reset role;
  r := r || format('K55 an admin reads all choices (%s, want at least 2) and all ended pairings (%s, want 0: A resumed)', v_cnt, n) || E'\n';

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.available_requests_for_tutor();
    r := r || 'K56 FAIL: a signed-out caller ran the tutor function' || E'\n';
  exception when others then r := r || format('K56 signed out is refused: %s', sqlerrm) || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.pairing_blocked(v_l, v_a);
    r := r || 'K57 FAIL: a signed-in user called the internal rule' || E'\n';
  exception when others then r := r || format('K57 the internal rule is not callable by signed-in users: %s', sqlerrm) || E'\n'; end;
  begin
    perform public.notify_tutor_of_addressed_request();
    r := r || 'K58 FAIL: a signed-in user called the notifier' || E'\n';
  exception when others then r := r || format('K58 the notifier is not callable by signed-in users: %s', sqlerrm) || E'\n'; end;
  reset role;

  raise exception 'KEEP OR SWAP TEST (rolled back): %', r;
end $$;
