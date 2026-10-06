-- Rolled-back test: a tutor can't accept a request they made themselves (migration 20261005200000).
-- A tutor account is an adult, so can_book_for() lets it insert a request for itself (through the API,
-- with no subject enrolment). The server's claim (service_role, as server/index.ts calls it) must refuse
-- that tutor, and still let a different tutor accept. See README.md.
do $$
declare
  r text := E'\n';
  v_tutor uuid := gen_random_uuid();
  v_tutor2 uuid := gen_random_uuid();
  q_own uuid;
  j jsonb; s text;
  auth_ok jsonb := '{"authorization_code":"AUTH_test123","reusable":true,"signature":"SIG_abc","last4":"4081","card_type":"visa ","bank":"TEST BANK","exp_month":"12","exp_year":"2030"}';
  adult text := (current_date - interval '30 years')::date::text;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_tutor, z,'authenticated','authenticated','t.t.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor','first_name','Tutor','date_of_birth',adult), '{}'),
    (v_tutor2, z,'authenticated','authenticated','t.t2.'||v_tutor2||'@example.invalid', jsonb_build_object('role','tutor','first_name','Tutor2','date_of_birth',adult), '{}');
  update profiles set date_of_birth = adult::date where id in (v_tutor, v_tutor2);
  update tutor_profiles set is_verified = true, current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null
  where id in (v_tutor, v_tutor2);
  insert into tutor_subject_competencies (tutor_id, subject_name, min_grade_level, max_grade_level, verification_status)
  values (v_tutor, 'Mathematics', 'Grade 8', 'Grade 12', 'verified'), (v_tutor2, 'Mathematics', 'Grade 8', 'Grade 12', 'verified');

  -- The tutor books for themselves. Through the site this fails earlier: the subject enrolment needs a
  -- student_profiles row, which a tutor account doesn't have. But session_requests.student_id only needs a
  -- profile, so a tutor calling the API directly can insert a request with no enrolment (RLS allows it:
  -- can_book_for() accepts any adult). That is the route this guards.
  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id)
    values (v_tutor, v_tutor, now() + interval '2 days', 1, 'tsm_own', '1A') returning id into q_own;
    r := r || 'S1 a tutor account can insert a request for itself (no enrolment), the case this guards' || E'\n';
  exception when others then r := r || 'S1 note: tutor self-booking refused at insert: ' || sqlerrm || E'\n'; end;
  reset role;

  if q_own is not null then
    set local role service_role;
    select public.record_card_verification('tsm_own', 100, 'ZAR', auth_ok, 't@example.invalid') into s;
    r := r || format('S2 card check -> %s (want card_verified)', s) || E'\n';
    perform public.save_tutor_payout_account(v_tutor, '632005', 'Absa Bank Limited, South Africa', 'Tutor Test', '6789',
                                             'ACCT_selftutor1', 'recorded_test_mode', '{}');
    perform public.save_tutor_payout_account(v_tutor2, '632005', 'Absa Bank Limited, South Africa', 'Tutor Two', '1111',
                                             'ACCT_selftutor2', 'recorded_test_mode', '{}');
    begin
      select public.claim_session_request(q_own, v_tutor) into j;
      r := r || format('S3 FAIL tutor accepted their own request (mode %s)', j->>'mode') || E'\n';
    exception when others then r := r || 'S3 ok own request refused: ' || sqlerrm || E'\n'; end;
    select public.claim_session_request(q_own, v_tutor2) into j;
    r := r || format('S4 another tutor claims it -> mode %s (want charge)', j->>'mode') || E'\n';
    reset role;
  end if;

  raise exception 'NO SELF-MATCH TEST (rolled back): %', r;
end $$;
