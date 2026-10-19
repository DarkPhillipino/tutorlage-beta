-- Rolled-back test of the Tier 1 pipeline (migrations 20261012090200 and 20261012090300). See README.md.
-- Needs the Mathematics items. Until the migrations are applied (not before Mon 12 Oct, CEO), run it through
-- scripts/run-rolled-back-test.mjs with the pipeline migration and the Mathematics rows
-- (node scripts/build-tier1-items-sql.mjs Drake/educator/item-bank <out> --only Mathematics); the runner
-- replaces log_admin_event with a recorder. After the 12th, run this file on its own.
do $$
declare
  r text := E'\n';
  v_t uuid := gen_random_uuid();   -- passes
  v_u uuid := gen_random_uuid();   -- fails, retakes, runs late
  v_v uuid := gen_random_uuid();   -- abandons a test
  v_s uuid := gen_random_uuid();   -- a learner, not a tutor
  v_admin uuid := gen_random_uuid();
  v_rec uuid; v_att uuid; v_att2 uuid;
  j jsonb; v_ans jsonb; v_wrong jsonb;
  n int; t text; b boolean;
  adult text := (current_date - interval '25 years')::date::text;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_t, z,'authenticated','authenticated','t.t.'||v_t||'@example.invalid', jsonb_build_object('role','tutor','first_name','Thandi','date_of_birth',adult), '{}'),
    (v_u, z,'authenticated','authenticated','t.u.'||v_u||'@example.invalid', jsonb_build_object('role','tutor','first_name','Uma','date_of_birth',adult), '{}'),
    (v_v, z,'authenticated','authenticated','t.v.'||v_v||'@example.invalid', jsonb_build_object('role','tutor','first_name','Vusi','date_of_birth',adult), '{}'),
    (v_s, z,'authenticated','authenticated','t.s.'||v_s||'@example.invalid', jsonb_build_object('role','student','first_name','Sam','date_of_birth',adult), '{}'),
    (v_admin, z,'authenticated','authenticated','t.ad.'||v_admin||'@example.invalid', jsonb_build_object('first_name','Admin','date_of_birth',adult), '{}');
  insert into admin_profiles (id, first_name, surname, email) values (v_admin, 'Test', 'Admin', 't.ad.'||v_admin||'@example.invalid');
  insert into storage.objects (bucket_id, name, owner) values ('tutor-documents', v_t || '/matric.pdf', v_t);
  select count(*) into n from tier1_items where subject_name = 'Mathematics';
  r := r || format('P0 Mathematics items present: %s (want 8)', n) || E'\n';

  -- A learner account can't use the route.
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.tier1_status('Mathematics');
    r := r || 'P1 FAIL a learner account used the Tier 1 route' || E'\n';
  exception when others then r := r || 'P1 ok learner refused: ' || sqlerrm || E'\n'; end;
  reset role;

  -- Tutor T, start to finish.
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from tier1_items;
  r := r || format('P2 tutor reads the items (with keys): %s rows (want 0)', n) || E'\n';
  select count(*) into n from tier1_scenarios;
  r := r || format('P3 tutor reads the Module 7 answers: %s rows (want 0)', n) || E'\n';
  j := public.tier1_status('Mathematics');
  r := r || format('P4 before anything: can_start=%s, reason="%s"', j ->> 'can_start', j ->> 'reason') || E'\n';
  begin
    perform public.tier1_start_test('Mathematics');
    r := r || 'P5 FAIL the test started without the academic record' || E'\n';
  exception when others then r := r || 'P5 ok start refused: ' || sqlerrm || E'\n'; end;
  begin
    perform public.tier1_submit_academic_record('Mathematics', 75, 'matric', v_s || '/x.pdf');
    r := r || 'P6 FAIL someone else''s file was accepted' || E'\n';
  exception when others then r := r || 'P6 ok foreign file refused: ' || sqlerrm || E'\n'; end;
  select public.tier1_submit_academic_record('Mathematics', 75, 'matric', v_t || '/matric.pdf') into v_rec;
  j := public.tier1_status('Mathematics');
  r := r || format('P7 record pending: academic_ok=%s (want false)', j ->> 'academic_ok') || E'\n';
  begin
    perform public.admin_check_tier1_record(v_rec, 'verified', null);
    r := r || 'P8 FAIL a tutor verified their own record' || E'\n';
  exception when others then r := r || 'P8 ok tutor can''t verify: ' || sqlerrm || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.admin_check_tier1_record(v_rec, 'verified', null);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.tier1_status('Mathematics');
  r := r || format('P9 after the check: academic_ok=%s, can_start=%s, reason="%s"', j ->> 'academic_ok', j ->> 'can_start', j ->> 'reason') || E'\n';
  begin
    perform public.tier1_complete_module(2::smallint);
    r := r || 'P10 FAIL a live module was marked done by the tutor' || E'\n';
  exception when others then r := r || 'P10 ok live module refused: ' || sqlerrm || E'\n'; end;
  begin
    perform public.tier1_complete_module(7::smallint);
    r := r || 'P11 FAIL Module 7 was marked done without its check' || E'\n';
  exception when others then r := r || 'P11 ok Module 7 needs its check: ' || sqlerrm || E'\n'; end;
  perform public.tier1_complete_module(1::smallint);
  perform public.tier1_complete_module(3::smallint);
  perform public.tier1_complete_module(4::smallint);
  perform public.tier1_complete_module(6::smallint);
  j := public.tier1_module_check_questions();
  r := r || format('P12 check questions: %s, any answer key in them: %s (want 4, false)',
                   jsonb_array_length(j), j::text like '%"answer"%') || E'\n';
  j := public.tier1_submit_module_check('{"1":1,"2":2,"3":0,"4":0}'::jsonb);
  r := r || format('P13 one wrong: passed=%s, right=%s/%s (want false, 3/4)', j ->> 'passed', j ->> 'right', j ->> 'total') || E'\n';
  j := public.tier1_submit_module_check('{"1":1,"2":2,"3":3,"4":0}'::jsonb);
  r := r || format('P14 all right: passed=%s (want true)', j ->> 'passed') || E'\n';
  begin
    perform public.admin_record_tier1_signoff(v_t, 2::smallint, 'Me', 'pass', null);
    r := r || 'P15 FAIL a tutor signed themselves off' || E'\n';
  exception when others then r := r || 'P15 ok self sign-off refused: ' || sqlerrm || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.admin_record_tier1_signoff(v_t, 2::smallint, 'Trainer One', 'pass', null);
  begin
    perform public.admin_record_tier1_signoff(v_t, 5::smallint, 'Trainer One', 'not_yet', null);
    r := r || 'P16 FAIL "not yet" without the missing items' || E'\n';
  exception when others then r := r || 'P16 ok "not yet" needs the missing items: ' || sqlerrm || E'\n'; end;
  perform public.admin_record_tier1_signoff(v_t, 5::smallint, 'Trainer One', 'not_yet', 'Didn''t break the problem down yet');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.tier1_status('Mathematics');
  r := r || format('P17 Module 5 "not yet": training_complete=%s (want false)', j ->> 'training_complete') || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.admin_record_tier1_signoff(v_t, 5::smallint, 'Trainer One', 'pass', null);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.tier1_status('Mathematics');
  r := r || format('P18 all gates before the test: training_complete=%s, can_start=%s (want true, true)', j ->> 'training_complete', j ->> 'can_start') || E'\n';
  j := public.tier1_start_test('Mathematics');
  v_att := (j ->> 'attempt_id')::uuid;
  r := r || format('P19 test started: %s items, 4+4 options on the first: %s, keys in the reply: %s (want 8, true, false)',
                   jsonb_array_length(j -> 'items'),
                   jsonb_array_length(j -> 'items' -> 0 -> 'q1') = 4 and jsonb_array_length(j -> 'items' -> 0 -> 'q2') = 4,
                   strpos(j::text, 'q1_key') > 0 or strpos(j::text, 'q2_key') > 0) || E'\n';
  j := public.tier1_start_test('Mathematics');
  r := r || format('P20 starting again resumes the same test: %s', (j ->> 'attempt_id')::uuid = v_att) || E'\n';
  begin
    perform option_orders from tier1_attempts where id = v_att;
    r := r || 'P21 FAIL the tutor read the option orders' || E'\n';
  exception when others then r := r || 'P21 ok option orders hidden: ' || sqlerrm || E'\n'; end;
  reset role;

  -- The right answers, worked out as the owner from the keys and this attempt's option orders.
  select jsonb_object_agg(i.id, jsonb_build_object(
           'q1', (select x.n - 1 from jsonb_array_elements_text(a.option_orders -> i.id -> 'q1') with ordinality x(e, n) where x.e::int = i.q1_key),
           'q2', (select x.n - 1 from jsonb_array_elements_text(a.option_orders -> i.id -> 'q2') with ordinality x(e, n) where x.e::int = i.q2_key)))
  into v_ans
  from tier1_attempts a join tier1_items i on i.id = any(a.item_ids) where a.id = v_att;

  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.tier1_submit_test(v_att, v_ans);
    r := r || 'P22 FAIL another tutor handed in T''s test' || E'\n';
  exception when others then r := r || 'P22 ok another tutor refused: ' || sqlerrm || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.tier1_submit_test(v_att, v_ans);
  r := r || format('P23 all right: total=%s, diagnoses=%s, passed=%s (want 16, 8, true)', j ->> 'total_score', j ->> 'diagnosis_score', j ->> 'passed') || E'\n';
  begin
    perform public.tier1_submit_test(v_att, v_ans);
    r := r || 'P24 FAIL the same test was handed in twice' || E'\n';
  exception when others then r := r || 'P24 ok second hand-in refused: ' || sqlerrm || E'\n'; end;
  begin
    perform public.tier1_start_test('Mathematics');
    r := r || 'P25 FAIL a new test started after passing' || E'\n';
  exception when others then r := r || 'P25 ok no new test after passing: ' || sqlerrm || E'\n'; end;
  select count(*) into n from tutor_subject_competencies where tutor_id = v_t and subject_name = 'Mathematics' and verification_status = 'verified';
  r := r || format('P26 Mathematics verified on T''s profile: %s (want 1)', n) || E'\n';
  reset role;
  select count(*) into n from notifications where profile_id = v_t and type = 'tier1_passed';
  r := r || format('P27 T told they passed: %s (want 1)', n) || E'\n';

  -- Tutor U: fails, waits, retakes late. Gates set directly by the owner.
  insert into tier1_academic_records (tutor_id, subject_name, mark_pct, source, document_path, status)
  values (v_u, 'Mathematics', 80, 'matric', v_u || '/r.pdf', 'verified'), (v_v, 'Mathematics', 80, 'matric', v_v || '/r.pdf', 'verified');
  insert into tier1_training (tutor_id, module, result, method)
  select p, m, 'complete', 'self_paced' from unnest(array[v_u, v_v]) p, generate_series(1, 7) m;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.tier1_start_test('Mathematics');
  v_att2 := (j ->> 'attempt_id')::uuid;
  reset role;
  select jsonb_object_agg(i.id, jsonb_build_object(
           'q1', (select min(x.n) - 1 from jsonb_array_elements_text(a.option_orders -> i.id -> 'q1') with ordinality x(e, n) where x.e::int <> i.q1_key),
           'q2', (select min(x.n) - 1 from jsonb_array_elements_text(a.option_orders -> i.id -> 'q2') with ordinality x(e, n) where x.e::int <> i.q2_key)))
  into v_wrong
  from tier1_attempts a join tier1_items i on i.id = any(a.item_ids) where a.id = v_att2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.tier1_submit_test(v_att2, v_wrong);
  r := r || format('P28 all wrong: total=%s, passed=%s (want 0, false)', j ->> 'total_score', j ->> 'passed') || E'\n';
  j := public.tier1_status('Mathematics');
  r := r || format('P29 straight after failing: can_start=%s, next retake set=%s (want false, true)', j ->> 'can_start', j ->> 'next_retake_at' is not null) || E'\n';
  reset role;
  update tier1_attempts set submitted_at = now() - interval '15 days', deadline_at = now() - interval '15 days' where id = v_att2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.tier1_start_test('Mathematics');
  v_att2 := (j ->> 'attempt_id')::uuid;
  r := r || format('P30 15 days later the retake starts: %s', v_att2 is not null) || E'\n';
  reset role;
  update tier1_attempts set deadline_at = now() - interval '5 minutes' where id = v_att2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.tier1_submit_test(v_att2, v_ans);
  r := r || format('P31 handed in 5 minutes late: status=%s, passed=%s (want expired, false)', j ->> 'status', j ->> 'passed') || E'\n';
  j := public.tier1_status('Mathematics');
  r := r || format('P32 after the retake: can_start=%s, reason="%s"', j ->> 'can_start', j ->> 'reason') || E'\n';
  reset role;

  -- Tutor V abandons a test: it counts as an attempt, so the retake wait applies.
  perform set_config('request.jwt.claims', json_build_object('sub', v_v, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.tier1_start_test('Mathematics');
  v_att2 := (j ->> 'attempt_id')::uuid;
  reset role;
  update tier1_attempts set deadline_at = now() - interval '1 hour' where id = v_att2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_v, 'role','authenticated')::text, true);
  set local role authenticated;
  j := public.tier1_status('Mathematics');
  r := r || format('P33 abandoned test: can_start=%s (want false: the 14-day wait)', j ->> 'can_start') || E'\n';
  reset role;

  -- 7as: a tutor can't verify their own subject once the setting is on.
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'require_subject_verification';
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
  values (v_u, 'Life Sciences', 'caps', 'Grade 10', 'Grade 12', 'verified');
  select verification_status::text into t from tutor_subject_competencies where tutor_id = v_u and subject_name = 'Life Sciences';
  r := r || format('P34 setting on: self-added subject stored as %s (want pending)', t) || E'\n';
  begin
    update tutor_subject_competencies set verification_status = 'verified' where tutor_id = v_u and subject_name = 'Life Sciences';
    r := r || 'P35 FAIL a tutor verified their own subject' || E'\n';
  exception when others then r := r || 'P35 ok self-verification refused: ' || sqlerrm || E'\n'; end;
  reset role;
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'require_subject_verification';
  perform set_config('request.jwt.claims', json_build_object('sub', v_v, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
  values (v_v, 'Life Sciences', 'caps', 'Grade 10', 'Grade 12', 'verified');
  select verification_status::text into t from tutor_subject_competencies where tutor_id = v_v and subject_name = 'Life Sciences';
  r := r || format('P36 setting off: the guard no longer depends on the setting (migration 20261019090000), a self-added subject is stored as %s (want pending)', t) || E'\n';
  reset role;

  -- Admin views.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*), max(attempts) into n, t from public.admin_tier1_item_analysis('Mathematics');
  r := r || format('P37 item analysis: %s items, most attempts on one item %s (want 8, 3)', n, t) || E'\n';
  select count(*) into n from tier1_items where subject_name = 'Mathematics';
  r := r || format('P38 admin reads the items: %s (want 8)', n) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_tier1_item_analysis('Mathematics');
    r := r || 'P39 FAIL a tutor ran the item analysis' || E'\n';
  exception when others then r := r || 'P39 ok tutor refused: ' || sqlerrm || E'\n'; end;
  reset role;

  select count(*) into n from admin_audit_logs where target_entity_id in (v_rec, v_t);
  r := r || format('P40 audit rows: %s written, %s recorded by the test stub (want 4 in one of them: 1 record check, 3 sign-offs)',
                   n, coalesce(nullif(current_setting('test.audit_calls', true), ''), '0')) || E'\n';

  raise exception 'TIER 1 PIPELINE TEST (rolled back): %', r;
end $$;
