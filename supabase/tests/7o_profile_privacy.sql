-- Rolled-back test of profile privacy (migration 20260930220000). See README.md.
do $$
declare
  r text := E'\n';
  v_admin uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_student uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  v_ututor uuid := gen_random_uuid();
  v_mum uuid := gen_random_uuid();
  v_kid uuid := gen_random_uuid();
  v_cnt int; v_txt text;
  adult text := (current_date - interval '30 years')::date::text;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_admin, z,'authenticated','authenticated','t.a.'||v_admin||'@example.invalid', '{}'::jsonb, '{}'),
    (v_stranger, z,'authenticated','authenticated','t.s.'||v_stranger||'@example.invalid', jsonb_build_object('first_name','Stranger','date_of_birth',adult), '{}'),
    (v_student, z,'authenticated','authenticated','t.st.'||v_student||'@example.invalid', jsonb_build_object('first_name','Student','date_of_birth',adult), '{}'),
    (v_tutor, z,'authenticated','authenticated','t.t.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor','first_name','Verified'), '{}'),
    (v_ututor, z,'authenticated','authenticated','t.u.'||v_ututor||'@example.invalid', jsonb_build_object('role','tutor','first_name','Unverified'), '{}'),
    (v_mum, z,'authenticated','authenticated','t.m.'||v_mum||'@example.invalid', jsonb_build_object('role','parent','first_name','Mum','date_of_birth',adult), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_kid, z,'authenticated','authenticated','t.k.'||v_kid||'@example.invalid',
     jsonb_build_object('first_name','Kid','date_of_birth',(current_date - interval '14 years')::date::text), jsonb_build_object('created_by_guardian', v_mum));
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_admin, 'T', 'Admin', 'x@example.invalid', '');
  update profiles set date_of_birth = adult::date where id = v_tutor;
  update tutor_profiles set is_verified = true where id = v_tutor;
  -- the verified tutor has a session with the student (inserted as owner)
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_student, v_tutor, v_student, now() + interval '1 day', 100, 20, 100, 80);

  -- not signed in
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  set local role anon;
  begin
    perform full_name from profiles limit 1;
    r := r || 'P1 FAIL anon can read profiles' || E'\n';
  exception when others then r := r || 'P1 ok anon has no access: ' || sqlerrm || E'\n'; end;
  reset role;

  -- a stranger (adult learner with no sessions)
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform email from profiles limit 1;
    r := r || 'P2 FAIL email readable' || E'\n';
  exception when others then r := r || 'P2 ok email unreadable: ' || sqlerrm || E'\n'; end;
  begin
    perform phone_number from profiles limit 1;
    r := r || 'P3 FAIL phone readable' || E'\n';
  exception when others then r := r || 'P3 ok phone unreadable: ' || sqlerrm || E'\n'; end;
  select count(*) into v_cnt from profiles where id in (v_student, v_kid, v_mum, v_ututor);
  r := r || format('P4 stranger sees other learners/parents/unverified tutors=%s (want 0)', v_cnt) || E'\n';
  select count(*) into v_cnt from profiles where id = v_tutor;
  r := r || format('P5 stranger sees the verified tutor=%s (want 1)', v_cnt) || E'\n';
  select count(*) into v_cnt from profiles where id = v_stranger;
  r := r || format('P6 sees self=%s (want 1)', v_cnt) || E'\n';
  reset role;

  -- the verified tutor sees their own session's student, not others
  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from profiles where id = v_student;
  r := r || format('P7 tutor sees own session student=%s (want 1)', v_cnt);
  select count(*) into v_cnt from profiles where id in (v_stranger, v_kid);
  r := r || format(', others=%s (want 0)', v_cnt) || E'\n';
  reset role;

  -- the guardian sees the linked learner; the learner sees the guardian
  perform set_config('request.jwt.claims', json_build_object('sub', v_mum, 'role','authenticated')::text, true);
  set local role authenticated;
  select full_name into v_txt from profiles where id = v_kid;
  r := r || format('P8 guardian sees learner name=%s', coalesce(v_txt,'NULL'));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_kid, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from profiles where id = v_mum;
  r := r || format(' | learner sees guardian=%s (want 1)', v_cnt) || E'\n';
  begin
    perform public.admin_search_profiles('');
    r := r || 'P9 FAIL non-admin searched profiles' || E'\n';
  exception when others then r := r || 'P9 ok admin search refused: ' || sqlerrm || E'\n'; end;
  reset role;

  -- an admin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from profiles where id in (v_stranger, v_student, v_tutor, v_ututor, v_mum, v_kid);
  r := r || format('P10 admin sees all six=%s', v_cnt);
  select count(*) into v_cnt from public.admin_search_profiles('t.k.');
  r := r || format(', email search finds the learner=%s (want 1)', v_cnt);
  select email into v_txt from public.admin_profile_private(array[v_kid]);
  r := r || format(', private email=%s', case when v_txt like 't.k.%' then 'ok' else 'MISSING' end) || E'\n';
  reset role;

  raise exception 'PROFILE PRIVACY TEST (rolled back): %', r;
end $$;
