-- Rolled-back test of the 7k/7l access rules (migration 20260930190000). See README.md.
do $$
declare
  r text := E'\n';
  v_admin uuid := gen_random_uuid();
  v_nodob uuid := gen_random_uuid();
  v_adult uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_learner uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  v_enr uuid; v_enr_adult uuid;
  v_cnt int; v_d date;
  adult_dob text := (current_date - interval '30 years')::date::text;
  minor_dob text := (current_date - interval '15 years')::date::text;
  ver_t text; ver_p text;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  select setting_value #>> '{}' into ver_t from system_settings where setting_key='current_terms_version';
  select setting_value #>> '{}' into ver_p from system_settings where setting_key='current_privacy_version';

  -- setup, as the migration owner
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_admin, z,'authenticated','authenticated','t.a.'||v_admin||'@example.invalid', jsonb_build_object('role','student'), '{}'),
    (v_nodob, z,'authenticated','authenticated','t.nd.'||v_nodob||'@example.invalid', jsonb_build_object('role','student'), '{}'),
    (v_adult, z,'authenticated','authenticated','t.ad.'||v_adult||'@example.invalid',
       jsonb_build_object('role','student','date_of_birth',adult_dob,'accepted_terms_version',ver_t,'accepted_privacy_version',ver_p), '{}'),
    -- the guardian needs a phone on file to book for a learner (20260930237000)
    (v_parent, z,'authenticated','authenticated','t.pa.'||v_parent||'@example.invalid', jsonb_build_object('role','parent','date_of_birth',adult_dob,'phone_number','081 234 5678'), '{}'),
    (v_tutor, z,'authenticated','authenticated','t.tu.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor'), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_learner, z,'authenticated','authenticated','t.le.'||v_learner||'@example.invalid',
       jsonb_build_object('role','student','date_of_birth',minor_dob), jsonb_build_object('created_by_guardian', v_parent, 'relationship','mother'));
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_admin, 'T', 'Admin', 'x@example.invalid', '');

  -- an adult learner
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into parent_student_links (parent_id, student_id, relationship) values (v_adult, v_learner, 'guardian');
    r := r || 'T12 FAIL arbitrary user linked to a learner' || E'\n';
  exception when others then r := r || 'T12 ok self-made link refused: ' || sqlerrm || E'\n'; end;
  begin
    perform date_of_birth from profiles where id = v_learner;
    r := r || 'T13 FAIL date_of_birth readable' || E'\n';
  exception when others then r := r || 'T13 ok DOB unreadable: ' || sqlerrm || E'\n'; end;
  begin
    perform full_name, avatar_url from profiles where id = v_adult;
    r := r || 'T13b ok own name/avatar still readable' || E'\n';
  exception when others then r := r || 'T13b FAIL: ' || sqlerrm || E'\n'; end;
  begin
    perform public.is_minor(v_learner);
    r := r || 'T14 FAIL is_minor callable' || E'\n';
  exception when others then r := r || 'T14 ok is_minor not callable: ' || sqlerrm || E'\n'; end;
  begin
    perform public.has_active_guardian_consent(v_parent, v_learner);
    r := r || 'T14b FAIL consent probe callable' || E'\n';
  exception when others then r := r || 'T14b ok consent probe not callable: ' || sqlerrm || E'\n'; end;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_adult, 'Mathematics', 'Grade 12') returning id into v_enr_adult;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, enrollment_id)
    values (v_adult, v_adult, now() + interval '2 days', 1, 'tref_adult_1', '1A', v_enr_adult);
    r := r || 'T15 ok adult with DOB booked for self' || E'\n';
  exception when others then r := r || 'T15 FAIL adult self-booking: ' || sqlerrm || E'\n'; end;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id)
    values (v_learner, v_adult, now() + interval '2 days', 1, 'tref_adult_2', '1A');
    r := r || 'T16 FAIL stranger booked for a learner' || E'\n';
  exception when others then r := r || 'T16 ok stranger refused: ' || sqlerrm || E'\n'; end;
  begin
    insert into policy_acceptances (profile_id, accepted_by_profile_id, document, version, method) values (v_adult, v_adult, 'terms', 'x', 'signup_checkbox');
    r := r || 'T17 FAIL client wrote an acceptance' || E'\n';
  exception when others then r := r || 'T17 ok client acceptance write refused: ' || sqlerrm || E'\n'; end;
  select count(*) into v_cnt from public.my_pending_acceptances();
  r := r || format('T18 adult pending acceptances=%s (want 0)', v_cnt) || E'\n';
  begin
    perform public.admin_profile_private(array[v_learner]);
    r := r || 'T19 FAIL non-admin read private data' || E'\n';
  exception when others then r := r || 'T19 ok admin_profile_private refused: ' || sqlerrm || E'\n'; end;
  reset role;

  -- the learner under 18
  perform set_config('request.jwt.claims', json_build_object('sub', v_learner, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id)
    values (v_learner, v_learner, now() + interval '2 days', 1, 'tref_kid_1', '1A');
    r := r || 'T20 FAIL minor booked for self' || E'\n';
  exception when others then r := r || 'T20 ok minor self-booking refused: ' || sqlerrm || E'\n'; end;
  select count(*) into v_cnt from guardian_consents;
  r := r || format('T21 learner sees own consent rows=%s (want 1)', v_cnt) || E'\n';
  begin
    perform public.set_my_date_of_birth(adult_dob::date);
    r := r || 'T22 FAIL learner changed DOB to adult' || E'\n';
  exception when others then r := r || 'T22 ok learner cannot change DOB: ' || sqlerrm || E'\n'; end;
  reset role;

  -- the guardian
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_learner, 'Mathematics', 'Grade 10') returning id into v_enr;
    r := r || 'T23 ok guardian created learner enrolment' || E'\n';
  exception when others then r := r || 'T23 FAIL guardian enrolment: ' || sqlerrm || E'\n'; end;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, enrollment_id)
    values (v_learner, v_parent, now() + interval '2 days', 1, 'tref_mum_1', '1A', v_enr);
    r := r || 'T24 ok guardian booked for learner' || E'\n';
  exception when others then r := r || 'T24 FAIL guardian booking: ' || sqlerrm || E'\n'; end;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, enrollment_id)
    values (v_learner, v_parent, now() + interval '2 days', 1, 'tref_mum_2', '1A', v_enr_adult);
    r := r || 'T25 FAIL request used another learner''s enrolment' || E'\n';
  exception when others then r := r || 'T25 ok foreign enrolment refused: ' || sqlerrm || E'\n'; end;
  select count(*) into v_cnt from session_requests where requested_by_profile_id = v_parent;
  r := r || format('T26 guardian sees own booking=%s (want 1)', v_cnt) || E'\n';
  perform public.withdraw_guardian_consent(v_learner);
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id)
    values (v_learner, v_parent, now() + interval '3 days', 1, 'tref_mum_3', '1A');
    r := r || 'T27 FAIL booking after consent withdrawn' || E'\n';
  exception when others then r := r || 'T27 ok booking after withdrawal refused: ' || sqlerrm || E'\n'; end;
  reset role;

  -- a learner with no date of birth on file
  perform set_config('request.jwt.claims', json_build_object('sub', v_nodob, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id)
    values (v_nodob, v_nodob, now() + interval '2 days', 1, 'tref_nd_1', '1A');
    r := r || 'T28 FAIL unknown-age learner booked' || E'\n';
  exception when others then r := r || 'T28 ok unknown-age self-booking refused: ' || sqlerrm || E'\n'; end;
  select count(*) into v_cnt from public.my_pending_acceptances();
  r := r || format('T29 pending=%s (want 2)', v_cnt);
  perform public.accept_current_policies();
  select count(*) into v_cnt from public.my_pending_acceptances();
  r := r || format(', after accept=%s (want 0)', v_cnt) || E'\n';
  begin
    perform public.set_my_date_of_birth('2999-01-01'::date);
    r := r || 'T30 FAIL future DOB accepted' || E'\n';
  exception when others then r := r || 'T30 ok future DOB refused: ' || sqlerrm || E'\n'; end;
  perform public.set_my_date_of_birth(adult_dob::date);
  r := r || format('T31 DOB set once -> %s', public.my_date_of_birth());
  begin
    perform public.set_my_date_of_birth('1950-01-01'::date);
    r := r || ' | FAIL DOB changed twice' || E'\n';
  exception when others then r := r || ' | ok second change refused: ' || sqlerrm || E'\n'; end;
  begin
    insert into session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id)
    values (v_nodob, v_nodob, now() + interval '2 days', 1, 'tref_nd_2', '1A');
    r := r || 'T32 ok booking works once DOB recorded' || E'\n';
  exception when others then r := r || 'T32 FAIL: ' || sqlerrm || E'\n'; end;
  reset role;

  -- a tutor
  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_my_date_of_birth(minor_dob::date);
    r := r || 'T33 FAIL tutor declared under 18' || E'\n';
  exception when others then r := r || 'T33 ok under-18 tutor DOB refused: ' || sqlerrm || E'\n'; end;
  reset role;

  -- an admin verifying that tutor
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    update tutor_profiles set is_verified = true where id = v_tutor;
    r := r || 'T34 FAIL tutor verified with no DOB' || E'\n';
  exception when others then r := r || 'T34 ok verify without DOB refused: ' || sqlerrm || E'\n'; end;
  perform public.admin_set_date_of_birth(v_tutor, adult_dob::date);
  update tutor_profiles set is_verified = true where id = v_tutor;
  get diagnostics v_cnt = row_count;
  r := r || format('T35 admin recorded DOB then verified: rows=%s (want 1)', v_cnt);
  select date_of_birth into v_d from public.admin_profile_private(array[v_tutor]);
  r := r || format(', admin reads DOB=%s', v_d) || E'\n';
  reset role;

  -- not signed in
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  set local role anon;
  begin
    perform date_of_birth from profiles limit 1;
    r := r || 'T36 FAIL anon reads DOB' || E'\n';
  exception when others then r := r || 'T36 ok anon cannot read DOB: ' || sqlerrm || E'\n'; end;
  begin
    perform public.set_my_date_of_birth(adult_dob::date);
    r := r || 'T37 FAIL anon called set_my_date_of_birth' || E'\n';
  exception when others then r := r || 'T37 ok anon refused: ' || sqlerrm || E'\n'; end;
  reset role;

  raise exception 'ACCESS TEST REPORT (rolled back): %', r;
end $$;
