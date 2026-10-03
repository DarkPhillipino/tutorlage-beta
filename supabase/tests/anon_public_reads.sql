-- Rolled-back test of signed-out reads (migrations 20260930234000 and 20260930235000). See README.md.
-- Reads real rows with a filter, the way the app does: a bare count(*) passed on production even
-- while a filtered read failed with "permission denied for function is_active_admin".
do $$
declare
  r text := E'\n';
  t text; n int;
  v_vt uuid := gen_random_uuid();
  v_ut uuid := gen_random_uuid();
  v_st uuid := gen_random_uuid();
  v_mum uuid := gen_random_uuid();
  v_kid uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid();
  adult text := (current_date - interval '30 years')::date::text;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_vt, z,'authenticated','authenticated','t.vt.'||v_vt||'@example.invalid', jsonb_build_object('role','tutor','first_name','Verified'), '{}'),
    (v_ut, z,'authenticated','authenticated','t.ut.'||v_ut||'@example.invalid', jsonb_build_object('role','tutor','first_name','Unverified'), '{}'),
    (v_st, z,'authenticated','authenticated','t.st.'||v_st||'@example.invalid', jsonb_build_object('first_name','Student','date_of_birth',adult), '{}'),
    (v_mum, z,'authenticated','authenticated','t.m.'||v_mum||'@example.invalid', jsonb_build_object('role','parent','first_name','Mum','date_of_birth',adult), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_kid, z,'authenticated','authenticated','t.k.'||v_kid||'@example.invalid',
     jsonb_build_object('first_name','Kid','date_of_birth',(current_date - interval '14 years')::date::text), jsonb_build_object('created_by_guardian', v_mum));
  update profiles set date_of_birth = adult::date where id = v_vt;
  update tutor_profiles set is_verified = true where id = v_vt;
  -- a session between the adult student and the UNverified tutor, and one for the learner (as owner)
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount) values
    (v_st, v_ut, v_st, now() + interval '1 day', 100, 20, 100, 80),
    (v_kid, v_vt, v_mum, now() + interval '2 days', 100, 20, 100, 80);

  -- not signed in: every public reference table reads without error
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  set local role anon;
  foreach t in array array['tutor_profiles','credential_definitions','schools_institutions','subjects','tier_definitions',
    'sub_tier_definitions','reviews','tutor_availability','tutor_languages','tutor_subject_competencies','countries',
    'currencies','curricula','languages','grade_levels'] loop
    begin
      execute format('select count(*) from (select * from public.%I where true limit 50) x', t) into n;
    exception when others then r := r || 'S1 FAIL anon read of ' || t || ': ' || sqlerrm || E'\n'; end;
  end loop;
  r := r || 'S1 anon read every public table (any failure listed above)' || E'\n';
  select count(*) into n from tutor_profiles where id = v_vt;
  r := r || format('S2 anon sees the verified tutor=%s (want 1)', n);
  select count(*) into n from tutor_profiles where id = v_ut;
  r := r || format(', the unverified tutor=%s (want 0)', n) || E'\n';
  select count(*) into n from credential_definitions where code is not null;
  r := r || format('S2b anon filtered read of credential definitions=%s (want >0)', n) || E'\n';
  begin
    perform public.is_active_admin();
    r := r || 'S2c FAIL anon can call is_active_admin' || E'\n';
  exception when others then r := r || 'S2c ok anon cannot call is_active_admin: ' || sqlerrm || E'\n'; end;
  reset role;

  -- the student still sees the unverified tutor of their own session
  perform set_config('request.jwt.claims', json_build_object('sub', v_st, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from tutor_profiles where id = v_ut;
  r := r || format('S3 student sees own session''s unverified tutor=%s (want 1)', n) || E'\n';
  reset role;

  -- the guardian still sees the learner's session
  perform set_config('request.jwt.claims', json_build_object('sub', v_mum, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from sessions where student_id = v_kid;
  r := r || format('S4 guardian sees learner''s session=%s (want 1)', n) || E'\n';
  reset role;

  -- a separate admin (no sessions of their own) still sees everything through the admin policies
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_adm, z,'authenticated','authenticated','t.adm.'||v_adm||'@example.invalid', '{}'::jsonb, '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_adm, 'T', 'Admin', 'x@example.invalid', '');
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from tutor_profiles where id = v_ut;
  r := r || format('S5 admin sees the unverified tutor=%s (want 1)', n);
  select count(*) into n from sessions where student_id = v_kid;
  r := r || format(', learner''s session=%s (want 1)', n);
  select count(*) into n from system_settings where setting_key = 'current_terms_version';
  r := r || format(', system setting=%s (want 1)', n) || E'\n';
  reset role;

  raise exception 'ANON READ TEST (rolled back): %', r;
end $$;
