-- Rolled-back test of migration 20261016150000_parent_sets_learner_grade.sql (16 Oct 2026).
-- Run it on its own after the migration, or TOGETHER with the migration in one statement before it is applied. Every check prints its
-- result; "FAIL" marks a real problem. The last statement raises an error on purpose so that nothing is kept.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '15 years')::date::text;
  v_p uuid := gen_random_uuid();   -- a parent
  v_x uuid := gen_random_uuid();   -- another parent (a stranger to the child)
  v_c uuid := gen_random_uuid();   -- the parent's child (own sign-in), Grade 9
  v_d uuid := gen_random_uuid();   -- a second child of the parent, no grade yet
  t text; n int; g text;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_p, z,'authenticated','authenticated','gr.p.'||v_p||'@example.invalid', jsonb_build_object('role','parent','first_name','Pat','date_of_birth',adult,'phone_number','081 234 5678'), '{}'),
    (v_x, z,'authenticated','authenticated','gr.x.'||v_x||'@example.invalid', jsonb_build_object('role','parent','first_name','Xan','date_of_birth',adult,'phone_number','081 234 5679'), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_c, z,'authenticated','authenticated','gr.c.'||v_c||'@example.invalid', jsonb_build_object('role','student','first_name','Chi','date_of_birth',minor,'grade_level','Grade 9'),
       jsonb_build_object('created_by_guardian', v_p, 'relationship','mother')),
    (v_d, z,'authenticated','authenticated','gr.d.'||v_d||'@example.invalid', jsonb_build_object('role','student','first_name','Dee','date_of_birth',minor),
       jsonb_build_object('created_by_guardian', v_p, 'relationship','mother'));
  update student_profiles set grade_level = 'Grade 9' where id = v_c;

  select grade_level into g from student_profiles where id = v_c;
  r := r || format('G0 setup: the child starts in %s (want Grade 9)', g) || E'\n';

  -- the parent changes the child's grade (any capitals)
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role','authenticated')::text, true);
  set local role authenticated;
  select public.set_learner_grade(v_c, 'grade 10') into t;
  reset role;
  select grade_level into g from student_profiles where id = v_c;
  r := r || format('G1 the parent changes the grade: returned %s, stored %s (want Grade 10, Grade 10)', t, g) || E'\n';

  -- the second child had no grade
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role','authenticated')::text, true);
  set local role authenticated;
  select public.set_learner_grade(v_d, 'Grade R') into t;
  reset role;
  select grade_level into g from student_profiles where id = v_d;
  r := r || format('G2 a learner with no grade can be given one: %s (want Grade R)', g) || E'\n';

  -- a made-up grade
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_learner_grade(v_c, 'Grade 13');
    r := r || 'G3 FAIL: a made-up grade was accepted' || E'\n';
  exception when others then r := r || format('G3 a made-up grade is refused: %s', sqlerrm) || E'\n'; end;
  begin
    perform public.set_learner_grade(v_c, '');
    r := r || 'G3b FAIL: an empty grade was accepted' || E'\n';
  exception when others then r := r || format('G3b an empty grade is refused: %s', sqlerrm) || E'\n'; end;
  reset role;
  select grade_level into g from student_profiles where id = v_c;
  r := r || format('G3c and the stored grade did not move: %s (want Grade 10)', g) || E'\n';

  -- a stranger
  perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_learner_grade(v_c, 'Grade 12');
    r := r || 'G4 FAIL: another parent changed the grade' || E'\n';
  exception when others then r := r || format('G4 another parent cannot: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- the child with their own sign-in cannot use it for themselves (they change their own row the usual way)
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_learner_grade(v_c, 'Grade 12');
    r := r || 'G5 FAIL: a learner under 18 used the guardian function' || E'\n';
  exception when others then r := r || format('G5 a learner under 18 cannot use the guardian function: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- signed out
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.set_learner_grade(v_c, 'Grade 12');
    r := r || 'G6 FAIL: a signed-out caller changed a grade' || E'\n';
  exception when others then r := r || format('G6 signed out is refused: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- consent withdrawn: the parent loses the right at once
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.withdraw_guardian_consent(v_c);
  begin
    perform public.set_learner_grade(v_c, 'Grade 11');
    r := r || 'G7 FAIL: a parent whose consent was withdrawn changed the grade' || E'\n';
  exception when others then r := r || format('G7 after consent is withdrawn the parent cannot: %s', sqlerrm) || E'\n'; end;
  reset role;
  select grade_level into g from student_profiles where id = v_c;
  r := r || format('G8 and the grade stayed: %s (want Grade 10)', g) || E'\n';

  raise exception 'LEARNER GRADE TEST (rolled back): %', r;
end $$;
