-- Rolled-back test of names on sign-up (migration 20260930236000). See README.md.
do $$
declare
  r text := E'\n';
  v1 uuid := gen_random_uuid();
  v2 uuid := gen_random_uuid();
  v3 uuid := gen_random_uuid();
  v4 uuid := gen_random_uuid();
  v5 uuid := gen_random_uuid();
  v6 uuid := gen_random_uuid();
  a text; b text; c text;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v1, z,'authenticated','authenticated','t.n1.'||v1||'@example.invalid', jsonb_build_object('full_name','Thandi  van der Merwe','name','Thandi van der Merwe'), '{}'),
    (v2, z,'authenticated','authenticated','t.n2.'||v2||'@example.invalid', jsonb_build_object('name','Sipho'), '{}'),
    (v3, z,'authenticated','authenticated','t.n3.'||v3||'@example.invalid', jsonb_build_object('first_name','Lerato','surname','Mokoena','full_name','Someone Else'), '{}'),
    (v4, z,'authenticated','authenticated','t.n4.'||v4||'@example.invalid', '{}'::jsonb, '{}'),
    (v5, z,'authenticated','authenticated','t.n5.'||v5||'@example.invalid', jsonb_build_object('full_name','Naledi Dlamini'), '{}'),
    (v6, z,'authenticated','authenticated','t.n6.'||v6||'@example.invalid', jsonb_build_object('full_name','Kagiso Molefe'), '{}');

  select p.full_name, s.first_name, s.surname into a, b, c from profiles p join student_profiles s on s.id = p.id where p.id = v1;
  r := r || format('N1 Google full name -> "%s" / first "%s" / surname "%s" (want Thandi van der Merwe / Thandi / van der Merwe)', a, b, c) || E'\n';
  select p.full_name, s.first_name, s.surname into a, b, c from profiles p join student_profiles s on s.id = p.id where p.id = v2;
  r := r || format('N2 one-word name -> "%s" / "%s" / "%s" (want Sipho / Sipho / empty)', a, b, c) || E'\n';
  select p.full_name, s.first_name, s.surname into a, b, c from profiles p join student_profiles s on s.id = p.id where p.id = v3;
  r := r || format('N3 email sign-up names win -> "%s" / "%s" / "%s" (want Lerato Mokoena / Lerato / Mokoena)', a, b, c) || E'\n';
  select p.full_name into a from profiles p where p.id = v4;
  r := r || format('N4 no name at all -> "%s" (want User)', a) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v5, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.convert_new_account_role('parent');
  reset role;
  select first_name, surname into b, c from parent_profiles where id = v5;
  r := r || format('N5 Google -> parent: "%s" / "%s" (want Naledi / Dlamini)', b, c) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v6, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.convert_new_account_role('tutor');
  reset role;
  select headline into a from tutor_profiles where id = v6;
  r := r || format('N6 Google -> tutor headline "%s" (want Kagiso - Tutor)', a) || E'\n';

  raise exception 'GOOGLE NAMES TEST (rolled back): %', r;
end $$;
