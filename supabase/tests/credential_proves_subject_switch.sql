-- Rolled-back test of migration 20261118190000_credential_proves_subject_switch.sql (SHOULD batch B, 18 Nov 2026): only a super admin can say which credentials prove subject competence, and the switch
-- really changes what the teaching-credential button accepts. Made-up people only (example.invalid); the block ends with `raise exception` so nothing is kept.
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/credential_proves_subject_switch.sql supabase/migrations/20261118190000_credential_proves_subject_switch.sql
-- After the apply, paste this file alone.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  uid text := replace(gen_random_uuid()::text, '-', '');
  adult text := ((now() at time zone 'Africa/Johannesburg')::date - interval '30 years')::date::text;
  v_sa uuid := gen_random_uuid(); v_off uuid := gen_random_uuid(); v_fin uuid := gen_random_uuid(); v_tut uuid := gen_random_uuid();
  v_doc uuid; v_cur text; t text; nfail int; nlines int;
  v_all constant text := 'Only a super admin can change which credentials prove subject competence';
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
        perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
        set local role authenticated;
        begin
          execute p_sql into v;
          reset role;
          return coalesce(v, 'null');
        exception when others then
          reset role;
          return 'ERR: ' || sqlerrm;
        end;
      end $f$ $mk$;
    select k.curriculum::text into v_cur from public.curriculum_criteria k where k.active order by k.curriculum limit 1;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_sa, z, 'authenticated', 'authenticated', 'cs.sa.' || uid || '@example.invalid', '{}', '{}'),
      (v_off, z, 'authenticated', 'authenticated', 'cs.o.' || uid || '@example.invalid', '{}', '{}'),
      (v_fin, z, 'authenticated', 'authenticated', 'cs.f.' || uid || '@example.invalid', '{}', '{}'),
      (v_tut, z, 'authenticated', 'authenticated', 'cs.t.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tia', 'surname', 'Tutor', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_sa, 'Sue', 'Super', 'cs.sa.' || uid || '@example.invalid', '', 'super_admin', true),
      (v_off, 'Vic', 'Officer', 'cs.o.' || uid || '@example.invalid', '', 'verification_officer', true),
      (v_fin, 'Fin', 'Manager', 'cs.f.' || uid || '@example.invalid', '', 'finance_manager', true);
    -- a tutor who finished Module 7 (so only the credential matters), one claimed subject, a verified document and a verified credential that does NOT prove competence today (exam marker)
    insert into public.tier1_training (tutor_id, module, result, method, conduct_accepted_at) values (v_tut, 7, 'complete', 'scenario_check', now());
    insert into public.tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
      values (v_tut, 'Mathematics', v_cur::public.curriculum_type, 'Grade 8', 'Grade 12', 'pending');
    insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status) values (v_tut, 'teaching_qualification', 'fixture/' || v_tut, 'verified') returning id into v_doc;
    insert into public.tutor_credentials (tutor_id, credential_code, document_id, status, obtained_on, verified_by, verified_at) values (v_tut, 'exam_marker', v_doc, 'verified', current_date, v_off, now());
    r := r || 'S0 setup: a super admin, an officer, a finance manager, a tutor with Module 7, one pending subject and a verified exam-marker credential' || E'\n';

    r := r || pg_temp.chk('K1', 'today an exam marker does not prove competence', (select proves_subject_competence::text from credential_definitions where code = 'exam_marker'), 'false');
    t := pg_temp.run_as(v_off, format('select public.admin_approve_subjects_on_credential(%L::uuid)::text', v_tut));
    r := r || pg_temp.chk('K2', 'so the officer cannot approve the subject on it', (t like 'ERR: This tutor has no verified teaching credential%')::text, 'true');
    r := r || pg_temp.chk('K3', 'the super admin ticks it', pg_temp.run_as(v_sa, format('select public.admin_set_credential_proves_subject(%L, true)::text', 'exam_marker')), 'true');
    r := r || pg_temp.chk('K4', 'the flag is on and ONE audit event was written', (select proves_subject_competence::text from credential_definitions where code = 'exam_marker') || '/'
      || (select count(*)::text from admin_audit_logs a where a.metadata ->> 'kind' = 'credential_proves_subject_changed' and a.metadata ->> 'credential' = 'exam_marker'), 'true/1');
    t := pg_temp.run_as(v_off, format('select (public.admin_approve_subjects_on_credential(%L::uuid)->>%L)', v_tut, 'approved'));
    r := r || pg_temp.chk('K5', 'now the officer can approve the claimed subject on that credential (the button follows the switch)', t, '1');
    r := r || pg_temp.chk('K6', 'ticking it again changes nothing and writes no second audit event', pg_temp.run_as(v_sa, format('select public.admin_set_credential_proves_subject(%L, true)::text', 'exam_marker')) || '/'
      || (select count(*)::text from admin_audit_logs a where a.metadata ->> 'kind' = 'credential_proves_subject_changed' and a.metadata ->> 'credential' = 'exam_marker'), 'true/1');
    t := pg_temp.run_as(v_sa, format('select public.admin_set_credential_proves_subject(%L, false)::text', 'exam_marker'));
    r := r || pg_temp.chk('K7', 'the super admin unticks it', t || '/' || (select proves_subject_competence::text from credential_definitions where code = 'exam_marker'), 'false/false');
    r := r || pg_temp.chk('K8', 'an officer cannot change the switch', pg_temp.run_as(v_off, format('select public.admin_set_credential_proves_subject(%L, true)::text', 'exam_marker')), 'ERR: ' || v_all);
    r := r || pg_temp.chk('K9', 'a finance manager cannot', pg_temp.run_as(v_fin, format('select public.admin_set_credential_proves_subject(%L, true)::text', 'exam_marker')), 'ERR: ' || v_all);
    r := r || pg_temp.chk('K10', 'a tutor cannot', pg_temp.run_as(v_tut, format('select public.admin_set_credential_proves_subject(%L, true)::text', 'exam_marker')), 'ERR: Admins only');
    r := r || pg_temp.chk('K11', 'signed out and the server key have no right to call it', has_function_privilege('anon', 'public.admin_set_credential_proves_subject(text, boolean)', 'execute')::text || '/' || has_function_privilege('service_role', 'public.admin_set_credential_proves_subject(text, boolean)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.admin_set_credential_proves_subject(text, boolean)', 'execute')::text, 'false/false/true');
    r := r || pg_temp.chk('K12', 'an unknown credential is refused', pg_temp.run_as(v_sa, format('select public.admin_set_credential_proves_subject(%L, true)::text', 'no_such_credential')), 'ERR: No such credential');
    r := r || pg_temp.chk('K13', 'the built-in assigned-by-an-admin level can never be ticked', (pg_temp.run_as(v_sa, format('select public.admin_set_credential_proves_subject(%L, true)::text', 'admin_assigned')) like 'ERR: The built-in%has no document%')::text, 'true');
    r := r || pg_temp.chk('K14', 'yes or no must be given', pg_temp.run_as(v_sa, format('select public.admin_set_credential_proves_subject(%L, null)::text', 'exam_marker')), 'ERR: Say yes or no');
    r := r || pg_temp.chk('K15', 'every other credential keeps its flag (the nine that prove competence are still true)',
      (select count(*)::text from credential_definitions where proves_subject_competence), '9');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
