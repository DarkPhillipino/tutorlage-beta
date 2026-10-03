-- Rolled-back test of handle_new_user_role_expansion() (migration 20260930190000). See README.md.
do $$
declare
  r text := E'\n';
  v_admin uuid := gen_random_uuid();
  v_nodob uuid := gen_random_uuid();
  v_adult uuid := gen_random_uuid();
  v_wrongver uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_parent_nodob uuid := gen_random_uuid();
  v_learner uuid := gen_random_uuid();
  v_cnt int; v_txt text; v_d date;
  adult_dob text := (current_date - interval '30 years')::date::text;
  minor_dob text := (current_date - interval '15 years')::date::text;
  ver_t text; ver_p text;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  select setting_value #>> '{}' into ver_t from system_settings where setting_key='current_terms_version';
  select setting_value #>> '{}' into ver_p from system_settings where setting_key='current_privacy_version';

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_admin, z,'authenticated','authenticated','t.a.'||v_admin||'@example.invalid', jsonb_build_object('role','admin'), '{}');
  select role::text into v_txt from profiles where id=v_admin;
  select count(*) into v_cnt from admin_profiles where id=v_admin;
  r := r || format('T1 role=admin metadata -> role=%s admin_rows=%s (want student,0)', v_txt, v_cnt) || E'\n';

  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), z,'authenticated','authenticated','t.mt.'||gen_random_uuid()||'@example.invalid', jsonb_build_object('role','tutor','date_of_birth',minor_dob), '{}');
    r := r || 'T2 FAIL minor tutor created' || E'\n';
  exception when others then r := r || 'T2 ok: ' || sqlerrm || E'\n'; end;
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), z,'authenticated','authenticated','t.mp.'||gen_random_uuid()||'@example.invalid', jsonb_build_object('role','parent','date_of_birth',minor_dob), '{}');
    r := r || 'T3 FAIL minor parent created' || E'\n';
  exception when others then r := r || 'T3 ok: ' || sqlerrm || E'\n'; end;
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), z,'authenticated','authenticated','t.ms.'||gen_random_uuid()||'@example.invalid', jsonb_build_object('role','student','date_of_birth',minor_dob), '{}');
    r := r || 'T4 FAIL minor self-signup' || E'\n';
  exception when others then r := r || 'T4 ok: ' || sqlerrm || E'\n'; end;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_nodob, z,'authenticated','authenticated','t.nd.'||v_nodob||'@example.invalid', jsonb_build_object('role','student'), '{}');
  select count(*) into v_cnt from student_profiles where id=v_nodob;
  r := r || format('T5 no-DOB student: rows=%s is_adult=%s (want 1,false)', v_cnt, is_adult(v_nodob)) || E'\n';

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_adult, z,'authenticated','authenticated','t.ad.'||v_adult||'@example.invalid',
          jsonb_build_object('role','student','date_of_birth',adult_dob,'accepted_terms_version',ver_t,'accepted_privacy_version',ver_p), '{}');
  select count(*) into v_cnt from policy_acceptances where profile_id=v_adult and accepted_by_profile_id=v_adult and method='signup_checkbox';
  r := r || format('T6 current versions -> acceptances=%s (want 2)', v_cnt) || E'\n';

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_wrongver, z,'authenticated','authenticated','t.wv.'||v_wrongver||'@example.invalid',
          jsonb_build_object('role','student','date_of_birth','2999-01-01','accepted_terms_version','old'), '{}');
  select count(*) into v_cnt from policy_acceptances where profile_id=v_wrongver;
  select date_of_birth into v_d from profiles where id=v_wrongver;
  r := r || format('T6b stale version + future DOB -> acceptances=%s dob=%s (want 0,null)', v_cnt, coalesce(v_d::text,'null')) || E'\n';

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_parent, z,'authenticated','authenticated','t.pa.'||v_parent||'@example.invalid', jsonb_build_object('role','parent','date_of_birth',adult_dob), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_parent_nodob, z,'authenticated','authenticated','t.pn.'||v_parent_nodob||'@example.invalid', jsonb_build_object('role','parent'), '{}');

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_learner, z,'authenticated','authenticated','t.le.'||v_learner||'@example.invalid',
          jsonb_build_object('role','student','date_of_birth',minor_dob,'accepted_terms_version',ver_t,'accepted_privacy_version',ver_p),
          jsonb_build_object('created_by_guardian', v_parent, 'relationship','mother'));
  select count(*) into v_cnt from parent_student_links where parent_id=v_parent and student_id=v_learner and can_book_sessions;
  r := r || format('T7 guardian-created learner: link=%s', v_cnt);
  select count(*) into v_cnt from guardian_consents where guardian_profile_id=v_parent and learner_profile_id=v_learner and withdrawn_at is null;
  r := r || format(' consent=%s', v_cnt);
  select count(*) into v_cnt from policy_acceptances where profile_id=v_learner and accepted_by_profile_id=v_parent and method='guardian_added_learner';
  r := r || format(' acceptances=%s (want 1,1,2)', v_cnt) || E'\n';

  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), z,'authenticated','authenticated','t.l2.'||gen_random_uuid()||'@example.invalid',
            jsonb_build_object('role','student','date_of_birth',minor_dob), jsonb_build_object('created_by_guardian', v_parent_nodob));
    r := r || 'T8 FAIL guardian without DOB' || E'\n';
  exception when others then r := r || 'T8 ok: ' || sqlerrm || E'\n'; end;
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), z,'authenticated','authenticated','t.l3.'||gen_random_uuid()||'@example.invalid',
            jsonb_build_object('role','student','date_of_birth',minor_dob), jsonb_build_object('created_by_guardian', v_adult));
    r := r || 'T9 FAIL student acted as guardian' || E'\n';
  exception when others then r := r || 'T9 ok: ' || sqlerrm || E'\n'; end;
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), z,'authenticated','authenticated','t.l4.'||gen_random_uuid()||'@example.invalid',
            jsonb_build_object('role','student','date_of_birth',minor_dob), jsonb_build_object('created_by_guardian', v_parent, 'relationship','sponsor'));
    r := r || 'T10 FAIL sponsor as guardian' || E'\n';
  exception when others then r := r || 'T10 ok: ' || sqlerrm || E'\n'; end;
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), z,'authenticated','authenticated','t.l5.'||gen_random_uuid()||'@example.invalid',
            jsonb_build_object('role','tutor','date_of_birth',adult_dob), jsonb_build_object('created_by_guardian', v_parent));
    r := r || 'T11 FAIL guardian created a tutor' || E'\n';
  exception when others then r := r || 'T11 ok: ' || sqlerrm || E'\n'; end;

  raise exception 'SIGNUP TEST REPORT (rolled back): %', r;
end $$;
