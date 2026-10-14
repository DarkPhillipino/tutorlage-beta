-- Rolled-back test of master 7cz, "Tell me when a tutor is available" (migration 20261014090000). See README.md.
-- Run it TOGETHER with the migration in one statement (scripts/run-rolled-back-test.mjs) before the migration is
-- applied, or on its own after. Every check prints its result; "FAIL" marks a real problem.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '15 years')::date::text;
  v_l1 uuid := gen_random_uuid();      -- an adult learner
  v_l2 uuid := gen_random_uuid();      -- another adult
  v_parent uuid := gen_random_uuid();
  v_child uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  v_tutor2 uuid := gen_random_uuid();
  v_tutor3 uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_id uuid; v_id2 uuid; v_old uuid; v_cnt int; n int; t text;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l1, z,'authenticated','authenticated','w.l1.'||v_l1||'@example.invalid', jsonb_build_object('role','student','date_of_birth',adult), '{}'),
    (v_l2, z,'authenticated','authenticated','w.l2.'||v_l2||'@example.invalid', jsonb_build_object('role','student','date_of_birth',adult), '{}'),
    (v_parent, z,'authenticated','authenticated','w.pa.'||v_parent||'@example.invalid', jsonb_build_object('role','parent','date_of_birth',adult,'phone_number','081 234 5678'), '{}'),
    (v_tutor, z,'authenticated','authenticated','w.t1.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor','first_name','T','date_of_birth',adult), '{}'),
    (v_tutor2, z,'authenticated','authenticated','w.t2.'||v_tutor2||'@example.invalid', jsonb_build_object('role','tutor','first_name','T2','date_of_birth',adult), '{}'),
    (v_tutor3, z,'authenticated','authenticated','w.t3.'||v_tutor3||'@example.invalid', jsonb_build_object('role','tutor','first_name','T3','date_of_birth',adult), '{}'),
    (v_admin, z,'authenticated','authenticated','w.ad.'||v_admin||'@example.invalid', '{}'::jsonb, '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_child, z,'authenticated','authenticated','w.ch.'||v_child||'@example.invalid',
       jsonb_build_object('role','student','date_of_birth',minor), jsonb_build_object('created_by_guardian', v_parent, 'relationship','mother'));
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_admin, 'T', 'Admin', 'x@example.invalid', '');
  update profiles set date_of_birth = adult::date where id in (v_tutor, v_tutor2, v_tutor3);

  -- Nobody teaches Astronomy, so every search for it is a dead end.
  select count(*) into n from available_price_levels('Astronomy', 'Grade 11', null);
  r := r || format('W0 setup: no tutor can take Astronomy, Grade 11: levels=%s (want 0)', n) || E'\n';

  -- ---- joining -------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_l1, 'role','authenticated')::text, true);
  set local role authenticated;
  v_id := public.join_tutor_waitlist(v_l1, 'Astronomy', 'Grade 11', null);
  select count(*) into v_cnt from tutor_waitlist where requested_by = v_l1 and notified_at is null;
  r := r || format('W1 a learner joins for themselves: id returned=%s, own open entries=%s (want true, 1)', v_id is not null, v_cnt) || E'\n';

  v_id2 := public.join_tutor_waitlist(v_l1, '  astronomy ', 'grade 11 ', null);
  select count(*) into v_cnt from tutor_waitlist where requested_by = v_l1 and notified_at is null;
  r := r || format('W2 joining again (other case and spaces) returns the same entry: same=%s, open entries=%s (want true, 1)', v_id2 = v_id, v_cnt) || E'\n';

  begin
    perform public.join_tutor_waitlist(v_l1, '   ', 'Grade 11', null);
    r := r || 'W3 FAIL: a blank subject was accepted' || E'\n';
  exception when others then r := r || format('W3 a blank subject is refused: %s', sqlerrm) || E'\n'; end;

  begin
    insert into tutor_waitlist (student_id, requested_by, subject) values (v_l1, v_l1, 'Direct');
    r := r || 'W4 FAIL: a direct insert worked' || E'\n';
  exception when others then r := r || format('W4 a direct insert is refused: %s', sqlerrm) || E'\n'; end;
  begin
    update tutor_waitlist set subject = 'Changed' where id = v_id;
    get diagnostics n = row_count;
    r := r || format('W4b a direct update changed %s row(s) (want it refused or 0)', n) || E'\n';
  exception when others then r := r || format('W4b a direct update is refused: %s', sqlerrm) || E'\n'; end;
  begin
    delete from tutor_waitlist where id = v_id;
    get diagnostics n = row_count;
    r := r || format('W4c a direct delete removed %s row(s) (want it refused or 0)', n) || E'\n';
  exception when others then r := r || format('W4c a direct delete is refused: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- a parent joins for their child (the learner under 18)
  perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    v_id2 := public.join_tutor_waitlist(v_child, 'Astronomy', 'Grade 11', null);
    select count(*) into v_cnt from tutor_waitlist where requested_by = v_parent and student_id = v_child;
    r := r || format('W5 a parent joins for their child: entries=%s (want 1)', v_cnt) || E'\n';
  exception when others then r := r || format('W5 FAIL: the parent could not join for their child: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- someone else cannot join for a learner they do not look after, or see others' entries
  perform set_config('request.jwt.claims', json_build_object('sub', v_l2, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.join_tutor_waitlist(v_l1, 'Astronomy', 'Grade 11', null);
    r := r || 'W6 FAIL: an adult joined for another adult' || E'\n';
  exception when others then r := r || format('W6 joining for someone else is refused: %s', sqlerrm) || E'\n'; end;
  begin
    perform public.join_tutor_waitlist(v_child, 'Astronomy', 'Grade 11', null);
    r := r || 'W6b FAIL: a stranger joined for someone else''s child' || E'\n';
  exception when others then r := r || format('W6b joining for a stranger''s child is refused: %s', sqlerrm) || E'\n'; end;
  select count(*) into v_cnt from tutor_waitlist;
  r := r || format('W7 another person sees none of those entries: %s (want 0)', v_cnt) || E'\n';
  reset role;

  -- signed out
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.join_tutor_waitlist(v_l1, 'Astronomy', 'Grade 11', null);
    r := r || 'W8 FAIL: a signed-out caller joined' || E'\n';
  exception when others then r := r || format('W8 signed out is refused: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- the limit of 10 open entries
  perform set_config('request.jwt.claims', json_build_object('sub', v_l2, 'role','authenticated')::text, true);
  set local role authenticated;
  for i in 1..10 loop
    perform public.join_tutor_waitlist(v_l2, 'Subject' || i, 'Grade 10', null);
  end loop;
  select count(*) into v_cnt from tutor_waitlist where requested_by = v_l2 and notified_at is null;
  r := r || format('W9 ten open entries are allowed: %s (want 10)', v_cnt) || E'\n';
  begin
    perform public.join_tutor_waitlist(v_l2, 'Subject11', 'Grade 10', null);
    r := r || 'W9b FAIL: an 11th open entry was accepted' || E'\n';
  exception when others then r := r || format('W9b an 11th is refused: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- an admin sees everything (the count of unmet demand)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from tutor_waitlist where notified_at is null;
  r := r || format('W10 an admin sees all open entries: %s (want at least 12: 1 + 1 + 10)', v_cnt) || E'\n';
  reset role;

  -- ---- telling people ---------------------------------------------------------------------------------------------
  -- Tutor 1 is approved and teaches Mathematics: this is NOT what the entries asked for.
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null where id = v_tutor;
  insert into tutor_subject_competencies (tutor_id, subject_name, min_grade_level, max_grade_level, verification_status)
    values (v_tutor, 'Mathematics', 'Grade 8', 'Grade 12', 'verified');
  update tutor_profiles set is_verified = true where id = v_tutor;
  select count(*) into v_cnt from notifications where type = 'tutor_available' and profile_id in (v_l1, v_parent, v_l2);
  r := r || format('W11 an approved tutor for a different subject tells nobody: notifications=%s (want 0)', v_cnt) || E'\n';

  -- Tutor 1 adds Astronomy for Grades 8 to 12: now the Astronomy, Grade 11 entries have a tutor.
  insert into tutor_subject_competencies (tutor_id, subject_name, min_grade_level, max_grade_level, verification_status)
    values (v_tutor, 'Astronomy', 'Grade 8', 'Grade 12', 'verified');
  select count(*) into v_cnt from notifications where type = 'tutor_available' and profile_id = v_l1;
  select count(*) into n from notifications where type = 'tutor_available' and profile_id = v_parent;
  r := r || format('W12 the learner and the parent are each told once: learner=%s, parent=%s (want 1, 1)', v_cnt, n) || E'\n';
  select count(*) into v_cnt from notifications where type = 'tutor_available' and profile_id = v_l2;
  r := r || format('W13 the person waiting for other subjects is not told: %s (want 0)', v_cnt) || E'\n';
  select count(*) into v_cnt from tutor_waitlist where notified_at is not null and subject ilike 'Astronomy';
  select count(*) into n from tutor_waitlist where notified_at is null and subject ilike 'Subject%';
  r := r || format('W14 the two Astronomy entries are marked told (%s, want 2) and the other ten are still open (%s, want 10)', v_cnt, n) || E'\n';
  select title || ' / ' || body into t from notifications where type = 'tutor_available' and profile_id = v_l1;
  r := r || format('W15 what the learner is told: %s', t) || E'\n';

  -- A second Astronomy tutor must not tell them again.
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null where id = v_tutor2;
  insert into tutor_subject_competencies (tutor_id, subject_name, min_grade_level, max_grade_level, verification_status)
    values (v_tutor2, 'Astronomy', 'Grade 8', 'Grade 12', 'verified');
  update tutor_profiles set is_verified = true where id = v_tutor2;
  select count(*) into v_cnt from notifications where type = 'tutor_available' and profile_id in (v_l1, v_parent);
  r := r || format('W16 a second tutor does not tell them again: total notifications=%s (want 2)', v_cnt) || E'\n';

  -- Joining is now refused: a tutor is available.
  perform set_config('request.jwt.claims', json_build_object('sub', v_l1, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.join_tutor_waitlist(v_l1, 'Astronomy', 'Grade 11', null);
    r := r || 'W17 FAIL: joined although a tutor is available' || E'\n';
  exception when others then r := r || format('W17 joining is refused once a tutor is available: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- Approving a tutor who already has the subject verified also tells people (the other trigger).
  perform set_config('request.jwt.claims', json_build_object('sub', v_l1, 'role','authenticated')::text, true);
  set local role authenticated;
  v_old := public.join_tutor_waitlist(v_l1, 'Chess', 'Grade 9', null);
  reset role;
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null where id = v_tutor3;
  insert into tutor_subject_competencies (tutor_id, subject_name, min_grade_level, max_grade_level, verification_status)
    values (v_tutor3, 'Chess', 'Grade 8', 'Grade 12', 'verified');
  select notified_at is null into t from tutor_waitlist where id = v_old;
  r := r || format('W18 a subject verified for a tutor who is not approved yet tells nobody: still open=%s (want true)', t) || E'\n';
  update tutor_profiles set is_verified = true where id = v_tutor3;
  select notified_at is not null into t from tutor_waitlist where id = v_old;
  r := r || format('W19 approving that tutor tells the learner: told=%s (want true)', t) || E'\n';

  -- ---- leaving ------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_l1, 'role','authenticated')::text, true);
  set local role authenticated;
  v_id := public.join_tutor_waitlist(v_l1, 'Latin', 'Grade 9', null);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l2, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.leave_tutor_waitlist(v_id);
  reset role;
  select count(*) into v_cnt from tutor_waitlist where id = v_id;
  r := r || format('W20 someone else cannot remove my entry: rows left=%s (want 1)', v_cnt) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v_l1, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.leave_tutor_waitlist(v_id);
  reset role;
  select count(*) into v_cnt from tutor_waitlist where id = v_id;
  r := r || format('W21 I can remove my own entry: rows left=%s (want 0)', v_cnt) || E'\n';

  -- ---- expiry and clean-up ---------------------------------------------------------------------------------------------
  -- An open entry older than 60 days is not told, and is replaced when the person joins again.
  insert into tutor_waitlist (id, student_id, requested_by, subject, grade_level, created_at)
    values (gen_random_uuid(), v_l1, v_l1, 'Dutch', 'Grade 9', now() - interval '61 days') returning id into v_old;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l1, 'role','authenticated')::text, true);
  set local role authenticated;
  v_id := public.join_tutor_waitlist(v_l1, 'Dutch', 'Grade 9', null);
  reset role;
  select count(*) into v_cnt from tutor_waitlist where id = v_old;
  r := r || format('W22 joining again replaces an expired entry: old rows=%s, new entry is different=%s (want 0, true)', v_cnt, v_id <> v_old) || E'\n';
  insert into tutor_waitlist (student_id, requested_by, subject, grade_level, created_at)
    values (v_l2, v_l2, 'Hebrew', 'Grade 9', now() - interval '61 days') returning id into v_old;
  insert into tutor_subject_competencies (tutor_id, subject_name, min_grade_level, max_grade_level, verification_status)
    values (v_tutor, 'Hebrew', 'Grade 8', 'Grade 12', 'verified');
  select notified_at is null into t from tutor_waitlist where id = v_old;
  r := r || format('W23 an expired entry is not told: still open=%s (want true)', t) || E'\n';

  -- The daily purge: 100-day-old told and open entries go; a recent one stays.
  insert into tutor_waitlist (student_id, requested_by, subject, created_at, notified_at) values (v_l2, v_l2, 'OldTold', now() - interval '101 days', now() - interval '100 days');
  insert into tutor_waitlist (student_id, requested_by, subject, created_at) values (v_l2, v_l2, 'OldOpen', now() - interval '100 days');
  insert into tutor_waitlist (student_id, requested_by, subject, created_at, notified_at) values (v_l2, v_l2, 'RecentTold', now() - interval '10 days', now() - interval '5 days');
  n := public.purge_old_tutor_waitlist();
  select count(*) into v_cnt from tutor_waitlist where subject in ('OldTold','OldOpen');
  r := r || format('W24 the purge removed %s row(s) (want at least 2); old rows left=%s (want 0)', n, v_cnt) || E'\n';
  select count(*) into v_cnt from tutor_waitlist where subject = 'RecentTold';
  r := r || format('W25 a recently told entry stays: %s (want 1)', v_cnt) || E'\n';

  -- ---- who may call what -------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_l1, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.purge_old_tutor_waitlist();
    r := r || 'W26 FAIL: a signed-in user ran the purge' || E'\n';
  exception when others then r := r || format('W26 the purge is not callable by signed-in users: %s', sqlerrm) || E'\n'; end;
  begin
    perform public.notify_tutor_waitlist();
    r := r || 'W27 FAIL: a signed-in user ran the notifier' || E'\n';
  exception when others then r := r || format('W27 the notifier is not callable by signed-in users: %s', sqlerrm) || E'\n'; end;
  reset role;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select count(*) into v_cnt from cron.job where jobname = 'purge-old-tutor-waitlist';
    r := r || format('W28 the daily purge is scheduled: jobs=%s (want 1)', v_cnt) || E'\n';
  else
    r := r || 'W28 pg_cron is not installed here, so no job was scheduled (the migration skips it)' || E'\n';
  end if;

  raise exception 'TUTOR WAITLIST TEST (rolled back): %', r;
end $$;
