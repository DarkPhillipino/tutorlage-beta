-- Rolled-back test of migration 20261118130000_teaching_credential_approves_subjects.sql (a verified teaching credential approves the claimed subjects; 18 Nov 2026).
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/teaching_credential_approves_subjects.sql supabase/migrations/20261118130000_teaching_credential_approves_subjects.sql
-- After the apply, paste this file alone. Made-up people only (example.invalid); nothing real is touched; the block ends with `raise exception` so nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  uid text := replace(gen_random_uuid()::text, '-', '');
  adult text := ((now() at time zone 'Africa/Johannesburg')::date - interval '30 years')::date::text;
  v_off uuid := gen_random_uuid();   -- verification officer
  v_sup uuid := gen_random_uuid();   -- support agent
  t1 uuid := gen_random_uuid();      -- SACE teacher, document verified, claims: 2 pending + 1 rejected + 1 verified
  t2 uuid := gen_random_uuid();      -- credential recorded, document NOT verified
  t3 uuid := gen_random_uuid();      -- credential that does not prove competence (exam marker)
  t4 uuid := gen_random_uuid();      -- nothing: the checklist route
  t5 uuid := gen_random_uuid();      -- student teacher, proof of enrolment verified
  v_cur text;
  v_crit uuid[];
  d1 uuid; d2 uuid; d3 uuid; d5 uuid; cr1 uuid; cr5 uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid;
  t text; n int; nfail int; nlines int;
begin
  begin
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
      create function pg_temp.mkc(p_tutor uuid, p_subject text, p_cur text, p_status text) returns uuid language plpgsql as $f$
      declare v uuid;
      begin
        insert into public.tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
        values (p_tutor, p_subject, p_cur::public.curriculum_type, 'Grade 8', 'Grade 12', p_status::public.verification_status) returning id into v;
        return v;
      end $f$ $mk$;
    execute $mk$
      create function pg_temp.mkdoc(p_tutor uuid, p_type text, p_status text) returns uuid language plpgsql as $f$
      declare v uuid;
      begin
        insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status)
        values (p_tutor, p_type::public.doc_type, 'fixture/' || p_tutor || '/' || p_type, p_status::public.verification_status) returning id into v;
        return v;
      end $f$ $mk$;
    execute $mk$
      create function pg_temp.go(p_u uuid, p_tutor uuid) returns text language sql as $f$
        select pg_temp.run_as(p_u, format('select public.admin_approve_subjects_on_credential(%L::uuid)::text', p_tutor)) $f$ $mk$;

    select k.curriculum::text into v_cur from public.curriculum_criteria k where k.active order by k.curriculum limit 1;
    select coalesce(array_agg(k.id), '{}') into v_crit from public.curriculum_criteria k where k.curriculum::text = v_cur and k.active;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_off, z, 'authenticated', 'authenticated', 'tc.o.' || uid || '@example.invalid', '{}', '{}'),
      (v_sup, z, 'authenticated', 'authenticated', 'tc.s.' || uid || '@example.invalid', '{}', '{}'),
      (t1, z, 'authenticated', 'authenticated', 'tc.1.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tia', 'surname', 'Teacher', 'date_of_birth', adult), '{}'),
      (t2, z, 'authenticated', 'authenticated', 'tc.2.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tom', 'surname', 'Two', 'date_of_birth', adult), '{}'),
      (t3, z, 'authenticated', 'authenticated', 'tc.3.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'surname', 'Three', 'date_of_birth', adult), '{}'),
      (t4, z, 'authenticated', 'authenticated', 'tc.4.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tim', 'surname', 'Four', 'date_of_birth', adult), '{}'),
      (t5, z, 'authenticated', 'authenticated', 'tc.5.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Sue', 'surname', 'Student', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_off, 'Vic', 'Officer', 'tc.o.' || uid || '@example.invalid', '', 'verification_officer', true),
      (v_sup, 'Sam', 'Support', 'tc.s.' || uid || '@example.invalid', '', 'support_agent', true);
    r := r || format('S0 setup: officer, support agent, 5 tutors; curriculum "%s" with %s checklist items; definitions that prove competence: %s',
      v_cur, coalesce(array_length(v_crit, 1), 0), (select string_agg(code, ',' order by code) from credential_definitions where proves_subject_competence)) || E'\n';

    -- the data: which credentials prove competence
    r := r || pg_temp.chk('D1', 'the teaching credentials prove competence; markers, the higher certificate and the admin-assigned level do not',
      (select string_agg(code || '=' || proves_subject_competence::text, ' ' order by code) from credential_definitions where code in ('exam_marker', 'higher_certificate_education', 'admin_assigned', 'sace_registered_teacher', 'student_teacher_enrolled')),
      'admin_assigned=false exam_marker=false higher_certificate_education=false sace_registered_teacher=true student_teacher_enrolled=true');
    r := r || pg_temp.chk('D2', 'the new student-teacher credential starts at 1A (the level everyone starts at)', (select entry_sub_tier_id from credential_definitions where code = 'student_teacher_enrolled'), '1A');

    -- documents and credentials, recorded the way the app does it (admin_record_credential)
    d1 := pg_temp.mkdoc(t1, 'teaching_qualification', 'verified');
    d2 := pg_temp.mkdoc(t2, 'teaching_qualification', 'pending');
    d3 := pg_temp.mkdoc(t3, 'proof_of_experience', 'verified');
    d5 := pg_temp.mkdoc(t5, 'university_transcript', 'verified');
    r := r || pg_temp.chk('C0a', 'officer records the SACE credential for the teacher', (pg_temp.run_as(v_off, format('select (public.admin_record_credential(%L::uuid, %L, current_date, %L::uuid, %L) is not null)::text', t1, 'sace_registered_teacher', d1, 'seen')) ), 'true');
    r := r || pg_temp.chk('C0b', 'officer records the student-teacher credential (level stays 1A)', pg_temp.run_as(v_off, format('select (public.admin_record_credential(%L::uuid, %L, current_date, %L::uuid, %L) is not null)::text', t5, 'student_teacher_enrolled', d5, 'enrolment seen')), 'true');
    perform pg_temp.run_as(v_off, format('select public.admin_record_credential(%L::uuid, %L, current_date, %L::uuid, %L)::text', t2, 'sace_registered_teacher', d2, 'doc not checked yet'));
    perform pg_temp.run_as(v_off, format('select public.admin_record_credential(%L::uuid, %L, current_date, %L::uuid, %L)::text', t3, 'exam_marker', d3, 'marker'));
    select id into cr1 from tutor_credentials where tutor_id = t1; select id into cr5 from tutor_credentials where tutor_id = t5;
    r := r || pg_temp.chk('C0c', 'the student teacher is still level 1A', (select current_sub_tier_id from tutor_profiles where id = t5), '1A');

    a1 := pg_temp.mkc(t1, 'Mathematics', v_cur, 'pending'); a2 := pg_temp.mkc(t1, 'Physical Sciences', v_cur, 'under_review');
    a3 := pg_temp.mkc(t1, 'History', v_cur, 'rejected'); a4 := pg_temp.mkc(t1, 'English', v_cur, 'verified');
    perform pg_temp.mkc(t2, 'Mathematics', v_cur, 'pending'); perform pg_temp.mkc(t3, 'Mathematics', v_cur, 'pending'); perform pg_temp.mkc(t4, 'Mathematics', v_cur, 'pending');
    perform pg_temp.mkc(t5, 'Mathematics', v_cur, 'pending'); perform pg_temp.mkc(t5, 'Life Sciences', v_cur, 'pending');

    -- the action
    t := pg_temp.go(v_off, t1);
    r := r || pg_temp.chk('A1', 'the officer approves the teacher''s claimed subjects on the credential: 2 approved, credential named', regexp_replace(t, '"subject_ids": \[[^]]*\]', '"subject_ids": [..]'), '{"approved": 2, "credential": "SACE-registered qualified teacher", "subject_ids": [..]}');
    r := r || pg_temp.chk('A2', 'the two pending claims are verified; the rejected one and the verified one are untouched',
      (select string_agg(verification_status::text, ' ' order by subject_name) from tutor_subject_competencies where tutor_id = t1), 'verified rejected verified verified');
    r := r || pg_temp.chk('A3', 'one review row per approved claim, with the note; none for the rejected claim',
      (select count(*)::text || '/' || bool_and(review_note like 'Teaching credential verified: SACE-registered qualified teacher (teaching qualification)')::text from tutor_subject_reviews where competency_id in (a1, a2)) || '/' || (select count(*)::text from tutor_subject_reviews where competency_id = a3), '2/true/0');
    select count(*)::text into t from admin_audit_logs where target_entity_id in (a1, a2) and metadata ->> 'kind' = 'subject_approved_on_credential';
    r := r || pg_temp.chk('A4', 'one audit event per approved claim, naming the credential', t, '2');
    r := r || pg_temp.chk('A5', 'a second press approves nothing more', (pg_temp.go(v_off, t1))::text, '{"approved": 0, "credential": "SACE-registered qualified teacher", "subject_ids": []}');
    r := r || pg_temp.chk('A6', 'the student teacher''s two claims are approved on the proof of enrolment', regexp_replace(pg_temp.go(v_off, t5), '"subject_ids": \[[^]]*\]', '"subject_ids": [..]'), '{"approved": 2, "credential": "Student teacher enrolled in a B.Ed or PGCE (proof of enrolment)", "subject_ids": [..]}');

    -- what must NOT approve
    r := r || pg_temp.chk('R1', 'a credential whose document is not verified approves nothing', left(pg_temp.go(v_off, t2), 70), 'ERR: This tutor has no verified teaching credential with a verified do');
    r := r || pg_temp.chk('R2', 'a credential that does not prove competence (exam marker) approves nothing', left(pg_temp.go(v_off, t3), 70), 'ERR: This tutor has no verified teaching credential with a verified do');
    r := r || pg_temp.chk('R3', 'a tutor with no credential approves nothing', left(pg_temp.go(v_off, t4), 70), 'ERR: This tutor has no verified teaching credential with a verified do');
    r := r || pg_temp.chk('R4', 'and their claims are still pending', (select count(*)::text from tutor_subject_competencies where tutor_id in (t2, t3, t4) and verification_status = 'pending'), '3');
    r := r || pg_temp.chk('R5', 'a support agent is refused', pg_temp.go(v_sup, t4), 'ERR: Only a verification officer or a super admin can approve subjects');
    r := r || pg_temp.chk('R6', 'a tutor (approving their own) is refused', pg_temp.go(t4, t4), 'ERR: Admins only');
    r := r || pg_temp.chk('R7', 'a signed-out caller is refused', pg_temp.go(null, t4), 'ERR: permission denied for function admin_approve_subjects_on_credential');
    r := r || pg_temp.chk('R8', 'a credential row that belongs to another tutor cannot be used', left(pg_temp.run_as(v_off, format('select public.admin_approve_subjects_on_credential(%L::uuid, %L::uuid)::text', t4, cr1)), 40), 'ERR: This tutor has no verified teaching');

    -- the checklist route is unchanged
    r := r || pg_temp.chk('K1', 'the checklist route still approves a subject for a tutor with no credential',
      pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject((select id from tutor_subject_competencies where tutor_id = %L), %L, %L, %L::uuid[])::text', t4, 'approve', 'zz checked', v_crit::text)), '');
    r := r || pg_temp.chk('K2', 'and it is now verified', (select verification_status::text from tutor_subject_competencies where tutor_id = t4), 'verified');

    -- ONE place for "may a subject be approved yet" (item 7 will change only this function): both routes obey it
    r := r || pg_temp.chk('B1', 'the blocker answers null today and no API role may call it',
      coalesce((select public.subject_approval_blocker(t1)), 'null') || '/' || has_function_privilege('anon', 'public.subject_approval_blocker(uuid)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.subject_approval_blocker(uuid)', 'execute')::text || '/' || has_function_privilege('service_role', 'public.subject_approval_blocker(uuid)', 'execute')::text,
      'null/false/false/false');
    update tutor_subject_competencies set verification_status = 'pending' where tutor_id = t5;
    execute $x$ create or replace function public.subject_approval_blocker(p_tutor uuid) returns text language sql stable security definer set search_path = public as $b$ select 'BLOCKED FOR TEST'::text $b$ $x$;
    r := r || pg_temp.chk('B2', 'with a blocker in place the credential route refuses', pg_temp.go(v_off, t5), 'ERR: BLOCKED FOR TEST');
    update tutor_subject_competencies set verification_status = 'pending' where tutor_id = t4;
    r := r || pg_temp.chk('B3', 'and so does the checklist route', pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject((select id from tutor_subject_competencies where tutor_id = %L), %L, %L, %L::uuid[])::text', t4, 'approve', 'zz checked', v_crit::text)), 'ERR: BLOCKED FOR TEST');
    r := r || pg_temp.chk('B4', 'a rejection is not blocked', pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject((select id from tutor_subject_competencies where tutor_id = %L), %L, %L, %L::uuid[])::text', t4, 'reject', 'not enough', '{}')), '');
    execute $x$ create or replace function public.subject_approval_blocker(p_tutor uuid) returns text language sql stable security definer set search_path = public as $b$ select null::text $b$ $x$;
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
