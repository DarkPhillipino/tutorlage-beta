-- Rolled-back test of migration 20261118230000_teacher_starting_levels.sql (ITEM 6, 18 Nov 2026): every qualified-teacher credential starts ONE level higher; students and non-teacher credentials are unchanged;
-- a tutor's level is the higher of the earned level and the credential floor. Made-up people only (example.invalid); the block ends with `raise exception` so nothing is kept.
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/teacher_starting_levels.sql supabase/migrations/20261118230000_teacher_starting_levels.sql
-- After the apply, paste this file alone.
do $$
declare
  r text := '';
  uid text := replace(gen_random_uuid()::text, '-', '');
  nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;
    -- a made-up tutor who holds ONE verified credential: answers "floor/level" after the floor is worked out
    execute $mk$
      create function pg_temp.held(p_uid text, p_codes text[]) returns text language plpgsql as $f$
      declare t uuid := gen_random_uuid(); c text; d uuid;
      begin
        insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
        values (t, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tsl.' || p_uid || '.' || substr(t::text, 1, 8) || '@example.invalid',
                jsonb_build_object('role', 'tutor', 'first_name', 'Zztsl', 'surname', 'Test'), '{}');
        foreach c in array p_codes loop
          d := gen_random_uuid();
          insert into public.tutor_verification_documents (id, tutor_id, document_type, document_url, status) values (d, t, 'teaching_qualification', 'fixture/' || t || '/' || c, 'verified');
          insert into public.tutor_credentials (tutor_id, credential_code, document_id, status, obtained_on, verified_at) values (t, c, d, 'verified', current_date, now());
        end loop;
        perform public.refresh_credential_floor(t);
        return (select coalesce(credential_floor_sub_tier_id, '-') || '/' || coalesce(current_sub_tier_id, '-') from public.tutor_profiles where id = t);
      end $f$ $mk$;

    r := r || pg_temp.chk('L1', 'the seven qualified-teacher credentials moved up one level',
      (select string_agg(code || '=' || entry_sub_tier_id, ' ' order by code) from public.credential_definitions
        where code in ('sace_registered_teacher', 'teaching_degree', 'teaching_degree_2y', 'sace_fet_subject_teacher', 'teaching_degree_3y', 'teaching_degree_4y', 'subject_leader')),
      'sace_fet_subject_teacher=3B sace_registered_teacher=2D subject_leader=3D teaching_degree=2D teaching_degree_2y=3A teaching_degree_3y=3B teaching_degree_4y=3C');
    r := r || pg_temp.chk('L2', 'the others are exactly as they were (students, certificate, practicum, examiners, admin level)',
      (select string_agg(code || '=' || coalesce(entry_sub_tier_id, 'none'), ' ' order by code) from public.credential_definitions
        where code in ('student_teacher_enrolled', 'higher_certificate_education', 'practicum_complete', 'exam_marker', 'exam_moderator_examiner', 'admin_assigned')),
      'admin_assigned=none exam_marker=4A exam_moderator_examiner=4B higher_certificate_education=2A practicum_complete=2C student_teacher_enrolled=1A');
    r := r || pg_temp.chk('L3', 'no other credential row exists or was changed (13 rows in all)', (select count(*)::text from public.credential_definitions), '13');

    -- what a tutor gets (floor/level)
    r := r || pg_temp.chk('L4', 'a SACE-registered teacher starts at 2D', pg_temp.held(uid, array['sace_registered_teacher']), '2D/2D');
    r := r || pg_temp.chk('L5', 'a teaching degree or PGCE starts at 2D', pg_temp.held(uid, array['teaching_degree']), '2D/2D');
    r := r || pg_temp.chk('L6', 'a degree and 2 years starts at 3A', pg_temp.held(uid, array['teaching_degree_2y']), '3A/3A');
    r := r || pg_temp.chk('L7', 'a SACE FET subject teacher starts at 3B', pg_temp.held(uid, array['sace_fet_subject_teacher']), '3B/3B');
    r := r || pg_temp.chk('L8', 'a degree and 3 years starts at 3B', pg_temp.held(uid, array['teaching_degree_3y']), '3B/3B');
    r := r || pg_temp.chk('L9', 'a degree and 4 years starts at 3C', pg_temp.held(uid, array['teaching_degree_4y']), '3C/3C');
    r := r || pg_temp.chk('L10', 'a head of department starts at 3D', pg_temp.held(uid, array['subject_leader']), '3D/3D');
    r := r || pg_temp.chk('L11', 'a student teacher still starts at 1A and a finished practicum at 2C', pg_temp.held(uid, array['student_teacher_enrolled']) || ' ' || pg_temp.held(uid, array['practicum_complete']), '1A/1A 2C/2C');
    r := r || pg_temp.chk('L12', 'with two credentials the higher floor wins', pg_temp.held(uid, array['teaching_degree', 'subject_leader']), '3D/3D');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
