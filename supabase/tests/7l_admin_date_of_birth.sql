-- Rolled-back test of admin_set_date_of_birth() auditing (migration 20260930210000). See README.md.
do $$
declare
  r text := E'\n';
  v_admin uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  v_cnt int;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_admin, z,'authenticated','authenticated','t.a.'||v_admin||'@example.invalid', '{}'::jsonb, '{}'),
    (v_tutor, z,'authenticated','authenticated','t.t.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor'), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_admin, 'T', 'Admin', 'x@example.invalid', '');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_date_of_birth(v_tutor, (current_date - interval '25 years')::date);
  perform public.admin_set_date_of_birth(v_tutor, (current_date - interval '26 years')::date);
  select count(*) into v_cnt from admin_audit_logs where target_entity_id = v_tutor and action = 'date_of_birth_recorded';
  r := r || format('A1 two recordings -> audit rows=%s (want 2)', v_cnt) || E'\n';
  select count(*) into v_cnt from admin_audit_logs where target_entity_id = v_tutor and (metadata->>'was_already_recorded')::boolean;
  r := r || format('A2 second marked as a correction=%s (want 1)', v_cnt) || E'\n';
  update tutor_profiles set is_verified = true where id = v_tutor;
  get diagnostics v_cnt = row_count;
  r := r || format('A3 verify after DOB recorded rows=%s (want 1)', v_cnt) || E'\n';
  reset role;
  raise exception 'ADMIN DOB TEST (rolled back): %', r;
end $$;
