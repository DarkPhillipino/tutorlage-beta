-- Rolled-back test of school results and grade uplift (migration 20261012090100). See README.md.
-- Until the migration is applied (not before Mon 12 Oct, CEO), run it with scripts/run-rolled-back-test.mjs,
-- which wraps the migration and this block in one DO statement that always fails, so nothing is kept.
-- That runner also replaces log_admin_event with a recorder, because the audit enum values
-- (20261012090000) can't be used in the transaction that adds them. After the 12th, run this file on its own.
do $$
declare
  r text := E'\n';
  v_mum uuid := gen_random_uuid();
  v_kid uuid := gen_random_uuid();
  v_adult uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  v_tutor2 uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  e_kid uuid; e_adult uuid; e_kid_phys uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid;
  r_base uuid; r_during uuid; r_test uuid; r_adult uuid;
  n int; x numeric; t text; p text[];
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '14 years')::date::text;
  z uuid := '00000000-0000-0000-0000-000000000000';
  first_on date := current_date - 60;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_mum, z,'authenticated','authenticated','t.m.'||v_mum||'@example.invalid', jsonb_build_object('role','parent','first_name','Mum','date_of_birth',adult,'phone_number','081 234 5678'), '{}'),
    (v_adult, z,'authenticated','authenticated','t.a.'||v_adult||'@example.invalid', jsonb_build_object('role','student','first_name','Adult','date_of_birth',adult), '{}'),
    (v_tutor, z,'authenticated','authenticated','t.t.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor','first_name','TutorA','date_of_birth',adult), '{}'),
    (v_tutor2, z,'authenticated','authenticated','t.t2.'||v_tutor2||'@example.invalid', jsonb_build_object('role','tutor','first_name','TutorB','date_of_birth',adult), '{}'),
    (v_stranger, z,'authenticated','authenticated','t.s.'||v_stranger||'@example.invalid', jsonb_build_object('role','parent','first_name','Stranger','date_of_birth',adult), '{}'),
    (v_admin, z,'authenticated','authenticated','t.ad.'||v_admin||'@example.invalid', jsonb_build_object('first_name','Admin','date_of_birth',adult), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_kid, z,'authenticated','authenticated','t.k.'||v_kid||'@example.invalid',
     jsonb_build_object('role','student','first_name','Kid','date_of_birth',minor), jsonb_build_object('created_by_guardian', v_mum, 'relationship','mother'));
  insert into admin_profiles (id, first_name, surname, email) values (v_admin, 'Test', 'Admin', 't.ad.'||v_admin||'@example.invalid');

  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_kid, 'Mathematics', 'Grade 10') returning id into e_kid;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_adult, 'Mathematics', 'Grade 12') returning id into e_adult;

  -- Three sessions with tutor A (completed one by one, so the trigger fires as it does live), one with tutor B.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, enrollment_id)
  values (v_kid, v_tutor, v_mum, first_on + time '15:00', 50, 30, 50, 35, e_kid) returning id into s1;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, enrollment_id)
  values (v_kid, v_tutor, v_mum, current_date - 45 + time '15:00', 50, 30, 50, 35, e_kid) returning id into s2;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, enrollment_id)
  values (v_kid, v_tutor, v_mum, current_date - 30 + time '15:00', 50, 30, 50, 35, e_kid) returning id into s3;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, enrollment_id)
  values (v_kid, v_tutor2, v_mum, current_date - 40 + time '15:00', 50, 30, 50, 35, e_kid) returning id into s4;
  update sessions set status = 'completed', completed_at = now() where id = s1;
  update sessions set status = 'completed', completed_at = now() where id = s2;
  select count(*) into n from notifications where profile_id = v_mum and type = 'school_results_prompt';
  r := r || format('R0 after 2 sessions with tutor A: prompts to the guardian = %s (want 0)', n) || E'\n';
  update sessions set status = 'completed', completed_at = now() where id = s3;
  update sessions set status = 'completed', completed_at = now() where id = s4;
  select count(*) into n from notifications where profile_id = v_mum and type = 'school_results_prompt';
  r := r || format('R1 after the 3rd session with tutor A (and 1 with B): prompts = %s (want 1)', n) || E'\n';

  -- Files as if uploaded (the owner inserts the storage rows; upload rights are checked separately below).
  insert into storage.objects (bucket_id, name, owner) values
    ('school-results', v_kid || '/base.pdf', v_mum), ('school-results', v_kid || '/during.jpg', v_mum);

  -- A stranger: no consent, no reads, no uploads into the child's folder.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.give_school_results_consent(v_kid);
    r := r || 'R2 FAIL a stranger gave consent for someone else''s child' || E'\n';
  exception when others then r := r || 'R2 ok stranger''s consent refused: ' || sqlerrm || E'\n'; end;
  begin
    insert into storage.objects (bucket_id, name) values ('school-results', v_kid || '/stranger.pdf');
    r := r || 'R3 FAIL a stranger uploaded into the child''s folder' || E'\n';
  exception when others then r := r || 'R3 ok stranger''s upload refused: ' || sqlerrm || E'\n'; end;
  reset role;

  -- The child (14) can't act for themselves.
  perform set_config('request.jwt.claims', json_build_object('sub', v_kid, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.give_school_results_consent(v_kid);
    r := r || 'R4 FAIL a learner under 18 gave their own consent' || E'\n';
  exception when others then r := r || 'R4 ok under-18 learner refused: ' || sqlerrm || E'\n'; end;
  begin
    insert into academic_assessments_and_reports (enrollment_id, evaluation_type, title, term, achieved_mark_pct)
    values (e_kid, 'test', 'legacy path', '3', 99);
    r := r || 'R5 FAIL the legacy assessments table still accepts writes' || E'\n';
  exception when others then r := r || 'R5 ok legacy table closed: ' || sqlerrm || E'\n'; end;
  reset role;

  -- The guardian.
  perform set_config('request.jwt.claims', json_build_object('sub', v_mum, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.add_school_result(v_kid, 'Mathematics', 'report_card', 'Term 2 report', first_on - 20, 2::smallint, 50, 100, v_kid || '/base.pdf');
    r := r || 'R6 FAIL a result was added before consent' || E'\n';
  exception when others then r := r || 'R6 ok consent needed first: ' || sqlerrm || E'\n'; end;
  perform public.give_school_results_consent(v_kid);
  select count(*) into n from school_results_consents where student_id = v_kid and withdrawn_at is null;
  r := r || format('R7 guardian consented and can read it: %s (want 1)', n) || E'\n';
  begin
    perform public.add_school_result(v_kid, 'Physical Sciences', 'test', 'Forces test', current_date - 10, null, 30, 50, null);
    r := r || 'R8 FAIL a result for a subject the learner never booked was accepted' || E'\n';
  exception when others then r := r || 'R8 ok unbooked subject refused: ' || sqlerrm || E'\n'; end;
  begin
    perform public.add_school_result(v_kid, 'Mathematics', 'test', 'Too many marks', current_date - 10, null, 60, 50, null);
    r := r || 'R9 FAIL a mark above the total was accepted' || E'\n';
  exception when others then r := r || 'R9 ok mark above total refused: ' || sqlerrm || E'\n'; end;
  begin
    perform public.add_school_result(v_kid, 'Mathematics', 'test', 'Someone else''s file', current_date - 10, null, 30, 50, v_stranger || '/x.pdf');
    r := r || 'R10 FAIL another person''s file path was accepted' || E'\n';
  exception when others then r := r || 'R10 ok foreign file path refused: ' || sqlerrm || E'\n'; end;
  begin
    insert into storage.objects (bucket_id, name) values ('school-results', v_kid || '/mum-upload.pdf');
    r := r || 'R11 ok guardian may upload into the child''s folder' || E'\n';
  exception when others then r := r || 'R11 FAIL guardian upload refused: ' || sqlerrm || E'\n'; end;
  select public.add_school_result(v_kid, 'mathematics', 'report_card', 'Term 2 report', first_on - 20, 2::smallint, 50, 100, v_kid || '/base.pdf') into r_base;
  select public.add_school_result(v_kid, 'Mathematics', 'report_card', 'Term 3 report', current_date - 5, 3::smallint, 65, 100, v_kid || '/during.jpg') into r_during;
  select public.add_school_result(v_kid, 'Mathematics', 'test', 'Algebra test', current_date - 20, null, 35, 50, null) into r_test;
  select subject_name into t from school_results where id = r_base;
  r := r || format('R12 three results added; subject stored as booked: "%s" (want "Mathematics")', t) || E'\n';
  select has_before::text || '/' || has_during::text || '/' || completed_sessions into t
  from public.school_results_overview(v_kid) where subject_name = 'Mathematics';
  r := r || format('R13 overview before/during/completed = %s (want true/true/4)', t) || E'\n';
  begin
    perform public.admin_check_school_result(r_base, 'verified', null);
    r := r || 'R14 FAIL a guardian verified their own result' || E'\n';
  exception when others then r := r || 'R14 ok guardian can''t verify: ' || sqlerrm || E'\n'; end;
  reset role;

  select count(*) into n from student_academic_records where student_id = v_kid;
  r := r || format('R15 pending results count for nothing: progress rows = %s (want 0)', n) || E'\n';

  -- Tutors and strangers can't read the results themselves.
  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from school_results where student_id = v_kid;
  r := r || format('R16 tutor reads the child''s results: %s rows (want 0)', n) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from school_results where student_id = v_kid;
  r := r || format('R17 stranger reads the child''s results: %s rows (want 0)', n) || E'\n';
  begin
    perform * from public.school_results_overview(v_kid);
    r := r || 'R18 FAIL stranger read the overview' || E'\n';
  exception when others then r := r || 'R18 ok stranger''s overview refused: ' || sqlerrm || E'\n'; end;
  reset role;

  -- The admin checks.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.admin_check_school_result(r_base, 'verified', null);
  perform public.admin_check_school_result(r_during, 'verified', 'Matches the report card');
  begin
    perform public.admin_check_school_result(r_test, 'verified', null);
    r := r || 'R19 FAIL a result with no document was verified' || E'\n';
  exception when others then r := r || 'R19 ok no document, no verification: ' || sqlerrm || E'\n'; end;
  begin
    perform public.admin_check_school_result(r_test, 'rejected', '  ');
    r := r || 'R20 FAIL rejected without a reason' || E'\n';
  exception when others then r := r || 'R20 ok a rejection needs a reason: ' || sqlerrm || E'\n'; end;
  perform public.admin_check_school_result(r_test, 'rejected', 'Please add a photo of the marked test');
  reset role;

  select uplift_delta_pct into x from student_academic_records where student_id = v_kid and tutor_id = v_tutor;
  r := r || format('R21 tutor A''s uplift for this learner: %s (want 15.00: 50%% before, 65%% during)', x) || E'\n';
  select count(*) into n from student_academic_records where student_id = v_kid and tutor_id = v_tutor2;
  r := r || format('R22 tutor B (1 session, under the 3-session minimum): rows = %s (want 0)', n) || E'\n';
  select avg_grade_uplift_pct || '/' || qualified_uplift_students_count into t from tutor_profiles where id = v_tutor;
  r := r || format('R23 tutor A''s profile uplift/learners = %s (want 15.00/1)', t) || E'\n';

  -- What a tutor and the guardian may see of it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role','authenticated')::text, true);
  set local role authenticated;
  select uplift_delta_pct into x from student_academic_records where student_id = v_kid;
  r := r || format('R24 tutor A sees the change: %s (want 15.00)', x) || E'\n';
  begin
    perform baseline_score_pct from student_academic_records where student_id = v_kid;
    r := r || 'R25 FAIL tutor read the learner''s actual marks' || E'\n';
  exception when others then r := r || 'R25 ok marks hidden from the tutor: ' || sqlerrm || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_mum, 'role','authenticated')::text, true);
  set local role authenticated;
  select uplift_delta_pct into x from student_academic_records where student_id = v_kid;
  r := r || format('R26 guardian sees the progress: %s (want 15.00)', x) || E'\n';
  select status || ': ' || coalesce(check_note, '') into t from school_results where id = r_test;
  r := r || format('R27 guardian sees why the test wasn''t accepted: "%s"', t) || E'\n';

  -- Deleting the verified "during" report card removes the progress again.
  select public.delete_school_result(r_during) into t;
  r := r || format('R28 delete returns the file to remove: %s', t) || E'\n';
  reset role;
  select count(*) into n from student_academic_records where student_id = v_kid;
  r := r || format('R29 progress rows after deleting it: %s (want 0)', n) || E'\n';
  select qualified_uplift_students_count into n from tutor_profiles where id = v_tutor;
  r := r || format('R30 tutor A''s learners with progress: %s (want 0)', n) || E'\n';

  -- An adult learner for themselves, and not for anyone else.
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.give_school_results_consent(v_adult);
  select public.add_school_result(v_adult, 'Mathematics', 'exam', 'June exam', current_date - 100, 2::smallint, 140, 200, null) into r_adult;
  r := r || format('R31 adult learner added their own result: %s', r_adult is not null) || E'\n';
  begin
    perform public.add_school_result(v_kid, 'Mathematics', 'test', 'Not mine', current_date - 3, null, 10, 20, null);
    r := r || 'R32 FAIL an adult learner added results for someone else''s child' || E'\n';
  exception when others then r := r || 'R32 ok refused: ' || sqlerrm || E'\n'; end;
  reset role;

  -- Withdrawing consent deletes everything and stops new results.
  perform set_config('request.jwt.claims', json_build_object('sub', v_mum, 'role','authenticated')::text, true);
  set local role authenticated;
  select public.withdraw_school_results_consent(v_kid) into p;
  r := r || format('R33 withdrawal returns %s file(s) to delete (want 1: the base report)', coalesce(array_length(p, 1), 0)) || E'\n';
  select count(*) into n from school_results where student_id = v_kid;
  r := r || format('R34 results left after withdrawal: %s (want 0)', n) || E'\n';
  begin
    perform public.add_school_result(v_kid, 'Mathematics', 'test', 'After withdrawal', current_date - 3, null, 10, 20, null);
    r := r || 'R35 FAIL a result was added after consent was withdrawn' || E'\n';
  exception when others then r := r || 'R35 ok refused after withdrawal: ' || sqlerrm || E'\n'; end;
  reset role;

  -- Signed-out visitors get nothing.
  set local role anon;
  begin
    perform count(*) from school_results;
    r := r || 'R36 FAIL signed-out visitor read school_results' || E'\n';
  exception when others then r := r || 'R36 ok signed-out refused: ' || sqlerrm || E'\n'; end;
  reset role;

  select count(*) into n from admin_audit_logs where target_entity_id in (r_base, r_during, r_test);
  r := r || format('R37 audit rows for the 3 checks: %s written, %s recorded by the test stub (want 3 in one of them)',
                   n, coalesce(nullif(current_setting('test.audit_calls', true), ''), '0')) || E'\n';

  raise exception 'SCHOOL RESULTS TEST (rolled back): %', r;
end $$;
