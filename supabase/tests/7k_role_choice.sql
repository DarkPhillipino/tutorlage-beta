-- Rolled-back test of convert_new_account_role() and current_policy_versions()
-- (migration 20260930200000). See README.md.
do $$
declare
  r text := E'\n';
  v_g1 uuid := gen_random_uuid();
  v_g2 uuid := gen_random_uuid();
  v_busy uuid := gen_random_uuid();
  v_mum uuid := gen_random_uuid();
  v_kid uuid := gen_random_uuid();
  v_txt text; v_cnt int; v_cnt2 int;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- Google-style sign-ups: no role, no date of birth
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_g1, z,'authenticated','authenticated','t.g1.'||v_g1||'@example.invalid', jsonb_build_object('full_name','Gee One'), '{}'),
    (v_g2, z,'authenticated','authenticated','t.g2.'||v_g2||'@example.invalid', jsonb_build_object('full_name','Gee Two'), '{}'),
    (v_busy, z,'authenticated','authenticated','t.gb.'||v_busy||'@example.invalid', '{}'::jsonb, '{}'),
    (v_mum, z,'authenticated','authenticated','t.gm.'||v_mum||'@example.invalid',
       jsonb_build_object('role','parent','date_of_birth',(current_date - interval '40 years')::date::text), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_kid, z,'authenticated','authenticated','t.gk.'||v_kid||'@example.invalid',
       jsonb_build_object('role','student','date_of_birth',(current_date - interval '15 years')::date::text),
       jsonb_build_object('created_by_guardian', v_mum));

  perform set_config('request.jwt.claims', json_build_object('sub', v_g1, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.convert_new_account_role('tutor');
  perform public.convert_new_account_role('tutor');  -- a reload of the callback page: no-op
  reset role;
  select role::text into v_txt from profiles where id = v_g1;
  select count(*) into v_cnt from tutor_profiles where id = v_g1;
  select count(*) into v_cnt2 from student_profiles where id = v_g1;
  r := r || format('T1 Google learner -> tutor: role=%s tutor_rows=%s student_rows=%s (want tutor,1,0)', v_txt, v_cnt, v_cnt2) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v_g2, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.convert_new_account_role('parent');
  begin
    perform public.convert_new_account_role('tutor');
    r := r || 'T3 FAIL parent switched to tutor' || E'\n';
  exception when others then r := r || 'T3 ok parent can''t switch again: ' || sqlerrm || E'\n'; end;
  begin
    perform public.convert_new_account_role('admin');
    r := r || 'T4 FAIL admin chosen' || E'\n';
  exception when others then r := r || 'T4 ok admin refused: ' || sqlerrm || E'\n'; end;
  reset role;
  select role::text into v_txt from profiles where id = v_g2;
  select count(*) into v_cnt from parent_profiles where id = v_g2;
  r := r || format('T2 Google learner -> parent: role=%s parent_rows=%s (want parent,1)', v_txt, v_cnt) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v_busy, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_busy, 'Mathematics', 'Grade 12');
  begin
    perform public.convert_new_account_role('tutor');
    r := r || 'T5 FAIL learner with activity switched' || E'\n';
  exception when others then r := r || 'T5 ok learner with activity refused: ' || sqlerrm || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_kid, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.convert_new_account_role('parent');
    r := r || 'T6 FAIL guardian-added learner switched' || E'\n';
  exception when others then r := r || 'T6 ok guardian-added learner refused: ' || sqlerrm || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  set local role anon;
  select terms_version into v_txt from public.current_policy_versions();
  r := r || format('T7 anon reads current terms version=%s', v_txt) || E'\n';
  begin
    perform public.convert_new_account_role('tutor');
    r := r || 'T8 FAIL anon called convert' || E'\n';
  exception when others then r := r || 'T8 ok anon refused: ' || sqlerrm || E'\n'; end;
  reset role;

  raise exception 'ROLE CHOICE TEST REPORT (rolled back): %', r;
end $$;
