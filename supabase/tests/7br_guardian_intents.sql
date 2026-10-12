-- Rolled-back test of migration 20261009133000 (master 7br: a parent adding a learner). See README.md.
-- Run with scripts/run-rolled-back-test.mjs (migration + this file in one always-failing statement), or after
-- the migration is applied, on its own (it always raises, so nothing is kept).
-- "Auth order" means what Supabase Auth's admin createUser does: insert the user with only
-- {provider, providers} in app_metadata, then write the caller's app_metadata in a later UPDATE.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  prov jsonb := '{"provider":"email","providers":["email"]}'::jsonb;
  adult_dob text := (current_date - interval '30 years')::date::text;
  minor_dob text := (current_date - interval '15 years')::date::text;
  ver_t text; ver_p text;
  v_parent uuid := gen_random_uuid();
  v_parent_nodob uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  l1 uuid := gen_random_uuid();
  l3 uuid := gen_random_uuid();
  l4 uuid := gen_random_uuid();
  l5 uuid := gen_random_uuid();
  l6 uuid := gen_random_uuid();
  l7 uuid := gen_random_uuid();
  l8 uuid := gen_random_uuid();
  l9 uuid := gen_random_uuid();
  l11 uuid := gen_random_uuid();
  v_cnt int; v_cnt2 int; v_txt text;
begin
  select setting_value #>> '{}' into ver_t from system_settings where setting_key = 'current_terms_version';
  select setting_value #>> '{}' into ver_p from system_settings where setting_key = 'current_privacy_version';

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_parent, z, 'authenticated', 'authenticated', 'g.pa.' || v_parent || '@example.invalid',
          jsonb_build_object('role', 'parent', 'date_of_birth', adult_dob), prov);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_parent_nodob, z, 'authenticated', 'authenticated', 'g.pn.' || v_parent_nodob || '@example.invalid',
          jsonb_build_object('role', 'parent'), prov);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_tutor, z, 'authenticated', 'authenticated', 'g.tu.' || v_tutor || '@example.invalid',
          jsonb_build_object('role', 'tutor', 'date_of_birth', adult_dob), prov);

  -- G1: Auth order with the server's record (written as service_role, as server/ does): accepted, linked,
  -- consent and acceptances by the guardian
  set local role service_role;
  insert into guardian_learner_intents (learner_id, guardian_id, relationship, consent_version)
  values (l1, v_parent, 'father', 'cv-test-7br');
  delete from guardian_learner_intents where expires_at < now();
  reset role;
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (l1, z, 'authenticated', 'authenticated', 'kid-g1@learners.tutorlage.invalid',
          jsonb_build_object('first_name', 'Kid', 'surname', 'Test', 'role', 'student', 'date_of_birth', minor_dob,
                             'accepted_terms_version', ver_t, 'accepted_privacy_version', ver_p), prov);
  select relationship::text into v_txt from parent_student_links where parent_id = v_parent and student_id = l1 and can_book_sessions;
  select count(*) into v_cnt from guardian_consents where guardian_profile_id = v_parent and learner_profile_id = l1 and consent_text_version = 'cv-test-7br';
  select count(*) into v_cnt2 from policy_acceptances where profile_id = l1 and accepted_by_profile_id = v_parent and method = 'guardian_added_learner';
  r := r || format('G1 Auth order + record: link=%s consent=%s acceptances=%s', coalesce(v_txt, 'none'), v_cnt, v_cnt2);
  select count(*) into v_cnt from guardian_learner_intents where learner_id = l1;
  select count(*) into v_cnt2 from student_profiles where id = l1;
  r := r || format(' record_left=%s student_row=%s (want father,1,2,0,1)', v_cnt, v_cnt2) || E'\n';

  -- G2: Auth order, no record: a minor's self-signup is still refused
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), z, 'authenticated', 'authenticated', 'g.ms.' || gen_random_uuid() || '@example.invalid',
            jsonb_build_object('role', 'student', 'date_of_birth', minor_dob), prov);
    r := r || 'G2 FAIL: minor self-signup accepted' || E'\n';
  exception when others then r := r || 'G2 ok: ' || sqlerrm || E'\n'; end;

  -- G3: an expired record doesn't count
  insert into guardian_learner_intents (learner_id, guardian_id, relationship, consent_version, expires_at)
  values (l3, v_parent, 'mother', 'cv-test-7br', now() - interval '1 minute');
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (l3, z, 'authenticated', 'authenticated', 'kid-g3@learners.tutorlage.invalid',
            jsonb_build_object('role', 'student', 'date_of_birth', minor_dob), prov);
    r := r || 'G3 FAIL: expired record used' || E'\n';
  exception when others then r := r || 'G3 ok: ' || sqlerrm || E'\n'; end;

  -- G4: the guardian must be an adult parent (a parent with no date of birth isn't)
  insert into guardian_learner_intents (learner_id, guardian_id, relationship, consent_version)
  values (l4, v_parent_nodob, 'mother', 'cv-test-7br');
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (l4, z, 'authenticated', 'authenticated', 'kid-g4@learners.tutorlage.invalid',
            jsonb_build_object('role', 'student', 'date_of_birth', minor_dob), prov);
    r := r || 'G4 FAIL: parent without a date of birth accepted' || E'\n';
  exception when others then r := r || 'G4 ok: ' || sqlerrm || E'\n'; end;

  -- G5: a tutor can't be the guardian
  insert into guardian_learner_intents (learner_id, guardian_id, relationship, consent_version)
  values (l5, v_tutor, 'guardian', 'cv-test-7br');
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (l5, z, 'authenticated', 'authenticated', 'kid-g5@learners.tutorlage.invalid',
            jsonb_build_object('role', 'student', 'date_of_birth', minor_dob), prov);
    r := r || 'G5 FAIL: tutor accepted as guardian' || E'\n';
  exception when others then r := r || 'G5 ok: ' || sqlerrm || E'\n'; end;

  -- G6: a record is for one id only; a different new user can't use it
  insert into guardian_learner_intents (learner_id, guardian_id, relationship, consent_version)
  values (l6, v_parent, 'mother', 'cv-test-7br');
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), z, 'authenticated', 'authenticated', 'kid-g6@learners.tutorlage.invalid',
            jsonb_build_object('role', 'student', 'date_of_birth', minor_dob), prov);
    r := r || 'G6 FAIL: another id used the record' || E'\n';
  exception when others then r := r || 'G6 ok: ' || sqlerrm || E'\n'; end;

  -- G7: the guardian in app_metadata at insert still works (the 7k order), with no record
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (l7, z, 'authenticated', 'authenticated', 'kid-g7@learners.tutorlage.invalid',
          jsonb_build_object('role', 'student', 'date_of_birth', minor_dob),
          prov || jsonb_build_object('created_by_guardian', v_parent, 'relationship', 'mother'));
  select count(*) into v_cnt from parent_student_links where parent_id = v_parent and student_id = l7 and relationship = 'mother';
  r := r || format('G7 app_metadata at insert: link=%s (want 1)', v_cnt) || E'\n';

  -- G8: an adult signing up for themselves: accepted, not linked, accepted their own terms
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (l8, z, 'authenticated', 'authenticated', 'g.ad.' || l8 || '@example.invalid',
          jsonb_build_object('role', 'student', 'date_of_birth', adult_dob,
                             'accepted_terms_version', ver_t, 'accepted_privacy_version', ver_p), prov);
  select count(*) into v_cnt from parent_student_links where student_id = l8;
  select count(*) into v_cnt2 from policy_acceptances where profile_id = l8 and accepted_by_profile_id = l8 and method = 'signup_checkbox';
  r := r || format('G8 adult self-signup: links=%s own_acceptances=%s (want 0,2)', v_cnt, v_cnt2) || E'\n';

  -- G9: a record can't create a tutor or parent account
  insert into guardian_learner_intents (learner_id, guardian_id, relationship, consent_version)
  values (l9, v_parent, 'guardian', 'cv-test-7br');
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (l9, z, 'authenticated', 'authenticated', 'g.t9.' || l9 || '@example.invalid',
            jsonb_build_object('role', 'tutor', 'date_of_birth', adult_dob), prov);
    r := r || 'G9 FAIL: record created a tutor' || E'\n';
  exception when others then r := r || 'G9 ok: ' || sqlerrm || E'\n'; end;

  -- G10: clients can't touch the table; the service role can; RLS is on. (The first run caught the service
  -- role with no rights at all: dev grants it nothing by default. The migration now grants them.)
  r := r || format('G10 anon select=%s, signed-in select=%s insert=%s, service_role insert=%s delete=%s, rls=%s (want f,f,f,t,t,t)',
    has_table_privilege('anon', 'public.guardian_learner_intents', 'select'),
    has_table_privilege('authenticated', 'public.guardian_learner_intents', 'select'),
    has_table_privilege('authenticated', 'public.guardian_learner_intents', 'insert'),
    has_table_privilege('service_role', 'public.guardian_learner_intents', 'insert'),
    has_table_privilege('service_role', 'public.guardian_learner_intents', 'delete'),
    (select relrowsecurity from pg_class where oid = 'public.guardian_learner_intents'::regclass)) || E'\n';

  -- G12: the server's clean-up when createUser fails: delete by id, as service_role
  set local role service_role;
  insert into guardian_learner_intents (learner_id, guardian_id, relationship, consent_version)
  values (gen_random_uuid(), v_parent, 'mother', 'cv-test-7br') returning learner_id into v_txt;
  delete from guardian_learner_intents where learner_id = v_txt::uuid;
  get diagnostics v_cnt = row_count;
  reset role;
  r := r || format('G12 service_role delete by id: rows=%s (want 1)', v_cnt) || E'\n';

  -- G13: a signed-in client can't read it
  begin
    set local role authenticated;
    perform count(*) from guardian_learner_intents;
    reset role;
    r := r || 'G13 FAIL: signed-in client read the table' || E'\n';
  exception when others then reset role; r := r || 'G13 ok: ' || sqlerrm || E'\n'; end;

  -- G11: Auth's full sequence: the insert, then the UPDATE that writes app_metadata. One link, no error.
  insert into guardian_learner_intents (learner_id, guardian_id, relationship, consent_version)
  values (l11, v_parent, 'mother', 'cv-test-7br');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (l11, z, 'authenticated', 'authenticated', 'kid-g11@learners.tutorlage.invalid',
          jsonb_build_object('role', 'student', 'date_of_birth', minor_dob), prov);
  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('created_by_guardian', v_parent, 'relationship', 'mother', 'consent_version', 'cv-test-7br'),
      email_confirmed_at = now()
  where id = l11;
  select count(*) into v_cnt from parent_student_links where parent_id = v_parent and student_id = l11;
  r := r || format('G11 insert then app_metadata update: links=%s (want 1)', v_cnt) || E'\n';

  raise exception 'TEST RESULT (rolled back):%', r;
end $$;
