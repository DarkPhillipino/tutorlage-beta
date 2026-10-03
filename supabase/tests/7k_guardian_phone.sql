-- Rolled-back test of the guardian's phone for a learner's sessions (migration 20260930237000,
-- legal spec §5). See README.md.
do $$
declare
  r text := E'\n';
  v_mum uuid := gen_random_uuid();
  v_kid uuid := gen_random_uuid();
  v_adult uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_enr uuid; v_sess uuid;
  n int; a text; b text;
  adult text := (current_date - interval '30 years')::date::text;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_mum, z,'authenticated','authenticated','t.m.'||v_mum||'@example.invalid', jsonb_build_object('role','parent','first_name','Mpho','surname','Khumalo','date_of_birth',adult), '{}'),
    (v_adult, z,'authenticated','authenticated','t.ad.'||v_adult||'@example.invalid', jsonb_build_object('first_name','Adult','date_of_birth',adult), '{}'),
    (v_tutor, z,'authenticated','authenticated','t.t.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor','first_name','Tutor'), '{}'),
    (v_other, z,'authenticated','authenticated','t.o.'||v_other||'@example.invalid', jsonb_build_object('role','tutor','first_name','Other'), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_kid, z,'authenticated','authenticated','t.k.'||v_kid||'@example.invalid',
     jsonb_build_object('first_name','Kid','date_of_birth',(current_date - interval '14 years')::date::text), jsonb_build_object('created_by_guardian', v_mum));

  -- the guardian, with no phone on file
  perform set_config('request.jwt.claims', json_build_object('sub', v_mum, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_kid, 'Mathematics', 'Grade 9') returning id into v_enr;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, enrollment_id)
    values (v_kid, v_mum, now() + interval '2 days', 1, 'tref_ph_1', '1A', v_enr);
    r := r || 'G1 FAIL guardian booked with no phone' || E'\n';
  exception when others then r := r || 'G1 ok no phone, booking refused: ' || sqlerrm || E'\n'; end;
  update parent_profiles set phone_number = '12' where id = v_mum;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, enrollment_id)
    values (v_kid, v_mum, now() + interval '2 days', 1, 'tref_ph_2', '1A', v_enr);
    r := r || 'G2 FAIL guardian booked with a two-digit phone' || E'\n';
  exception when others then r := r || 'G2 ok too-short phone refused: ' || sqlerrm || E'\n'; end;
  update parent_profiles set phone_number = '081 234 5678' where id = v_mum;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, enrollment_id)
    values (v_kid, v_mum, now() + interval '2 days', 1, 'tref_ph_3', '1A', v_enr);
    r := r || 'G3 ok guardian booked once phone was added' || E'\n';
  exception when others then r := r || 'G3 FAIL: ' || sqlerrm || E'\n'; end;
  select count(*) into n from public.my_session_guardian_contacts();
  r := r || format('G4 guardian (not a tutor) gets contacts=%s (want 0)', n) || E'\n';
  reset role;

  -- an adult booking for themselves needs no phone
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id)
    values (v_adult, v_adult, now() + interval '2 days', 1, 'tref_ph_4', '1A');
    r := r || 'G5 ok adult self-booking unaffected' || E'\n';
  exception when others then r := r || 'G5 FAIL: ' || sqlerrm || E'\n'; end;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id)
    values (v_kid, v_adult, now() + interval '2 days', 1, 'tref_ph_5', '1A');
    r := r || 'G5b FAIL stranger booked for the learner' || E'\n';
  exception when others then r := r || 'G5b ok stranger refused by the booking rule (not the phone rule): ' || sqlerrm || E'\n'; end;
  reset role;

  -- a session for the learner with v_tutor, booked by the guardian (inserted as owner)
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_kid, v_tutor, v_mum, now() + interval '3 days', 100, 20, 100, 80) returning id into v_sess;

  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role','authenticated')::text, true);
  set local role authenticated;
  select guardian_name, guardian_phone into a, b from public.my_session_guardian_contacts() where session_id = v_sess;
  r := r || format('G6 the session''s tutor sees guardian "%s" / "%s" (want Mpho Khumalo / 081 234 5678)', a, b) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.my_session_guardian_contacts();
  r := r || format('G7 another tutor sees contacts=%s (want 0)', n) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  set local role anon;
  begin
    perform public.my_session_guardian_contacts();
    r := r || 'G8 FAIL anon called my_session_guardian_contacts' || E'\n';
  exception when others then r := r || 'G8 ok anon refused: ' || sqlerrm || E'\n'; end;
  reset role;

  raise exception 'GUARDIAN PHONE TEST (rolled back): %', r;
end $$;
